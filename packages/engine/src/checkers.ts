/**
 * Russian draughts (шашки) on 8×8.
 *
 * - White (seat 0) starts. Men move one square diagonally forward and capture forward and backward.
 * - Capturing is compulsory, but any capture may be chosen (not necessarily the longest one).
 * - A capture goes on as long as it can; captured pieces are removed only at the end, and a piece
 *   cannot be jumped twice («Turkish strike»).
 * - A man reaching the far row becomes a king — during a capture too, and goes on capturing as a king.
 * - Kings fly: any distance along a diagonal, and capture from a distance landing on any free square
 *   beyond, except that when some landing square lets the capture continue, one of those must be taken.
 * - A player who cannot move loses. Draws: by agreement, threefold repetition, or 15 moves each with
 *   only kings moving and nothing captured.
 *
 * Squares are numbered 0..63, row by row from the top (black's side): index = row × 8 + col.
 */
import type { Seat } from './board';
import { DuelAction, DuelBase, DuelError, DuelEvent, finish, handleTalk, other } from './duel';

export type BotLevel = 'easy' | 'medium' | 'strong';
export interface CheckersRules { game: 'checkers'; botLevel: BotLevel; turnTimeoutSec: number }
export const CHECKERS_DEFAULTS: CheckersRules = { game: 'checkers', botLevel: 'medium', turnTimeoutSec: 45 };

/** 0 empty; 1 white man, 2 white king; −1 black man, −2 black king. */
export type Cells = number[];
/** A move: the squares the piece stands on, from start to end (several for a multi-capture). */
export interface CMove { path: number[]; captures: number[] }

export interface CheckersGame {
  board: Cells;
  turn: Seat;
  /** Plies in a row with only kings moving and nothing captured. */
  quiet: number;
  /** Times each position (board + side to move) has occurred. */
  seen: Record<string, number>;
  lastMove: CMove | null;
  moves: number;
}
export type CheckersState = DuelBase<CheckersRules, CheckersGame>;
export type CheckersAction = DuelAction<number[]>;
export type CheckersEvent = DuelEvent<CMove>;

const DIRS = [-9, -7, 7, 9];
const rowOf = (i: number) => i >> 3;
const colOf = (i: number) => i & 7;
/** The square one diagonal step from `i` in direction `d`, or −1 off the board. */
function step(i: number, d: number) {
  const r = rowOf(i) + (d < 0 ? -1 : 1);
  const c = colOf(i) + (d === -9 || d === 7 ? -1 : 1);
  return r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c;
}
export const isDark = (i: number) => (rowOf(i) + colOf(i)) % 2 === 1;
const own = (v: number, seat: Seat) => (seat === 0 ? v > 0 : v < 0);
const forward = (seat: Seat) => (seat === 0 ? [-9, -7] : [7, 9]);
const lastRow = (seat: Seat) => (seat === 0 ? 0 : 7);

export function startBoard(): Cells {
  const b = Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    if (!isDark(i)) continue;
    if (rowOf(i) <= 2) b[i] = -1;
    else if (rowOf(i) >= 5) b[i] = 1;
  }
  return b;
}

/** Every capture sequence of the piece on `from` (empty if it cannot capture). */
function capturesFrom(b: Cells, from: number, seat: Seat): CMove[] {
  const out: CMove[] = [];
  const startPiece = b[from];
  const walk = (at: number, king: boolean, taken: number[], path: number[]) => {
    let extended = false;
    for (const d of DIRS) {
      if (!king) {
        const mid = step(at, d);
        const land = mid < 0 ? -1 : step(mid, d);
        if (land < 0) continue;
        if (b[mid] === 0 || own(b[mid], seat) || taken.includes(mid)) continue;
        if (b[land] !== 0 && land !== from) continue;
        extended = true;
        walk(land, rowOf(land) === lastRow(seat), [...taken, mid], [...path, land]);
      } else {
        // fly to the first piece on the diagonal
        let sq = step(at, d);
        while (sq >= 0 && (b[sq] === 0 || sq === from)) sq = step(sq, d);
        if (sq < 0 || own(b[sq], seat) || taken.includes(sq)) continue;
        const landings: number[] = [];
        let land = step(sq, d);
        while (land >= 0 && (b[land] === 0 || land === from)) {
          landings.push(land);
          land = step(land, d);
        }
        if (!landings.length) continue;
        extended = true;
        // where the capture can go on, it must
        const going = landings.filter((l) => canCaptureFrom(b, l, seat, true, [...taken, sq], from));
        for (const l of going.length ? going : landings) walk(l, true, [...taken, sq], [...path, l]);
      }
    }
    if (!extended && taken.length) out.push({ path, captures: taken });
  };
  walk(from, Math.abs(startPiece) === 2, [], [from]);
  return out;
}

