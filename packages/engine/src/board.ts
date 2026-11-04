import { Variant } from './rules';

export type Seat = 0 | 1;
export type Team = Seat;
export const SEATS: readonly Seat[] = [0, 1];
export const teamOf = (seat: Seat): Team => seat;
export const otherSeat = (seat: Seat): Seat => (1 - seat) as Seat;

export const CHECKERS = 15;

/**
 * The board. `points[i]` is absolute point i + 1 (0..23): a positive number is seat 0's checkers
 * (white), a negative number seat 1's (black). `bar` holds hit checkers (short nardi only),
 * `off` the borne-off ones.
 */
export interface Board {
  points: number[];
  bar: [number, number];
  off: [number, number];
}

/** One checker step. `from`/`to` are absolute point indexes 0..23; 'bar' enters, 'off' bears off. */
export interface Move {
  from: number | 'bar';
  to: number | 'off';
  die: number;
  /** Short nardi: an opponent checker was hit. */
  hit?: boolean;
}

/**
 * Every player counts their own way: relative point 24 is where they start, 1..6 is their home,
 * 0 is off the board. White (seat 0) uses the absolute numbers. Black (seat 1) plays the mirror
 * in short nardi and starts from the opposite corner in long nardi.
 */
export function absIndex(variant: Variant, seat: Seat, rel: number): number {
  if (seat === 0) return rel - 1;
  return variant === 'short' ? 24 - rel : (rel > 12 ? rel - 12 : rel + 12) - 1;
}
export function relOf(variant: Variant, seat: Seat, abs: number): number {
  const p = abs + 1;
  if (seat === 0) return p;
  return variant === 'short' ? 25 - p : p > 12 ? p - 12 : p + 12;
}

export const own = (b: Board, seat: Seat, abs: number) => (seat === 0 ? Math.max(0, b.points[abs]) : Math.max(0, -b.points[abs]));
export const opp = (b: Board, seat: Seat, abs: number) => own(b, (1 - seat) as Seat, abs);

export function startBoard(variant: Variant): Board {
  const points = new Array(24).fill(0);
  const put = (seat: Seat, rel: number, n: number) => (points[absIndex(variant, seat, rel)] += seat === 0 ? n : -n);
  for (const seat of [0, 1] as Seat[]) {
    if (variant === 'long') put(seat, 24, 15);
    else { put(seat, 24, 2); put(seat, 13, 5); put(seat, 8, 3); put(seat, 6, 5); }
  }
  return { points, bar: [0, 0], off: [0, 0] };
}

export const cloneBoard = (b: Board): Board => ({ points: [...b.points], bar: [b.bar[0], b.bar[1]], off: [b.off[0], b.off[1]] });

/** Pip count: how many points a player still has to travel. */
export function pips(b: Board, variant: Variant, seat: Seat): number {
  let n = b.bar[seat] * 25;
  for (let abs = 0; abs < 24; abs++) n += own(b, seat, abs) * relOf(variant, seat, abs);
  return n;
}

/** Turn context needed by the long-nardi head rule. */
export interface TurnCtx {
  variant: Variant;
  seat: Seat;
  /** Checkers already taken from the head this turn. */
  headMoves: number;
  /** How many may leave the head this turn (1, or 2 on the first 6-6 / 4-4 / 3-3). */
  headLimit: number;
}

function allHome(b: Board, ctx: TurnCtx): boolean {
  if (b.bar[ctx.seat] > 0) return false;
  for (let abs = 0; abs < 24; abs++) if (own(b, ctx.seat, abs) > 0 && relOf(ctx.variant, ctx.seat, abs) > 6) return false;
  return true;
}

/** Long nardi: six own points in a row may not shut in every opponent checker. */
function primeOk(b: Board, ctx: TurnCtx): boolean {
  const o = otherSeat(ctx.seat);
  let run = 0;
  // walk the opponent's path (their rel 24 → 1); a block is fine only if some opponent checker is already past it
  for (let r = 24; r >= 1; r--) {
    if (own(b, ctx.seat, absIndex(ctx.variant, o, r)) > 0) run += 1;
    else run = 0;
    if (run >= 6) {
      const blockEnd = r; // lowest rel of the block
      let passed = false;
      for (let q = blockEnd - 1; q >= 1 && !passed; q--) if (own(b, o, absIndex(ctx.variant, o, q)) > 0) passed = true;
      if (!passed) return false;
    }
  }
  return true;
}

function place(b: Board, seat: Seat, abs: number, delta: number) {
  b.points[abs] += seat === 0 ? delta : -delta;
}

