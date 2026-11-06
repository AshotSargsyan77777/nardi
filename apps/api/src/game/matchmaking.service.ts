import { PushService } from '../common/push.service';
import { BlocksService } from '../users/blocks.service';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CHESS_CLOCKS, MatchmakingStatus, gameOf, seatCount } from '@nardi/engine';
import { baseRules } from './rooms.service';
import { randomInt, randomUUID } from 'crypto';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { Currency } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { MatchService } from './match.service';
import { RealtimeService } from './realtime.service';
import { StakePolicy } from './stake-policy.service';

interface QueueMeta { id: string; currency: Currency; stake: number; ranked: boolean; rules: Record<string, unknown> }
interface Entry { userId: string; rating: number; level: number; joinedAt: number }
interface Proposal { id: string; queue: QueueMeta; entries: Entry[]; accepted: Set<string>; expiresAt: number; timer: NodeJS.Timeout }

const PROPOSAL_TTL_MS = 15_000;
const QKEY = (q: string) => `mm:q:${q}`;
const UKEY = (u: string) => `mm:u:${u}`;

/**
 * Queue ids: `casual`, `ranked` or `fun:<stake>`, then which game: `@short` / `@long` (nardi, short if
 * left out), `@checkers`, or `@chess:<minutes>+<increment>` (one of the allowed clocks).
 */
export function parseQueue(raw: string): QueueMeta {
  const [base, v = 'short'] = raw.split('@');
  let rules: Record<string, unknown>;
  if (v === 'short' || v === 'long') rules = { game: 'nardi', variant: v };
  else if (v === 'blot') rules = { game: 'blot' };
  else if (v === 'checkers') rules = { game: 'checkers' };
  else {
    const c = /^chess:(\d{1,2})\+(\d{1,2})$/.exec(v);
    if (!c || !CHESS_CLOCKS.some(([m, i]) => m === Number(c[1]) && i === Number(c[2]))) throw new AppError('BAD_QUEUE', 'Unknown queue');
    rules = { game: 'chess', clockMin: Number(c[1]), clockInc: Number(c[2]) };
  }
  const id = `${base}@${v}`;
  if (base === 'casual') return { id, currency: 'FUN', stake: 0, ranked: false, rules };
  if (base === 'ranked') return { id, currency: 'FUN', stake: 0, ranked: true, rules };
  const m = /^fun:(\d{1,7})$/.exec(base);
  if (!m) throw new AppError('BAD_QUEUE', 'Unknown queue');
  return { id, currency: 'FUN', stake: Number(m[1]), ranked: false, rules };
}

/**
 * Random-opponent matchmaking by rating and experience level. The acceptable rating/level spread
 * widens with waiting time. A match starts only after both players confirm readiness.
 */
