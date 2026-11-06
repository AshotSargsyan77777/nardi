/**
 * Chess with clocks. Full rules: castling, en passant, promotion, check, checkmate, stalemate,
 * threefold repetition, the fifty-move rule, insufficient material, resigning, draw offers and
 * running out of time (a draw if the opponent cannot possibly mate).
 *
 * Squares 0..63 row by row from the top (black's side): index = row × 8 + col, so a8 = 0, h1 = 63.
 * Pieces: 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king; white positive, black negative.
 */
import type { Seat } from './board';
import { DuelAction, DuelBase, DuelError, DuelEvent, finish, handleTalk, other } from './duel';

export type BotLevel = 'easy' | 'medium' | 'strong';
export interface ChessRules { game: 'chess'; botLevel: BotLevel; clockMin: number; clockInc: number; turnTimeoutSec: number }
export const CHESS_CLOCKS: [number, number][] = [[1, 0], [3, 0], [3, 2], [5, 0], [10, 0], [15, 10], [30, 0]];
export const CHESS_DEFAULTS: ChessRules = { game: 'chess', botLevel: 'medium', clockMin: 5, clockInc: 0, turnTimeoutSec: 0 };

export interface CMoveC { from: number; to: number; promo?: number }
interface Full extends CMoveC { piece: number; captured: number; ep?: boolean; castle?: boolean }

export interface Position {
  board: number[];
  turn: Seat;
  /** 1 white O-O, 2 white O-O-O, 4 black O-O, 8 black O-O-O. */
  castling: number;
  ep: number;
  half: number;
  full: number;
}
export interface ChessGame {
  pos: Position;
  sans: string[];
  lastMove: CMoveC | null;
  seen: Record<string, number>;
  /** Milliseconds left for [white, black]; the side on move has been thinking since `since`. */
  clock: { left: [number, number]; since: number; inc: number };
}
export type ChessState = DuelBase<ChessRules, ChessGame>;
export type ChessAction = DuelAction<CMoveC>;
export type ChessEvent = DuelEvent<CMoveC>;

const row = (i: number) => i >> 3;
const col = (i: number) => i & 7;
const sideOf = (p: number): Seat => (p > 0 ? 0 : 1);
const mine = (p: number, s: Seat) => (s === 0 ? p > 0 : p < 0);
export const sqName = (i: number) => 'abcdefgh'[col(i)] + (8 - row(i));
export const sqIndex = (n: string) => (8 - Number(n[1])) * 8 + (n.charCodeAt(0) - 97);

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const at = (r: number, c: number) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);

export function startPosition(): Position {
  const back = [4, 2, 3, 5, 6, 3, 2, 4];
  const board = Array(64).fill(0);
  for (let c = 0; c < 8; c++) {
    board[c] = -back[c];
    board[8 + c] = -1;
    board[48 + c] = 1;
    board[56 + c] = back[c];
  }
  return { board, turn: 0, castling: 15, ep: -1, half: 0, full: 1 };
}

/** Is square `sq` attacked by `by`? */
export function attacked(b: number[], sq: number, by: Seat): boolean {
  const r = row(sq), c = col(sq);
  const sgn = by === 0 ? 1 : -1;
  // pawns attack diagonally forward (white upward)
  const pr = by === 0 ? r + 1 : r - 1;
  for (const dc of [-1, 1]) { const i = at(pr, c + dc); if (i >= 0 && b[i] === sgn * 1) return true; }
  for (const [dr, dc] of KNIGHT) { const i = at(r + dr, c + dc); if (i >= 0 && b[i] === sgn * 2) return true; }
  for (const [dr, dc] of KING) { const i = at(r + dr, c + dc); if (i >= 0 && b[i] === sgn * 6) return true; }
  for (const [dr, dc] of DIAG) {
    for (let k = 1; ; k++) {
      const i = at(r + dr * k, c + dc * k);
      if (i < 0) break;
      if (b[i]) { if (b[i] === sgn * 3 || b[i] === sgn * 5) return true; break; }
    }
  }
  for (const [dr, dc] of ORTHO) {
    for (let k = 1; ; k++) {
      const i = at(r + dr * k, c + dc * k);
      if (i < 0) break;
      if (b[i]) { if (b[i] === sgn * 4 || b[i] === sgn * 5) return true; break; }
    }
  }
  return false;
}

