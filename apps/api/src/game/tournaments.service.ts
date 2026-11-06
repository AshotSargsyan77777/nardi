import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { randomInt } from 'crypto';
import { GAME_KINDS, GameKind, kindOf, rulesForKind } from '@nardi/engine';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { PushService } from '../common/push.service';
import { ENV, Env } from '../config/env';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { MatchService } from './match.service';
import { RealtimeService } from './realtime.service';

/** One pairing of the bracket. A null player is a bye; `since` = when the match was first due. */
export interface Pair { a: string | null; b: string | null; matchId?: string | null; winner?: string | null; since?: number }
type Bracket = Pair[][];

/** How long a pairing may wait for a player who is busy in another match before they lose it. */
const BUSY_GRACE_MS = 3 * 60_000;
const TZ_OFFSET_H = 4; // Yerevan

/**
 * Knock-out tournaments: free entry, FC prizes for the top three. Players register before the
 * start time; at the start the bracket is drawn (byes when the count is not a power of two) and each
 * round's matches open for both players at once. A daily tournament is created automatically.
 */
@Injectable()
export class TournamentsService implements OnModuleInit, OnApplicationShutdown {
  private log = new Logger('Tournaments');
  private timer: ReturnType<typeof setInterval> | null = null;
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private matches: MatchService,
    private ledger: LedgerService,
    private realtime: RealtimeService,
    private push: PushService,
    @Inject(ENV) private env: Env,
  ) {}

  onModuleInit() {
    this.matches.onFinished.push((matchId) => this.onMatchFinished(matchId));
    if (!this.env.isTest) this.timer = setInterval(() => this.tick().catch((e) => this.log.error(e?.message ?? e)), 20_000);
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs `fn` after everything already queued for this tournament (one process serves the API). */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.queues.set(id, next);
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => undefined);
    return next;
  }

  // ---------------------------------------------------------------- schedule

  async tick() {
    const features = await this.settings.effectiveFeatures();
    const cfg = (await this.settings.get('game')).tournaments;
    if (features.tournamentsEnabled && cfg.daily) await this.ensureDaily();
    const due = await this.prisma.tournament.findMany({ where: { status: 'REGISTRATION', startsAt: { lte: new Date() } }, select: { id: true } });
    for (const t of due) await this.serial(t.id, () => this.start(t.id));
    const running = await this.prisma.tournament.findMany({ where: { status: 'RUNNING' }, select: { id: true } });
    for (const t of running) await this.serial(t.id, () => this.progress(t.id));
  }

  /** The next daily tournament (today's if its hour has not passed yet, else tomorrow's). */
  async ensureDaily() {
    const cfg = (await this.settings.get('game')).tournaments;
    const local = new Date(Date.now() + TZ_OFFSET_H * 3600_000);
    let startsAt = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), cfg.hour) - TZ_OFFSET_H * 3600_000);
    if (startsAt.getTime() <= Date.now()) startsAt = new Date(startsAt.getTime() + 86400_000);
    const exists = await this.prisma.tournament.findFirst({ where: { auto: true, startsAt } , select: { id: true } });
    if (exists) return;
    const day = Math.floor((startsAt.getTime() + TZ_OFFSET_H * 3600_000) / 86400_000);
    await this.create({ name: 'daily', variant: GAME_KINDS[day % GAME_KINDS.length], targetScore: cfg.targetScore, maxPlayers: cfg.maxPlayers, prizes: cfg.prizes, startsAt, auto: true });
  }

  async create(input: { name: string; variant: GameKind; targetScore: number; maxPlayers: number; prizes: number[]; startsAt: Date; auto?: boolean; minPlayers?: number }) {
    if (![4, 8, 16, 32].includes(input.maxPlayers)) throw new AppError('BAD_TOURNAMENT', 'maxPlayers: 4, 8, 16 or 32');
    if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime()) || input.startsAt.getTime() < Date.now() + 60_000) throw new AppError('BAD_TOURNAMENT', 'The start must be at least a minute from now');
    const game = await this.settings.get('game');
    // chess tournaments play 5+0; nardi plays to the given score
    const rules = rulesForKind(input.variant, game.defaultRules as any, input.variant === 'short' || input.variant === 'long' ? { targetScore: input.targetScore } : {});
    return this.prisma.tournament.create({
      data: {
        name: input.name.slice(0, 60), status: 'REGISTRATION', maxTeams: input.maxPlayers, rules: rules as any, startsAt: input.startsAt,
        prizes: input.prizes.slice(0, 3).map((n) => Math.max(0, Math.floor(n))), auto: !!input.auto, minPlayers: Math.max(2, input.minPlayers ?? 4),
      },
    });
  }

  // ---------------------------------------------------------------- players

  async join(id: string, userId: string) {
    return this.serial(id, async () => {
      const t = await this.prisma.tournament.findUnique({ where: { id }, include: { _count: { select: { entries: true } } } });
      if (!t || t.status !== 'REGISTRATION') throw new AppError('TOURNAMENT_CLOSED', 'Registration is closed', 409);
      if (t._count.entries >= t.maxTeams) throw new AppError('TOURNAMENT_FULL', 'The tournament is full', 409);
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (u?.status !== 'ACTIVE') throw new AppError('PLAYER_UNAVAILABLE', 'Account is not active', 403);
      await this.prisma.tournamentEntry.upsert({ where: { tournamentId_userId: { tournamentId: id, userId } }, create: { tournamentId: id, userId }, update: {} });
      return { ok: true };
    });
  }

  async leave(id: string, userId: string) {
    return this.serial(id, async () => {
      const t = await this.prisma.tournament.findUnique({ where: { id } });
      if (!t || t.status !== 'REGISTRATION') throw new AppError('TOURNAMENT_CLOSED', 'The tournament has already started', 409);
      await this.prisma.tournamentEntry.deleteMany({ where: { tournamentId: id, userId } });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- running

  /** Draws the bracket and opens the first round (or cancels when too few registered). */
  async start(id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id }, include: { entries: true } });
    if (!t || t.status !== 'REGISTRATION') return;
    const players = t.entries.map((e) => e.userId);
    if (players.length < t.minPlayers) {
      await this.prisma.tournament.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      for (const uid of players) {
        await this.prisma.notification.create({ data: { userId: uid, type: 'tournament', title: 'tournament.cancelled', body: '', data: { tournamentId: id } } });
        this.realtime.toUser(uid, 'tournament:update', { tournamentId: id });
      }
      return;
    }
    // random draw; byes go to the first slots so nobody gets two in a row
    for (let i = players.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [players[i], players[j]] = [players[j], players[i]];
    }
    let size = 2;
    while (size < players.length) size *= 2;
    const slots: (string | null)[] = [...players, ...Array(size - players.length).fill(null)];
    const round: Pair[] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = slots[i];
      const b = slots[size - 1 - i];
      round.push({ a, b, winner: a && !b ? a : !a && b ? b : null });
    }
    await this.prisma.tournament.update({ where: { id }, data: { status: 'RUNNING', round: 0, bracket: [round] as any } });
    for (const uid of players) {
      this.push.send(uid, 'tournamentStart', '', `/tournaments/${id}`);
      this.realtime.toUser(uid, 'tournament:update', { tournamentId: id });
    }
    await this.progress(id);
  }

  /**
   * Opens the current round's matches that are not open yet, settles pairings stuck on a busy player,
   * and moves to the next round (or finishes) once every pairing has a winner.
   */
  async progress(id: string) {
    for (let guard = 0; guard < 8; guard++) {
      const t = await this.prisma.tournament.findUnique({ where: { id } });
      if (!t || t.status !== 'RUNNING') return;
      const bracket = t.bracket as unknown as Bracket;
      const round = bracket[t.round];
      let changed = false;
      for (const p of round) {
        if (p.winner || p.matchId || !p.a || !p.b) continue;
        p.since ??= Date.now();
        try {
          p.matchId = await this.matches.create({
            mode: 'TOURNAMENT', tournamentId: id, rules: t.rules as any, stake: 0, currency: 'FUN', ranked: false, chatEnabled: true,
            seats: randomInt(2) ? [{ userId: p.a }, { userId: p.b }] : [{ userId: p.b }, { userId: p.a }],
          });
          const names = await this.prisma.user.findMany({ where: { id: { in: [p.a, p.b] } }, select: { id: true, nickname: true } });
          const nick = (uid: string) => names.find((n) => n.id === uid)?.nickname ?? '';
          this.push.send(p.a, 'tournamentMatch', nick(p.b), `/match/${p.matchId}`);
          this.push.send(p.b, 'tournamentMatch', nick(p.a), `/match/${p.matchId}`);
        } catch (e: any) {
          if (e?.code !== 'ALREADY_IN_MATCH' && e?.code !== 'PLAYER_UNAVAILABLE') throw e;
          // a player is still busy elsewhere: after the grace time the one who is busy loses the pairing
          if (Date.now() - p.since > BUSY_GRACE_MS) {
            const busyA = !!this.matches.activeMatchOf(p.a) || e?.code === 'PLAYER_UNAVAILABLE';
            const busyB = !!this.matches.activeMatchOf(p.b);
            p.winner = busyA && !busyB ? p.b : busyB && !busyA ? p.a : randomInt(2) ? p.a : p.b;
          }
        }
        changed = true;
      }
      if (round.every((p) => p.winner)) {
        if (round.length === 1) {
          await this.prisma.tournament.update({ where: { id }, data: { bracket: bracket as any } });
          await this.finish(t, bracket);
          return;
        }
        const next: Pair[] = [];
        for (let i = 0; i < round.length; i += 2) next.push({ a: round[i].winner!, b: round[i + 1].winner!, winner: null });
        bracket.push(next);
        await this.prisma.tournament.update({ where: { id }, data: { bracket: bracket as any, round: t.round + 1 } });
        this.notifyAll(t.id, bracket);
        continue; // open the next round right away
      }
      if (changed) {
        await this.prisma.tournament.update({ where: { id }, data: { bracket: bracket as any } });
        this.notifyAll(t.id, bracket);
      }
      return;
    }
  }

  private notifyAll(id: string, bracket: Bracket) {
    const ids = new Set(bracket[0].flatMap((p) => [p.a, p.b]).filter((x): x is string => !!x));
    for (const uid of ids) this.realtime.toUser(uid, 'tournament:update', { tournamentId: id });
  }

  /** A tournament match ended: record the winner and move the bracket on. */
  async onMatchFinished(matchId: string) {
    const m = await this.prisma.match.findUnique({ where: { id: matchId }, select: { tournamentId: true, winnerTeam: true, status: true, players: { select: { seat: true, userId: true } } } });
    if (!m?.tournamentId) return;
    const tid = m.tournamentId;
    await this.serial(tid, async () => {
      const t = await this.prisma.tournament.findUnique({ where: { id: tid } });
      if (!t || t.status !== 'RUNNING') return;
      const bracket = t.bracket as unknown as Bracket;
      const p = bracket[t.round]?.find((x) => x.matchId === matchId);
      if (!p || p.winner) return;
      const byWinner = m.winnerTeam === null ? null : m.players.find((x) => x.seat === m.winnerTeam)?.userId ?? null;
      // a drawn chess or checkers game: black goes through (the «Armageddon» rule)
      const black = m.players.find((x) => x.seat === 1)?.userId ?? null;
      p.winner = byWinner ?? (m.status === 'FINISHED' && black ? black : randomInt(2) ? p.a : p.b);
      await this.prisma.tournament.update({ where: { id: tid }, data: { bracket: bracket as any } });
      this.notifyAll(tid, bracket);
      await this.progress(tid);
    });
  }

  /** Places and prizes: 1st, 2nd, and both semi-final losers share 3rd. */
  private async finish(t: Tournament, bracket: Bracket) {
    const final = bracket[bracket.length - 1][0];
    const first = final.winner!;
    const second = final.a === first ? final.b : final.a;
    const thirds = bracket.length >= 2 ? bracket[bracket.length - 2].map((p) => (p.winner === p.a ? p.b : p.a)).filter((x): x is string => !!x) : [];
    const prizes = (t.prizes as number[]) ?? [];
    const places: [string, number][] = [[first, 1], ...(second ? [[second, 2] as [string, number]] : []), ...thirds.map((u) => [u, 3] as [string, number])];
    await this.prisma.$transaction(async (tx) => {
      for (const [uid, place] of places) {
        await tx.tournamentEntry.updateMany({ where: { tournamentId: t.id, userId: uid }, data: { place } });
        const amount = prizes[place - 1] ?? 0;
        if (amount > 0) {
          await this.ledger.post({
            type: 'REWARD', currency: 'FUN', idempotencyKey: `tourney:${t.id}:${uid}`, description: `Tournament place ${place}`, refType: 'tournament', refId: t.id,
            entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -BigInt(amount) }, { account: { type: 'USER_WALLET', userId: uid }, amount: BigInt(amount) }],
          }, tx);
        }
        await tx.notification.create({ data: { userId: uid, type: 'tournament', title: 'tournament.place', body: `${place}`, data: { tournamentId: t.id, place, prize: amount } } });
      }
      await tx.tournament.update({ where: { id: t.id }, data: { status: 'FINISHED', winnerId: first, finishedAt: new Date() } });
    });
    this.notifyAll(t.id, bracket);
  }

  /** Admin: stop a tournament (open matches play on but no longer count). */
  async cancel(id: string) {
    return this.serial(id, async () => {
      const t = await this.prisma.tournament.findUnique({ where: { id } });
      if (!t || t.status === 'FINISHED' || t.status === 'CANCELLED') throw new AppError('TOURNAMENT_CLOSED', 'Already over', 409);
      await this.prisma.tournament.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- reading

  async list(userId: string | null) {
    const [open, recent] = await Promise.all([
      this.prisma.tournament.findMany({ where: { status: { in: ['REGISTRATION', 'RUNNING'] } }, orderBy: { startsAt: 'asc' }, take: 20, include: { _count: { select: { entries: true } } } }),
      this.prisma.tournament.findMany({ where: { status: 'FINISHED' }, orderBy: { finishedAt: 'desc' }, take: 10, include: { _count: { select: { entries: true } } } }),
    ]);
    const mine = userId ? new Set((await this.prisma.tournamentEntry.findMany({ where: { userId, tournamentId: { in: [...open, ...recent].map((t) => t.id) } }, select: { tournamentId: true } })).map((e) => e.tournamentId)) : new Set<string>();
    const winners = await this.prisma.user.findMany({ where: { id: { in: recent.map((t) => t.winnerId).filter((x): x is string => !!x) } }, select: { id: true, nickname: true } });
    const view = (t: (typeof open)[number]) => ({
      id: t.id, name: t.name, status: t.status, startsAt: t.startsAt, finishedAt: t.finishedAt, variant: kindOf(t.rules), targetScore: (t.rules as any)?.targetScore ?? 1, clock: (t.rules as any)?.game === 'chess' ? `${(t.rules as any).clockMin}+${(t.rules as any).clockInc}` : null,
      maxPlayers: t.maxTeams, players: t._count.entries, prizes: t.prizes, joined: mine.has(t.id), auto: t.auto,
      winner: winners.find((w) => w.id === t.winnerId)?.nickname ?? null,
    });
    return { open: open.map(view), recent: recent.map(view) };
  }

  async get(id: string, userId: string | null) {
    const t = await this.prisma.tournament.findUnique({ where: { id }, include: { entries: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw new AppError('NOT_FOUND', 'Tournament not found', 404);
    const users = await this.prisma.user.findMany({ where: { id: { in: t.entries.map((e) => e.userId) } }, select: { id: true, nickname: true, avatar: true, rating: true } });
    const people = new Map(users.map((u) => [u.id, { nickname: u.nickname, avatar: u.avatar, rating: u.rating }]));
    const bracket = (t.bracket as unknown as Bracket).map((round) => round.map((p) => ({ a: p.a, b: p.b, matchId: p.matchId ?? null, winner: p.winner ?? null })));
    const live = bracket[t.round]?.find((p) => userId && (p.a === userId || p.b === userId) && p.matchId && !p.winner);
    return {
      id: t.id, name: t.name, status: t.status, startsAt: t.startsAt, finishedAt: t.finishedAt, round: t.round, auto: t.auto,
      variant: kindOf(t.rules), targetScore: (t.rules as any)?.targetScore ?? 1, clock: (t.rules as any)?.game === 'chess' ? `${(t.rules as any).clockMin}+${(t.rules as any).clockInc}` : null, maxPlayers: t.maxTeams, minPlayers: t.minPlayers, prizes: t.prizes,
      joined: !!userId && people.has(userId), myMatchId: live?.matchId ?? null,
      players: t.entries.filter((e) => people.has(e.userId)).map((e) => ({ userId: e.userId, ...people.get(e.userId)!, place: e.place })),
      bracket,
    };
  }
}
