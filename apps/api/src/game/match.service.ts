import { PushService } from '../common/push.service';
import { BlocksService } from '../users/blocks.service';
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import {
  AnyAction, AnyEvent, AnyRules, AnyState, GameId, MatchActionPayload, MatchDTO, MatchState, Move, SEATS, Seat, SeatInfo, Team, actorOf, applyAny,
  autoAny, botAny, clockDeadline, createAny, forfeitAny, gameOf, normalizeAnyRules, seatCount, teamOfSeat, turnOf, usesDice, viewAny,
} from '@nardi/engine';
import * as Blot from '@nardi/engine/dist/blot';
import { BotRunner } from './bot-runner';
import { MatchMode, Prisma } from '@prisma/client';
import { createHash, randomInt, randomUUID } from 'crypto';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { canonicalJson } from '../common/util';
import { ENV, Env } from '../config/env';
import { Currency, LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { ReferralsService } from '../users/referrals.service';
import { UsersService, levelForXp } from '../users/users.service';
import { Roll, commitDeck, commitRolls, eloDelta, secureRolls, secureShuffle, tableShuffle } from './fairness';
import { RealtimeService } from './realtime.service';

interface SeatPlayer {
  seat: Seat;
  userId: string | null;
  nickname: string;
  avatar: string;
  rating: number | null;
  level: number | null;
  isBot: boolean;
}

/** A game's dice, fixed and committed before it starts; `used` is how many have been rolled. */
interface FairnessRecord { game: number; rolls: Roll[]; salt: string; commitment: string; used: number }

/** What is persisted in Match.state (server-private). */
/** Blot: each hand's deck, committed before the deal. */
interface DeckRecord { hand: number; deck: string[]; salt: string; commitment: string }
interface PersistedState { engine: AnyState; fairness: (FairnessRecord | DeckRecord)[]; seq: number; strikes: number[]; leaverSeat: Seat | null }

interface Runtime extends PersistedState {
  id: string;
  mode: MatchMode;
  stake: bigint;
  currency: Currency;
  ranked: boolean;
  chatEnabled: boolean;
  roomId: string | null;
  players: SeatPlayer[];
  startedAt: Date;
  deadline: number | null;
  timer: NodeJS.Timeout | null;
  lock: Promise<unknown>;
  recentActions: Map<string, number>;
  lastEvents: AnyEvent[];
}

export interface CreateMatchInput {
  mode: MatchMode;
  rules: Partial<AnyRules> & { game?: string };
  stake: number;
  currency: Currency;
  ranked: boolean;
  chatEnabled: boolean;
  roomId?: string | null;
  tournamentId?: string | null;
  /** Exactly two seats, in seat order. */
  seats: ({ userId: string } | { botName: string })[];
}

const BOT_NAMES = ['Արամ', 'Նարե', 'Տիգրան', 'Անի', 'Դավիթ', 'Լուսինե', 'Վարդան', 'Մարիամ'];

@Injectable()
export class MatchService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(MatchService.name);
  private runtimes = new Map<string, Runtime>();
  /** Callbacks run after a match finishes (e.g. rooms update their status). */
  onFinished: ((matchId: string, roomId: string | null) => Promise<void> | void)[] = [];

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private settings: SettingsService,
    private users: UsersService,
    private referrals: ReferralsService,
    private realtime: RealtimeService,
    private audit: AuditService,
    private blocks: BlocksService,
    private push: PushService,
    private bots: BotRunner,
    @Inject(ENV) private env: Env,
  ) {}

  private team(rt: Runtime, seat: number) {
    return teamOfSeat(gameOf(rt.engine), seat) as Team;
  }

  static botName(i: number) {
    return BOT_NAMES[i % BOT_NAMES.length];
  }

  async onModuleInit() {
    await this.recover();
  }

  onApplicationShutdown() {
    for (const rt of this.runtimes.values()) if (rt.timer) clearTimeout(rt.timer);
  }

  // ------------------------------------------------------------------ creation

  async create(input: CreateMatchInput): Promise<string> {
    const kind = gameOf(normalizeAnyRules(input.rules));
    if (input.seats.length !== seatCount(kind)) throw new AppError('BAD_SEATS', `A match needs exactly ${seatCount(kind)} seats`);
    const rules = normalizeAnyRules(input.rules);
    const game = gameOf(rules);
    const humanIds = input.seats.filter((s): s is { userId: string } => 'userId' in s).map((s) => s.userId);
    if (new Set(humanIds).size !== humanIds.length) throw new AppError('BAD_SEATS', 'A player cannot take two seats');
    if (input.stake > 0 && humanIds.length !== 2) throw new AppError('BOTS_NOT_ALLOWED', 'Bots cannot play in matches with stakes');
    for (const uid of humanIds) {
      const active = this.activeMatchOf(uid);
      if (active) throw new AppError('ALREADY_IN_MATCH', 'A player is already in an active match', 409);
    }

    const users = await this.prisma.user.findMany({ where: { id: { in: humanIds } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const uid of humanIds) {
      const u = byId.get(uid);
      if (!u || u.status !== 'ACTIVE') throw new AppError('PLAYER_UNAVAILABLE', 'A player is unavailable', 409);
      if (input.stake > 0 && (u.restrictions as any)?.noStakes) throw new AppError('RESTRICTED', `${u.nickname} cannot play for stakes`, 403);
    }

    const players: SeatPlayer[] = input.seats.map((s, i) => {
      if ('userId' in s) {
        const u = byId.get(s.userId)!;
        return { seat: i as Seat, userId: u.id, nickname: u.nickname, avatar: u.avatar, rating: u.rating, level: u.level, isBot: false };
      }
      return { seat: i as Seat, userId: null, nickname: s.botName, avatar: 'bot', rating: null, level: null, isBot: true };
    });

    const matchId = randomUUID();
    const rolls = secureRolls();
    const { salt, commitment } = commitRolls(rolls);
    let engine = createAny(rules, randomInt(seatCount(game)) as Seat);
    let fairness: PersistedState['fairness'] = usesDice(game) ? [{ game: 1, rolls, salt, commitment, used: 0 }] : [];
    let startEvents: AnyEvent[] = [];
    let deckRow: { deck: string[]; salt: string; commitment: string } | null = null;
    if (game === 'blot') {
      // blot: the first deck is shuffled and committed now, then dealt
      const deck = secureShuffle();
      const c = commitDeck(deck);
      const dealt = Blot.dealHand(engine as Blot.MatchState, deck as Blot.Card[]);
      engine = dealt.state;
      startEvents = dealt.events;
      fairness = [{ hand: 1, deck, salt: c.salt, commitment: c.commitment }];
      deckRow = { deck, ...c };
    }
    const firstTurn = turnOf(engine);
    // nardi: the dice are fixed and committed before the game starts
    const persisted: PersistedState = { engine, fairness, seq: 0, strikes: Array(seatCount(game)).fill(0), leaverSeat: null };
    const stake = BigInt(input.stake);

    await this.prisma.$transaction(async (tx) => {
      await tx.match.create({
        data: {
          id: matchId, mode: input.mode, roomId: input.roomId ?? null, tournamentId: input.tournamentId ?? null, rules: rules as any, stake, currency: input.currency, ranked: input.ranked,
          chatEnabled: input.chatEnabled, state: persisted as any, version: engine.version,
        },
      });
      for (const p of players) {
        await tx.matchPlayer.create({ data: { matchId, seat: p.seat, team: teamOfSeat(game, p.seat), userId: p.userId, isBot: p.isBot, botName: p.isBot ? p.nickname : null, ratingBefore: p.rating } });
      }
      if (stake > 0n) {
        for (const p of players) {
          if (!p.userId) continue;
          await this.ledger.post({
            type: 'STAKE', currency: input.currency, idempotencyKey: `stake:${matchId}:${p.userId}`, description: 'Match stake', refType: 'match', refId: matchId,
            entries: [{ account: { type: 'USER_WALLET', userId: p.userId }, amount: -stake }, { account: { type: 'MATCH_ESCROW', matchId }, amount: stake }],
          }, tx);
        }
      }
      await this.appendEvents(tx, matchId, persisted, [
        { type: 'match_created', payload: { mode: input.mode, rules, stake: input.stake, currency: input.currency, seats: players.map((p) => ({ seat: p.seat, userId: p.userId, bot: p.isBot ? p.nickname : null })) } },
        deckRow
          ? { type: 'hand_dealt', payload: { hand: 1, dealer: (engine as Blot.MatchState).dealer, ...deckRow } }
          : { type: 'game_started', payload: { game: 1, turn: firstTurn, ...(usesDice(game) ? { commitment } : {}) } },
      ]);
    }, { timeout: 20000 });

    const rt: Runtime = {
      ...persisted, id: matchId, mode: input.mode, stake, currency: input.currency, ranked: input.ranked, chatEnabled: input.chatEnabled,
      roomId: input.roomId ?? null, players, startedAt: new Date(), deadline: null, timer: null, lock: Promise.resolve(), recentActions: new Map(),
      lastEvents: game === 'blot' ? startEvents : [{ type: 'game_started', game: 1, turn: firstTurn as Seat }],
    };
    this.runtimes.set(matchId, rt);
    if (stake > 0n) this.checkSharedIps(matchId, humanIds).catch(() => undefined);
    for (const p of players) if (p.userId) this.realtime.toUser(p.userId, 'match:started', { matchId });
    this.broadcast(rt);
    this.schedule(rt);
    return matchId;
  }

  // ------------------------------------------------------------------ queries

  activeMatchOf(userId: string): string | null {
    for (const rt of this.runtimes.values()) {
      if (rt.engine.status === 'playing' && rt.players.some((p) => p.userId === userId)) return rt.id;
    }
    return null;
  }

  private lastEmote = new Map<string, number>();
  private rematchVotes = new Map<string, Set<string>>();

  /**
   * «Մի հատ էլ խաղանք»: after a match, each human presses it; when all of them have, a new match
   * starts with the same seats and settings (bots stay bots, stakes are taken again).
   */
  async rematch(matchId: string, userId: string) {
    const rt = this.runtimes.get(matchId);
    if (!rt || !rt.players.some((p) => p.userId === userId)) throw new AppError('NOT_IN_MATCH', 'Not a player');
    if (rt.engine.status !== 'finished') throw new AppError('MATCH_NOT_FINISHED', 'The match is not over yet');
    if (rt.mode === 'TOURNAMENT') throw new AppError('NO_REMATCH', 'Tournament matches have no rematch');
    const humans = rt.players.filter((p) => p.userId).map((p) => p.userId!);
    const votes = this.rematchVotes.get(matchId) ?? new Set<string>();
    votes.add(userId);
    this.rematchVotes.set(matchId, votes);
    const tell = (payload: object) => humans.forEach((uid) => this.realtime.toUser(uid, 'match:rematch', { matchId, ...payload }));
    if (votes.size < humans.length) {
      tell({ seats: rt.players.filter((p) => p.userId && votes.has(p.userId)).map((p) => p.seat), needed: humans.length });
      return { ok: true, waiting: true };
    }
    this.rematchVotes.delete(matchId);
    try {
      const newMatchId = await this.create({
        mode: rt.mode, rules: rt.engine.config, stake: Number(rt.stake), currency: rt.currency, ranked: rt.ranked, chatEnabled: rt.chatEnabled,
        // chess and checkers: swap colours for the next game
        seats: (gameOf(rt.engine) === 'nardi' ? rt.players : [...rt.players].reverse()).map((p) => (p.userId ? { userId: p.userId } : { botName: p.nickname })),
      });
      tell({ newMatchId });
      return { ok: true, newMatchId };
    } catch (e: any) {
      tell({ error: e?.code ?? 'REMATCH_FAILED' });
      throw e;
    }
  }

  /** A quick phrase / emoji from a player: checked against the admin list, rate-limited, sent to the table. */
  async emote(matchId: string, userId: string, id: string) {
    const rt = this.runtimes.get(matchId);
    const player = rt?.players.find((p) => p.userId === userId);
    if (!rt || !player) throw new AppError('NOT_IN_MATCH', 'Not a player');
    const key = `${matchId}:${userId}`;
    if (Date.now() - (this.lastEmote.get(key) ?? 0) < 3000) throw new AppError('RATE_LIMITED', 'Slow down');
    const { emotes } = await this.settings.get('game');
    if (!emotes.phrases.some((p) => p.id === id) && !emotes.emojis.includes(id)) throw new AppError('BAD_EMOTE', 'Unknown phrase');
    this.lastEmote.set(key, Date.now());
    await this.sendEmote(rt, player.seat, id);
    return { ok: true };
  }

  private async sendEmote(rt: Runtime, seat: Seat, id: string) {
    const from = rt.players.find((p) => p.seat === seat)?.userId;
    const hidden = from ? await this.blocks.blockers(from) : new Set<string>();
    for (const p of rt.players) if (p.userId && !hidden.has(p.userId)) this.realtime.toUser(p.userId, 'match:emote', { matchId: rt.id, seat, id });
  }

  /** Bots now and then react (a lucky roll, the end of a game), so practice games feel alive. */
  private botReactions(rt: Runtime, events: AnyEvent[]) {
    const bot = rt.players.find((p) => p.isBot);
    if (!bot) return;
    let pool: string[] | null = null;
    if (gameOf(rt.engine) === 'blot') {
      // a reaction now and then to the end of a hand
      const scored = events.find((e) => e.type === 'hand_scored') as { result: Blot.HandResult } | undefined;
      if (!scored || scored.result.redeal || !scored.result.contract) return;
      const r = scored.result;
      const winners = r.awarded[0] >= r.awarded[1] ? 0 : 1;
      const bots = rt.players.filter((p) => p.isBot);
      if (!bots.length || Math.random() > 0.45) return;
      const b = bots[Math.floor(Math.random() * bots.length)];
      const won = b.seat % 2 === winners;
      const bidders = r.contract!.seat % 2;
      const pool = won
        ? r.kapotTeam !== null ? ['🔥', 'taraq'] : r.made === false && b.seat % 2 !== bidders ? ['mnacin', '😎'] : ['taraq', '😎', '👏']
        : ['vay', '😢', '🤔', 'apres'];
      const id = pool[Math.floor(Math.random() * pool.length)];
      setTimeout(() => void this.sendEmote(rt, b.seat, id), 900 + Math.random() * 900);
      return;
    }
    if (gameOf(rt.engine) !== 'nardi') {
      const over = events.find((e) => e.type === 'game_over') as { winner: Seat | null } | undefined;
      if (over) pool = over.winner === bot.seat ? ['😎', '👏'] : over.winner === null ? ['👏', '🤝'] : ['😢', '👏'];
      if (!pool || Math.random() > 0.55) return;
      const id = pool[Math.floor(Math.random() * pool.length)];
      setTimeout(() => void this.sendEmote(rt, bot.seat, id), 700 + Math.random() * 900);
      return;
    }
    const won = events.find((e) => e.type === 'game_won') as { result: { winner: Seat; mars: boolean } } | undefined;
    const rolled = events.find((e) => e.type === 'rolled') as { seat: Seat; dice: [number, number] } | undefined;
    if (won) pool = won.result.winner === bot.seat ? (won.result.mars ? ['mars', '🔥', '😎'] : ['😎', 'apres', '👏']) : ['vay', '😢', 'bakht', 'apres'];
    else if (rolled && rolled.seat !== bot.seat && rolled.dice[0] === rolled.dice[1] && Math.random() < 0.5) pool = ['bakht', 'gele', '🤔'];
    else if (rolled && rolled.seat === bot.seat && rolled.dice[0] === rolled.dice[1] && Math.random() < 0.3) pool = ['gele', '🔥'];
    if (!pool || Math.random() > 0.55) return;
    const id = pool[Math.floor(Math.random() * pool.length)];
    setTimeout(() => void this.sendEmote(rt, bot.seat, id), 700 + Math.random() * 900);
  }

  isParticipant(matchId: string, userId: string) {
    return !!this.runtimes.get(matchId)?.players.some((p) => p.userId === userId);
  }

  chatEnabled(matchId: string) {
    return this.runtimes.get(matchId)?.chatEnabled ?? false;
  }

  activeSummaries() {
    return [...this.runtimes.values()].filter((r) => r.engine.status === 'playing').map((r) => ({
      id: r.id, game: gameOf(r.engine), mode: r.mode, stake: Number(r.stake), currency: r.currency, startedAt: r.startedAt, scores: r.engine.scores, hand: r.engine.handNumber,
      players: r.players.map((p) => ({ seat: p.seat, nickname: p.nickname, isBot: p.isBot, connected: p.userId ? this.realtime.isOnline(p.userId) : true })),
    }));
  }

  dto(matchId: string, userId: string): MatchDTO {
    const rt = this.runtimes.get(matchId);
    if (!rt) throw new AppError('MATCH_NOT_ACTIVE', 'Match is not active', 404);
    const seat = rt.players.find((p) => p.userId === userId)?.seat;
    if (seat === undefined) throw new AppError('NOT_IN_MATCH', 'You are not a player of this match', 403);
    return this.buildDto(rt, seat);
  }

  private buildDto(rt: Runtime, seat: Seat | null): MatchDTO {
    const s = rt.engine;
    const current = s.status === 'playing' ? s.handNumber : null;
    const nardiFair = rt.fairness.filter((f): f is FairnessRecord => 'rolls' in f);
    const decks = rt.fairness.filter((f): f is DeckRecord => 'deck' in f);
    const cur = nardiFair.find((f) => f.game === current);
    return {
      matchId: rt.id,
      mode: rt.mode,
      stake: Number(rt.stake),
      currency: 'FUN',
      chatEnabled: rt.chatEnabled,
      players: rt.players.map<SeatInfo>((p) => ({
        seat: p.seat, userId: p.userId, nickname: p.nickname, avatar: p.avatar, rating: p.rating, level: p.level, isBot: p.isBot,
        connected: p.isBot || (p.userId ? this.realtime.isOnline(p.userId) : false),
      })),
      view: viewAny(s, seat),
      deadline: rt.deadline,
      diceCommitment: cur?.commitment ?? null,
      // a finished game's dice (the whole committed list; the first `used` were rolled) with the salt to check them
      revealedDice: nardiFair.filter((f) => f.game !== current).map((f) => ({ game: f.game, rolls: f.rolls, salt: f.salt, commitment: f.commitment })),
      // blot: the current hand's deck is only committed; finished hands' decks are revealed
      deckCommitment: decks.find((f) => f.hand === current)?.commitment ?? null,
      revealedDecks: decks.filter((f) => f.hand !== current).map((f) => ({ hand: f.hand, deck: f.deck, salt: f.salt, commitment: f.commitment })),
      events: rt.lastEvents,
      serverTime: Date.now(),
    };
  }

  private broadcast(rt: Runtime) {
    for (const p of rt.players) if (p.userId) this.realtime.toUser(p.userId, 'match:state', this.buildDto(rt, p.seat));
    // spectators get the public view only: no player's cards
    this.realtime.toChannel(`watch:${rt.id}`, 'match:state', this.buildDto(rt, null));
  }

  /** Friends of a player in the match (and staff) may watch it. */
  async watchDto(matchId: string, userId: string, role?: string): Promise<MatchDTO> {
    const rt = this.runtimes.get(matchId);
    if (!rt) throw new AppError('MATCH_NOT_ACTIVE', 'Match is not active', 404);
    if (rt.players.some((p) => p.userId === userId)) throw new AppError('IS_PLAYER', 'You play in this match', 409);
    const humans = rt.players.filter((p) => p.userId).map((p) => p.userId!);
    const staff = role && role !== 'USER';
    const friend = await this.prisma.friendship.count({
      where: { status: 'ACCEPTED', OR: [{ requesterId: userId, addresseeId: { in: humans } }, { addresseeId: userId, requesterId: { in: humans } }] },
    });
    if (!staff && !friend) throw new AppError('NOT_FRIENDS', 'You can watch only your friends', 403);
    return this.buildDto(rt, null);
  }

  /** Re-send state to one player (e.g. after reconnect) and refresh "connected" badges for others. */
  resync(matchId: string, userId: string) {
    const rt = this.runtimes.get(matchId);
    if (!rt) return;
    this.broadcast(rt);
  }

  // ------------------------------------------------------------------ actions

  private exclusive<T>(rt: Runtime, fn: () => Promise<T>): Promise<T> {
    const run = rt.lock.then(fn, fn);
    rt.lock = run.catch(() => undefined);
    return run;
  }

  async handleAction(userId: string, p: MatchActionPayload) {
    const rt = this.runtimes.get(p.matchId);
    if (!rt) throw new AppError('MATCH_NOT_ACTIVE', 'Match is not active', 404);
    return this.exclusive(rt, async () => {
      const player = rt.players.find((x) => x.userId === userId);
      if (!player) throw new AppError('NOT_IN_MATCH', 'You are not a player of this match', 403);
      if (typeof p.actionId !== 'string' || p.actionId.length < 8 || p.actionId.length > 64) throw new AppError('BAD_ACTION_ID', 'actionId required');
      if (rt.recentActions.has(`${userId}:${p.actionId}`)) {
        // duplicate delivery (retry after reconnect) — idempotent, just resend state
        this.realtime.toUser(userId, 'match:state', this.buildDto(rt, player.seat));
        return { duplicate: true };
      }
      if (p.version !== rt.engine.version) throw new AppError('STALE_STATE', 'Game state changed, please retry', 409);
      await this.apply(rt, player.seat, sanitizeAction(gameOf(rt.engine), p.action), { actorId: userId, actionId: p.actionId, source: 'player' });
      rt.recentActions.set(`${userId}:${p.actionId}`, rt.engine.version);
      if (rt.recentActions.size > 500) rt.recentActions.delete(rt.recentActions.keys().next().value!);
      rt.strikes[player.seat] = 0;
      return { ok: true };
    });
  }

  async leave(userId: string, matchId: string) {
    const rt = this.runtimes.get(matchId);
    if (!rt) throw new AppError('MATCH_NOT_ACTIVE', 'Match is not active', 404);
    return this.exclusive(rt, async () => {
      const player = rt.players.find((x) => x.userId === userId);
      if (!player) throw new AppError('NOT_IN_MATCH', 'Not a player', 403);
      if (rt.engine.status !== 'playing') return;
      rt.leaverSeat = player.seat;
      await this.applyForfeit(rt, this.team(rt, player.seat), { actorId: userId, source: 'leave' });
    });
  }

  private async applyForfeit(rt: Runtime, team: Team, meta: Record<string, unknown>) {
    const res = forfeitAny(rt.engine, team);
    await this.commit(rt, res.state, res.events.map((e) => ({ type: e.type, payload: { ...e, ...meta } })), res.events);
  }

  private async apply(rt: Runtime, seat: Seat, action: AnyAction, meta: Record<string, unknown>) {
    let fairness = rt.fairness;
    const game = gameOf(rt.engine);
    // the server's clock is the only one that counts
    if (game === 'chess') action = { ...(action as any), at: Date.now() };
    if (game === 'nardi' && action.type === 'roll') {
      // the dice come from the list fixed (and committed) before the game started
      fairness = fairness.map((f) => ({ ...f }));
      const rec = fairness.find((f): f is FairnessRecord => 'rolls' in f && f.game === rt.engine.handNumber);
      if (rec && rec.used < rec.rolls.length) {
        action = { type: 'roll', dice: rec.rolls[rec.used] };
        rec.used += 1;
      } else {
        this.log.warn(`match ${rt.id}: game ${rt.engine.handNumber} ran out of committed dice`);
        action = { type: 'roll', dice: secureRolls(1)[0] };
      }
    }
    const res = applyAny(rt.engine, seat, action);
    const next = res.state;
    const publicEvents: AnyEvent[] = [...res.events];
    const rows: { type: string; seat?: number; payload: any }[] = [
      { type: 'action', seat, payload: { action, version: rt.engine.version, ...meta } },
      ...res.events.map((e) => ({ type: e.type, seat: 'seat' in e ? (e as any).seat : undefined, payload: e })),
    ];
    let nextState: AnyState = next;
    if (game === 'blot' && next.status === 'playing' && (next as Blot.MatchState).awaitingDeal) {
      const b = next as Blot.MatchState;
      const deck = b.config.dealStyle === 'table' && b.collected?.length === 32 ? tableShuffle(b.collected) : secureShuffle();
      const c = commitDeck(deck);
      const dealt = Blot.dealHand(b, deck as Blot.Card[]);
      nextState = dealt.state;
      fairness = [...fairness, { hand: dealt.state.handNumber, deck, salt: c.salt, commitment: c.commitment }];
      publicEvents.push(...dealt.events);
      rows.push({ type: 'hand_dealt', payload: { hand: dealt.state.handNumber, dealer: dealt.state.dealer, deck, ...c } });
    }
    if (game === 'nardi' && next.status === 'playing' && next.handNumber !== rt.engine.handNumber) {
      // a new game: fix its dice now; the finished game's dice are revealed
      const rolls = secureRolls();
      const { salt, commitment } = commitRolls(rolls);
      fairness = [...fairness, { game: next.handNumber, rolls, salt, commitment, used: 0 }];
      rows.push({ type: 'game_dice', payload: { game: next.handNumber, commitment } });
    }
    await this.commit(rt, nextState, rows, publicEvents, fairness);
  }

  /** Persist atomically with optimistic concurrency on Match.version, then update memory + clients. */
  private async commit(rt: Runtime, next: AnyState, rows: { type: string; seat?: number; payload: any }[], publicEvents: AnyEvent[], fairness = rt.fairness) {
    const prevVersion = rt.engine.version;
    const persisted: PersistedState = { engine: next, fairness, seq: rt.seq, strikes: rt.strikes, leaverSeat: rt.leaverSeat };
    await this.prisma.$transaction(async (tx) => {
      await this.appendEvents(tx, rt.id, persisted, rows);
      const finished = next.status === 'finished';
      if (finished) await this.finalizeInTx(tx, rt, next, persisted);
      const res = await tx.match.updateMany({
        where: { id: rt.id, version: prevVersion, status: 'ACTIVE' },
        data: {
          state: persisted as any, version: next.version, scoreTeam0: next.scores[0], scoreTeam1: next.scores[1],
          ...(finished ? this.finishedFields(rt, next, persisted) : {}),
        },
      });
      if (res.count !== 1) throw new AppError('CONCURRENT_UPDATE', 'Match was modified concurrently', 409);
    }, { timeout: 20000 });
    rt.engine = next;
    rt.fairness = fairness;
    rt.seq = persisted.seq;
    rt.lastEvents = publicEvents;
    this.broadcast(rt);
    this.botReactions(rt, publicEvents);
    if (next.status === 'finished') this.afterFinish(rt);
    else this.schedule(rt);
  }

  private async appendEvents(tx: Tx, matchId: string, ps: PersistedState, rows: { type: string; seat?: number; payload: any }[]) {
    for (const r of rows) {
      ps.seq += 1;
      await tx.matchEvent.create({ data: { matchId, seq: ps.seq, type: r.type, seat: r.seat ?? null, actorId: (r.payload?.actorId as string) ?? null, payload: r.payload } });
    }
  }

  // ------------------------------------------------------------------ timers & bots

  private schedule(rt: Runtime) {
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = null;
    rt.deadline = null;
    const turn = turnOf(rt.engine);
    const actor = actorOf(rt.engine);
    if (turn === null || actor === null) return;
    const game = gameOf(rt.engine);
    const version = rt.engine.version;
    const clock = clockDeadline(rt.engine);
    // chess: the clock of the side on move decides; the server calls the flag when it falls
    if (clock !== null) {
      rt.deadline = clock;
      rt.timer = setTimeout(() => this.timed(rt, version, 'clock'), Math.max(0, clock - Date.now()) + 50);
    }
    const player = rt.players[actor];
    if (player.isBot) {
      const base = this.env.botDelayMs;
      let ms: number;
      if (game === 'nardi') {
        // roll after a short pause; then leave time to see the dice before the checkers move
        ms = (rt.engine as MatchState).game?.phase === 'move' ? Math.round(base * 2.2) + randomInt(Math.max(1, Math.round(base * 0.8))) : base + randomInt(Math.max(1, Math.round(base * 0.6)));
      } else if (game === 'blot') ms = base + randomInt(Math.max(1, Math.round(base * 0.5)));
      else ms = Math.round(base * 0.6) + randomInt(Math.max(1, Math.round(base * 0.6)));
      const botTimer = setTimeout(() => this.timed(rt, version, 'bot'), ms);
      if (clock === null) rt.timer = botTimer;
      return;
    }
    // the player is away (app closed / phone locked): tell their phone it is their turn
    if (player.userId && !this.realtime.isOnline(player.userId)) this.push.send(player.userId, 'turn', '', `/match/${rt.id}`);
    if (clock !== null) return;
    const sec = rt.engine.config.turnTimeoutSec;
    if (sec > 0) {
      const ms = (player.userId && !this.realtime.isOnline(player.userId) ? Math.min(sec, 15) : sec) * 1000;
      rt.deadline = Date.now() + ms;
      rt.timer = setTimeout(() => this.timed(rt, version, 'timeout'), ms);
    }
  }

  private timed(rt: Runtime, version: number, kind: 'bot' | 'timeout' | 'clock') {
    this.exclusive(rt, async () => {
      if (rt.engine.version !== version || rt.engine.status !== 'playing') return;
      if (kind === 'clock') {
        const seat = turnOf(rt.engine);
        if (seat !== null) await this.apply(rt, seat, { type: 'flag' }, { source: 'clock' });
        return;
      }
      const seat = actorOf(rt.engine);
      if (seat === null) return;
      if (kind === 'bot') {
        // chess and checkers bots think in a worker thread so the server stays responsive
        const g = gameOf(rt.engine);
        const action = g === 'nardi' || g === 'blot' ? botAny(rt.engine, seat) : await this.bots.think(rt.engine, seat);
        if (rt.engine.version !== version || rt.engine.status !== 'playing') return;
        await this.apply(rt, seat, action, { source: 'bot' });
        return;
      }
      rt.strikes[seat] += 1;
      const p = rt.players[seat];
      const offline = p.userId ? !this.realtime.isOnline(p.userId) : false;
      if ((offline && rt.strikes[seat] >= 3) || rt.strikes[seat] >= 6) {
        rt.leaverSeat = seat;
        await this.applyForfeit(rt, this.team(rt, seat), { source: 'abandon', seat });
        return;
      }
      await this.apply(rt, seat, autoAny(rt.engine, seat), { source: 'timeout' });
    }).catch((e) => this.log.error(`timer action failed for ${rt.id}: ${e?.message}`));
  }

  // ------------------------------------------------------------------ finishing

  private finishedFields(rt: Runtime, s: AnyState, ps: PersistedState) {
    const finishedAt = new Date();
    return {
      status: 'FINISHED' as const,
      winnerTeam: s.winnerTeam,
      finishReason: s.finishReason,
      finishedAt,
      durationSec: Math.round((finishedAt.getTime() - rt.startedAt.getTime()) / 1000),
      resultHash: createHash('sha256').update(canonicalJson({ id: rt.id, scores: s.scores, winner: s.winnerTeam, history: s.history, seq: ps.seq, decks: ps.fairness.map((f) => f.commitment) })).digest('hex'),
    };
  }

  /** Payouts, ratings, stats and achievements — all inside the same DB transaction as the final move. */
  private async finalizeInTx(tx: Tx, rt: Runtime, s: AnyState, ps: PersistedState) {
    // chess and checkers can end in a draw (no winner): stakes go back, ratings move half way
    const winner = s.winnerTeam;
    const draw = winner === null;
    const humans = rt.players.filter((p) => p.userId);
    const winners = draw ? humans : humans.filter((p) => this.team(rt, p.seat) === winner);

    if (rt.stake > 0n && humans.length) {
      const pot = rt.stake * BigInt(humans.length);
      const feePct = draw ? 0 : (await this.settings.get('economy')).fees.matchFeePercent;
      let fee = (pot * BigInt(Math.round(feePct * 100))) / 10000n;
      const share = winners.length ? (pot - fee) / BigInt(winners.length) : 0n;
      fee = pot - share * BigInt(winners.length); // rounding remainder goes to fees, never lost
      const entries: { account: any; amount: bigint }[] = [{ account: { type: 'MATCH_ESCROW', matchId: rt.id }, amount: -pot }];
      for (const w of winners) entries.push({ account: { type: 'USER_WALLET', userId: w.userId! }, amount: share });
      if (fee > 0n) entries.push({ account: { type: 'SYSTEM_FEES' }, amount: fee });
      await this.ledger.post({ type: 'PAYOUT', currency: rt.currency, idempotencyKey: `payout:${rt.id}`, description: 'Match winnings', refType: 'match', refId: rt.id, entries }, tx);
    }

    const ratingDelta = (seat: Seat) => {
      if (!rt.ranked || humans.length !== rt.players.length) return 0;
      const team = this.team(rt, seat);
      const mine = rt.players.filter((p) => this.team(rt, p.seat) === team).map((p) => p.rating ?? 1200);
      const theirs = rt.players.filter((p) => this.team(rt, p.seat) !== team).map((p) => p.rating ?? 1200);
      return eloDelta(mine, theirs, draw ? 0.5 : team === winner ? 1 : 0);
    };
    const marsWinners = new Set(((s.history ?? []) as { mars?: boolean; winner: number }[]).filter((h) => h.mars).map((h) => h.winner));
    const kapotTeams = new Set(((s.history ?? []) as { kapotTeam?: number | null }[]).filter((h) => h.kapotTeam !== undefined && h.kapotTeam !== null).map((h) => h.kapotTeam));
    const length = gameOf(s) === 'nardi' ? (s.history ?? []).length : Math.min(15, Math.ceil(((s as any).game?.moves ?? (s as any).game?.sans?.length ?? 0) / 10));

    for (const p of humans) {
      const won = !draw && this.team(rt, p.seat) === winner;
      const lost = !draw && !won;
      const user = await tx.user.findUniqueOrThrow({ where: { id: p.userId! } });
      const delta = ratingDelta(p.seat);
      const xpGained = 20 + (won ? 30 : draw ? 15 : 0) + Math.min(30, length * 2);
      const xp = user.xp + xpGained;
      const rating = Math.max(100, user.rating + delta);
      await tx.user.update({
        where: { id: user.id },
        data: { gamesPlayed: { increment: 1 }, wins: { increment: won ? 1 : 0 }, losses: { increment: lost ? 1 : 0 }, xp, level: levelForXp(xp), rating },
      });
      // walking out of a match does not count towards the invite bonus
      if (won || s.finishReason !== 'forfeit') await this.referrals.onGameFinished(tx, user.id, user.gamesPlayed + 1);
      // a reward for every new level: level × 100 practice chips
      for (let lvl = user.level + 1; lvl <= levelForXp(xp); lvl++) {
        const amount = BigInt(lvl * 100);
        await this.ledger.post({
          type: 'REWARD', currency: 'FUN', idempotencyKey: `level:${user.id}:${lvl}`, description: `Level ${lvl} reward`, refType: 'user', refId: user.id,
          entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId: user.id }, amount }],
        }, tx);
        await tx.notification.create({ data: { userId: user.id, type: 'level', title: 'level.up', body: `${lvl}`, data: { level: lvl, reward: lvl * 100 } } });
      }
      await tx.matchPlayer.update({
        where: { matchId_seat: { matchId: rt.id, seat: p.seat } },
        data: { result: won ? 'WIN' : draw ? 'DRAW' : ps.leaverSeat === p.seat ? 'ABANDON' : 'LOSS', ratingAfter: rating, ratingBefore: user.rating, xpGained },
      });
      await this.users.grantAchievements(tx, user.id, { mars: gameOf(s) === 'nardi' && marsWinners.has(p.seat), kapot: gameOf(s) === 'blot' && kapotTeams.has(this.team(rt, p.seat)), privateMatch: rt.mode === 'PRIVATE' });
    }
    for (const p of rt.players.filter((x) => x.isBot)) {
      await tx.matchPlayer.update({ where: { matchId_seat: { matchId: rt.id, seat: p.seat } }, data: { result: draw ? 'DRAW' : this.team(rt, p.seat) === winner ? 'WIN' : 'LOSS' } });
    }
  }

  private afterFinish(rt: Runtime) {
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = null;
    rt.deadline = null;
    for (const cb of this.onFinished) Promise.resolve(cb(rt.id, rt.roomId)).catch((e) => this.log.error(e));
    // keep the final state around briefly so clients can show the result screen
    setTimeout(() => this.runtimes.delete(rt.id), 10 * 60_000).unref();
  }

  /** Admin cancellation: refunds every stake from escrow; the match is frozen as CANCELLED. */
  async cancel(matchId: string, reason: string, admin: { id: string; role: string; ip?: string }) {
    const rt = this.runtimes.get(matchId);
    const run = async () => {
      await this.prisma.$transaction(async (tx) => {
        const m = await tx.match.findUnique({ where: { id: matchId }, include: { players: true } });
        if (!m) throw new AppError('NOT_FOUND', 'Match not found', 404);
        if (m.status !== 'ACTIVE') throw new AppError('BAD_STATE', `Match is ${m.status}`, 409);
        if (m.stake > 0n) {
          for (const p of m.players) {
            if (!p.userId) continue;
            const staked = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: `stake:${matchId}:${p.userId}` } });
            if (!staked) continue;
            await this.ledger.post({
              type: 'STAKE_REFUND', currency: m.currency as Currency, idempotencyKey: `stake-refund:${matchId}:${p.userId}`, description: 'Match cancelled — stake returned',
              refType: 'match', refId: matchId, createdById: admin.id,
              entries: [{ account: { type: 'MATCH_ESCROW', matchId }, amount: -m.stake }, { account: { type: 'USER_WALLET', userId: p.userId }, amount: m.stake }],
            }, tx);
          }
        }
        const seq = ((m.state as any)?.seq ?? 0) + 1;
        await tx.matchEvent.create({ data: { matchId, seq, type: 'match_cancelled', actorId: admin.id, payload: { reason } } });
        const state = { ...(m.state as any), seq };
        await tx.match.update({ where: { id: matchId }, data: { status: 'CANCELLED', finishReason: 'cancelled', finishedAt: new Date(), state } });
        await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'match.cancel', targetType: 'match', targetId: matchId, before: { status: 'ACTIVE' }, after: { status: 'CANCELLED', reason }, ip: admin.ip });
      });
      if (rt) {
        if (rt.timer) clearTimeout(rt.timer);
        rt.engine = { ...rt.engine, status: 'finished', finishReason: null };
        for (const p of rt.players) if (p.userId) this.realtime.toUser(p.userId, 'match:cancelled', { matchId, reason });
        this.runtimes.delete(matchId);
        for (const cb of this.onFinished) await cb(matchId, rt.roomId);
      }
    };
    return rt ? this.exclusive(rt, run) : run();
  }

  // ------------------------------------------------------------------ recovery

  /** Rebuild in-memory runtimes for ACTIVE matches after a restart (state is in the DB). */
  async recover() {
    const active = await this.prisma.match.findMany({ where: { status: 'ACTIVE' }, include: { players: { include: { user: true } } } });
    for (const m of active) {
      const ps = m.state as unknown as PersistedState;
      const rt: Runtime = {
        ...ps, id: m.id, mode: m.mode, stake: m.stake, currency: m.currency as Currency, ranked: m.ranked, chatEnabled: m.chatEnabled, roomId: m.roomId,
        players: m.players.sort((a, b) => a.seat - b.seat).map((p) => ({
          seat: p.seat as Seat, userId: p.userId, nickname: p.user?.nickname ?? p.botName ?? 'Bot', avatar: p.user?.avatar ?? 'bot',
          rating: p.user?.rating ?? null, level: p.user?.level ?? null, isBot: p.isBot,
        })),
        startedAt: m.startedAt, deadline: null, timer: null, lock: Promise.resolve(), recentActions: new Map(), lastEvents: [],
      };
      this.runtimes.set(m.id, rt);
      if (rt.engine.status === 'finished') {
        // crashed between engine finish and persistence is impossible (same tx), but be defensive
        this.log.warn(`Match ${m.id} has a finished engine state but ACTIVE row; leaving for admin review`);
        continue;
      }
      this.schedule(rt);
    }
    if (active.length) this.log.log(`Recovered ${active.length} active match(es)`);
  }

  private async checkSharedIps(matchId: string, userIds: string[]) {
    const sessions = await this.prisma.session.findMany({ where: { userId: { in: userIds }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, select: { userId: true, ip: true } });
    const byIp = new Map<string, Set<string>>();
    for (const s of sessions) if (s.ip) byIp.set(s.ip, (byIp.get(s.ip) ?? new Set()).add(s.userId));
    const shared = [...byIp.entries()].filter(([, u]) => u.size > 1);
    if (shared.length) {
      await this.prisma.suspiciousFlag.create({ data: { type: 'STAKE_MATCH_SHARED_IP', severity: 'medium', details: { matchId, shared: shared.map(([ip, u]) => ({ ip, users: [...u] })) } as Prisma.InputJsonValue } });
    }
  }
}

