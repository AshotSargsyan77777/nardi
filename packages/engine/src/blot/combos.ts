import { Card, Rank, SEQUENCE_ORDER, Suit, rankOf, suitOf } from './cards';

export type ComboKind = 'terz' | 'fifty' | 'hundred' | 'four';

export interface Combo {
  kind: ComboKind;
  cards: Card[];
  /** Raw points (20 / 50 / 100 / 100-200). */
  points: number;
  /** Index of the highest card in SEQUENCE_ORDER (for tie-breaks). */
  top: number;
  suit: Suit | null;
}

/** Four of a kind («չորս թուղթ»): value with a trump suit and in a no-trump (բոյ) hand; 0 = does not count. */
const FOUR_POINTS: Partial<Record<Rank, number>> = { J: 200, '9': 140, A: 110, '10': 100, K: 100, Q: 100 };
const FOUR_POINTS_NT: Partial<Record<Rank, number>> = { J: 100, '9': 0, A: 190, '10': 100, K: 100, Q: 100 };
/** Which four of a kind is stronger, strongest first. */
const FOUR_ORDER: Rank[] = ['J', '9', 'A', '10', 'K', 'Q'];
const FOUR_ORDER_NT: Rank[] = ['A', '10', 'K', 'Q', 'J'];

/**
 * Detect declarable combinations in a hand. A card is used in at most one combination:
 * four-of-a-kind is taken first, then runs are built from the remaining cards.
 * The blot (K+Q of trump) is not a declaration and is handled separately.
 */
export function detectCombos(hand: Card[], noTrump = false): Combo[] {
  const combos: Combo[] = [];
  const used = new Set<Card>();

  for (const rank of Object.keys(FOUR_POINTS) as Rank[]) {
    const same = hand.filter((c) => rankOf(c) === rank);
    const points = (noTrump ? FOUR_POINTS_NT : FOUR_POINTS)[rank]!;
    if (same.length === 4 && points > 0) {
      combos.push({ kind: 'four', cards: same, points, top: SEQUENCE_ORDER.indexOf(rank), suit: null });
      same.forEach((c) => used.add(c));
    }
  }

  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  for (const suit of suits) {
    const idx = hand
      .filter((c) => suitOf(c) === suit && !used.has(c))
      .map((c) => SEQUENCE_ORDER.indexOf(rankOf(c)))
      .sort((a, b) => a - b);
    let start = 0;
    for (let i = 1; i <= idx.length; i++) {
      if (i === idx.length || idx[i] !== idx[i - 1] + 1) {
        const len = i - start;
        if (len >= 3) {
          const run = idx.slice(start, i).map((n) => `${SEQUENCE_ORDER[n]}${suit}` as Card);
          const kind: ComboKind = len === 3 ? 'terz' : len === 4 ? 'fifty' : 'hundred';
          combos.push({ kind, cards: run, points: kind === 'terz' ? 20 : kind === 'fifty' ? 50 : 100, top: idx[i - 1], suit });
        }
        start = i;
      }
    }
  }
  return combos;
}

/**
 * Compare two combinations. Positive => a is stronger.
 * Order: points, then four-of-a-kind over a sequence, then longer sequence,
 * then higher top card, then trump suit. 0 means an exact tie.
 */
export function compareCombos(a: Combo, b: Combo, trump: Suit | null): number {
  if (a.points !== b.points) return a.points - b.points;
  const aFour = a.kind === 'four' ? 1 : 0;
  const bFour = b.kind === 'four' ? 1 : 0;
  if (aFour !== bFour) return aFour - bFour;
  if (aFour && bFour) {
    // two fours: J > 9 > A > 10 > K > Q with a trump suit, A > 10 > K > Q > J in a no-trump hand
    const order = trump === null ? FOUR_ORDER_NT : FOUR_ORDER;
    return order.indexOf(rankOf(b.cards[0])) - order.indexOf(rankOf(a.cards[0]));
  }
  if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
  if (a.top !== b.top) return a.top - b.top;
  const aT = a.suit !== null && a.suit === trump ? 1 : 0;
  const bT = b.suit !== null && b.suit === trump ? 1 : 0;
  return aT - bT;
}

export function bestCombo(combos: Combo[], trump: Suit | null): Combo | null {
  let best: Combo | null = null;
  for (const c of combos) if (!best || compareCombos(c, best, trump) > 0) best = c;
  return best;
}
