export const SUITS = ['S', 'H', 'D', 'C'] as const;
export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** Card code, e.g. "JH" (jack of hearts) or "10S" (ten of spades). */
export type Card = `${Rank}${Suit}`;

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export const rankOf = (c: Card): Rank => c.slice(0, -1) as Rank;
export const suitOf = (c: Card): Suit => c.slice(-1) as Suit;
export const teamOf = (seat: Seat): Team => (seat % 2) as Team;
export const nextSeat = (seat: Seat, step = 1): Seat => (((seat + step) % 4) + 4) % 4 as Seat;
export const partnerOf = (seat: Seat): Seat => nextSeat(seat, 2);

export function isCard(value: unknown): value is Card {
  if (typeof value !== 'string') return false;
  const r = value.slice(0, -1);
  const s = value.slice(-1);
  return (RANKS as readonly string[]).includes(r) && (SUITS as readonly string[]).includes(s);
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}` as Card);
  return deck;
}

/** Strength order, weakest first. */
const TRUMP_ORDER: Rank[] = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const PLAIN_ORDER: Rank[] = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
/** Natural order used for sequences (terz / 50 / 100). */
export const SEQUENCE_ORDER: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const TRUMP_POINTS: Record<Rank, number> = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };
const PLAIN_POINTS: Record<Rank, number> = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
/** No trump (անղոզ): the ace is worth 19, so the deck still holds 152 (+10 = 162). */
const NO_TRUMP_POINTS: Record<Rank, number> = { ...PLAIN_POINTS, A: 19 };

/** Card value; `trump === null` means a no-trump hand. */
export function cardPoints(card: Card, trump: Suit | null): number {
  const r = rankOf(card);
  if (trump === null) return NO_TRUMP_POINTS[r];
  return suitOf(card) === trump ? TRUMP_POINTS[r] : PLAIN_POINTS[r];
}

export function cardStrength(card: Card, trump: Suit | null): number {
  const r = rankOf(card);
  return suitOf(card) === trump ? TRUMP_ORDER.indexOf(r) : PLAIN_ORDER.indexOf(r);
}

/** Returns true when card `a` beats card `b` given the led suit and trump. */
export function beats(a: Card, b: Card, led: Suit, trump: Suit | null): boolean {
  const aT = suitOf(a) === trump;
  const bT = suitOf(b) === trump;
  if (aT && !bT) return true;
  if (!aT && bT) return false;
  if (aT && bT) return cardStrength(a, trump) > cardStrength(b, trump);
  const aL = suitOf(a) === led;
  const bL = suitOf(b) === led;
  if (aL && !bL) return true;
  if (!aL && bL) return false;
  if (!aL && !bL) return false;
  return cardStrength(a, trump) > cardStrength(b, trump);
}

const isRedSuit = (s: Suit) => s === 'H' || s === 'D';

/**
 * Hand order: trumps first, then the remaining suits alternating colours (red, black, red… or the
 * reverse) as far as the suits in hand allow; inside every suit (trump or not) the natural order
 * 7 8 9 10 J Q K A.
 */
export function sortHand(cards: Card[], trump: Suit | null): Card[] {
  const present = (['S', 'H', 'C', 'D'] as Suit[]).filter((s) => cards.some((c) => suitOf(c) === s));
  const order: Suit[] = [];
  const rest = [...present];
  const take = (s: Suit) => {
    order.push(s);
    rest.splice(rest.indexOf(s), 1);
  };
  if (trump && rest.includes(trump)) take(trump);
  while (rest.length) {
    const prev = order[order.length - 1];
    // always prefer a suit of the opposite colour to the previous one
    const opposite = prev ? rest.filter((s) => isRedSuit(s) !== isRedSuit(prev)) : rest;
    const pool = opposite.length ? opposite : rest;
    const reds = rest.filter(isRedSuit).length;
    const blacks = rest.length - reds;
    // start with the colour that has more suits left so the alternation can continue
    const pick = prev ? pool[0] : pool.find((s) => isRedSuit(s) === reds > blacks) ?? pool[0];
    take(pick);
  }
  return [...cards].sort((a, b) => {
    const sa = suitOf(a);
    const sb = suitOf(b);
    if (sa !== sb) return order.indexOf(sa) - order.indexOf(sb);
    return SEQUENCE_ORDER.indexOf(rankOf(a)) - SEQUENCE_ORDER.indexOf(rankOf(b));
  });
}

/** Total raw card points in a deck: 152 (+10 for the last trick = 162). */
export const DECK_POINTS = 152;
export const LAST_TRICK_BONUS = 10;