/** Every single step one die allows, with the board after it. */
export function singleSteps(b: Board, ctx: TurnCtx, die: number): { move: Move; board: Board; head: boolean }[] {
  const out: { move: Move; board: Board; head: boolean }[] = [];
  const { variant, seat } = ctx;
  const o = otherSeat(seat);
  if (variant === 'short' && b.bar[seat] > 0) {
    const to = absIndex(variant, seat, 25 - die);
    const n = opp(b, seat, to);
    if (n <= 1) {
      const nb = cloneBoard(b);
      nb.bar[seat] -= 1;
      if (n === 1) { place(nb, o, to, -1); nb.bar[o] += 1; }
      place(nb, seat, to, 1);
      out.push({ move: { from: 'bar', to, die, ...(n === 1 ? { hit: true } : {}) }, board: nb, head: false });
    }
    return out;
  }
  const home = allHome(b, ctx);
  for (let rel = 24; rel >= 1; rel--) {
    const from = absIndex(variant, seat, rel);
    if (own(b, seat, from) === 0) continue;
    const isHead = variant === 'long' && rel === 24;
    if (isHead && ctx.headMoves >= ctx.headLimit) continue;
    const target = rel - die;
    if (target >= 1) {
      const to = absIndex(variant, seat, target);
      const n = opp(b, seat, to);
      if (variant === 'long' ? n > 0 : n > 1) continue;
      const nb = cloneBoard(b);
      place(nb, seat, from, -1);
      if (n === 1) { place(nb, o, to, -1); nb.bar[o] += 1; }
      place(nb, seat, to, 1);
      if (variant === 'long' && !primeOk(nb, ctx)) continue;
      out.push({ move: { from, to, die, ...(n === 1 ? { hit: true } : {}) }, board: nb, head: isHead });
    } else if (home) {
      // bear off: exactly, or with a bigger die from the highest occupied point
      if (target < 0) {
        let higher = false;
        for (let r = rel + 1; r <= 6; r++) if (own(b, seat, absIndex(variant, seat, r)) > 0) higher = true;
        if (higher) continue;
      }
      const nb = cloneBoard(b);
      place(nb, seat, from, -1);
      nb.off[seat] += 1;
      out.push({ move: { from, to: 'off', die }, board: nb, head: false });
    }
  }
  return out;
}

const keyOf = (b: Board) => `${b.points.join(',')}|${b.bar.join(',')}|${b.off.join(',')}`;

export interface Sequence { moves: Move[]; board: Board }

/**
 * All legal ways to play a roll. The rules every nardi table uses: play as many dice as possible;
 * if only one of two different dice can be played, play the bigger one. Sequences that end in the
 * same position are listed once.
 */
export function legalSequences(b: Board, ctx: TurnCtx, dice: number[]): Sequence[] {
  const doubles = dice.length === 2 && dice[0] === dice[1];
  const orders = doubles ? [[dice[0], dice[0], dice[0], dice[0]]] : dice.length === 2 ? [[dice[0], dice[1]], [dice[1], dice[0]]] : [dice];
  const { list, best } = explore(b, ctx, orders);
  let out = list;
  if (!doubles && dice.length === 2 && best === 1) {
    const big = Math.max(dice[0], dice[1]);
    if (out.some((s) => s.moves[0].die === big)) out = out.filter((s) => s.moves[0].die === big);
  }
  return best === 0 ? [{ moves: [], board: b }] : out;
}

/** Walk every order of the given dice; the longest plays win. */
function explore(b: Board, ctx: TurnCtx, orders: number[][]): { list: Sequence[]; best: number } {
  const results = new Map<string, Sequence>();
  let best = 0;
  const seen = new Set<string>();
  const walk = (board: Board, rest: number[], moves: Move[], headMoves: number) => {
    const k = `${keyOf(board)}#${rest.join('')}#${headMoves}`;
    if (seen.has(k)) return;
    seen.add(k);
    const steps = rest.length ? singleSteps(board, { ...ctx, headMoves }, rest[0]) : [];
    if (!steps.length) {
      if (moves.length < best) return;
      if (moves.length > best) { best = moves.length; results.clear(); }
      // one-step plays keep the die too, so the «bigger die» rule can pick between them
      const fk = keyOf(board) + (moves.length === 1 ? `#${moves[0].die}` : '');
      if (!results.has(fk)) results.set(fk, { moves, board });
      return;
    }
    for (const s of steps) walk(s.board, rest.slice(1), [...moves, s.move], headMoves + (s.head ? 1 : 0));
  };
  for (const order of orders) walk(b, order, [], ctx.headMoves);
  return { list: [...results.values()], best };
}