/** Accept only the known action shapes from clients (defence in depth before the engine). */
function sanitizeAction(game: GameId, a: any): AnyAction {
  if (!a || typeof a !== 'object') throw new AppError('BAD_ACTION', 'Invalid action');
  const square = (v: any) => Number.isInteger(v) && v >= 0 && v < 64;
  if (game === 'blot') {
    switch (a.type) {
      case 'pass': case 'contra': case 'recontra':
        return { type: a.type };
      case 'bid':
        return a.value === 'kapot'
          ? { type: 'bid', value: 'kapot', suit: String(a.suit) as any, plus: a.plus === undefined ? 0 : Number(a.plus) }
          : { type: 'bid', value: Number(a.value), suit: String(a.suit) as any };
      case 'play':
        return { type: 'play', card: String(a.card) as Blot.Card, declare: true, ...(a.slap === true ? { slap: true } : {}) };
      default:
        throw new AppError('BAD_ACTION', 'Unknown action');
    }
  }
  if (game !== 'nardi') {
    switch (a.type) {
      case 'resign': case 'offer_draw': case 'accept_draw': case 'decline_draw':
        return { type: a.type };
      case 'move':
        if (game === 'checkers') {
          if (!Array.isArray(a.move) || a.move.length < 2 || a.move.length > 14 || !a.move.every(square)) throw new AppError('BAD_ACTION', 'Invalid move');
          return { type: 'move', move: a.move.map(Number) };
        }
        if (!a.move || !square(a.move.from) || !square(a.move.to) || (a.move.promo !== undefined && ![2, 3, 4, 5].includes(a.move.promo))) throw new AppError('BAD_ACTION', 'Invalid move');
        return { type: 'move', move: { from: a.move.from, to: a.move.to, ...(a.move.promo ? { promo: a.move.promo } : {}) } };
      default:
        throw new AppError('BAD_ACTION', 'Unknown action');
    }
  }
  switch (a.type) {
    case 'roll':
      // dice are never taken from the client
      return { type: 'roll' };
    case 'move': {
      if (!Array.isArray(a.moves) || a.moves.length > 4) throw new AppError('BAD_ACTION', 'Invalid moves');
      const pt = (v: any, extra: string) => (v === extra ? extra : Number.isInteger(v) && v >= 0 && v < 24 ? v : null);
      const moves: Move[] = a.moves.map((m: any) => {
        const from = pt(m?.from, 'bar');
        const to = pt(m?.to, 'off');
        const die = Number(m?.die);
        if (from === null || to === null || !Number.isInteger(die) || die < 1 || die > 6) throw new AppError('BAD_ACTION', 'Invalid move');
        return { from, to, die } as Move;
      });
      return { type: 'move', moves };
    }
    default:
      throw new AppError('BAD_ACTION', 'Unknown action');
  }
}

export { SEATS };