const kingSq = (b: number[], s: Seat) => b.indexOf(s === 0 ? 6 : -6);
export const inCheck = (p: Position, s: Seat = p.turn) => attacked(p.board, kingSq(p.board, s), other(s));

function pseudo(p: Position): Full[] {
  const out: Full[] = [];
  const b = p.board, s = p.turn, sgn = s === 0 ? 1 : -1;
  const add = (from: number, to: number, extra: Partial<Full> = {}) => out.push({ from, to, piece: b[from], captured: b[to], ...extra });
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v || !mine(v, s)) continue;
    const t = Math.abs(v), r = row(i), c = col(i);
    if (t === 1) {
      const dir = s === 0 ? -1 : 1, start = s === 0 ? 6 : 1, last = s === 0 ? 0 : 7;
      const one = at(r + dir, c);
      const push = (to: number, extra: Partial<Full> = {}) => {
        if (row(to) === last) for (const pr of [5, 4, 3, 2]) add(i, to, { ...extra, promo: pr });
        else add(i, to, extra);
      };
      if (one >= 0 && !b[one]) {
        push(one);
        const two = at(r + 2 * dir, c);
        if (r === start && !b[two]) add(i, two);
      }
      for (const dc of [-1, 1]) {
        const to = at(r + dir, c + dc);
        if (to < 0) continue;
        if (b[to] && !mine(b[to], s)) push(to);
        else if (to === p.ep) add(i, to, { ep: true, captured: -sgn });
      }
    } else if (t === 2 || t === 6) {
      for (const [dr, dc] of t === 2 ? KNIGHT : KING) {
        const to = at(r + dr, c + dc);
        if (to >= 0 && (!b[to] || !mine(b[to], s))) add(i, to);
      }
      if (t === 6) {
        const home = s === 0 ? 60 : 4;
        if (i === home && !attacked(b, i, other(s))) {
          const ks = s === 0 ? 1 : 4, qs = s === 0 ? 2 : 8;
          if (p.castling & ks && !b[i + 1] && !b[i + 2] && b[i + 3] === sgn * 4 && !attacked(b, i + 1, other(s)) && !attacked(b, i + 2, other(s))) add(i, i + 2, { castle: true });
          if (p.castling & qs && !b[i - 1] && !b[i - 2] && !b[i - 3] && b[i - 4] === sgn * 4 && !attacked(b, i - 1, other(s)) && !attacked(b, i - 2, other(s))) add(i, i - 2, { castle: true });
        }
      }
    } else {
      const dirs = t === 3 ? DIAG : t === 4 ? ORTHO : [...DIAG, ...ORTHO];
      for (const [dr, dc] of dirs) {
        for (let k = 1; ; k++) {
          const to = at(r + dr * k, c + dc * k);
          if (to < 0) break;
          if (!b[to]) { add(i, to); continue; }
          if (!mine(b[to], s)) add(i, to);
          break;
        }
      }
    }
  }
  return out;
}

export function make(p: Position, m: Full | CMoveC): Position {
  const b = [...p.board];
  const s = p.turn, sgn = s === 0 ? 1 : -1;
  const piece = b[m.from];
  const t = Math.abs(piece);
  const captured = b[m.to];
  b[m.to] = m.promo ? sgn * m.promo : piece;
  b[m.from] = 0;
  let ep = -1;
  if (t === 1) {
    if (m.to === p.ep) b[m.to + (s === 0 ? 8 : -8)] = 0;
    if (Math.abs(m.to - m.from) === 16) ep = (m.to + m.from) / 2;
  }
  if (t === 6 && Math.abs(m.to - m.from) === 2) {
    // move the rook too
    if (m.to > m.from) { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = 0; }
    else { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = 0; }
  }
  let castling = p.castling;
  const touch = (sq: number) => {
    if (sq === 60) castling &= ~3;
    if (sq === 4) castling &= ~12;
    if (sq === 63) castling &= ~1;
    if (sq === 56) castling &= ~2;
    if (sq === 7) castling &= ~4;
    if (sq === 0) castling &= ~8;
  };
  touch(m.from);
  touch(m.to);
  return { board: b, turn: other(s), castling, ep, half: t === 1 || captured ? 0 : p.half + 1, full: s === 1 ? p.full + 1 : p.full };
}

/** Legal moves of the side to move. */
export function legal(p: Position): Full[] {
  return pseudo(p).filter((m) => !inCheck(make(p, m), p.turn));
}