/** The dice a roll gives: two moves, or four on doubles. */
export const diceMoves = (dice: number[]) => (dice.length === 2 && dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [...dice]);

/** Dice still to play after `prefix` (each step uses one die). */
export function remainingDice(dice: number[], prefix: Move[]): number[] {
  const rest = diceMoves(dice);
  for (const m of prefix) {
    const i = rest.indexOf(m.die);
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
}

const headAbs = (ctx: TurnCtx) => absIndex(ctx.variant, ctx.seat, 24);

/**
 * The steps a player may take next, after already taking `prefix`, in any order they like:
 * a step is allowed when the rest of the roll can still be played as fully as the rules demand.
 */
export function stepOptions(start: Board, ctx: TurnCtx, dice: number[], prefix: Move[]): Move[] {
  const all = legalSequences(start, ctx, dice);
  const best = all[0].moves.length;
  if (prefix.length >= best) return [];
  let board = start;
  let headMoves = ctx.headMoves;
  for (const m of prefix) {
    const step = singleSteps(board, { ...ctx, headMoves }, m.die).find((s) => s.move.from === m.from && s.move.to === m.to);
    if (!step) return [];
    board = step.board;
    if (step.head) headMoves += 1;
  }
  const rest = remainingDice(dice, prefix);
  const out: Move[] = [];
  const tried = new Set<number>();
  for (let i = 0; i < rest.length; i++) {
    const d = rest[i];
    if (tried.has(d)) continue;
    tried.add(d);
    const others = [...rest.slice(0, i), ...rest.slice(i + 1)];
    for (const s of singleSteps(board, { ...ctx, headMoves }, d)) {
      // the rest is one die, or the same die repeated (doubles), so a single order covers it
      const playable = others.length ? explore(s.board, { ...ctx, headMoves: headMoves + (s.head ? 1 : 0) }, [others]).best : 0;
      if (prefix.length + 1 + playable === best) out.push(s.move);
    }
  }
  // one of two different dice playable only: it must be the bigger one
  if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const big = Math.max(dice[0], dice[1]);
    if (out.some((m) => m.die === big)) return out.filter((m) => m.die === big);
  }
  return out;
}

/** Check a whole turn sent by a player; returns the board after it, or null if it breaks a rule. */
export function playTurn(start: Board, ctx: TurnCtx, dice: number[], moves: Move[]): Board | null {
  const best = legalSequences(start, ctx, dice)[0].moves.length;
  if (moves.length !== best) return null;
  const done: Move[] = [];
  for (const m of moves) {
    const opts = stepOptions(start, ctx, dice, done);
    const hit = opts.find((o) => o.from === m.from && o.to === m.to && o.die === m.die);
    if (!hit) return null;
    done.push(hit);
  }
  return applySteps(start, ctx.variant, ctx.seat, done);
}

export { headAbs };

/** Board after applying the steps of a prefix (client-side preview). */
export function applySteps(b: Board, variant: Variant, seat: Seat, moves: Move[]): Board {
  const nb = cloneBoard(b);
  const o = otherSeat(seat);
  for (const m of moves) {
    if (m.from === 'bar') nb.bar[seat] -= 1;
    else place(nb, seat, m.from, -1);
    if (m.to === 'off') nb.off[seat] += 1;
    else {
      if (variant === 'short' && opp(nb, seat, m.to) === 1) { place(nb, o, m.to, -1); nb.bar[o] += 1; }
      place(nb, seat, m.to, 1);
    }
  }
  return nb;
}

/** The board before the given steps were played (to replay a turn). Inverse of `applySteps`. */
export function unapplySteps(b: Board, variant: Variant, seat: Seat, moves: Move[]): Board {
  const nb = cloneBoard(b);
  const o = otherSeat(seat);
  for (const m of [...moves].reverse()) {
    if (m.to === 'off') nb.off[seat] -= 1;
    else {
      place(nb, seat, m.to, -1);
      if (variant === 'short' && m.hit) { nb.bar[o] -= 1; place(nb, o, m.to, 1); }
    }
    if (m.from === 'bar') nb.bar[seat] += 1;
    else place(nb, seat, m.from, 1);
  }
  return nb;
}

/** The same steps with `hit` set where an opponent checker was hit (short nardi). */
export function withHits(b: Board, variant: Variant, seat: Seat, moves: Move[]): Move[] {
  let cur = b;
  return moves.map((m) => {
    const hit = variant === 'short' && m.to !== 'off' && opp(cur, seat, m.to) === 1;
    cur = applySteps(cur, variant, seat, [m]);
    return { from: m.from, to: m.to, die: m.die, ...(hit ? { hit: true } : {}) };
  });
}
