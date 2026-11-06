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
import * as B from './blot';

export type GameId = 'nardi' | 'checkers' | 'chess' | 'blot';
export const GAME_IDS: GameId[] = ['nardi', 'checkers', 'chess', 'blot'];
export type BlotRules = B.RuleConfig & { game: 'blot' };

export type NardiRules = RuleConfig & { game?: 'nardi' };
export type AnyRules = NardiRules | CheckersRules | ChessRules | BlotRules;
export type AnyState = MatchState | CheckersState | ChessState | B.MatchState;
export type AnyView = (PlayerView & { game?: 'nardi' }) | CheckersView | ChessView | (B.PlayerView & { game: 'blot' });
export type AnyAction = Action | CheckersAction | ChessAction | B.Action;
export type AnyEvent = GameEvent | DuelEvent<any> | B.GameEvent;

/** The game of a state, view or rules object. */
export const gameOf = (x: any): GameId => {
  const g = x?.config ? x.config.game : x?.game;
  return g === 'chess' || g === 'checkers' || g === 'blot' ? g : 'nardi';
};

/** Validates rules for any game (`game` missing = nardi). */
export function normalizeAnyRules(input: Partial<AnyRules> & { game?: string } | null | undefined): AnyRules {
  const g = gameOf(input ?? {});
  if (g === 'checkers') return normalizeCheckersRules(input as Partial<CheckersRules>);
  if (g === 'chess') return normalizeChessRules(input as Partial<ChessRules>);
  if (g === 'blot') return { ...B.normalizeRules(input as Partial<B.RuleConfig>), game: 'blot' };
  return normalizeRules(input as Partial<RuleConfig>);
}

export function createAny(rules: AnyRules, firstTurn: Seat, now = Date.now()): AnyState {
  const g = gameOf(rules as any);
  if (g === 'checkers') return createCheckers(rules as CheckersRules, firstTurn);
  if (g === 'chess') return createChess(rules as ChessRules, now);
  if (g === 'blot') {
    // the server deals right after (it shuffles and commits the deck)
    const s = B.createMatch(rules as B.RuleConfig, firstTurn as B.Seat);
    s.config = { ...s.config, game: 'blot' } as B.RuleConfig;
    return s;
  }
  return createMatch(rules as RuleConfig, firstTurn);
}

export function applyAny(s: AnyState, seat: Seat, a: AnyAction): { state: AnyState; events: AnyEvent[] } {
  const g = gameOf(s);
  if (g === 'checkers') return applyCheckers(s as CheckersState, seat, a as CheckersAction);
  if (g === 'chess') return applyChess(s as ChessState, seat, a as ChessAction);
  if (g === 'blot') return B.applyAction(s as B.MatchState, seat as B.Seat, a as B.Action);
  return applyAction(s as MatchState, seat, a as Action);
}

export function turnOf(s: AnyState): Seat | null {
  const g = gameOf(s);
  if (g === 'checkers') return checkersTurn(s as CheckersState);
  if (g === 'chess') return chessTurn(s as ChessState);
  if (g === 'blot') return B.whoseTurn(s as B.MatchState) as Seat | null;
  return whoseTurn(s as MatchState);
}

/** Who has to answer right now: the player on move, or the one offered a draw. */
export function actorOf(s: AnyState): Seat | null {
  if (gameOf(s) === 'blot') return turnOf(s);
  const offer = (s as CheckersState).drawOffer;
  if (s.status === 'playing' && offer !== undefined && offer !== null) return (1 - offer) as Seat;
  return turnOf(s);
}

export function botAny(s: AnyState, seat: Seat): AnyAction {
  const g = gameOf(s);
  if (g === 'checkers') return checkersBotAction(s as CheckersState, seat);
  if (g === 'chess') return chessBotAction(s as ChessState, seat);
  if (g === 'blot') return B.botAction(s as B.MatchState, seat as B.Seat);
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
  if (g === 'blot') return B.autoAction(s as B.MatchState, seat as B.Seat);
  return autoAction(s as MatchState, seat);
}

export function forfeitAny(s: AnyState, losing: Team): { state: AnyState; events: AnyEvent[] } {
  const g = gameOf(s);
  if (g === 'checkers') return forfeitCheckers(s as CheckersState, losing as Seat);
  if (g === 'chess') return forfeitChess(s as ChessState, losing as Seat);
  if (g === 'blot') return B.forfeit(s as B.MatchState, losing as B.Team);
  return forfeit(s as MatchState, losing);
}

export function viewAny(s: AnyState, seat: Seat | null): AnyView {
  const g = gameOf(s);
  if (g === 'checkers') return checkersView(s as CheckersState, seat);
  if (g === 'chess') return chessView(s as ChessState, seat);
  if (g === 'blot') return { ...B.playerView(s as B.MatchState, seat as B.Seat | null), game: 'blot' };
  return { ...playerView(s as MatchState, seat), game: 'nardi' };
}

/** Chess: when the side on move runs out of time. Other games use per-turn timers. */
export function clockDeadline(s: AnyState): number | null {
  return gameOf(s) === 'chess' ? chessDeadline(s as ChessState) : null;
}

export const usesDice = (g: GameId) => g === 'nardi';
/** Blot is played by four (two teams of two); the others by two. */
export const seatCount = (g: GameId) => (g === 'blot' ? 4 : 2);
/** A seat's team: blot partners sit opposite (0+2, 1+3); elsewhere every seat is its own side. */
export const teamOfSeat = (g: GameId, seat: number) => (g === 'blot' ? seat % 2 : seat);
export const hasDraws = (g: GameId) => g !== 'nardi';

/** What players pick in menus: short or long nardi, checkers or chess. */
export type GameKind = 'short' | 'long' | 'checkers' | 'chess' | 'blot';
export const GAME_KINDS: GameKind[] = ['blot', 'short', 'long', 'checkers', 'chess'];
/** Kinds with one-against-one tournaments (blot is a team game). */
export const TOURNEY_KINDS: GameKind[] = ['short', 'long', 'checkers', 'chess'];
export function kindOf(rules: any): GameKind {
  const g = gameOf(rules ?? {});
  if (g !== 'nardi') return g;
  return rules?.variant === 'long' ? 'long' : 'short';
}
/** Rules for a kind on top of the platform defaults (chess: the given clock or 5+0). */
export function rulesForKind(kind: GameKind, base: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (kind === 'checkers') return { ...base, game: 'checkers', ...extra };
  if (kind === 'chess') return { ...base, game: 'chess', clockMin: 5, clockInc: 0, ...extra };
  if (kind === 'blot') return { game: 'blot', ...extra };
  return { ...base, game: 'nardi', variant: kind, ...extra };
}
