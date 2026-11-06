import { Injectable } from '@nestjs/common';
import { kindOf } from '@nardi/engine';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

/** A quest: what to do, how many times, and the reward in practice chips (FUN). */
interface Quest { id: string; target: number; reward: number }

const DAILY: Quest[] = [
  { id: 'play3', target: 3, reward: 300 },
  { id: 'win1', target: 1, reward: 300 },
  { id: 'win2', target: 2, reward: 500 },
  { id: 'games5', target: 5, reward: 300 },
  { id: 'gameWins3', target: 3, reward: 400 },
  { id: 'mars1', target: 1, reward: 500 },
  { id: 'doubles5', target: 5, reward: 300 },
  { id: 'sheshBesh1', target: 1, reward: 300 },
  { id: 'short1', target: 1, reward: 300 },
  { id: 'long1', target: 1, reward: 400 },
  { id: 'friends1', target: 1, reward: 400 },
  { id: 'random1', target: 1, reward: 400 },
  { id: 'playBlot1', target: 1, reward: 300 },
  { id: 'winBlot1', target: 1, reward: 500 },
  { id: 'checkers1', target: 1, reward: 300 },
  { id: 'chess1', target: 1, reward: 300 },
  { id: 'checkersWin1', target: 1, reward: 400 },
  { id: 'chessWin1', target: 1, reward: 500 },
];
const WEEKLY: Quest[] = [
  { id: 'wWin10', target: 10, reward: 3000 },
  { id: 'wPlay25', target: 25, reward: 2500 },
  { id: 'wMars3', target: 3, reward: 3000 },
  { id: 'wGames40', target: 40, reward: 3000 },
];
const PER_DAY = 3;
/** Extra reward for finishing all of the day's quests. */
const ALL_DONE_REWARD = 500;
const TZ_OFFSET_H = 4; // days and weeks turn at midnight Yerevan time

type Progress = Record<string, number>;

/**
 * Three quests a day plus one for the week, the same for everybody, checked against finished
 * matches; finishing all three daily quests pays a bonus. Rewards are practice chips via the ledger.
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
  private todays(key: string) {
    const next = this.seeded(key);
    const pool = [...DAILY];
    const out: Quest[] = [];
    while (out.length < PER_DAY) out.push(pool.splice(next() % pool.length, 1)[0]);
    return out;
  }

  private async progress(userId: string, since: Date): Promise<Progress> {
    const all = await this.prisma.matchPlayer.findMany({
      where: { userId, match: { status: 'FINISHED', finishedAt: { gte: since } } },
      select: { matchId: true, seat: true, result: true, match: { select: { mode: true, rules: true, finishReason: true } } },
    });
    // A match someone walked out of (left, or timed out until they lost) is not a played match:
    // it counts for nothing for the one who left; the one who stayed keeps what happened in the
    // games actually played (rolls, games won, mars) but not «played / won a match».
    const forfeited = (s: (typeof all)[number]) => s.match.finishReason === 'forfeit';
    const seatsPlayed = all.filter((s) => !forfeited(s) || s.result === 'WIN');
    const seats = all.filter((s) => !forfeited(s));
    const p: Progress = {
      play: seats.length, win: seats.filter((s) => s.result === 'WIN').length,
      friends: seats.filter((s) => s.match.mode === 'PRIVATE').length, random: seats.filter((s) => s.match.mode === 'RANDOM').length,
      short: seats.filter((s) => kindOf(s.match.rules) === 'short').length, long: seats.filter((s) => kindOf(s.match.rules) === 'long').length,
      checkers: seats.filter((s) => kindOf(s.match.rules) === 'checkers').length, chess: seats.filter((s) => kindOf(s.match.rules) === 'chess').length,
      chessWins: seats.filter((s) => kindOf(s.match.rules) === 'chess' && s.result === 'WIN').length,
      blot: seats.filter((s) => kindOf(s.match.rules) === 'blot').length,
      blotWins: seats.filter((s) => kindOf(s.match.rules) === 'blot' && s.result === 'WIN').length,
      checkersWins: seats.filter((s) => kindOf(s.match.rules) === 'checkers' && s.result === 'WIN').length,
      games: 0, gameWins: 0, mars: 0, doubles: 0, sheshBesh: 0,
    };
    if (!seatsPlayed.length) return p;
    const seatOf = new Map(seatsPlayed.map((s) => [s.matchId, s.seat]));
    const events = await this.prisma.matchEvent.findMany({ where: { matchId: { in: [...seatOf.keys()] }, type: { in: ['game_won', 'rolled'] } }, select: { matchId: true, type: true, payload: true } });
    for (const e of events) {
      const seat = seatOf.get(e.matchId)!;
      const x = e.payload as any;
      if (e.type === 'game_won' && x?.result) {
        p.games += 1;
        if (x.result.winner === seat) { p.gameWins += 1; if (x.result.mars) p.mars += 1; }
      } else if (e.type === 'rolled' && x?.seat === seat && Array.isArray(x.dice)) {
        if (x.dice[0] === x.dice[1]) p.doubles += 1;
        if (x.dice.includes(6) && x.dice.includes(5)) p.sheshBesh += 1;
      }
    }
    return p;
  }

  /** Which progress counter a quest reads. */
  private counter(id: string) {
    return ({
      play3: 'play', win1: 'win', win2: 'win', games5: 'games', gameWins3: 'gameWins', mars1: 'mars', doubles5: 'doubles', sheshBesh1: 'sheshBesh',
      short1: 'short', long1: 'long', friends1: 'friends', random1: 'random',
      playBlot1: 'blot', winBlot1: 'blotWins', checkers1: 'checkers', chess1: 'chess', checkersWin1: 'checkersWins', chessWin1: 'chessWins',
      wWin10: 'win', wPlay25: 'play', wMars3: 'mars', wGames40: 'games',
    } as Record<string, string>)[id];
  }

  async list(userId: string) {
    const d = this.day();
    const w = this.week();
    const weekly = WEEKLY[w.index % WEEKLY.length];
    const [today, thisWeek, claims] = await Promise.all([
      this.progress(userId, d.start),
      this.progress(userId, w.start),
      this.prisma.ledgerTransaction.findMany({
        where: { OR: [{ idempotencyKey: { startsWith: `quest:${userId}:${d.key}:` } }, { idempotencyKey: { startsWith: `quest:${userId}:${w.key}:` } }] },
        select: { idempotencyKey: true },
      }),
    ]);
    const claimed = new Set(claims.map((c) => c.idempotencyKey.split(':').slice(2).join(':')));
    const view = (q: Quest, p: Progress, period: string) => {
      const n = p[this.counter(q.id)] ?? 0;
      return { ...q, progress: Math.min(q.target, n), done: n >= q.target, claimed: claimed.has(`${period}:${q.id}`) };
    };
    const quests = this.todays(d.key).map((q) => view(q, today, d.key));
    return {
      day: d.key,
      quests,
      allDone: { reward: ALL_DONE_REWARD, done: quests.every((q) => q.done), claimed: claimed.has(`${d.key}:all`) },
      weekly: view(weekly, thisWeek, w.key),
    };
  }

  /** `id`: one of today's quests, the week's quest, or «all» for the all-done bonus. */
  async claim(userId: string, id: string) {
    const st = await this.list(userId);
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
      type: 'REWARD', currency: 'FUN', idempotencyKey: `quest:${userId}:${period}:${id}`, description: `Quest ${id}`,
      refType: 'user', refId: userId,
      entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId }, amount }],
    });
    return this.list(userId);
  }
}
