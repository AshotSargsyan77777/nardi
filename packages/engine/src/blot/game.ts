import {
  Card, LAST_TRICK_BONUS, SEATS, Seat, Suit, Team, beats, cardPoints, fullDeck, isCard, nextSeat,
  partnerOf, rankOf, suitOf, teamOf,
} from './cards';
import { Combo, ComboKind, bestCombo, compareCombos, detectCombos } from './combos';
import { RuleConfig, normalizeRules } from './rules';

export type BidValue = number | 'kapot';
/** A trump suit, or 'NT' for a no-trump (անղոզ / բոյ) contract. */
export type BidSuit = Suit | 'NT';

export interface Contract {
  seat: Seat;
  value: BidValue;
  suit: BidSuit;
  /** Kapot only: «Կապոտ +N» — each step outbids the previous kapot and adds N to its value. */
  plus?: number;
}

export type BidRecord =
  | { seat: Seat; type: 'bid'; value: BidValue; suit: BidSuit; plus?: number }
  | { seat: Seat; type: 'pass' }
  | { seat: Seat; type: 'contra' }
  | { seat: Seat; type: 'recontra' };

export interface Play { seat: Seat; card: Card }
export interface CompletedTrick { plays: Play[]; winner: Seat; points: number }

export interface HandState {
  number: number;
  phase: 'bidding' | 'playing';
  dealer: Seat;
  /** Full deck order as dealt (server-private, used for audit / fairness proof). */
  deck: Card[];
  hands: Card[][];
  /** Cards still to be dealt after bidding (used when cardsBeforeBidding = 4). */
  pending: Card[][];
  bids: BidRecord[];
  contract: Contract | null;
  contra: Seat | null;
  recontra: Seat | null;
  passesInRow: number;
  turn: Seat;
  trump: Suit | null;
  trick: Play[];
  tricks: CompletedTrick[];
  /** Per seat: combos declared on the first trick (null = not yet played first card). */
  declared: (Combo[] | null)[];
  combosResolved: boolean;
  comboWinnerTeam: Team | null;
  blotHolder: Seat | null;
  blotPlayed: number;
}

/** One part of what a team wrote for a hand (shown as «12 × 2 + 16 + 5 = 45»). */
export interface ScoreLine { kind: 'bid' | 'cards' | 'combos' | 'blot'; points: number; bid?: number; mult?: number }

export interface HandResult {
  number: number;
  redeal: boolean;
  contract: Contract | null;
  contra: boolean;
  recontra: boolean;
  trickRaw: [number, number];
  comboRaw: [number, number];
  blotRaw: [number, number];
  tricksWon: [number, number];
  kapotTeam: Team | null;
  /** «Թարս կապուտ»: the bidding team took no trick — it loses the match. */
  tharsKapot?: boolean;
  made: boolean | null;
  awarded: [number, number];
  /** How each team's `awarded` was made up. */
  lines?: [ScoreLine[], ScoreLine[]];
  scoresAfter: [number, number];
}

export interface MatchState {
  config: RuleConfig;
  status: 'playing' | 'finished';
  scores: [number, number];
  dealer: Seat;
  handNumber: number;
  hand: HandState | null;
  /** True when the server must call dealHand() with a freshly shuffled deck. */
  awaitingDeal: boolean;
  history: HandResult[];
  winnerTeam: Team | null;
  finishReason: 'score' | 'forfeit' | 'tharsKapot' | 'kapot' | null;
  /** The last hand's cards as they were picked up from the table (for a «table» deal). */
  collected?: Card[] | null;
  /** Monotonic counter; clients send it back to prevent stale/duplicate actions. */
  version: number;
}

export type Action =
  | { type: 'bid'; value: BidValue; suit: BidSuit; plus?: number }
  | { type: 'pass' }
  | { type: 'contra' }
  | { type: 'recontra' }
  | { type: 'play'; card: Card; declare?: boolean; slap?: boolean };

