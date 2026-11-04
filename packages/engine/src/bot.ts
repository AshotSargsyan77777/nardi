import { Board, Move, Seat, Sequence, absIndex, legalSequences, opp, otherSeat, own, pips, relOf } from './board';
import { Action, MatchState, turnCtx } from './game';
import { Variant } from './rules';
import { PlayerView, viewCtx } from './view';

/** How good a position is for `seat` (bigger is better). */
export function evaluate(b: Board, variant: Variant, seat: Seat): number {
  const o = otherSeat(seat);
  let score = (pips(b, variant, o) - pips(b, variant, seat)) * 1.0 + (b.off[seat] - b.off[o]) * 6;
  if (variant === 'short') {
    score += b.bar[o] * 14 - b.bar[seat] * 14;
    // opponent checkers that could hit a lonely checker (rough: within 12 points behind it)
    const oppRel: number[] = [];
    for (let abs = 0; abs < 24; abs++) if (own(b, o, abs) > 0) oppRel.push(relOf(variant, o, abs));
    if (b.bar[o] > 0) oppRel.push(25);
    for (let abs = 0; abs < 24; abs++) {
      const n = own(b, seat, abs);
      if (n === 0) continue;
      const myRel = relOf(variant, seat, abs);
      if (n === 1) {
        // the same point seen from the opponent's side
        const theirRel = 25 - myRel;
        const shooters = oppRel.filter((r) => r > theirRel && r - theirRel <= 12).length;
        if (shooters) score -= 4 + Math.min(shooters, 4) * 1.5 + (25 - myRel) * 0.15;
      } else {
        score += myRel <= 6 ? 3.5 : myRel <= 9 ? 2 : 1;
        if (n > 4) score -= (n - 4) * 0.8;
      }
    }
  } else {
    // long nardi: leave the head, hold points (blocks), keep checkers spread
    let run = 0;
    for (let rel = 24; rel >= 1; rel--) {
      const abs = absIndex(variant, seat, rel);
      const n = own(b, seat, abs);
      if (rel === 24) score -= n * 1.2;
      if (n > 0) {
        score += 1.2;
        run += 1;
        if (run >= 2) score += run * 0.8;
        if (n > 4) score -= (n - 4) * 0.6;
      } else run = 0;
      // points in the opponent's way are worth more
      if (n > 0 && opp(b, seat, abs) === 0) score += rel >= 13 && rel <= 18 ? 0.6 : 0;
    }
  }
  return score;
}

/** A bot's turn: roll, or pick a way to play the dice. */
export function botAction(state: MatchState, seat: Seat, random: () => number = Math.random): Action {
  const g = state.game!;
  if (g.phase === 'roll') return { type: 'roll' };
  const seqs = legalSequences(g.board, turnCtx(state), g.dice!);
  return { type: 'move', moves: pick(seqs, state.config.variant, seat, state.config.botLevel, random).moves };
}

function pick(seqs: Sequence[], variant: Variant, seat: Seat, level: string, random: () => number): Sequence {
  if (seqs.length === 1) return seqs[0];
  const scored = seqs.map((s) => ({ s, v: evaluate(s.board, variant, seat) + (level === 'strong' ? 0 : (random() - 0.5) * (level === 'easy' ? 14 : 4)) }));
  scored.sort((a, b) => b.v - a.v);
  if (level === 'easy' && random() < 0.35) return scored[Math.floor(random() * Math.min(scored.length, 4))].s;
  return scored[0].s;
}

/** What the server does when a player runs out of time: roll for them, or play a simple move. */
export function autoAction(state: MatchState, seat: Seat): Action {
  const g = state.game!;
  if (g.phase === 'roll') return { type: 'roll' };
  const seqs = legalSequences(g.board, turnCtx(state), g.dice!);
  return { type: 'move', moves: pick(seqs, state.config.variant, seat, 'medium', () => 0.5).moves };
}

/** The strongest bot's choice for the player to move in this view (practice hints). */
export function viewHint(v: PlayerView): Move[] {
  const ctx = viewCtx(v);
  if (!ctx) return [];
  const seqs = legalSequences(v.board, ctx, v.dice!);
  if (!seqs.length) return [];
  return pick(seqs, v.config.variant, ctx.seat, 'strong', Math.random).moves;
}
