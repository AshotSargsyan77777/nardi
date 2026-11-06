import { TournamentsService } from '../src/game/tournaments.service';
import { viewMoveOptions } from '@nardi/engine';
import { MailService } from '../src/common/mail.service';
import { QuestsService } from '../src/users/quests.service';
import { INestApplication } from '@nestjs/common';
import { MatchDTO } from '@nardi/engine';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { LedgerService } from '../src/ledger/ledger.service';
import { SettingsService } from '../src/settings/settings.service';
import { ReferralsService } from '../src/users/referrals.service';
import { autoActionFor, autoPlay, bootApp, connect, post, prismaOf, registerUser, sleep, TestUser } from './helpers';

jest.setTimeout(180_000);

describe('NARDI API end-to-end', () => {
  let app: INestApplication;
  let admin: TestUser;

  beforeAll(async () => {
    app = await bootApp();
    admin = await registerUser(app, 'boss_admin');
    await prismaOf(app).user.update({ where: { id: admin.id }, data: { role: 'SUPERADMIN', tokenVersion: { increment: 1 } } });
    // re-login to get a token carrying the new role/version
    const csrf = (await admin.agent.get('/api/auth/csrf')).body.csrfToken;
    const res = await admin.agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'boss_admin', password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    admin.csrf = /bb_csrf=([^;]+)/.exec(([] as string[]).concat(res.headers['set-cookie']).join(';'))![1];
  });
  afterAll(async () => app.close());

  describe('auth & security', () => {
    it('requires a CSRF token for cookie-authenticated mutations', async () => {
      const u = await registerUser(app);
      const r = await u.agent.patch('/api/users/me').send({ avatar: 'lion' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('CSRF');
      const ok = await u.agent.patch('/api/users/me').set('x-csrf-token', u.csrf).send({ avatar: 'lion' });
      expect(ok.status).toBe(200);
      expect(ok.body.avatar).toBe('lion');
    });

    it('accepts a real image as a profile photo and serves it; rejects anything else', async () => {
      const u = await registerUser(app);
      const send = (image: string) => u.agent.post('/api/users/me/photo').set('x-csrf-token', u.csrf).send({ image });
      // HTML pretending to be a PNG
      expect((await send(`data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`)).status).toBe(400);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
      const ok = await send(`data:image/png;base64,${png.toString('base64')}`);
      expect(ok.status).toBe(200);
      expect(ok.body.avatar).toMatch(/^photo:/);
      const img = await request(app.getHttpServer()).get(`/api/avatars/${ok.body.avatar.slice(6)}`);
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toBe('image/png');
      // choosing a picture from the set drops the photo
      const back = await u.agent.patch('/api/users/me').set('x-csrf-token', u.csrf).send({ avatar: 'lion' });
      expect(back.body.avatar).toBe('lion');
      expect((await request(app.getHttpServer()).get(`/api/avatars/${ok.body.avatar.slice(6)}`)).status).toBe(404);
    });

    it('lets players block and report each other', async () => {
      const a = await registerUser(app);
      const b = await registerUser(app);
      const post = (u: any, path: string, body?: object) => u.agent.post(path).set('x-csrf-token', u.csrf).send(body ?? {});
      expect((await post(a, `/api/users/profile/${b.nickname}/block`)).status).toBe(200);
      expect((await a.agent.get(`/api/users/profile/${b.nickname}`)).body.blocked).toBe(true);
      expect((await a.agent.get('/api/users/me/blocks')).body.map((x: any) => x.nickname)).toEqual([b.nickname]);
      expect((await post(a, `/api/users/profile/${a.nickname}/block`)).status).toBe(400); // not yourself
      expect((await post(a, `/api/users/profile/${b.nickname}/report`, { reason: 'abuse', details: 'rude in chat' })).status).toBe(200);
      expect((await post(a, `/api/users/profile/${b.nickname}/report`, { reason: 'nonsense' })).status).toBe(400);
      expect((await a.agent.delete(`/api/users/profile/${b.nickname}/block`).set('x-csrf-token', a.csrf)).status).toBe(200);
      expect((await a.agent.get(`/api/users/profile/${b.nickname}`)).body.blocked).toBe(false);
    });

    it('friends: request, accept, list, invite to a room', async () => {
      const a = await registerUser(app);
      const b = await registerUser(app);
      const post = (u: any, path: string, body?: object) => u.agent.post(path).set('x-csrf-token', u.csrf).send(body ?? {});
      expect((await post(a, `/api/friends/${b.nickname}`)).body.status).toBe('requested');
      expect((await b.agent.get('/api/friends')).body.incoming.map((x: any) => x.nickname)).toEqual([a.nickname]);
      expect((await a.agent.get(`/api/users/profile/${b.nickname}`)).body.friendship).toBe('sent');
      expect((await post(b, `/api/friends/${a.nickname}/accept`)).body.status).toBe('friends');
      expect((await a.agent.get('/api/friends')).body.friends.map((x: any) => x.nickname)).toEqual([b.nickname]);
      const room = (await post(a, '/api/rooms', { rules: { targetScore: 3 }, stake: 0, currency: 'FUN', chatEnabled: true, allowBots: true })).body;
      expect((await post(a, `/api/friends/${b.nickname}/invite`, { roomCode: room.code })).status).toBe(200);
      const c = await registerUser(app);
      expect((await post(a, `/api/friends/${c.nickname}/invite`, { roomCode: room.code })).status).toBe(403); // not a friend
      expect((await a.agent.delete(`/api/friends/${b.nickname}`).set('x-csrf-token', a.csrf)).status).toBe(200);
      expect((await a.agent.get('/api/friends')).body.friends).toEqual([]);
    });

    it('lets a friend watch a match', async () => {
      const a = await registerUser(app);
      const b = await registerUser(app);
      const post = (u: any, path: string, body?: object) => u.agent.post(path).set('x-csrf-token', u.csrf).send(body ?? {});
      const matchId = (await post(a, '/api/matches/practice', {})).body.matchId;
      const sb = await connect(b);
      const denied: any = await sb.emitWithAck('match:watch', { matchId });
      expect(denied.error.code).toBe('NOT_FRIENDS');
      await post(a, `/api/friends/${b.nickname}`);
      await post(b, `/api/friends/${a.nickname}/accept`);
      const ok: any = await sb.emitWithAck('match:watch', { matchId });
      expect(ok.state.view.seat).toBeNull();
      expect(ok.state.view.board.points).toHaveLength(24);
      expect(JSON.stringify(ok.state)).not.toMatch(/"rolls"/);
      sb.close();
    });

    it('push: hands out a VAPID key and stores a subscription', async () => {
      const u = await registerUser(app);
      const key = (await u.agent.get('/api/push/key')).body.publicKey;
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(40);
      const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'BKx'.padEnd(87, 'A'), auth: 'x'.padEnd(22, 'y') } };
      expect((await u.agent.post('/api/push/subscribe').set('x-csrf-token', u.csrf).send(sub)).status).toBe(200);
      expect((await u.agent.post('/api/push/subscribe').set('x-csrf-token', u.csrf).send({ ...sub, endpoint: 'http://evil' })).status).toBe(400);
      expect((await u.agent.post('/api/push/unsubscribe').set('x-csrf-token', u.csrf).send({ endpoint: sub.endpoint })).status).toBe(200);
    });

    it('refuses a nickname that only looks different', async () => {
      const base = `Aram${Date.now() % 100000}`;
      await registerUser(app, base);
      const agent = request.agent(app.getHttpServer());
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const reg = (nickname: string) => agent.post('/api/auth/register').set('x-csrf-token', csrf).send({ email: `${randomUUID()}@example.com`, nickname, password: 'correct-horse-battery', acceptTerms: true, ageConfirmed: true });
      const cyr = base.replace('A', 'А'); // Cyrillic capital A, rest Latin -> mixed alphabets
      expect((await reg(cyr)).status).toBe(400);
      expect((await reg(base.toLowerCase())).status).toBe(409);
      // an all-Cyrillic name that looks exactly like an existing Latin one
      const n = Date.now() % 100000;
      await registerUser(app, `Ope${n}`);
      expect((await reg(`Оре${n}`)).status).toBe(409);
    });

    it('rejects wrong passwords and unknown fields', async () => {
      const agent = request.agent(app.getHttpServer());
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      expect((await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'boss_admin', password: 'nope' })).status).toBe(401);
      const r = await agent.post('/api/auth/register').set('x-csrf-token', csrf).send({ email: 'x@y.z', nickname: 'abc', password: 'longenough1', acceptTerms: true, ageConfirmed: true, role: 'ADMIN' });
      expect(r.status).toBe(400);
    });

    it('rotates refresh tokens and detects reuse', async () => {
      const u = await registerUser(app);
      const server = app.getHttpServer();
      const cookieOf = (res: any, name: string) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => new RegExp(`^${name}=([^;]+)`).exec(c)?.[1]).find(Boolean)!;
      const csrf = (await request(server).get('/api/auth/csrf')).body.csrfToken;
      const login = await request(server).post('/api/auth/login').set('Cookie', `bb_csrf=${csrf}`).set('x-csrf-token', csrf).send({ login: u.nickname, password: 'correct-horse-battery' });
      const rt1 = cookieOf(login, 'bb_rt');
      const c1 = cookieOf(login, 'bb_csrf');
      const refresh = (rt: string) => request(server).post('/api/auth/refresh').set('Cookie', `bb_rt=${rt}; bb_csrf=${c1}`).set('x-csrf-token', c1);
      const r1 = await refresh(rt1);
      expect(r1.status).toBe(200);
      const rt2 = cookieOf(r1, 'bb_rt');
      expect(rt2).toBeDefined();
      expect(rt2).not.toBe(rt1);
      // replaying the already-rotated token is detected ...
      expect((await refresh(rt1)).status).toBe(401);
      // ... and revokes the whole family, including the newest token
      expect((await refresh(rt2)).status).toBe(401);
      const flags = await prismaOf(app).suspiciousFlag.findMany({ where: { userId: u.id, type: 'REFRESH_TOKEN_REUSE' } });
      expect(flags.length).toBeGreaterThanOrEqual(1);
    });

    it('protects admin endpoints by role', async () => {
      const u = await registerUser(app);
      expect((await u.agent.get('/api/admin/analytics/overview')).status).toBe(403);
      expect((await request(app.getHttpServer()).get('/api/admin/analytics/overview')).status).toBe(401);
      expect((await admin.agent.get('/api/admin/analytics/overview')).status).toBe(200);
    });
  });

  describe('chess and checkers', () => {
    for (const game of ['checkers', 'chess'] as const) {
      it(`plays a whole ${game} game against a bot`, async () => {
        const u = await registerUser(app);
        const s = await connect(u);
        // chess against a bot can go on for long: after 20 moves the player resigns
        const done = game === 'chess'
          ? new Promise<MatchDTO>((resolve) => s.on('match:state', (d: MatchDTO) => {
              const v: any = d.view;
              if (v.status === 'finished') return resolve(d);
              const action = v.sans?.length >= 20 && v.turn === v.seat ? { type: 'resign' } : autoActionFor(v);
              if (action) s.emit('match:action', { matchId: d.matchId, version: v.version, actionId: randomUUID(), action });
            }))
          : autoPlay(s);
        const r = await post(u, '/api/matches/practice', { rules: { game, botLevel: 'easy', ...(game === 'chess' ? { clockMin: 15, clockInc: 10 } : {}) } });
        expect(r.status).toBe(201);
        // the first state comes with the start
        const first = (await u.agent.get(`/api/matches/${r.body.matchId}/state`)).body;
        expect(first.view.game).toBe(game);
        s.listeners('match:state').forEach((fn) => fn(first));
        const final = await done;
        expect(final.view.status).toBe('finished');
        const m = await prismaOf(app).match.findUniqueOrThrow({ where: { id: r.body.matchId }, include: { players: true } });
        expect(m.status).toBe('FINISHED');
        expect((m.rules as any).game).toBe(game);
        const me = m.players.find((p) => p.userId === u.id)!;
        expect(['WIN', 'LOSS', 'DRAW']).toContain(me.result);
        if (me.result === 'DRAW') expect(m.winnerTeam).toBeNull();
        s.close();
      }, 240_000);
    }

    it('resigns, offers and declines draws between two players', async () => {
      const [a, b] = await Promise.all([registerUser(app), registerUser(app)]);
      const room = (await post(a, '/api/rooms', { rules: { game: 'chess', clockMin: 3, clockInc: 2 } })).body;
      expect(room.settings.rules).toMatchObject({ game: 'chess', clockMin: 3, clockInc: 2 });
      expect((await post(b, `/api/rooms/${room.code}/join`)).status).toBe(200);
      await post(b, `/api/rooms/${room.code}/ready`, { ready: true });
      await post(a, `/api/rooms/${room.code}/ready`, { ready: true });
      const [sa, sb] = await Promise.all([connect(a), connect(b)]);
      const started = (await post(a, `/api/rooms/${room.code}/start`)).body;
      const matchId = started.matchId;
      const state = async (u: typeof a) => (await u.agent.get(`/api/matches/${matchId}/state`)).body;
      const act = (s: typeof sa, d: any, action: any) => s.emitWithAck('match:action', { matchId, version: d.view.version, actionId: randomUUID(), action });
      let da = await state(a);
      expect(da.view.clock.left).toEqual([180000, 180000]);
      const white = da.view.seat === 0 ? sa : sb;
      const whiteUser = da.view.seat === 0 ? a : b;
      const blackSock = white === sa ? sb : sa;
      const blackUser = white === sa ? b : a;
      da = await state(whiteUser);
      expect(await act(white, da, { type: 'move', move: { from: 52, to: 36 } })).toMatchObject({ ok: true }); // e2-e4
      let db = await state(blackUser);
      expect(db.view.sans).toEqual(['e4']);
      expect(await act(blackSock, db, { type: 'offer_draw' })).toMatchObject({ ok: true });
      da = await state(whiteUser);
      expect(da.view.drawOffer).toBe(1);
      expect(await act(white, da, { type: 'decline_draw' })).toMatchObject({ ok: true });
      db = await state(blackUser);
      expect(db.view.drawOffer).toBeNull();
      expect(await act(blackSock, db, { type: 'resign' })).toMatchObject({ ok: true });
      await sleep(200);
      const m = await prismaOf(app).match.findUniqueOrThrow({ where: { id: matchId }, include: { players: true } });
      expect(m.status).toBe('FINISHED');
      expect(m.finishReason).toBe('resign');
      expect(m.players.find((p) => p.userId === whiteUser.id)!.result).toBe('WIN');
      sa.close();
      sb.close();
    });
  });

  describe('private room with bots (practice chips, no stake)', () => {
    it('runs a full match server-side and records the result', async () => {
      const host = await registerUser(app);
      const room = (await post(host, '/api/rooms', { rules: { variant: 'short', targetScore: 3, turnTimeoutSec: 45 }, stake: 0, currency: 'FUN', chatEnabled: true, allowBots: true })).body;
      expect(room.code).toHaveLength(6);
      expect(room.status).toBe('WAITING');
      expect(room.seats).toHaveLength(2);
      expect((await post(host, `/api/rooms/${room.code}/start`)).status).toBe(409); // nobody on the other seat
      await post(host, `/api/rooms/${room.code}/bots`, { seat: 1 });
      const ready = (await post(host, `/api/rooms/${room.code}/ready`, { ready: true })).body;
      expect(ready.status).toBe('READY');

      const s1 = await connect(host);
      const seen: MatchDTO[] = [];
      const p1 = autoPlay(s1, (d) => seen.push(d));
      const started = (await post(host, `/api/rooms/${room.code}/start`)).body;
      expect(started.status).toBe('PLAYING');
      // a second start (double click) must not create another match
      expect((await post(host, `/api/rooms/${room.code}/start`)).status).toBe(409);

      const final = await p1;
      expect(final.view.status).toBe('finished');
      expect(final.view.winnerTeam).not.toBeNull();
      expect(Math.max(...final.view.scores)).toBeGreaterThanOrEqual(3);
      for (const d of seen) {
        // the dice of the game being played are never sent ahead of time
        expect(JSON.stringify(d.view)).not.toMatch(/"rolls"/);
        if (d.view.status === 'playing') expect(d.revealedDice.every((r) => r.game < d.view.handNumber)).toBe(true);
      }
      // fairness: every finished game reveals dice matching its commitment
      expect(final.revealedDice.length).toBeGreaterThan(0);

      const summary = (await host.agent.get(`/api/matches/${final.matchId}`)).body;
      expect(summary.status).toBe('FINISHED');
      expect(summary.fairness.every((f: any) => f.verified)).toBe(true);
      const hist = (await host.agent.get('/api/users/me/matches')).body;
      expect(hist.items[0].matchId).toBe(final.matchId);
      expect((await host.agent.get(`/api/rooms/${room.code}`)).body.status).toBe('FINISHED');
      const stats = (await host.agent.get('/api/users/me/stats')).body;
      expect(stats.matches).toBe(1);
      expect(stats.games).toBeGreaterThan(0);
      expect(stats.shortMatches).toBe(1);
      expect(stats.rolls).toBeGreaterThan(0);
      expect(stats.doublesPct).toBeLessThanOrEqual(100);
      const month = (await host.agent.get('/api/leaderboard?season=month')).body;
      expect(month.items.find((x: any) => x.nickname === host.nickname)?.games).toBe(1);
      const qs = (await host.agent.get('/api/quests')).body;
      const quests = qs.quests;
      expect(quests).toHaveLength(3);
      expect(qs.weekly.target).toBeGreaterThan(1);
      expect(qs.allDone.reward).toBeGreaterThan(0);
      if (!qs.allDone.done) expect((await host.agent.post('/api/quests/all/claim').set('x-csrf-token', host.csrf)).status).toBe(409);
      const notDone = quests.find((q: any) => !q.done);
      if (notDone) expect((await host.agent.post(`/api/quests/${notDone.id}/claim`).set('x-csrf-token', host.csrf)).status).toBe(409);
      const done = quests.find((q: any) => q.done);
      if (done) {
        expect((await host.agent.post(`/api/quests/${done.id}/claim`).set('x-csrf-token', host.csrf)).status).toBe(200);
        expect((await host.agent.post(`/api/quests/${done.id}/claim`).set('x-csrf-token', host.csrf)).status).toBe(409);
      }

      // finished matches are frozen at the database level
      await expect(prismaOf(app).match.update({ where: { id: final.matchId }, data: { scoreTeam0: 999 } })).rejects.toThrow(/can no longer be modified/);
      s1.close();
    });
  });

  describe('two players with a stake (practice chips)', () => {
    it('escrows stakes, pays the winners and rejects stale/duplicate actions', async () => {
      const users = await Promise.all([0, 1].map(() => registerUser(app)));
      const room = (await post(users[0], '/api/rooms', { rules: { variant: 'long', targetScore: 1 }, stake: 100, currency: 'FUN', allowBots: true })).body;
      expect(room.settings.allowBots).toBe(false); // bots are never allowed with stakes
      for (const u of users.slice(1)) await post(u, `/api/rooms/${room.code}/join`);
      for (const u of users) await post(u, `/api/rooms/${room.code}/ready`, { ready: true });
      const sockets = await Promise.all(users.map(connect));

      // stale-version + duplicate protection, tested on the first state received
      const firstState = new Promise<MatchDTO>((res) => sockets[0].once('match:state', res));
      const plays = sockets.map((s) => autoPlay(s));
      await post(users[0], `/api/rooms/${room.code}/start`);
      const first = await firstState;
      const stale: any = await sockets[0].emitWithAck('match:action', { matchId: first.matchId, version: first.view.version - 1, actionId: randomUUID(), action: { type: 'roll' } });
      expect(stale.error.code).toMatch(/STALE_STATE|NOT_YOUR_TURN/);

      const ledger = app.get(LedgerService);
      const escrow = await prismaOf(app).ledgerAccount.findFirst({ where: { type: 'MATCH_ESCROW', matchId: first.matchId } });
      expect(Number(escrow?.balance)).toBe(200);

      const results = await Promise.all(plays);
      const final = results[0];
      const winnerTeam = final.view.winnerTeam!;
      for (const u of users) {
        const seat = final.players.find((p) => p.userId === u.id)!.seat;
        const expected = 10000 + (seat === winnerTeam ? 100 : -100);
        expect(Number(await ledger.balance(u.id, 'FUN'))).toBe(expected);
      }
      const escrowAfter = await prismaOf(app).ledgerAccount.findFirst({ where: { type: 'MATCH_ESCROW', matchId: first.matchId } });
      expect(Number(escrowAfter?.balance)).toBe(0);
      expect((await ledger.verify()).ok).toBe(true);
      sockets.forEach((s) => s.close());
    });
  });

  describe('tournaments', () => {
    it('runs a knock-out with a bye and pays the top three', async () => {
      const tours = app.get(TournamentsService);
      const users = await Promise.all([0, 1, 2].map(() => registerUser(app)));
      const t = await tours.create({ name: 'Test cup', variant: 'short', targetScore: 1, maxPlayers: 4, prizes: [500, 200, 100], startsAt: new Date(Date.now() + 3600_000), minPlayers: 2 });
      for (const u of users) expect((await post(u, `/api/tournaments/${t.id}/join`)).status).toBe(200);
      const list = (await users[0].agent.get('/api/tournaments')).body;
      expect(list.open.find((x: any) => x.id === t.id)).toMatchObject({ players: 3, joined: true });
      // every player keeps playing whatever match they are in
      const sockets = await Promise.all(users.map(connect));
      sockets.forEach((s, k) => {
        // like the web client: a started match is opened right away
        s.on('match:started', async ({ matchId }: { matchId: string }) => {
          const d = (await users[k].agent.get(`/api/matches/${matchId}/state`)).body;
          s.listeners('match:state').forEach((fn) => fn(d));
        });
        s.on('match:state', (d: MatchDTO) => {
          const v = d.view;
          const action = autoActionFor(v);
          if (!action) return;
          s.emitWithAck('match:action', { matchId: d.matchId, version: v.version, actionId: randomUUID(), action }).then((r: any) => { if (process.env.DEBUG_T && r?.error) console.log('ACK', k, JSON.stringify(r).slice(0, 200)); });
        });
      });
      await tours.start(t.id);
      let done: any = null;
      for (let i = 0; i < 560 && !done; i++) {
        await sleep(500);
        const row = await prismaOf(app).tournament.findUniqueOrThrow({ where: { id: t.id } });
        if (row.status === 'FINISHED') done = row;
      }
      expect(done).not.toBeNull();
      const view = (await users[0].agent.get(`/api/tournaments/${t.id}`)).body;
      expect(view.bracket).toHaveLength(2);
      const places = view.players.map((p: any) => p.place).sort();
      expect(places).toEqual([1, 2, 3]);
      const ledger = app.get(LedgerService);
      for (const p of view.players) {
        const u = users.find((x) => x.id === p.userId)!;
        const prize = [500, 200, 100][p.place - 1];
        expect(Number(await ledger.balance(u.id, 'FUN'))).toBe(10000 + prize);
      }
      expect(done.winnerId).toBe(view.players.find((p: any) => p.place === 1).userId);
      expect((await ledger.verify()).ok).toBe(true);
      sockets.forEach((s) => s.close());
    }, 320_000);
  });

  describe('clubs', () => {
    it('creates a club, joins by invite code, ranks members and hands over ownership', async () => {
      const [a, b, c] = await Promise.all([0, 1, 2].map(() => registerUser(app)));
      const name = `Bak ${randomUUID().slice(0, 6)}`;
      const created = await post(a, '/api/clubs', { name, emblem: '🌳', description: 'Մեր բակը' });
      expect(created.status).toBe(200);
      expect((await post(b, '/api/clubs', { name: name.toUpperCase() })).status).toBe(409); // name taken (any case)
      const club = (await a.agent.get(`/api/clubs/${created.body.id}`)).body;
      expect(club.myRole).toBe('OWNER');
      expect(club.inviteCode).toHaveLength(6);
      expect((await b.agent.get(`/api/clubs/${club.id}`)).status).toBe(403); // not a member yet
      expect((await b.agent.get(`/api/clubs/invite/${club.inviteCode.toLowerCase()}`)).body).toMatchObject({ name, members: 1 });
      expect((await post(b, `/api/clubs/invite/${club.inviteCode}/join`)).status).toBe(200);
      expect((await post(c, `/api/clubs/invite/${club.inviteCode}/join`)).status).toBe(200);
      const full = (await b.agent.get(`/api/clubs/${club.id}`)).body;
      expect(full.members).toHaveLength(3);
      expect(full.myRole).toBe('MEMBER');
      // only the owner removes members
      expect((await b.agent.delete(`/api/clubs/${club.id}/members/${c.id}`).set('x-csrf-token', b.csrf)).status).toBe(403);
      expect((await a.agent.delete(`/api/clubs/${club.id}/members/${c.id}`).set('x-csrf-token', a.csrf)).status).toBe(200);
      // the owner leaves: the next member takes over
      expect((await post(a, `/api/clubs/${club.id}/leave`)).status).toBe(200);
      expect((await b.agent.get(`/api/clubs/${club.id}`)).body.myRole).toBe('OWNER');
      expect((await b.agent.get('/api/clubs')).body.items.map((x: any) => x.id)).toContain(club.id);
    });
  });

  describe('password reset', () => {
    it('mails a one-time link that sets a new password', async () => {
      const u = await registerUser(app);
      const mail = app.get(MailService);
      mail.outbox.length = 0;
      const agent = request.agent(app.getHttpServer());
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      // unknown address: same answer, no mail
      expect((await agent.post('/api/auth/forgot').set('x-csrf-token', csrf).send({ email: 'nobody@example.com' })).status).toBe(200);
      expect(mail.outbox).toHaveLength(0);
      expect((await agent.post('/api/auth/forgot').set('x-csrf-token', csrf).send({ email: `${u.nickname}@example.com` })).status).toBe(200);
      expect(mail.outbox).toHaveLength(1);
      const token = decodeURIComponent(mail.outbox[0].text.match(/reset\?token=([^\s]+)/)![1]);
      const r = await agent.post('/api/auth/reset').set('x-csrf-token', csrf).send({ token, password: 'brand-new-password-1' });
      expect(r.status).toBe(200);
      const csrf2 = (await agent.get('/api/auth/csrf')).body.csrfToken;
      // used up
      expect((await agent.post('/api/auth/reset').set('x-csrf-token', csrf2).send({ token, password: 'another-password-2' })).status).toBe(400);
      const login = await agent.post('/api/auth/login').set('x-csrf-token', csrf2).send({ login: u.nickname, password: 'brand-new-password-1' });
      expect(login.status).toBe(200);
      const csrf3 = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const old = await agent.post('/api/auth/login').set('x-csrf-token', csrf3).send({ login: u.nickname, password: 'correct-horse-battery' });
      expect(old.status).toBe(401);
    });
  });

  describe('random matchmaking', () => {
    it('matches two searching players after both accept', async () => {
      const users = await Promise.all([0, 1].map(() => registerUser(app)));
      const sockets = await Promise.all(users.map(connect));
      const matched = sockets.map((s) => new Promise<string>((res) => s.on('mm:status', (st: any) => {
        if (st.state === 'proposal' && !st.proposal.youAccepted) s.emit('mm:respond', { proposalId: st.proposal.id, accept: true });
        if (st.state === 'matched' && st.matchId) res(st.matchId);
      })));
      for (const s of sockets) {
        const r: any = await s.emitWithAck('mm:join', { queue: 'casual@long' });
        expect(r.error).toBeUndefined();
      }
      const ids = await Promise.all(matched);
      expect(new Set(ids).size).toBe(1);
      const m = await prismaOf(app).match.findUniqueOrThrow({ where: { id: ids[0] } });
      expect(m.mode).toBe('RANDOM');
      expect((m.rules as any).variant).toBe('long');
      // clean up: one team leaves -> forfeit
      const leave: any = await sockets[0].emitWithAck('match:leave', { matchId: ids[0] });
      expect(leave.ok).toBe(true);
      await sleep(200);
      expect((await prismaOf(app).match.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe('FINISHED');
      // a match someone walked out of does not count towards quests, for either player
      const quests = app.get(QuestsService) as any;
      for (const u of users) {
        const p = await quests.progress(u.id, new Date(0));
        expect([p.play, p.win, p.random, p.long]).toEqual([0, 0, 0, 0]);
      }
      // per-variant table: the one who stayed is listed with a win, the one who left is not
      const lb = (await request(app.getHttpServer()).get('/api/leaderboard?variant=long&season=month')).body;
      const names = lb.items.map((r: any) => r.nickname);
      expect(names).toContain(users[1].nickname);
      expect(names).not.toContain(users[0].nickname);
      expect(lb.items.find((r: any) => r.nickname === users[1].nickname).points).toBe(3);
      expect((await request(app.getHttpServer()).get('/api/leaderboard?variant=short&season=month')).body.items.map((r: any) => r.nickname)).not.toContain(users[1].nickname);
      sockets.forEach((s) => s.close());
    });
  });


  describe('no payments', () => {
    it('has no purchase or withdrawal endpoints and shows only practice chips', async () => {
      const u = await registerUser(app);
      expect((await u.agent.get('/api/economy/packages')).status).toBe(404);
      expect((await post(u, '/api/withdrawals', { amount: 1000 })).status).toBe(404);
      const cfg = (await u.agent.get('/api/config')).body;
      expect(cfg.currencies.map((c: any) => c.code)).toEqual(['FUN']);
      expect(cfg.features.purchasesEnabled).toBe(false);
      expect(cfg.donate).toBeUndefined();
      expect((await admin.agent.put('/api/admin/settings/donate').set('x-csrf-token', admin.csrf).send({ enabled: true })).status).toBe(400);
    });
  });

  describe('invite a friend', () => {
    it('links the friend at sign-up and pays both once, after enough games', async () => {
      const inviter = await registerUser(app);
      const ledger = app.get(LedgerService);
      const before = Number(await ledger.balance(inviter.id, 'FUN'));
      const agent = request.agent(app.getHttpServer());
      const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
      const nick = `f_${randomUUID().slice(0, 8)}`;
      const reg = await agent.post('/api/auth/register').set('x-csrf-token', csrf).send({ email: `${nick}@example.com`, nickname: nick, password: 'correct-horse-battery', acceptTerms: true, ageConfirmed: true, ref: inviter.nickname.toUpperCase() });
      expect(reg.status).toBe(201);
      const friendId = reg.body.user.id;
      const prisma = prismaOf(app);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: friendId } })).referredById).toBe(inviter.id);
      const friendStart = Number(await ledger.balance(friendId, 'FUN'));

      const refs = app.get(ReferralsService);
      await prisma.$transaction((tx) => refs.onGameFinished(tx, friendId, 2));
      expect(Number(await ledger.balance(inviter.id, 'FUN'))).toBe(before);
      await prisma.$transaction((tx) => refs.onGameFinished(tx, friendId, 3));
      await prisma.$transaction((tx) => refs.onGameFinished(tx, friendId, 4)); // only once
      expect(Number(await ledger.balance(inviter.id, 'FUN'))).toBe(before + 2000);
      expect(Number(await ledger.balance(friendId, 'FUN'))).toBe(friendStart + 1000);

      const sum = (await inviter.agent.get('/api/referrals')).body;
      expect(sum.earned).toBe(2000);
      expect(sum.friends[0]).toMatchObject({ nickname: nick, done: true });
      // an unknown code is ignored, sign-up still works
      const n2 = `g_${randomUUID().slice(0, 8)}`;
      const r2 = await agent.post('/api/auth/register').set('x-csrf-token', (await agent.get('/api/auth/csrf')).body.csrfToken).send({ email: `${n2}@example.com`, nickname: n2, password: 'correct-horse-battery', acceptTerms: true, ageConfirmed: true, ref: 'nobody_here' });
      expect(r2.status).toBe(201);
    });
  });

  describe('admin & audit', () => {
    it('logs privileged actions in a verifiable hash chain that cannot be altered', async () => {
      const u = await registerUser(app);
      await post(admin, `/api/admin/users/${u.id}/block`, { reason: 'spam in chat' });
      expect((await u.agent.get('/api/users/me')).status).toBe(403);
      await post(admin, `/api/admin/users/${u.id}/unblock`);
      const audit = (await admin.agent.get('/api/admin/audit')).body;
      expect(audit.items.map((a: any) => a.action)).toEqual(expect.arrayContaining(['user.block', 'user.unblock']));
      expect((await admin.agent.get('/api/admin/audit/verify')).body.ok).toBe(true);
      await expect(prismaOf(app).auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    });

    it('requires a reason and goes through the ledger for manual balance changes', async () => {
      const u = await registerUser(app);
      expect((await post(admin, `/api/admin/users/${u.id}/adjust`, { currency: 'FUN', amount: 5, reason: 'x', idempotencyKey: randomUUID() })).status).toBe(400);
      const r = await post(admin, `/api/admin/users/${u.id}/adjust`, { currency: 'FUN', amount: -20000, reason: 'test negative', idempotencyKey: randomUUID() });
      expect(r.body.code).toBe('INSUFFICIENT_FUNDS');
    });

    it('returns analytics', async () => {
      const o = (await admin.agent.get('/api/admin/analytics/overview')).body;
      expect(o.users.total).toBeGreaterThan(5);
      expect(o.matches.total).toBeGreaterThanOrEqual(3);
      expect(o.payments).toBeUndefined();
    });
  });
});
