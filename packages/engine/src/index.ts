export * from './board';
export * from './rules';
export * from './game';
export * from './view';
export * from './bot';
export * from './protocol';
export * from './duel';
export * from './games';
export {
  CHECKERS_DEFAULTS, applyCheckers, applyMove as applyCheckersMove, checkersView, createCheckers, isDark, legalMoves as checkersMoves, normalizeCheckersRules,
  startBoard as checkersStartBoard,
} from './checkers';
export type { CMove, Cells, CheckersAction, CheckersEvent, CheckersGame, CheckersRules, CheckersState, CheckersView } from './checkers';
export {
  CHESS_CLOCKS, CHESS_DEFAULTS, applyChess, chessView, createChess, inCheck, legal as chessLegal, make as chessMake, normalizeChessRules, san as chessSan, sqIndex, sqName,
  startPosition as chessStartPosition,
} from './chess';
export type { CMoveC, ChessAction, ChessEvent, ChessGame, ChessRules, ChessState, ChessView, Position } from './chess';
