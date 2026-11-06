/**
 * One entry point for every game on the platform. The server keeps a match's state as an opaque
 * `AnyState` and goes through these functions; `config.game` says which game it is (old nardi matches
 * have no `game` field and are nardi).
 */
import { Seat, Team } from './board';
import {
  CheckersAction, CheckersRules, CheckersState, CheckersView, applyCheckers, checkersAutoAction, checkersBotAction, checkersTurn, checkersView,
  createCheckers, forfeitCheckers, normalizeCheckersRules,
} from './checkers';
import {
  ChessAction, ChessRules, ChessState, ChessView, applyChess, chessBotAction, chessDeadline, chessTurn, chessView, createChess, forfeitChess, normalizeChessRules,
} from './chess';
import { DuelEvent } from './duel';
import { Action, GameEvent, MatchState, applyAction, createMatch, forfeit, whoseTurn } from './game';
import { autoAction, botAction } from './bot';
import { RuleConfig, normalizeRules } from './rules';
import { PlayerView, playerView } from './view';

export type GameId = 'nardi' | 'checkers' | 'chess';
export const GAME_IDS: GameId[] = ['nardi', 'checkers', 'chess'];

export type NardiRules = RuleConfig & { game?: 'nardi' };
export type AnyRules = NardiRules | CheckersRules | ChessRules;
export type AnyState = MatchState | CheckersState | ChessState;
export type AnyView = (PlayerView & { game?: 'nardi' }) | CheckersView | ChessView;
export type AnyAction = Action | CheckersAction | ChessAction;
export type AnyEvent = GameEvent | DuelEvent<any>;

/** The game of a state, view or rules object. */
export const gameOf = (x: any): GameId => {
  const g = x?.config ? x.config.game : x?.game;
  return g === 'chess' || g === 'checkers' ? g : 'nardi';
};

/** Validates rules for any game (`game` missing = nardi). */
export function normalizeAnyRules(input: Partial<AnyRules> & { game?: string } | null | undefined): AnyRules {
  const g = gameOf(input ?? {});
  if (g === 'checkers') return normalizeCheckersRules(input as Partial<CheckersRules>);
  if (g === 'chess') return normalizeChessRules(input as Partial<ChessRules>);
  return normalizeRules(input as Partial<RuleConfig>);
}

export function createAny(rules: AnyRules, firstTurn: Seat, now = Date.now()): AnyState {
  const g = gameOf(rules as any);
  if (g === 'checkers') return createCheckers(rules as CheckersRules, firstTurn);
  if (g === 'chess') return createChess(rules as ChessRules, now);
  return createMatch(rules as RuleConfig, firstTurn);
}

export function applyAny(s: AnyState, seat: Seat, a: AnyAction): { state: AnyState; events: AnyEvent[] } {
  const g = gameOf(s);
  if (g === 'checkers') return applyCheckers(s as CheckersState, seat, a as CheckersAction);
  if (g === 'chess') return applyChess(s as ChessState, seat, a as ChessAction);
  return applyAction(s as MatchState, seat, a as Action);
}

export function turnOf(s: AnyState): Seat | null {
  const g = gameOf(s);
  if (g === 'checkers') return checkersTurn(s as CheckersState);
  if (g === 'chess') return chessTurn(s as ChessState);
  return whoseTurn(s as MatchState);
}

/** Who has to answer right now: the player on move, or the one offered a draw. */
export function actorOf(s: AnyState): Seat | null {
  const offer = (s as CheckersState).drawOffer;
  if (s.status === 'playing' && offer !== undefined && offer !== null) return (1 - offer) as Seat;
  return turnOf(s);
}

export function botAny(s: AnyState, seat: Seat): AnyAction {
  const g = gameOf(s);
  if (g === 'checkers') return checkersBotAction(s as CheckersState, seat);
  if (g === 'chess') return chessBotAction(s as ChessState, seat);
  return botAction(s as MatchState, seat);
}

/** What the server plays when a player's turn timer runs out (not used for chess: the clock decides). */
export function autoAny(s: AnyState, seat: Seat): AnyAction {
  const g = gameOf(s);
  if (g === 'checkers') {
    const cs = s as CheckersState;
    if (cs.drawOffer !== null && cs.drawOffer !== seat) return { type: 'decline_draw' };
    return checkersAutoAction(cs, seat);
  }
  if (g === 'chess') return { type: 'flag', at: Date.now() };
  return autoAction(s as MatchState, seat);
}

export function forfeitAny(s: AnyState, losing: Team): { state: AnyState; events: AnyEvent[] } {
  const g = gameOf(s);
  if (g === 'checkers') return forfeitCheckers(s as CheckersState, losing as Seat);
  if (g === 'chess') return forfeitChess(s as ChessState, losing as Seat);
  return forfeit(s as MatchState, losing);
}

export function viewAny(s: AnyState, seat: Seat | null): AnyView {
  const g = gameOf(s);
  if (g === 'checkers') return checkersView(s as CheckersState, seat);
  if (g === 'chess') return chessView(s as ChessState, seat);
  return { ...playerView(s as MatchState, seat), game: 'nardi' };
}

/** Chess: when the side on move runs out of time. Other games use per-turn timers. */
export function clockDeadline(s: AnyState): number | null {
  return gameOf(s) === 'chess' ? chessDeadline(s as ChessState) : null;
}

export const usesDice = (g: GameId) => g === 'nardi';
export const hasDraws = (g: GameId) => g !== 'nardi';

/** What players pick in menus: short or long nardi, checkers or chess. */
export type GameKind = 'short' | 'long' | 'checkers' | 'chess';
export const GAME_KINDS: GameKind[] = ['short', 'long', 'checkers', 'chess'];
export function kindOf(rules: any): GameKind {
  const g = gameOf(rules ?? {});
  if (g !== 'nardi') return g;
  return rules?.variant === 'long' ? 'long' : 'short';
}
/** Rules for a kind on top of the platform defaults (chess: the given clock or 5+0). */
export function rulesForKind(kind: GameKind, base: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (kind === 'checkers') return { ...base, game: 'checkers', ...extra };
  if (kind === 'chess') return { ...base, game: 'chess', clockMin: 5, clockInc: 0, ...extra };
  return { ...base, game: 'nardi', variant: kind, ...extra };
}