export type GameEvent =
  | { type: 'hand_dealt'; hand: number; dealer: Seat }
  | { type: 'bid'; seat: Seat; value: BidValue; suit: BidSuit; plus?: number }
  | { type: 'pass'; seat: Seat }
  | { type: 'contra'; seat: Seat }
  | { type: 'recontra'; seat: Seat }
  | { type: 'bidding_ended'; contract: Contract; contra: boolean; recontra: boolean }
  | { type: 'redeal'; hand: number }
  | { type: 'card_played'; seat: Seat; card: Card; declared?: ComboKind[]; slap?: boolean }
  | { type: 'blot'; seat: Seat }
  | { type: 'trick_won'; seat: Seat; points: number; trick: number }
  | { type: 'combos_resolved'; winnerTeam: Team | null }
  | { type: 'hand_scored'; result: HandResult }
  | { type: 'match_finished'; winnerTeam: Team; reason: 'score' | 'forfeit' | 'tharsKapot' | 'kapot' };

export class EngineError extends Error {
  constructor(public code: string, public detail?: string) {
    super(code);
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function createMatch(config?: Partial<RuleConfig>, firstDealer: Seat = 0): MatchState {
  return {
    config: normalizeRules(config),
    status: 'playing',
    scores: [0, 0],
    // dealHand() rotates before dealing, so store the seat "before" the first dealer.
    dealer: nextSeat(firstDealer, -1),
    handNumber: 0,
    hand: null,
    awaitingDeal: true,
    history: [],
    winnerTeam: null,
    finishReason: null,
    version: 0,
  };
}

function validateDeck(deck: Card[]) {
  if (deck.length !== 32) throw new EngineError('BAD_DECK', 'Deck must contain 32 cards');
  const set = new Set(deck);
  const ref = fullDeck();
  if (set.size !== 32 || !ref.every((c) => set.has(c))) throw new EngineError('BAD_DECK', 'Deck is not a full 32-card deck');
}

/**
 * Deal a new hand from an already-shuffled deck (shuffling is the server's job; the engine
 * never uses randomness). Cards go 3-2-3 (or 2-2, then 2-2 after the bazar) starting left of the dealer.
 */
export function dealHand(prev: MatchState, deck: Card[]): { state: MatchState; events: GameEvent[] } {
  if (prev.status !== 'playing') throw new EngineError('MATCH_FINISHED');
  if (!prev.awaitingDeal) throw new EngineError('NOT_AWAITING_DEAL');
  validateDeck(deck);
  const state = clone(prev);
  const dealer = nextSeat(state.dealer) as Seat;
  const first = nextSeat(dealer);
  const order = [0, 1, 2, 3].map((i) => nextSeat(first, i));
  const hands: Card[][] = [[], [], [], []];
  const pending: Card[][] = [[], [], [], []];
  let p = 0;
  const fourFour = state.config.cardsBeforeBidding === 4;
  for (const n of fourFour ? [2, 2] : [3, 2, 3]) for (const seat of order) for (let k = 0; k < n; k++) hands[seat].push(deck[p++]);
  if (fourFour) for (const n of [2, 2]) for (const seat of order) for (let k = 0; k < n; k++) pending[seat].push(deck[p++]);

  state.handNumber += 1;
  state.dealer = dealer;
  state.awaitingDeal = false;
  state.hand = {
    number: state.handNumber,
    phase: 'bidding',
    dealer,
    deck: [...deck],
    hands,
    pending,
    bids: [],
    contract: null,
    contra: null,
    recontra: null,
    passesInRow: 0,
    turn: first,
    trump: null,
    trick: [],
    tricks: [],
    declared: [null, null, null, null],
    combosResolved: false,
    comboWinnerTeam: null,
    blotHolder: null,
    blotPlayed: 0,
  };
  state.version += 1;
  return { state, events: [{ type: 'hand_dealt', hand: state.handNumber, dealer }] };
}

/** Bid value written to the score: a number, or kapot points + N for «Կապոտ +N». */
export const bidPoints = (c: { value: BidValue; plus?: number }, cfg: RuleConfig) =>
  c.value === 'kapot' ? cfg.kapotPoints + (c.plus ?? 0) : c.value;
/** Maximum N in «Կապոտ +N». */
export const maxKapotPlus = (cfg: RuleConfig) => Math.max(0, cfg.maxBid - cfg.kapotPoints);

export interface BiddingOptions {
  canPass: boolean;
  minBid: number | null;
  maxBid: number;
  canKapot: boolean;
  /** Lowest allowed N for «Կապոտ +N» (0 = plain kapot); null when kapot cannot be bid. */
  minKapotPlus: number | null;
  maxKapotPlus: number;
  canNoTrump: boolean;
  canContra: boolean;
  canRecontra: boolean;
}

export function biddingOptions(state: MatchState, seat: Seat): BiddingOptions | null {
  const h = state.hand;
  if (!h || state.status !== 'playing' || h.phase !== 'bidding' || h.turn !== seat) return null;
  const c = state.config;
  const cur = h.contract;
  const curKapot = cur?.value === 'kapot';
  const lowest = curKapot ? Number.POSITIVE_INFINITY : Math.max(c.minBid, (cur ? (cur.value as number) : c.minBid - 1) + 1);
  const kapotFrom = curKapot ? (cur!.plus ?? 0) + 1 : 0;
  const kapotMax = maxKapotPlus(c);
  const isOpponentContract = !!cur && teamOf(cur.seat) !== teamOf(seat);
  // After a contra (քուանշ) nobody may bid any more: the bidding team can only answer
  // with a recontra (սուր) or pass, and the hand is played at the doubled contract.
  if (h.contra !== null) {
    return {
      canPass: true, minBid: null, maxBid: c.maxBid, canKapot: false, minKapotPlus: null, maxKapotPlus: kapotMax, canNoTrump: false, canContra: false,
      canRecontra: c.recontraEnabled && !isOpponentContract && h.recontra === null,
    };
  }
  return {
    canPass: true,
    minBid: lowest <= c.maxBid ? lowest : null,
    maxBid: c.maxBid,
    canKapot: c.allowKapotBid && kapotFrom <= kapotMax,
    minKapotPlus: c.allowKapotBid && kapotFrom <= kapotMax ? kapotFrom : null,
    maxKapotPlus: kapotMax,
    canNoTrump: c.allowNoTrump,
    canContra: c.contraEnabled && isOpponentContract && h.contra === null,
    canRecontra: c.recontraEnabled && !!cur && !isOpponentContract && h.contra !== null && h.recontra === null,
  };
}

export function legalCards(state: MatchState, seat: Seat): Card[] {
  const h = state.hand;
  if (!h || state.status !== 'playing' || h.phase !== 'playing' || h.turn !== seat) return [];
  return legalCardsFor(h.hands[seat], h.trick, h.trump, seat, state.config);
}

export function legalCardsFor(hand: Card[], trick: Play[], trump: Suit | null, seat: Seat, rules: RuleConfig): Card[] {
  if (trick.length === 0) return [...hand];
  const led = suitOf(trick[0].card);
  let winner = trick[0];
  for (const p of trick.slice(1)) if (beats(p.card, winner.card, led, trump)) winner = p;
  const trumpsInTrick = trick.filter((p) => suitOf(p.card) === trump).map((p) => p.card);
  const myTrumps = hand.filter((c) => suitOf(c) === trump);
  const overtrumps = (cands: Card[]) => {
    if (!rules.mustOvertrump || trumpsInTrick.length === 0) return cands;
    const best = trumpsInTrick.reduce((a, b) => (beats(b, a, trump!, trump) ? b : a));
    const higher = cands.filter((c) => beats(c, best, trump!, trump));
    return higher.length ? higher : cands;
  };

  const ofLed = hand.filter((c) => suitOf(c) === led);
  if (ofLed.length) return led === trump ? overtrumps(ofLed) : ofLed;

  if (myTrumps.length === 0) return [...hand];
  // no need to trump when the partner's card is already the strongest on the table
  if (winner.seat === partnerOf(seat)) return [...hand];
  return overtrumps(myTrumps);
}

function assertTurn(state: MatchState, seat: Seat) {
  if (state.status !== 'playing') throw new EngineError('MATCH_FINISHED');
  if (state.awaitingDeal || !state.hand) throw new EngineError('NO_ACTIVE_HAND');
  if (state.hand.turn !== seat) throw new EngineError('NOT_YOUR_TURN');
}

export function applyAction(prev: MatchState, seat: Seat, action: Action): { state: MatchState; events: GameEvent[] } {
  if (!SEATS.includes(seat)) throw new EngineError('BAD_SEAT');
  assertTurn(prev, seat);
  const state = clone(prev);
  const events: GameEvent[] = [];
  const h = state.hand!;

  if (h.phase === 'bidding') {
    const opts = biddingOptions(state, seat)!;
    switch (action.type) {
      case 'pass':
        h.bids.push({ seat, type: 'pass' });
        h.passesInRow += 1;
        events.push({ type: 'pass', seat });
        break;
      case 'bid': {
        if (h.contra !== null) throw new EngineError('BIDDING_CLOSED', 'No bids after a contra');
        if (action.suit === 'NT') {
          if (!opts.canNoTrump) throw new EngineError('NO_TRUMP_DISABLED');
        } else if (!['S', 'H', 'D', 'C'].includes(action.suit)) throw new EngineError('BAD_SUIT');
        let plus: number | undefined;
        if (action.value === 'kapot') {
          plus = action.plus ?? 0;
          if (opts.minKapotPlus === null || !Number.isInteger(plus) || plus < opts.minKapotPlus || plus > opts.maxKapotPlus) {
            throw new EngineError('BID_NOT_ALLOWED');
          }
        } else {
          if (!Number.isInteger(action.value) || opts.minBid === null || action.value < opts.minBid || action.value > opts.maxBid) {
            throw new EngineError('BID_TOO_LOW');
          }
        }
        h.contract = { seat, value: action.value, suit: action.suit, ...(plus ? { plus } : {}) };
        h.contra = null;
        h.recontra = null;
        h.passesInRow = 0;
        h.bids.push({ seat, type: 'bid', value: action.value, suit: action.suit, ...(plus ? { plus } : {}) });
        events.push({ type: 'bid', seat, value: action.value, suit: action.suit, ...(plus ? { plus } : {}) });
        break;
      }
      case 'contra':
        if (!opts.canContra) throw new EngineError('CONTRA_NOT_ALLOWED');
        h.contra = seat;
        h.passesInRow = 0;
        h.bids.push({ seat, type: 'contra' });
        events.push({ type: 'contra', seat });
        break;
      case 'recontra':
        if (!opts.canRecontra) throw new EngineError('RECONTRA_NOT_ALLOWED');
        h.recontra = seat;
        h.bids.push({ seat, type: 'recontra' });
        events.push({ type: 'recontra', seat });
        break;
      default:
        throw new EngineError('BAD_ACTION', 'Cards cannot be played during bidding');
    }

    const allPassed = !h.contract && h.passesInRow >= 4;
    // without a contra the bazar goes all the way round: the last bidder may raise again, so it ends
    // only when all four have passed after the last bid; after a contra only the two bidding-team
    // players may still act (recontra or pass)
    const closed = !!h.contract && (
      h.recontra !== null ||
      (h.contra !== null ? !state.config.recontraEnabled || h.passesInRow >= 2 : h.passesInRow >= 4)
    );
    if (allPassed) {
      const result = emptyResult(h.number, state.scores, true);
      state.history.push(result);
      // everybody throws their cards in, one hand on top of the other
      state.collected = [0, 1, 2, 3].flatMap((i) => [...h.hands[nextSeat(h.dealer, i + 1)], ...h.pending[nextSeat(h.dealer, i + 1)]]);
      state.hand = null;
      state.awaitingDeal = true;
      events.push({ type: 'redeal', hand: h.number });
    } else if (closed) {
      startPlay(state);
      events.push({ type: 'bidding_ended', contract: h.contract!, contra: h.contra !== null, recontra: h.recontra !== null });
    } else {
      // after a contra the turn goes only to the bidding team: the contra's next seat, then its partner
      h.turn = h.contra !== null && action.type === 'pass' ? nextSeat(seat, 2) : nextSeat(seat);
    }
    state.version += 1;
    return { state, events };
  }

  // Playing phase
  if (action.type !== 'play') throw new EngineError('BAD_ACTION', 'Bidding is over');
  if (!isCard(action.card)) throw new EngineError('BAD_CARD');
  const hand = h.hands[seat];
  if (!hand.includes(action.card)) throw new EngineError('CARD_NOT_IN_HAND');
  const legal = legalCardsFor(hand, h.trick, h.trump, seat, state.config);
  if (!legal.includes(action.card)) throw new EngineError('ILLEGAL_CARD');

  // «slap»: the card was slammed on the table (double tap) — only a sound for the others
  const ev: GameEvent = { type: 'card_played', seat, card: action.card, ...(action.slap ? { slap: true } : {}) };
  if (h.tricks.length === 0 && h.declared[seat] === null) {
    // combinations are always declared (terz, 50, 100, four of a kind) — blot is handled separately
    h.declared[seat] = detectCombos(hand, h.trump === null);
    (ev as any).declared = h.declared[seat]!.map((c) => c.kind);
  }
  h.hands[seat] = hand.filter((c) => c !== action.card);
  h.trick.push({ seat, card: action.card });
  events.push(ev);

  if (h.blotHolder === seat && suitOf(action.card) === h.trump && (rankOf(action.card) === 'K' || rankOf(action.card) === 'Q')) {
    h.blotPlayed += 1;
    if (h.blotPlayed === 2) events.push({ type: 'blot', seat });
  }

  if (h.trick.length < 4) {
    h.turn = nextSeat(seat);
  } else {
    const led = suitOf(h.trick[0].card);
    let win = h.trick[0];
    for (const p of h.trick.slice(1)) if (beats(p.card, win.card, led, h.trump)) win = p;
    const points = h.trick.reduce((s, p) => s + cardPoints(p.card, h.trump), 0);
    h.tricks.push({ plays: h.trick, winner: win.seat, points });
    h.trick = [];
    h.turn = win.seat;
    events.push({ type: 'trick_won', seat: win.seat, points, trick: h.tricks.length });
    if (h.tricks.length === 1) {
      resolveCombos(h);
      events.push({ type: 'combos_resolved', winnerTeam: h.comboWinnerTeam });
    }
    if (h.tricks.length === 8) {
      const result = scoreHand(h, state);
      events.push({ type: 'hand_scored', result });
      finishHandOrMatch(state, events);
    }
  }
  state.version += 1;
  return { state, events };
}

function startPlay(state: MatchState) {
  const h = state.hand!;
  h.phase = 'playing';
  h.trump = h.contract!.suit === 'NT' ? null : h.contract!.suit;
  for (const s of SEATS) {
    h.hands[s].push(...h.pending[s]);
    h.pending[s] = [];
  }
  const kq = [`K${h.trump}`, `Q${h.trump}`] as Card[];
  const holder = h.trump ? SEATS.find((s) => kq.every((c) => h.hands[s].includes(c))) : undefined;
  h.blotHolder = holder ?? null;
  h.turn = nextSeat(h.dealer);
}

export function resolveCombos(h: HandState) {
  h.combosResolved = true;
  // each team's strongest combination, and who holds it
  const best = ([0, 1] as Team[]).map((team) => {
    let top: { combo: Combo; seat: Seat } | null = null;
    for (const seat of SEATS.filter((s) => teamOf(s) === team)) {
      const c = bestCombo(h.declared[seat] ?? [], h.trump);
      if (c && (!top || compareCombos(c, top.combo, h.trump) > 0)) top = { combo: c, seat };
    }
    return top;
  });
  if (!best[0] && !best[1]) h.comboWinnerTeam = null;
  else if (!best[1]) h.comboWinnerTeam = 0;
  else if (!best[0]) h.comboWinnerTeam = 1;
  else {
    const cmp = compareCombos(best[0].combo, best[1].combo, h.trump);
    if (cmp !== 0) h.comboWinnerTeam = cmp > 0 ? 0 : 1;
    else {
      // exactly equal: the one who comes first after the dealer wins
      const order = (s: Seat) => (s - h.dealer + 3) % 4;
      h.comboWinnerTeam = order(best[0].seat) < order(best[1].seat) ? 0 : 1;
    }
  }
}

function emptyResult(number: number, scores: [number, number], redeal: boolean): HandResult {
  return {
    number, redeal, contract: null, contra: false, recontra: false,
    trickRaw: [0, 0], comboRaw: [0, 0], blotRaw: [0, 0], tricksWon: [0, 0],
    kapotTeam: null, made: null, awarded: [0, 0], scoresAfter: [...scores] as [number, number],
  };
}

/** Round x/10 with .5 going down (e.g. 75 -> 7, 76 -> 8). */
const scaleDown = (raw: number) => Math.floor((raw + 4) / 10);

export function scoreHand(h: HandState, state: MatchState): HandResult {
  const cfg = state.config;
  const contract = h.contract!;
  const trickRaw: [number, number] = [0, 0];
  const tricksWon: [number, number] = [0, 0];
  for (const t of h.tricks) {
    trickRaw[teamOf(t.winner)] += t.points;
    tricksWon[teamOf(t.winner)] += 1;
  }
  trickRaw[teamOf(h.tricks[h.tricks.length - 1].winner)] += LAST_TRICK_BONUS;

  const comboRaw: [number, number] = [0, 0];
  if (h.comboWinnerTeam !== null) {
    for (const s of SEATS) if (teamOf(s) === h.comboWinnerTeam) comboRaw[h.comboWinnerTeam] += (h.declared[s] ?? []).reduce((a, c) => a + c.points, 0);
  }
  const blotRaw: [number, number] = [0, 0];
  if (h.blotHolder !== null && h.blotPlayed >= 2) blotRaw[teamOf(h.blotHolder)] = 20;

  const bt = teamOf(contract.seat);
  const dt = (1 - bt) as Team;
  const kapotTeam: Team | null = tricksWon[0] === 8 ? 0 : tricksWon[1] === 8 ? 1 : null;
  const noTrump = contract.suit === 'NT';
  // «Թարս կապուտ»: the bidders took no trick at all — a failed contract that also loses the match
  const tharsKapot = tricksWon[bt] === 0;

  const comboPts = comboRaw.map((v) => v / 10) as [number, number];
  const blotPts = blotRaw.map((v) => v / 10) as [number, number];

  const bidderRaw = trickRaw[bt] + comboRaw[bt] + blotRaw[bt];
  const defenderRaw = trickRaw[dt] + comboRaw[dt] + blotRaw[dt];
  const made = !tharsKapot && (contract.value === 'kapot'
    ? kapotTeam === bt
    : bidderRaw >= contract.value * 10 && (!cfg.bidderMustOutscore || bidderRaw > defenderRaw));
  // the multiplier applies to the bid number only: ×1 / ×2 (quanche) / ×4 (sur);
  // a no-trump (բոյ) bid adds one more: ×2 / ×3 / ×5
  const mult = (h.recontra !== null ? 4 : h.contra !== null ? 2 : 1) + (noTrump && cfg.noTrumpDoubled ? 1 : 0);
  const bidValue = bidPoints(contract, cfg);
  const doubled = h.contra !== null || h.recontra !== null;
  // card points of a hand: 16, or 25 when the bidders take all 8 tricks (kapot)
  const base = made && kapotTeam === bt ? cfg.kapotPoints : cfg.handPoints;
  // the defenders' card points: their raw points / 10, .5 rounding down (75 -> 7, 76 -> 8)
  const defenderPts = kapotTeam === bt ? 0 : scaleDown(trickRaw[dt]);
  const trickPts: [number, number] = [0, 0];
  trickPts[bt] = base - defenderPts;
  trickPts[dt] = defenderPts;

  const lines: [ScoreLine[], ScoreLine[]] = [[], []];
  const bidLine: ScoreLine = { kind: 'bid', points: bidValue * mult, bid: bidValue, mult };
  if (made && !doubled) {
    // made: the bidders write bid × k + (16 − defenders' points) + their bonuses;
    // the defenders write their own points + their own bonuses
    lines[bt].push(bidLine, { kind: 'cards', points: trickPts[bt] }, { kind: 'combos', points: comboPts[bt] }, { kind: 'blot', points: blotPts[bt] });
    lines[dt].push({ kind: 'cards', points: trickPts[dt] }, { kind: 'combos', points: comboPts[dt] }, { kind: 'blot', points: blotPts[dt] });
  } else {
    // failed, or made with a quanche: the winner writes bid × k + 16 + every bonus of both teams
    const winner = made ? bt : dt;
    lines[winner].push(bidLine, { kind: 'cards', points: base }, { kind: 'combos', points: comboPts[0] + comboPts[1] });
    if (cfg.blotAlwaysKept) {
      lines[0].push({ kind: 'blot', points: blotPts[0] });
      lines[1].push({ kind: 'blot', points: blotPts[1] });
    } else {
      lines[winner].push({ kind: 'blot', points: blotPts[0] + blotPts[1] });
    }
  }
  for (const t of [0, 1] as Team[]) lines[t] = lines[t].filter((l) => l.points !== 0 || l.kind === 'cards');
  const awarded = lines.map((ls) => ls.reduce((a, l) => a + l.points, 0)) as [number, number];

  state.scores = [state.scores[0] + awarded[0], state.scores[1] + awarded[1]];
  const result: HandResult = {
    number: h.number, redeal: false, contract, contra: h.contra !== null, recontra: h.recontra !== null,
    trickRaw, comboRaw, blotRaw, tricksWon, kapotTeam, made, awarded, lines, scoresAfter: [...state.scores] as [number, number],
    ...(tharsKapot ? { tharsKapot } : {}),
  };
  state.history.push(result);
  return result;
}

function finishHandOrMatch(state: MatchState, events: GameEvent[]) {
  // each team stacks its tricks; the two piles go one on the other
  const played = state.hand!;
  state.collected = ([0, 1] as Team[]).flatMap((team) => played.tricks.filter((t) => teamOf(t.winner) === team).flatMap((t) => t.plays.map((p) => p.card)));
  state.hand = null;
  const r = state.history[state.history.length - 1];
  const end = (winnerTeam: Team, reason: 'score' | 'tharsKapot' | 'kapot') => {
    state.status = 'finished';
    state.winnerTeam = winnerTeam;
    state.finishReason = reason;
    events.push({ type: 'match_finished', winnerTeam, reason });
  };
  const bt = r?.contract ? teamOf(r.contract.seat) : null;
  // «Թարս կապուտ»: the bidding team loses the match whatever the score
  if (r?.tharsKapot && bt !== null) return end((1 - bt) as Team, 'tharsKapot');
  // a kapot bid that was quanched and still made wins the match at once
  if (r?.made && r.contract?.value === 'kapot' && r.contra && bt !== null) return end(bt, 'kapot');

  const [a, b] = state.scores;
  const target = state.config.targetScore;
  if (a >= target || b >= target) {
    if (r && r.made === false && bt !== null && state.scores[bt] >= target) {
      // a team at the target cannot win on a round it bid and failed: the opponents win only if
      // they are now ahead, otherwise play goes on
      const dt = (1 - bt) as Team;
      if (state.scores[dt] > state.scores[bt]) return end(dt, 'score');
    } else if (a !== b) {
      return end(a > b ? 0 : 1, 'score');
    }
  }
  // equal scores above the target, or the case above: another hand is played
  state.awaitingDeal = true;
}

/** A team forfeits (left the match / abandoned). The other team wins. */
export function forfeit(prev: MatchState, losingTeam: Team): { state: MatchState; events: GameEvent[] } {
  if (prev.status !== 'playing') throw new EngineError('MATCH_FINISHED');
  const state = clone(prev);
  state.status = 'finished';
  state.winnerTeam = (1 - losingTeam) as Team;
  state.finishReason = 'forfeit';
  state.hand = null;
  state.awaitingDeal = false;
  state.version += 1;
  return { state, events: [{ type: 'match_finished', winnerTeam: state.winnerTeam, reason: 'forfeit' }] };
}

/** Deterministic action used when a player's turn timer expires. */
export function autoAction(state: MatchState, seat: Seat): Action {
  const h = state.hand;
  if (!h) throw new EngineError('NO_ACTIVE_HAND');
  if (h.phase === 'bidding') return { type: 'pass' };
  const legal = legalCards(state, seat);
  const sorted = [...legal].sort((x, y) => cardPoints(x, h.trump) - cardPoints(y, h.trump));
  return { type: 'play', card: sorted[0], declare: true };
}

export function whoseTurn(state: MatchState): Seat | null {
  if (state.status !== 'playing' || state.awaitingDeal || !state.hand) return null;
  return state.hand.turn;
}
