import { QuestsService } from '../src/users/quests.service';
import { INestApplication } from '@nestjs/common';
import { MatchDTO } from '@nardi/engine';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { LedgerService } from '../src/ledger/ledger.service';
import { SettingsService } from '../src/settings/settings.service';
import { ReferralsService } from '../src/users/referrals.service';
import { autoPlay, bootApp, connect, post, prismaOf, registerUser, sleep, TestUser } from './helpers';

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