function canCaptureFrom(b: Cells, at: number, seat: Seat, king: boolean, taken: number[], from: number): boolean {
  for (const d of DIRS) {
    if (!king) {
      const mid = step(at, d);
      const land = mid < 0 ? -1 : step(mid, d);
      if (land >= 0 && b[mid] !== 0 && !own(b[mid], seat) && !taken.includes(mid) && (b[land] === 0 || land === from)) return true;
    } else {
      let sq = step(at, d);
      while (sq >= 0 && (b[sq] === 0 || sq === from)) sq = step(sq, d);
      if (sq < 0 || own(b[sq], seat) || taken.includes(sq)) continue;
      const land = step(sq, d);
      if (land >= 0 && (b[land] === 0 || land === from)) return true;
    }
  }
  return false;
}

/** All legal moves for `seat`: captures if there are any, else plain moves. */
export function legalMoves(b: Cells, seat: Seat): CMove[] {
  const caps: CMove[] = [];
  for (let i = 0; i < 64; i++) if (own(b[i], seat)) caps.push(...capturesFrom(b, i, seat));
  if (caps.length) return dedupe(caps);
  const out: CMove[] = [];
  for (let i = 0; i < 64; i++) {
    if (!own(b[i], seat)) continue;
    if (Math.abs(b[i]) === 1) {
      for (const d of forward(seat)) {
        const t = step(i, d);
        if (t >= 0 && b[t] === 0) out.push({ path: [i, t], captures: [] });
      }
    } else {
      for (const d of DIRS) {
        let t = step(i, d);
        while (t >= 0 && b[t] === 0) {
          out.push({ path: [i, t], captures: [] });
          t = step(t, d);
        }
      }
    }
  }
  return out;
}

/** Different capture orders can land the same way; keep one of each path. */
function dedupe(ms: CMove[]) {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = m.path.join(',') + '|' + [...m.captures].sort((a, b) => a - b).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function applyMove(b: Cells, m: CMove, seat: Seat): Cells {
  const nb = [...b];
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  let piece = nb[from];
  nb[from] = 0;
  for (const c of m.captures) nb[c] = 0;
  // promotion: on reaching the far row at any point of the move
  if (Math.abs(piece) === 1 && m.path.some((sq) => rowOf(sq) === lastRow(seat))) piece = seat === 0 ? 2 : -2;
  nb[to] = piece;
  return nb;
}

const key = (b: Cells, turn: Seat) => b.map((v) => (v < 0 ? 'abcd'[v + 2] : v)).join('') + turn;

export function createCheckers(cfg: Partial<CheckersRules> = {}, firstTurn: Seat = 0): CheckersState {
  void firstTurn; // white always starts; seats are drawn by the server
  const board = startBoard();
  return {
    config: normalizeCheckersRules(cfg), status: 'playing', scores: [0, 0], handNumber: 1, history: [], winnerTeam: null, finishReason: null, version: 1, drawOffer: null,
    game: { board, turn: 0, quiet: 0, seen: { [key(board, 0)]: 1 }, lastMove: null, moves: 0 },
  };
}

export function normalizeCheckersRules(p: Partial<CheckersRules>): CheckersRules {
  const level = (['easy', 'medium', 'strong'] as const).includes(p.botLevel as BotLevel) ? (p.botLevel as BotLevel) : CHECKERS_DEFAULTS.botLevel;
  const t = Number(p.turnTimeoutSec);
  return { game: 'checkers', botLevel: level, turnTimeoutSec: [0, 30, 45, 60, 90].includes(t) ? t : CHECKERS_DEFAULTS.turnTimeoutSec };
}

export const checkersTurn = (s: CheckersState): Seat | null => (s.status === 'playing' ? s.game.turn : null);

export function applyCheckers(prev: CheckersState, seat: Seat, a: CheckersAction): { state: CheckersState; events: CheckersEvent[] } {
  if (prev.status !== 'playing') throw new DuelError('MATCH_OVER');
  const s: CheckersState = structuredClone(prev);
  const g = s.game;
  const events: CheckersEvent[] = [];
  if (handleTalk(s, seat, a, g.turn, events)) {
    s.version += 1;
    return { state: s, events };
  }
  if (a.type === 'flag') throw new DuelError('BAD_ACTION');
  if (a.type !== 'move') throw new DuelError('BAD_ACTION');
  if (g.turn !== seat) throw new DuelError('NOT_YOUR_TURN');
  const legal = legalMoves(g.board, seat);
  const m = legal.find((x) => x.path.length === a.move.length && x.path.every((v, i) => v === a.move[i]));
  if (!m) throw new DuelError('ILLEGAL_MOVE');
  const wasKing = Math.abs(g.board[m.path[0]]) === 2;
  g.board = applyMove(g.board, m, seat);
  g.lastMove = m;
  g.moves += 1;
  g.quiet = wasKing && !m.captures.length ? g.quiet + 1 : 0;
  g.turn = other(seat);
  // a move answers a pending draw offer with «no»
  if (s.drawOffer !== null && s.drawOffer !== seat) s.drawOffer = null;
  const crowned = !wasKing && Math.abs(g.board[m.path[m.path.length - 1]]) === 2;
  events.push({ type: 'moved', seat, move: m, capture: m.captures.length > 0, ...(crowned ? { crowned: true } : {}) });
  const k = key(g.board, g.turn);
  g.seen[k] = (g.seen[k] ?? 0) + 1;
  if (!legalMoves(g.board, g.turn).length) finish(s, seat, 'no_moves', events);
  else if (g.seen[k] >= 3) finish(s, null, 'repetition', events);
  else if (g.quiet >= 30) finish(s, null, 'fifty_moves', events);
  s.version += 1;
  return { state: s, events };
}

export function forfeitCheckers(prev: CheckersState, losing: Seat) {
  const s: CheckersState = structuredClone(prev);
  const events: CheckersEvent[] = [];
  finish(s, other(losing), 'forfeit', events);
  s.version += 1;
  return { state: s, events };
}

// ---------------------------------------------------------------- bot

/** Material and position from `seat`'s side. */
function evaluate(b: Cells, seat: Seat): number {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const mine = own(p, seat) ? 1 : -1;
    const owner: Seat = p > 0 ? 0 : 1;
    if (Math.abs(p) === 2) v += mine * 300;
    else {
      const adv = owner === 0 ? 7 - rowOf(i) : rowOf(i);
      v += mine * (100 + adv * 4 + (colOf(i) >= 2 && colOf(i) <= 5 ? 4 : 0) + (adv === 0 ? 6 : 0));
    }
  }
  return v;
}