@Injectable()
export class MatchmakingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MatchmakingService.name);
  private interval: NodeJS.Timeout | null = null;
  private proposals = new Map<string, Proposal>();
  private userProposal = new Map<string, string>();
  private ticking = false;

  constructor(
    private redis: RedisService,
    private matches: MatchService,
    private realtime: RealtimeService,
    private settings: SettingsService,
    private stakes: StakePolicy,
    private prisma: PrismaService,
    private blocks: BlocksService,
    private push: PushService,
  ) {}

  onModuleInit() {
    if (process.env.MATCHMAKER_ENABLED === 'false') return;
    this.interval = setInterval(() => this.tick().catch((e) => this.log.error(e?.message)), 1000);
    this.interval.unref();
  }
  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    for (const p of this.proposals.values()) clearTimeout(p.timer);
  }

  async status(userId: string): Promise<MatchmakingStatus> {
    const pid = this.userProposal.get(userId);
    if (pid) {
      const p = this.proposals.get(pid)!;
      return { state: 'proposal', queue: p.queue.id as any, since: null, proposal: { id: p.id, expiresAt: p.expiresAt, accepted: p.accepted.size, total: 4, youAccepted: p.accepted.has(userId) }, matchId: null };
    }
    const raw = await this.redis.get(UKEY(userId));
    if (raw) {
      const e = JSON.parse(raw);
      const size = (await this.redis.zrangeWithScores(QKEY(e.queue))).length;
      return { state: 'searching', queue: e.queue, since: e.joinedAt, proposal: null, matchId: null, estimatedPlayers: size };
    }
    const active = this.matches.activeMatchOf(userId);
    return { state: active ? 'matched' : 'idle', queue: null, since: null, proposal: null, matchId: active };
  }

  private async emit(userId: string) {
    this.realtime.toUser(userId, 'mm:status', await this.status(userId));
  }

  async join(userId: string, queueId: string) {
    const q = parseQueue(queueId);
    if (this.matches.activeMatchOf(userId)) throw new AppError('ALREADY_IN_MATCH', 'Finish your current match first', 409);
    if (this.userProposal.has(userId) || (await this.redis.get(UKEY(userId)))) return this.status(userId);
    await this.stakes.assertAllowed(q.currency, q.stake, [userId]);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { rating: true, level: true } });
    const entry: Entry = { userId, rating: u.rating, level: u.level, joinedAt: Date.now() };
    await this.enqueue(q.id, entry);
    await this.emit(userId);
    return this.status(userId);
  }

  private async enqueue(queue: string, e: Entry) {
    await this.redis.set(UKEY(e.userId), JSON.stringify({ queue, joinedAt: e.joinedAt, rating: e.rating, level: e.level }), 3600);
    await this.redis.zadd(QKEY(queue), e.rating, e.userId);
  }

  async leave(userId: string) {
    const pid = this.userProposal.get(userId);
    if (pid) await this.respond(userId, pid, false);
    const raw = await this.redis.get(UKEY(userId));
    if (raw) {
      await this.redis.zrem(QKEY(JSON.parse(raw).queue), userId);
      await this.redis.del(UKEY(userId));
    }
    await this.emit(userId);
    return this.status(userId);
  }

  async respond(userId: string, proposalId: string, accept: boolean) {
    const p = this.proposals.get(proposalId);
    if (!p || !p.entries.some((e) => e.userId === userId)) throw new AppError('NO_PROPOSAL', 'This match offer has expired', 404);
    if (!accept) {
      await this.dissolve(p, new Set([userId]));
      return;
    }
    p.accepted.add(userId);
    if (p.accepted.size === p.entries.length) await this.launch(p);
    else for (const e of p.entries) await this.emit(e.userId);
  }

  // ---------------------------------------------------------------- matching loop

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const keys = await this.redis.keys('mm:q:');
      for (const key of keys) await this.matchQueue(key.slice(5));
    } finally {
      this.ticking = false;
    }
  }

  private async entries(queue: string): Promise<Entry[]> {
    const members = await this.redis.zrangeWithScores(QKEY(queue));
    const out: Entry[] = [];
    for (const m of members) {
      const raw = await this.redis.get(UKEY(m.member));
      if (!raw) {
        await this.redis.zrem(QKEY(queue), m.member);
        continue;
      }
      const d = JSON.parse(raw);
      out.push({ userId: m.member, rating: m.score, level: d.level ?? 1, joinedAt: d.joinedAt });
    }
    return out.sort((a, b) => a.rating - b.rating);
  }

  private async matchQueue(queue: string) {
    const meta = parseQueue(queue);
    const list = await this.entries(queue);
    const now = Date.now();
    const size = seatCount(gameOf(meta.rules));
    let i = 0;
    while (i + size <= list.length) {
      const group = list.slice(i, i + size);
      const waited = now - Math.min(...group.map((g) => g.joinedAt));
      const ratingSpread = Math.min(1500, 150 + 25 * Math.floor(waited / 5000));
      const levelSpread = 3 + Math.floor(waited / 10000);
      const rs = group[group.length - 1].rating - group[0].rating;
      const ls = Math.max(...group.map((g) => g.level)) - Math.min(...group.map((g) => g.level));
      // players who blocked each other are never put at one table
      if (rs <= ratingSpread && ls <= levelSpread && !(await this.blocks.anyBlocked(group.map((g) => g.userId)))) {
        await this.propose(meta, group);
        i += size;
      } else i += 1;
    }
    if (meta.id.startsWith('casual@')) {
      const f = await this.settings.effectiveFeatures();
      const after = f.fillCasualWithBotsAfterSec * 1000;
      if (f.practiceBotsEnabled && after > 0) {
        const remaining = (await this.entries(queue)).sort((a, b) => a.joinedAt - b.joinedAt);
        if (remaining.length && now - remaining[0].joinedAt >= after) await this.startWithBots(meta, remaining.slice(0, size - 1));
      }
    }
  }

  private async propose(queue: QueueMeta, group: Entry[]) {
    for (const g of group) await this.redis.zrem(QKEY(queue.id), g.userId);
    const p: Proposal = {
      id: randomUUID(), queue, entries: group, accepted: new Set(), expiresAt: Date.now() + PROPOSAL_TTL_MS,
      timer: setTimeout(() => {
        const notAccepted = new Set(p.entries.filter((e) => !p.accepted.has(e.userId)).map((e) => e.userId));
        this.dissolve(p, notAccepted).catch((e) => this.log.error(e));
      }, PROPOSAL_TTL_MS),
    };
    this.proposals.set(p.id, p);
    for (const g of group) {
      this.userProposal.set(g.userId, p.id);
      await this.emit(g.userId);
      if (!this.realtime.isOnline(g.userId)) this.push.send(g.userId, 'matchFound', '', '/play/random', 0);
    }
  }

  /** Remove a proposal; players in `drop` leave the queue, everybody else is re-queued with their original wait time. */
  private async dissolve(p: Proposal, drop: Set<string>) {
    if (!this.proposals.has(p.id)) return;
    clearTimeout(p.timer);
    this.proposals.delete(p.id);
    for (const e of p.entries) {
      this.userProposal.delete(e.userId);
      if (drop.has(e.userId)) {
        await this.redis.del(UKEY(e.userId));
        this.realtime.toUser(e.userId, 'mm:declined', { proposalId: p.id });
      } else await this.enqueue(p.queue.id, e);
      await this.emit(e.userId);
    }
  }

  private async launch(p: Proposal) {
    clearTimeout(p.timer);
    this.proposals.delete(p.id);
    // who plays white (or who partners whom in blot) is decided by chance
    const seats = [...p.entries];
    for (let k = seats.length - 1; k > 0; k--) {
      const j = randomInt(k + 1);
      [seats[k], seats[j]] = [seats[j], seats[k]];
    }
    try {
      const game = await this.settings.get('game');
      await this.stakes.assertAllowed(p.queue.currency, p.queue.stake, seats.map((s) => s.userId));
      const matchId = await this.matches.create({
        mode: 'RANDOM', rules: { ...baseRules(gameOf(p.queue.rules), game.defaultRules), ...p.queue.rules }, stake: p.queue.stake, currency: p.queue.currency, ranked: p.queue.ranked, chatEnabled: true,
        seats: seats.map((s) => ({ userId: s.userId })),
      });
      for (const e of p.entries) {
        this.userProposal.delete(e.userId);
        await this.redis.del(UKEY(e.userId));
        this.realtime.toUser(e.userId, 'mm:status', { state: 'matched', queue: p.queue.id, since: null, proposal: null, matchId });
      }
    } catch (err: any) {
      this.log.warn(`launch failed: ${err?.message}`);
      for (const e of p.entries) {
        this.userProposal.delete(e.userId);
        this.realtime.toUser(e.userId, 'mm:error', { code: err?.code ?? 'MATCH_FAILED', message: err?.message ?? 'Could not start the match' });
        await this.redis.del(UKEY(e.userId));
        await this.emit(e.userId);
      }
    }
  }

  private async startWithBots(queue: QueueMeta, humans: Entry[]) {
    for (const h of humans) {
      await this.redis.zrem(QKEY(queue.id), h.userId);
      await this.redis.del(UKEY(h.userId));
    }
    const seats: ({ userId: string } | { botName: string })[] = [];
    for (let i = 0; i < seatCount(gameOf(queue.rules)); i++) seats.push(humans[i] ? { userId: humans[i].userId } : { botName: MatchService.botName(i) });
    try {
      const game = await this.settings.get('game');
      const matchId = await this.matches.create({ mode: 'RANDOM', rules: { ...baseRules(gameOf(queue.rules), game.defaultRules), ...queue.rules }, stake: 0, currency: 'FUN', ranked: false, chatEnabled: true, seats });
      for (const h of humans) this.realtime.toUser(h.userId, 'mm:status', { state: 'matched', queue: queue.id, since: null, proposal: null, matchId });
    } catch (e: any) {
      this.log.warn(`bot fill failed: ${e?.message}`);
      for (const h of humans) await this.emit(h.userId);
    }
  }

  queueSizes = async () => {
    const keys = await this.redis.keys('mm:q:');
    const out: Record<string, number> = {};
    for (const k of keys) out[k.slice(5)] = (await this.redis.zrangeWithScores(k)).length;
    return out;
  };
}