export const posKey = (p: Position) => p.board.join(',') + '|' + p.turn + p.castling + '|' + p.ep;

/** Neither side can ever mate: K v K, K+minor v K, K+B v K+B with bishops on the same colour. */
export function insufficient(b: number[]): boolean {
  const rest = b.map((v, i) => ({ v, i })).filter((x) => x.v && Math.abs(x.v) !== 6);
  if (!rest.length) return true;
  if (rest.length === 1 && [2, 3].includes(Math.abs(rest[0].v))) return true;
  if (rest.every((x) => Math.abs(x.v) === 3)) {
    const colors = new Set(rest.map((x) => (row(x.i) + col(x.i)) % 2));
    return colors.size === 1;
  }
  return false;
}
/** Can `s` alone ever mate (for the flag rule)? */
function canMate(b: number[], s: Seat) {
  const mineP = b.filter((v) => v && mine(v, s) && Math.abs(v) !== 6).map(Math.abs);
  if (!mineP.length) return false;
  if (mineP.length === 1 && (mineP[0] === 2 || mineP[0] === 3)) return false;
  return true;
}

const LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K'];
/** Standard algebraic notation of a legal move in `p`. */
export function san(p: Position, m: Full | CMoveC, all: Full[] = legal(p)): string {
  const piece = p.board[m.from];
  const t = Math.abs(piece);
  let out: string;
  if (t === 6 && Math.abs(m.to - m.from) === 2) out = m.to > m.from ? 'O-O' : 'O-O-O';
  else {
    const capture = !!p.board[m.to] || (t === 1 && m.to === p.ep);
    if (t === 1) out = (capture ? 'abcdefgh'[col(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + LETTER[m.promo] : '');
    else {
      const rivals = all.filter((o) => o.to === m.to && o.from !== m.from && p.board[o.from] === piece);
      let dis = '';
      if (rivals.length) {
        if (!rivals.some((o) => col(o.from) === col(m.from))) dis = 'abcdefgh'[col(m.from)];
        else if (!rivals.some((o) => row(o.from) === row(m.from))) dis = String(8 - row(m.from));
        else dis = sqName(m.from);
      }
      out = LETTER[t] + dis + (capture ? 'x' : '') + sqName(m.to);
    }
  }
  const next = make(p, m);
  if (inCheck(next)) out += legal(next).length ? '+' : '#';
  return out;
}

// ---------------------------------------------------------------- match

export function normalizeChessRules(p: Partial<ChessRules>): ChessRules {
  const level = (['easy', 'medium', 'strong'] as const).includes(p.botLevel as BotLevel) ? (p.botLevel as BotLevel) : CHESS_DEFAULTS.botLevel;
  const min = Number(p.clockMin), inc = Number(p.clockInc);
  const ok = CHESS_CLOCKS.some(([a, b]) => a === min && b === inc);
  return { game: 'chess', botLevel: level, clockMin: ok ? min : CHESS_DEFAULTS.clockMin, clockInc: ok ? inc : CHESS_DEFAULTS.clockInc, turnTimeoutSec: 0 };
}

export function createChess(cfg: Partial<ChessRules> = {}, now = Date.now()): ChessState {
  const config = normalizeChessRules(cfg);
  const pos = startPosition();
  const ms = config.clockMin * 60_000;
  return {
    config, status: 'playing', scores: [0, 0], handNumber: 1, history: [], winnerTeam: null, finishReason: null, version: 1, drawOffer: null,
    game: { pos, sans: [], lastMove: null, seen: { [posKey(pos)]: 1 }, clock: { left: [ms, ms], since: now, inc: config.clockInc * 1000 } },
  };
}

export const chessTurn = (s: ChessState): Seat | null => (s.status === 'playing' ? s.game.pos.turn : null);

/** When the side on move runs out of time (epoch ms). */
export const chessDeadline = (s: ChessState): number | null => (s.status === 'playing' ? s.game.clock.since + s.game.clock.left[s.game.pos.turn] : null);

export function applyChess(prev: ChessState, seat: Seat, a: ChessAction): { state: ChessState; events: ChessEvent[] } {
  if (prev.status !== 'playing') throw new DuelError('MATCH_OVER');
  const s: ChessState = structuredClone(prev);
  const g = s.game;
  const now = a.at ?? Date.now();
  const events: ChessEvent[] = [];
  const turn = g.pos.turn;
  // the clock of the side on move first: a late move or any action after the flag fell loses on time
  if (now - g.clock.since >= g.clock.left[turn]) {
    g.clock.left[turn] = 0;
    finish(s, canMate(g.pos.board, other(turn)) ? other(turn) : null, 'timeout', events);
    s.version += 1;
    return { state: s, events };
  }
  if (a.type === 'flag') throw new DuelError('NOT_YET', 'Time is not over');
  if (handleTalk(s, seat, a, turn, events)) {
    s.version += 1;
    return { state: s, events };
  }
  if (a.type !== 'move') throw new DuelError('BAD_ACTION');
  if (turn !== seat) throw new DuelError('NOT_YOUR_TURN');
  const all = legal(g.pos);
  const m = all.find((x) => x.from === a.move.from && x.to === a.move.to && (x.promo ?? 0) === (a.move.promo ?? (x.promo ? 5 : 0)));
  if (!m) throw new DuelError('ILLEGAL_MOVE');
  const notation = san(g.pos, m, all);
  g.clock.left[turn] = g.clock.left[turn] - (now - g.clock.since) + g.clock.inc;
  g.clock.since = now;
  g.pos = make(g.pos, m);
  g.sans.push(notation);
  g.lastMove = { from: m.from, to: m.to, ...(m.promo ? { promo: m.promo } : {}) };
  if (s.drawOffer !== null && s.drawOffer !== seat) s.drawOffer = null;
  events.push({ type: 'moved', seat, move: g.lastMove, capture: !!m.captured, check: notation.endsWith('+') || notation.endsWith('#'), san: notation });
  const k = posKey(g.pos);
  g.seen[k] = (g.seen[k] ?? 0) + 1;
  const replies = legal(g.pos);
  if (!replies.length) {
    if (inCheck(g.pos)) finish(s, seat, 'checkmate', events);
    else finish(s, null, 'stalemate', events);
  } else if (insufficient(g.pos.board)) finish(s, null, 'material', events);
  else if (g.seen[k] >= 3) finish(s, null, 'repetition', events);
  else if (g.pos.half >= 100) finish(s, null, 'fifty_moves', events);
  s.version += 1;
  return { state: s, events };
}

export function forfeitChess(prev: ChessState, losing: Seat) {
  const s: ChessState = structuredClone(prev);
  const events: ChessEvent[] = [];
  finish(s, other(losing), 'forfeit', events);
  s.version += 1;
  return { state: s, events };
}

// ---------------------------------------------------------------- bot

const VAL = [0, 100, 320, 330, 500, 900, 0];
// piece-square tables from white's view (row 0 = rank 8)
const PST: Record<number, number[]> = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

/** Score from the side to move. */
function evaluate(p: Position): number {
  const b = p.board;
  let score = 0, material = 0;
  for (let i = 0; i < 64; i++) if (b[i] && Math.abs(b[i]) !== 6 && Math.abs(b[i]) !== 1) material += VAL[Math.abs(b[i])];
  const endgame = material <= 2600;
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v) continue;
    const t = Math.abs(v);
    const idx = v > 0 ? i : (7 - row(i)) * 8 + col(i);
    const table = t === 6 && endgame ? KING_END : PST[t];
    score += (v > 0 ? 1 : -1) * (VAL[t] + table[idx]);
  }
  return p.turn === 0 ? score : -score;
}

