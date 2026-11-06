import { Injectable } from '@nestjs/common';
import { kindOf } from '@nardi/engine';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

/** A quest: what to do, how many times, and the reward in practice chips (FUN). */
interface Quest { id: string; target: number; reward: number }

/** The site's game sections; every one has its own quests, counted from its own matches only. */
export type Section = 'blot' | 'nardi' | 'checkers' | 'chess';
export const SECTIONS: Section[] = ['blot', 'nardi', 'checkers', 'chess'];
const sectionOfRules = (rules: unknown): Section => {
  const k = kindOf(rules);
  return k === 'short' || k === 'long' ? 'nardi' : k;
};

const COMMON: Quest[] = [
  { id: 'play3', target: 3, reward: 300 },
  { id: 'win1', target: 1, reward: 300 },
  { id: 'win2', target: 2, reward: 500 },
  { id: 'friends1', target: 1, reward: 400 },
  { id: 'random1', target: 1, reward: 400 },
];
const DAILY: Record<Section, Quest[]> = {
  blot: [
    ...COMMON,
    { id: 'bidMade2', target: 2, reward: 300 },
    { id: 'bidHigh1', target: 1, reward: 500 },
    { id: 'hands20', target: 20, reward: 300 },
    { id: 'tricks30', target: 30, reward: 300 },
    { id: 'points100', target: 100, reward: 400 },
    { id: 'combo50', target: 1, reward: 300 },
    { id: 'combo100', target: 1, reward: 500 },
    { id: 'blot1', target: 1, reward: 300 },
    { id: 'kapot1', target: 1, reward: 500 },
    { id: 'noTrump1', target: 1, reward: 500 },
    { id: 'quanche1', target: 1, reward: 500 },
  ],
  nardi: [
    ...COMMON,
    { id: 'games5', target: 5, reward: 300 },
    { id: 'gameWins3', target: 3, reward: 400 },
    { id: 'mars1', target: 1, reward: 500 },
    { id: 'doubles5', target: 5, reward: 300 },
    { id: 'sheshBesh1', target: 1, reward: 300 },
    { id: 'short1', target: 1, reward: 300 },
    { id: 'long1', target: 1, reward: 400 },
  ],
  checkers: [
    ...COMMON,
    { id: 'captures10', target: 10, reward: 300 },
    { id: 'kings1', target: 1, reward: 400 },
    { id: 'multi1', target: 1, reward: 400 },
  ],
  chess: [
    ...COMMON,
    { id: 'mate1', target: 1, reward: 500 },
    { id: 'captures10', target: 10, reward: 300 },
    { id: 'checks5', target: 5, reward: 300 },
    { id: 'castle1', target: 1, reward: 300 },
  ],
};
const WEEKLY: Record<Section, Quest[]> = {
  blot: [{ id: 'wWin10', target: 10, reward: 3000 }, { id: 'wPlay25', target: 25, reward: 2500 }, { id: 'wKapot3', target: 3, reward: 3000 }, { id: 'wBidMade15', target: 15, reward: 3000 }],
  nardi: [{ id: 'wWin10', target: 10, reward: 3000 }, { id: 'wPlay25', target: 25, reward: 2500 }, { id: 'wMars3', target: 3, reward: 3000 }, { id: 'wGames40', target: 40, reward: 3000 }],
  checkers: [{ id: 'wWin10', target: 10, reward: 3000 }, { id: 'wPlay25', target: 25, reward: 2500 }],
  chess: [{ id: 'wWin10', target: 10, reward: 3000 }, { id: 'wPlay25', target: 25, reward: 2500 }, { id: 'wMate3', target: 3, reward: 3000 }],
};
/** Which progress counter a quest reads (anything not listed reads the counter of the same name). */
const COUNTER: Record<string, string> = {
  play3: 'play', win1: 'win', win2: 'win', friends1: 'friends', random1: 'random', wWin10: 'win', wPlay25: 'play',
  bidMade2: 'bidMade', bidHigh1: 'bidHigh', hands20: 'hands', tricks30: 'tricks', points100: 'points', combo50: 'combo50', combo100: 'combo100',
  blot1: 'blot', kapot1: 'kapot', noTrump1: 'noTrump', quanche1: 'quanche', wKapot3: 'kapot', wBidMade15: 'bidMade',
  games5: 'games', gameWins3: 'gameWins', mars1: 'mars', doubles5: 'doubles', sheshBesh1: 'sheshBesh', short1: 'short', long1: 'long', wMars3: 'mars', wGames40: 'games',
  captures10: 'captures', kings1: 'kings', multi1: 'multi', mate1: 'mate', checks5: 'checks', castle1: 'castle', wMate3: 'mate',
};
const PER_DAY = 3;
/** Extra reward for finishing all of the day's quests of a game. */
const ALL_DONE_REWARD = 500;
const TZ_OFFSET_H = 4; // days and weeks turn at midnight Yerevan time

