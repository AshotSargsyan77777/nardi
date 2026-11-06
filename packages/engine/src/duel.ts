/**
 * Shared shape of one-game «duel» matches (checkers, chess): two players, one game, a win, a loss or
 * a draw. Resigning, offering and accepting a draw work the same way in both.
 */
import type { Seat, Team } from './board';

export type DuelFinish = 'checkmate' | 'no_moves' | 'resign' | 'draw' | 'stalemate' | 'repetition' | 'fifty_moves' | 'material' | 'agreed' | 'timeout' | 'forfeit';

export interface DuelBase<C, G> {
  config: C;
  status: 'playing' | 'finished';
  /** 1 for the winner; a draw leaves both at 0. */
  scores: [number, number];
  /** Kept for the match pipeline (always 1: one game per match). */
  handNumber: number;
  history: never[];
  winnerTeam: Team | null;
  finishReason: DuelFinish | null;
  version: number;
  /** Who offered a draw that the other player has not answered yet. */
  drawOffer: Seat | null;
  game: G;
}

export type DuelAction<M> =
  | { type: 'move'; move: M; at?: number }
  | { type: 'resign'; at?: number }
  | { type: 'offer_draw'; at?: number }
  | { type: 'accept_draw'; at?: number }
  | { type: 'decline_draw'; at?: number }
  /** Server only: the player on move ran out of time. */
  | { type: 'flag'; at?: number };

export type DuelEvent<M> =
  | { type: 'moved'; seat: Seat; move: M; capture?: boolean; check?: boolean; san?: string }
  | { type: 'draw_offered'; seat: Seat }
  | { type: 'draw_declined'; seat: Seat }
  | { type: 'game_over'; winner: Seat | null; reason: DuelFinish }
  | { type: 'match_finished'; winnerTeam: Team | null; reason: DuelFinish };

export class DuelError extends Error {
  constructor(public code: string, public detail?: string) {
    super(detail ?? code);
  }
}

export const other = (s: Seat) => (1 - s) as Seat;

/** Ends the match: `winner` null for a draw. */
export function finish<S extends DuelBase<any, any>>(s: S, winner: Seat | null, reason: DuelFinish, events: DuelEvent<any>[]) {
  s.status = 'finished';
  s.winnerTeam = winner;
  s.finishReason = reason;
  s.drawOffer = null;
  if (winner !== null) s.scores[winner] = 1;
  events.push({ type: 'game_over', winner, reason });
  events.push({ type: 'match_finished', winnerTeam: winner, reason });
}

/** Resign / draw offers: the parts of `applyAction` common to both games. Returns true when handled. */
export function handleTalk<S extends DuelBase<any, any>>(s: S, seat: Seat, a: DuelAction<any>, turn: Seat | null, events: DuelEvent<any>[]): boolean {
  switch (a.type) {
    case 'resign':
      finish(s, other(seat), 'resign', events);
      return true;
    case 'offer_draw':
      if (s.drawOffer !== null) throw new DuelError('DRAW_ALREADY_OFFERED');
      s.drawOffer = seat;
      events.push({ type: 'draw_offered', seat });
      return true;
    case 'accept_draw':
      if (s.drawOffer === null || s.drawOffer === seat) throw new DuelError('NO_DRAW_OFFER');
      finish(s, null, 'agreed', events);
      return true;
    case 'decline_draw':
      if (s.drawOffer === null || s.drawOffer === seat) throw new DuelError('NO_DRAW_OFFER');
      s.drawOffer = null;
      events.push({ type: 'draw_declined', seat });
      return true;
    default:
      void turn;
      return false;
  }
}
