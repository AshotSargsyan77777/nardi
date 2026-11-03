import { Board, Move, Seat, TurnCtx, applySteps, stepOptions } from './board';
import { GameResult, MatchState, movesRequired, pipCounts } from './game';
import { RuleConfig } from './rules';

/** Nardi has no hidden information: every seat (and every spectator) sees the same table. */
export interface PlayerView {
  seat: Seat | null;
  config: RuleConfig;
  status: MatchState['status'];
  version: number;
  scores: [number, number];
  handNumber: number;
  phase: 'roll' | 'move' | 'finished';
  turn: Seat | null;
  board: Board;
  dice: [number, number] | null;
  /** How many dice the player to move must play with this roll. */
  movesRequired: number;
  turns: [number, number];
  lastTurn: { seat: Seat; dice: [number, number]; moves: Move[] } | null;
  pips: [number, number];
  history: GameResult[];
  winnerTeam: MatchState['winnerTeam'];
  finishReason: MatchState['finishReason'];
}

export function playerView(state: MatchState, seat: Seat | null): PlayerView {
  const g = state.game!;
  return {
    seat,
    config: state.config,
    status: state.status,
    version: state.version,
    scores: state.scores,
    handNumber: state.handNumber,
    phase: state.status === 'finished' ? 'finished' : g.phase,
    turn: state.status === 'playing' ? g.turn : null,
    board: g.board,
    dice: g.dice,
    movesRequired: movesRequired(state),
    turns: g.turns,
    lastTurn: g.lastTurn,
    pips: pipCounts(state),
    history: state.history,
    winnerTeam: state.winnerTeam,
    finishReason: state.finishReason,
  };
}

/** Rules context of the player to move, rebuilt from a view (the board UI runs the same rules as the server). */
export function viewCtx(v: PlayerView): TurnCtx | null {
  if (v.phase !== 'move' || v.turn === null || !v.dice) return null;
  const d = v.dice;
  const firstDouble = v.turns[v.turn] === 0 && d[0] === d[1] && [3, 4, 6].includes(d[0]);
  return { variant: v.config.variant, seat: v.turn, headMoves: 0, headLimit: v.config.variant === 'long' ? (firstDouble ? 2 : 1) : 99 };
}

/** The steps the player may take next after `prefix` (empty when it is not their move). */
export function viewMoveOptions(v: PlayerView, prefix: Move[]): Move[] {
  const ctx = viewCtx(v);
  return ctx ? stepOptions(v.board, ctx, v.dice!, prefix) : [];
}

/** The board as it will look after the steps taken so far. */
export function viewBoardAfter(v: PlayerView, prefix: Move[]): Board {
  return v.turn === null ? v.board : applySteps(v.board, v.config.variant, v.turn, prefix);
}