type Progress = Record<string, number>;

/**
 * Three quests a day and one for the week in every game, the same for everybody, checked against
 * that game's finished matches; finishing a game's three daily quests pays a bonus. A match someone
 * walked out of counts for nothing for them; the one who stayed keeps what happened in the games
 * played but not «played / won a match». Rewards are practice chips via the ledger.
 */
@Injectable()
export class QuestsService {
  constructor(private prisma: PrismaService, private ledger: LedgerService) {}

  private local(now = new Date()) {
    return new Date(now.getTime() + TZ_OFFSET_H * 3600_000);
  }
  private toUtc(localMidnight: Date) {
    return new Date(localMidnight.getTime() - TZ_OFFSET_H * 3600_000);
  }
  private day() {
    const key = this.local().toISOString().slice(0, 10);
    return { key, start: this.toUtc(new Date(`${key}T00:00:00.000Z`)) };
  }
  /** Week starting on Monday. */
  private week() {
    const l = this.local();
    const monday = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() - ((l.getUTCDay() + 6) % 7)));
    const key = `w${monday.toISOString().slice(0, 10)}`;
    return { key, start: this.toUtc(monday), index: Math.floor(monday.getTime() / (7 * 86400_000)) };
  }

  private seeded(key: string) {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return () => (h = (h * 1103515245 + 12345) >>> 0);
  }
  private todays(section: Section, key: string) {
    const next = this.seeded(`${key}:${section}`);
    const pool = [...DAILY[section]];
    const out: Quest[] = [];
    while (out.length < PER_DAY) out.push(pool.splice(next() % pool.length, 1)[0]);
    return out;
  }

  private async progress(userId: string, since: Date, section: Section): Promise<Progress> {
    const all = (await this.prisma.matchPlayer.findMany({
      where: { userId, match: { status: 'FINISHED', finishedAt: { gte: since } } },
      select: { matchId: true, seat: true, result: true, match: { select: { mode: true, rules: true, finishReason: true } } },
    })).filter((s) => sectionOfRules(s.match.rules) === section);
    const forfeited = (s: (typeof all)[number]) => s.match.finishReason === 'forfeit';
    // the leaver gets nothing; the one who stayed keeps the games but not the match
    const counted = all.filter((s) => !forfeited(s) || s.result === 'WIN');
    const seats = all.filter((s) => !forfeited(s));
    const p: Progress = {
      play: seats.length, win: seats.filter((s) => s.result === 'WIN').length,
      friends: seats.filter((s) => s.match.mode === 'PRIVATE').length, random: seats.filter((s) => s.match.mode === 'RANDOM').length,
      short: seats.filter((s) => kindOf(s.match.rules) === 'short').length, long: seats.filter((s) => kindOf(s.match.rules) === 'long').length,
    };
    if (!counted.length) return p;
    const seatOf = new Map(counted.map((s) => [s.matchId, s.seat]));
    const ids = [...seatOf.keys()];
    const add = (k: string, n = 1) => (p[k] = (p[k] ?? 0) + n);

    if (section === 'nardi') {
      const events = await this.prisma.matchEvent.findMany({ where: { matchId: { in: ids }, type: { in: ['game_won', 'rolled'] } }, select: { matchId: true, type: true, payload: true } });
      for (const e of events) {
        const seat = seatOf.get(e.matchId)!;
        const x = e.payload as any;
        if (e.type === 'game_won' && x?.result) {
          add('games');
          if (x.result.winner === seat) { add('gameWins'); if (x.result.mars) add('mars'); }
        } else if (e.type === 'rolled' && x?.seat === seat && Array.isArray(x.dice)) {
          if (x.dice[0] === x.dice[1]) add('doubles');
          if (x.dice.includes(6) && x.dice.includes(5)) add('sheshBesh');
        }
      }
    } else if (section === 'blot') {
      const events = await this.prisma.matchEvent.findMany({ where: { matchId: { in: ids }, type: { in: ['hand_scored', 'contra'] } }, select: { matchId: true, type: true, seat: true, payload: true } });
      const myContra = new Set(events.filter((e) => e.type === 'contra' && e.seat === seatOf.get(e.matchId)).map((e) => e.matchId));
      for (const e of events) {
        if (e.type !== 'hand_scored') continue;
        const r = (e.payload as any)?.result;
        if (!r || r.redeal || !r.contract) continue;
        const seat = seatOf.get(e.matchId)!;
        const team = seat % 2;
        add('hands');
        add('tricks', r.tricksWon?.[team] ?? 0);
        add('points', r.awarded?.[team] ?? 0);
        if (r.contract.seat === seat && r.made) {
          add('bidMade');
          if (r.contract.value === 'kapot' || r.contract.value >= 12) add('bidHigh');
          if (r.contract.suit === 'NT') add('noTrump');
        }
        if (r.kapotTeam === team && r.contract.seat % 2 === team) add('kapot');
        if ((r.comboRaw?.[team] ?? 0) >= 50) add('combo50');
        if ((r.comboRaw?.[team] ?? 0) >= 100) add('combo100');
        if ((r.blotRaw?.[team] ?? 0) > 0) add('blot');
        if (r.contra && r.contract.seat % 2 !== team && !r.made && myContra.has(e.matchId)) add('quanche');
      }
    } else {
      const events = await this.prisma.matchEvent.findMany({ where: { matchId: { in: ids }, type: { in: ['moved', 'game_over'] } }, select: { matchId: true, type: true, payload: true } });
      for (const e of events) {
        const seat = seatOf.get(e.matchId)!;
        const x = e.payload as any;
        if (e.type === 'game_over') {
          if (x?.winner === seat && x?.reason === 'checkmate') add('mate');
          continue;
        }
        if (x?.seat !== seat) continue;
        if (section === 'checkers') {
          const caps = x.move?.captures?.length ?? 0;
          add('captures', caps);
          if (caps >= 2) add('multi');
        } else {
          if (x.capture) add('captures');
          if (x.check) add('checks');
          if (typeof x.san === 'string' && x.san.startsWith('O-O')) add('castle');
        }
      }
      if (section === 'checkers') {
        // a man crowned: a move that ends on the far row with a man that was not a king (from the replayed moves)
        const moved = events.filter((e) => e.type === 'moved' && (e.payload as any)?.seat === seatOf.get(e.matchId));
        for (const e of moved) {
          const m = (e.payload as any).move;
          const last = m?.path?.[m.path.length - 1];
          const seat = (e.payload as any).seat;
          if (typeof last === 'number' && (seat === 0 ? last < 8 : last >= 56) && (e.payload as any).crowned) add('kings');
        }
      }
    }
    return p;
  }

  async list(userId: string, section: Section) {
    if (!SECTIONS.includes(section)) throw new AppError('BAD_GAME', 'Unknown game');
    const d = this.day();
    const w = this.week();
    const weeklyPool = WEEKLY[section];
    const weekly = weeklyPool[w.index % weeklyPool.length];
    const [today, thisWeek, claims] = await Promise.all([
      this.progress(userId, d.start, section),
      this.progress(userId, w.start, section),
      this.prisma.ledgerTransaction.findMany({
        where: { OR: [{ idempotencyKey: { startsWith: `quest:${userId}:${d.key}:${section}:` } }, { idempotencyKey: { startsWith: `quest:${userId}:${w.key}:${section}:` } }] },
        select: { idempotencyKey: true },
      }),
    ]);
    const claimed = new Set(claims.map((c) => c.idempotencyKey.split(':').slice(2).join(':')));
    const view = (q: Quest, p: Progress, period: string) => {
      const n = p[COUNTER[q.id] ?? q.id] ?? 0;
      return { ...q, progress: Math.min(q.target, n), done: n >= q.target, claimed: claimed.has(`${period}:${section}:${q.id}`) };
    };
    const quests = this.todays(section, d.key).map((q) => view(q, today, d.key));
    return {
      game: section,
      day: d.key,
      quests,
      allDone: { reward: ALL_DONE_REWARD, done: quests.every((q) => q.done), claimed: claimed.has(`${d.key}:${section}:all`) },
      weekly: view(weekly, thisWeek, w.key),
    };
  }

  /** `id`: one of today's quests of that game, its weekly quest, or «all» for the all-done bonus. */
  async claim(userId: string, section: Section, id: string) {
    const st = await this.list(userId, section);
    const w = this.week();
    let reward: number;
    let period: string;
    if (id === 'all') {
      if (!st.allDone.done) throw new AppError('QUEST_NOT_DONE', 'Finish all of today’s quests first', 409);
      if (st.allDone.claimed) throw new AppError('ALREADY_CLAIMED', 'Already claimed', 409);
      reward = st.allDone.reward;
      period = st.day;
    } else {
      const q = st.weekly.id === id ? st.weekly : st.quests.find((x) => x.id === id);
      if (!q) throw new AppError('NOT_FOUND', 'Not one of the current quests', 404);
      if (!q.done) throw new AppError('QUEST_NOT_DONE', 'The quest is not done yet', 409);
      if (q.claimed) throw new AppError('ALREADY_CLAIMED', 'Already claimed', 409);
      reward = q.reward;
      period = q === st.weekly ? w.key : st.day;
    }
    const amount = BigInt(reward);
    await this.ledger.post({
      type: 'REWARD', currency: 'FUN', idempotencyKey: `quest:${userId}:${period}:${section}:${id}`, description: `Quest ${section} ${id}`,
      refType: 'user', refId: userId,
      entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId }, amount }],
    });
    return this.list(userId, section);
  }
}
