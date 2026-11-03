import { Board, Move, Seat, Team, TurnCtx, absIndex, CHECKERS, legalSequences, otherSeat, pips, playTurn, startBoard, stepOptions } from './board';
import { RuleConfig, normalizeRules } from './rules';

/** One game (a match is played to several points). */
export interface GameState {
  number: number;
  board: Board;
  turn: Seat;
  /** 'roll': the player has to roll; 'move': dice are on the table. */
  phase: 'roll' | 'move';
  dice: [number, number] | null;
  /** Turns each player has taken in this game (the long-nardi head rule needs the first one). */
  turns: [number, number];
  /** What the previous turn did, so the table can show it. */
  lastTurn: { seat: Seat; dice: [number, number]; moves: Move[] } | null;
}

export interface GameResult {
  game: number;
  winner: Seat;
  points: number;
  mars: boolean;
  /** Pip counts left when the game ended. */
  pipsLeft: [number, number];
  scoresAfter: [number, number];
}

export interface MatchState {
  config: RuleConfig;
  status: 'playing' | 'finished';
  scores: [number, number];
  /** Number of the current game, from 1. */
  handNumber: number;
  game: GameState | null;
  history: GameResult[];
  winnerTeam: Team | null;
  finishReason: 'score' | 'forfeit' | null;
  /** Monotonic counter; clients send it back to prevent stale/duplicate actions. */
  version: number;
}

export type Action =
  /** The server fills in `dice`; whatever a client sends there is ignored. */
  | { type: 'roll'; dice?: [number, number] }
  | { type: 'move'; moves: Move[] };

export type GameEvent =
  | { type: 'game_started'; game: number; turn: Seat }
  | { type: 'rolled'; seat: Seat; dice: [number, number] }
  | { type: 'no_moves'; seat: Seat }
  | { type: 'moved'; seat: Seat; moves: Move[]; hits: number }
  | { type: 'game_won'; result: GameResult }
  | { type: 'match_finished'; winnerTeam: Team; reason: 'score' | 'forfeit' };