interface Ctx { deadline: number; nodes: number; stop: boolean }
function quiesce(p: Position, alpha: number, beta: number, ctx: Ctx, depth = 0): number {
  const stand = evaluate(p);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth > 6) return alpha;
  const caps = legal(p).filter((m) => m.captured || m.promo).sort((x, y) => VAL[Math.abs(y.captured)] - VAL[Math.abs(x.captured)]);
  for (const m of caps) {
    const v = -quiesce(make(p, m), -beta, -alpha, ctx, depth + 1);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}
function negamax(p: Position, depth: number, alpha: number, beta: number, ctx: Ctx, ply: number): number {
  if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.stop = true;
  if (ctx.stop) return 0;
  const moves = legal(p);
  if (!moves.length) return inCheck(p) ? -100000 + ply : 0;
  if (p.half >= 100) return 0;
  if (depth <= 0) return quiesce(p, alpha, beta, ctx);
  moves.sort((x, y) => (VAL[Math.abs(y.captured)] * 10 - VAL[Math.abs(y.piece)] / 10 + (y.promo ? 800 : 0)) - (VAL[Math.abs(x.captured)] * 10 - VAL[Math.abs(x.piece)] / 10 + (x.promo ? 800 : 0)));
  let best = -Infinity;
  for (const m of moves) {
    const v = -negamax(make(p, m), depth - 1, -beta, -alpha, ctx, ply + 1);
    if (ctx.stop) return best === -Infinity ? 0 : best;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** Iterative deepening within a time budget; weaker levels search less and add noise. */
export function chessBotMove(s: ChessState, seat: Seat, random: () => number = Math.random): CMoveC {
  const p = s.game.pos;
  const moves = legal(p);
  if (moves.length === 1) return { from: moves[0].from, to: moves[0].to, promo: moves[0].promo };
  const level = s.config.botLevel;
  const left = s.game.clock.left[seat];
  const budget = Math.min(level === 'strong' ? 1500 : level === 'medium' ? 500 : 120, Math.max(50, left / 40));
  const maxDepth = level === 'strong' ? 6 : level === 'medium' ? 3 : 1;
  const ctx: Ctx = { deadline: Date.now() + budget, nodes: 0, stop: false };
  let scored = moves.map((m) => ({ m, v: 0 }));
  for (let d = 1; d <= maxDepth; d++) {
    const round: { m: Full; v: number }[] = [];
    let alpha = -Infinity;
    for (const { m } of scored) {
      const v = -negamax(make(p, m), d - 1, -Infinity, -alpha + 1, ctx, 1);
      if (ctx.stop) break;
      round.push({ m, v });
      if (v > alpha) alpha = v;
    }
    if (ctx.stop && round.length < scored.length) {
      // keep the completed part of the deeper search when it already found a better move
      if (round.length) {
        const bestNew = round.reduce((a, b) => (b.v > a.v ? b : a));
        if (bestNew.v >= scored[0].v) scored = [bestNew, ...scored.filter((x) => x.m !== bestNew.m)];
      }
      break;
    }
    scored = round.sort((a, b) => b.v - a.v);
  }
  if (level !== 'strong') {
    const noise = level === 'easy' ? 160 : 35;
    scored = scored.map((x) => ({ ...x, v: x.v + (random() - 0.5) * noise })).sort((a, b) => b.v - a.v);
    if (level === 'easy' && random() < 0.15) {
      const pick = scored[Math.floor(random() * Math.min(5, scored.length))].m;
      return { from: pick.from, to: pick.to, promo: pick.promo };
    }
  }
  const m = scored[0].m;
  return { from: m.from, to: m.to, ...(m.promo ? { promo: m.promo } : {}) };
}

export function chessBotAction(s: ChessState, seat: Seat): ChessAction {
  if (s.drawOffer !== null && s.drawOffer !== seat) {
    const p = s.game.pos;
    const v = p.turn === seat ? evaluate(p) : -evaluate(p);
    return v < -250 ? { type: 'accept_draw' } : { type: 'decline_draw' };
  }
  return { type: 'move', move: chessBotMove(s, seat) };
}

// ---------------------------------------------------------------- view

export interface ChessView {
  game: 'chess';
  config: ChessRules;
  seat: Seat | null;
  status: 'playing' | 'finished';
  version: number;
  turn: Seat | null;
  board: number[];
  legal: CMoveC[];
  lastMove: CMoveC | null;
  /** The king in check, if any. */
  check: number | null;
  sans: string[];
  clock: { left: [number, number]; since: number; inc: number };
  scores: [number, number];
  winnerTeam: Seat | null;
  finishReason: string | null;
  drawOffer: Seat | null;
  handNumber: number;
  history: never[];
}

export function chessView(s: ChessState, seat: Seat | null): ChessView {
  const g = s.game;
  const turn = chessTurn(s);
  const check = s.status === 'playing' && inCheck(g.pos) ? kingSq(g.pos.board, g.pos.turn) : null;
  return {
    game: 'chess', config: s.config, seat, status: s.status, version: s.version, turn, board: g.pos.board,
    legal: turn === null ? [] : legal(g.pos).map((m) => ({ from: m.from, to: m.to, ...(m.promo ? { promo: m.promo } : {}) })),
    lastMove: g.lastMove, check, sans: g.sans, clock: g.clock, scores: s.scores, winnerTeam: s.winnerTeam, finishReason: s.finishReason,
    drawOffer: s.drawOffer, handNumber: 1, history: [],
  };
}