function search(b: Cells, seat: Seat, depth: number, alpha: number, beta: number, deadline: number): number {
  const moves = legalMoves(b, seat);
  if (!moves.length) return -100000 - depth;
  if (depth <= 0 && !moves[0].captures.length) return evaluate(b, seat);
  if (depth <= -6 || Date.now() > deadline) return evaluate(b, seat);
  moves.sort((x, y) => y.captures.length - x.captures.length);
  let best = -Infinity;
  for (const m of moves) {
    const v = -search(applyMove(b, m, seat), other(seat), depth - 1, -beta, -alpha, deadline);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** The bot's move: deeper search for stronger bots, some randomness for weaker ones. */
export function checkersBotMove(s: CheckersState, seat: Seat, random: () => number = Math.random): number[] {
  const g = s.game;
  const moves = legalMoves(g.board, seat);
  if (moves.length === 1) return moves[0].path;
  const level = s.config.botLevel;
  const depth = level === 'strong' ? 7 : level === 'medium' ? 4 : 2;
  const deadline = Date.now() + (level === 'strong' ? 1200 : 400);
  const scored = moves.map((m) => ({ m, v: -search(applyMove(g.board, m, seat), other(seat), depth - 1, -Infinity, Infinity, deadline) + (level === 'strong' ? 0 : (random() - 0.5) * (level === 'easy' ? 120 : 30)) }));
  scored.sort((x, y) => y.v - x.v);
  if (level === 'easy' && random() < 0.25) return scored[Math.floor(random() * Math.min(3, scored.length))].m.path;
  return scored[0].m.path;
}

export function checkersBotAction(s: CheckersState, seat: Seat): CheckersAction {
  // a draw offer to a bot: it accepts when it is clearly behind, else declines
  if (s.drawOffer !== null && s.drawOffer !== seat) return evaluate(s.game.board, seat) < -150 ? { type: 'accept_draw' } : { type: 'decline_draw' };
  return { type: 'move', move: checkersBotMove(s, seat) };
}

/** Time ran out on a move: the server plays the first capture / a random move. */
export function checkersAutoAction(s: CheckersState, seat: Seat): CheckersAction {
  const moves = legalMoves(s.game.board, seat);
  return { type: 'move', move: moves[Math.floor(Math.random() * moves.length)].path };
}

// ---------------------------------------------------------------- view

export interface CheckersView {
  game: 'checkers';
  config: CheckersRules;
  seat: Seat | null;
  status: 'playing' | 'finished';
  version: number;
  turn: Seat | null;
  board: Cells;
  /** The legal moves of the player on move (everyone sees them; nothing is hidden in checkers). */
  legal: CMove[];
  lastMove: CMove | null;
  moves: number;
  scores: [number, number];
  winnerTeam: Seat | null;
  finishReason: string | null;
  drawOffer: Seat | null;
  /** Pieces left: [white, black]. */
  pieces: [number, number];
  handNumber: number;
  history: never[];
}

export function checkersView(s: CheckersState, seat: Seat | null): CheckersView {
  const g = s.game;
  const turn = checkersTurn(s);
  return {
    game: 'checkers', config: s.config, seat, status: s.status, version: s.version, turn, board: g.board,
    legal: turn === null ? [] : legalMoves(g.board, turn), lastMove: g.lastMove, moves: g.moves, scores: s.scores, winnerTeam: s.winnerTeam,
    finishReason: s.finishReason, drawOffer: s.drawOffer, pieces: [g.board.filter((v) => v > 0).length, g.board.filter((v) => v < 0).length], handNumber: 1, history: [],
  };
}