export class EngineError extends Error {
  constructor(public code: string, public detail?: string) {
    super(code);
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function newGame(number: number, variant: RuleConfig['variant'], turn: Seat): GameState {
  return { number, board: startBoard(variant), turn, phase: 'roll', dice: null, turns: [0, 0], lastTurn: null };
}

export function createMatch(config?: Partial<RuleConfig>, firstTurn: Seat = 0): MatchState {
  const cfg = normalizeRules(config);
  return {
    config: cfg, status: 'playing', scores: [0, 0], handNumber: 1, game: newGame(1, cfg.variant, firstTurn),
    history: [], winnerTeam: null, finishReason: null, version: 1,
  };
}

/** Rules context for the player to move. */
export function turnCtx(state: MatchState): TurnCtx {
  const g = state.game!;
  const d = g.dice;
  // long nardi: one checker leaves the head per turn; on the very first turn 6-6, 4-4 or 3-3 may take two
  const firstDouble = g.turns[g.turn] === 0 && !!d && d[0] === d[1] && [3, 4, 6].includes(d[0]);
  return { variant: state.config.variant, seat: g.turn, headMoves: 0, headLimit: state.config.variant === 'long' ? (firstDouble ? 2 : 1) : 99 };
}

/** The steps the player to move may take next, after `prefix` (for the board UI). */
export function nextMoveOptions(state: MatchState, prefix: Move[]): Move[] {
  const g = state.game;
  if (!g || g.phase !== 'move' || !g.dice) return [];
  return stepOptions(g.board, turnCtx(state), g.dice, prefix);
}

/** How many dice the current roll lets the player play (the turn must use exactly this many). */
export function movesRequired(state: MatchState): number {
  const g = state.game;
  if (!g || g.phase !== 'move' || !g.dice) return 0;
  return legalSequences(g.board, turnCtx(state), g.dice)[0].moves.length;
}

export function applyAction(prev: MatchState, seat: Seat, action: Action): { state: MatchState; events: GameEvent[] } {
  if (prev.status !== 'playing' || !prev.game) throw new EngineError('MATCH_NOT_PLAYING');
  if (prev.game.turn !== seat) throw new EngineError('NOT_YOUR_TURN');
  const state = clone(prev);
  const g = state.game!;
  const events: GameEvent[] = [];

  if (action.type === 'roll') {
    if (g.phase !== 'roll') throw new EngineError('ALREADY_ROLLED');
    const d = action.dice;
    if (!d || d.length !== 2 || !d.every((x) => Number.isInteger(x) && x >= 1 && x <= 6)) throw new EngineError('BAD_DICE');
    g.dice = [d[0], d[1]];
    g.phase = 'move';
    events.push({ type: 'rolled', seat, dice: g.dice });
    if (legalSequences(g.board, turnCtx(state), g.dice)[0].moves.length === 0) {
      events.push({ type: 'no_moves', seat });
      endTurn(g, seat, []);
    }
  } else if (action.type === 'move') {
    if (g.phase !== 'move' || !g.dice) throw new EngineError('ROLL_FIRST');
    if (!Array.isArray(action.moves)) throw new EngineError('BAD_MOVES');
    const after = playTurn(g.board, turnCtx(state), g.dice, action.moves);
    if (!after) throw new EngineError('ILLEGAL_MOVE');
    const hits = action.moves.filter((m) => m.to !== 'off' && prev.game!.board.points[m.to as number] !== 0 && Math.sign(prev.game!.board.points[m.to as number]) !== (seat === 0 ? 1 : -1)).length;
    const moves = action.moves.map((m) => ({ from: m.from, to: m.to, die: m.die }));
    g.board = after;
    events.push({ type: 'moved', seat, moves, hits });
    if (after.off[seat] === CHECKERS) {
      finishGame(state, seat, events);
    } else endTurn(g, seat, moves);
  } else throw new EngineError('BAD_ACTION');

  state.version += 1;
  return { state, events };
}

function endTurn(g: GameState, seat: Seat, moves: Move[]) {
  g.lastTurn = { seat, dice: g.dice!, moves };
  g.turns[seat] += 1;
  g.turn = otherSeat(seat);
  g.phase = 'roll';
  g.dice = null;
}

function finishGame(state: MatchState, winner: Seat, events: GameEvent[]) {
  const g = state.game!;
  const loser = otherSeat(winner);
  const mars = state.config.marsEnabled && g.board.off[loser] === 0;
  const points = mars ? 2 : 1;
  state.scores[winner] += points;
  const result: GameResult = {
    game: g.number, winner, points, mars,
    pipsLeft: [pips(g.board, state.config.variant, 0), pips(g.board, state.config.variant, 1)],
    scoresAfter: [state.scores[0], state.scores[1]],
  };
  state.history.push(result);
  events.push({ type: 'game_won', result });
  if (state.scores[winner] >= state.config.targetScore) {
    state.status = 'finished';
    state.winnerTeam = winner;
    state.finishReason = 'score';
    state.game = { ...g, lastTurn: g.lastTurn, phase: 'roll', dice: null };
    events.push({ type: 'match_finished', winnerTeam: winner, reason: 'score' });
    return;
  }
  // the winner of a game starts the next one
  state.handNumber += 1;
  state.game = newGame(state.handNumber, state.config.variant, winner);
  events.push({ type: 'game_started', game: state.handNumber, turn: winner });
}

/** A player left or timed out too often: the opponent wins the match. */
export function forfeit(prev: MatchState, losingTeam: Team): { state: MatchState; events: GameEvent[] } {
  if (prev.status !== 'playing') throw new EngineError('MATCH_NOT_PLAYING');
  const state = clone(prev);
  state.status = 'finished';
  state.winnerTeam = otherSeat(losingTeam);
  state.finishReason = 'forfeit';
  state.version += 1;
  return { state, events: [{ type: 'match_finished', winnerTeam: state.winnerTeam, reason: 'forfeit' }] };
}

export function whoseTurn(state: MatchState): Seat | null {
  return state.status === 'playing' && state.game ? state.game.turn : null;
}

/** Pip counts of both players. */
export function pipCounts(state: MatchState): [number, number] {
  const b = state.game?.board;
  return b ? [pips(b, state.config.variant, 0), pips(b, state.config.variant, 1)] : [0, 0];
}

export { absIndex };
