import { Card, SUITS, Seat, Suit, beats, cardPoints, cardStrength, fullDeck, partnerOf, rankOf, suitOf, teamOf } from './cards';
import { detectCombos } from './combos';
import { Action, BidSuit, MatchState, biddingOptions, legalCards } from './game';

/**
 * Transparent practice bot. It only sees its own hand plus public information (cards already on
 * the table), never other players' cards, and it is used only in practice / explicitly labelled
 * seats. `config.botLevel`: easy makes mistakes, medium plays simply, strong remembers the cards.
 */
export function botAction(state: MatchState, seat: Seat, random: () => number = Math.random): Action {
  const h = state.hand;
  if (!h) throw new Error('No active hand');
  const level = state.config.botLevel ?? 'medium';
  if (h.phase === 'bidding') return botBid(state, seat, level);
  if (level === 'easy' && random() < 0.45) {
    // a beginner: often just plays any card it may play
    const legal = legalCards(state, seat);
    return { type: 'play', card: legal[Math.floor(random() * legal.length)], declare: true };
  }
  return level === 'strong' ? strongPlay(state, seat) : botPlay(state, seat);
}

function estimate(hand: Card[], trump: Suit): number {
  const trumps = hand.filter((c) => suitOf(c) === trump);
  if (trumps.length < 3 || !trumps.some((c) => ['J', '9'].includes(rankOf(c)))) return 0;
  let est = trumps.reduce((s, c) => s + cardPoints(c, trump), 0);
  for (const c of hand) {
    if (suitOf(c) === trump) continue;
    if (rankOf(c) === 'A') est += 11;
    if (rankOf(c) === '10' && hand.includes(`A${suitOf(c)}` as Card)) est += 10;
  }
  est += detectCombos(hand).reduce((s, c) => s + c.points, 0);
  est += trumps.length * 4 + 10; // trump length and a share of the last trick
  return est + 25; // expected partner contribution
}

function botBid(state: MatchState, seat: Seat, level: 'easy' | 'medium' | 'strong' = 'medium'): Action {
  const h = state.hand!;
  const opts = biddingOptions(state, seat)!;
  const hand = h.hands[seat];
  const cur = h.contract;

  if (opts.canContra && cur && level !== 'easy') {
    const t = cur.suit;
    if (hand.includes(`J${t}` as Card) && hand.includes(`9${t}` as Card) && hand.filter((c) => suitOf(c) === t).length >= 3) {
      return { type: 'contra' };
    }
  }
  let bestSuit: Suit = 'S';
  let best = 0;
  for (const s of SUITS) {
    const e = estimate(hand, s);
    if (e > best) {
      best = e;
      bestSuit = s;
    }
  }
  // no-trump (անղոզ) when holding at least three aces and no convincing trump suit
  let bidSuit: BidSuit = bestSuit;
  if (opts.canNoTrump) {
    const aces = hand.filter((c) => rankOf(c) === 'A');
    const tensBacked = hand.filter((c) => rankOf(c) === '10' && hand.includes(`A${suitOf(c)}` as Card)).length;
    const nt = aces.length * 19 + tensBacked * 10 + 10 + 25;
    if (aces.length >= 3 && nt > best) {
      best = nt;
      bidSuit = 'NT';
    }
  }
  // the bazar came back round to our own bid: keep it
  if (cur && cur.seat === seat) return { type: 'pass' };
  // easy bots bid timidly
  const capacity = Math.floor(best / 10) + (level === 'easy' ? -1 : 0);
  if (opts.minBid !== null && capacity >= opts.minBid) {
    const partnerHolds = cur && teamOf(cur.seat) === teamOf(seat);
    // bidding the lowest allowed number keeps room to raise later (jumping straight to the hand's
    // estimate was measured to score worse)
    if (!partnerHolds || capacity >= opts.minBid + 2) return { type: 'bid', value: opts.minBid, suit: bidSuit };
  }
  return { type: 'pass' };
}

function botPlay(state: MatchState, seat: Seat): Action {
  const h = state.hand!;
  const trump = h.trump;
  const legal = legalCards(state, seat);
  const byPoints = (a: Card, b: Card) => cardPoints(a, trump) - cardPoints(b, trump) || cardStrength(a, trump) - cardStrength(b, trump);
  const lowest = [...legal].sort(byPoints)[0];

  if (h.trick.length === 0) {
    const onContract = h.contract && teamOf(h.contract.seat) === teamOf(seat);
    const jack = `J${trump}` as Card;
    if (onContract && legal.includes(jack)) return { type: 'play', card: jack, declare: true };
    const ace = legal.find((c) => rankOf(c) === 'A' && suitOf(c) !== trump);
    return { type: 'play', card: ace ?? lowest, declare: true };
  }

  const led = suitOf(h.trick[0].card);
  let winner = h.trick[0];
  for (const p of h.trick.slice(1)) if (beats(p.card, winner.card, led, trump)) winner = p;

  if (winner.seat === partnerOf(seat)) {
    const nonTrump = legal.filter((c) => suitOf(c) !== trump);
    const pool = nonTrump.length ? nonTrump : legal;
    const richest = [...pool].sort(byPoints).reverse()[0];
    return { type: 'play', card: h.trick.length === 3 ? richest : lowest, declare: true };
  }
  const winning = legal.filter((c) => beats(c, winner.card, led, trump)).sort((a, b) => cardStrength(a, trump) - cardStrength(b, trump));
  if (winning.length) return { type: 'play', card: winning[0], declare: true };
  return { type: 'play', card: lowest, declare: true };
}

/**
 * Strong play: counts the cards already played (public) to know which cards are «masters»
 * (the highest left in their suit) and which players are out of a suit.
 */
function strongPlay(state: MatchState, seat: Seat): Action {
  const h = state.hand!;
  const trump = h.trump;
  const legal = legalCards(state, seat);
  const mine = h.hands[seat];
  const played = new Set<Card>([...h.tricks.flatMap((t) => t.plays.map((p) => p.card)), ...h.trick.map((p) => p.card)]);
  const unseen = fullDeck().filter((c) => !played.has(c) && !mine.includes(c)); // in other players' hands
  const byPoints = (a: Card, b: Card) => cardPoints(a, trump) - cardPoints(b, trump) || cardStrength(a, trump) - cardStrength(b, trump);
  const lowest = [...legal].sort(byPoints)[0];
  const isMaster = (c: Card) => !unseen.some((o) => suitOf(o) === suitOf(c) && cardStrength(o, trump) > cardStrength(c, trump));
  // who has shown to be out of a suit (did not follow it)
  const voids = new Map<Seat, Set<Suit>>();
  for (const t of [...h.tricks.map((t) => t.plays), h.trick]) {
    const led = t[0] && suitOf(t[0].card);
    for (const p of t.slice(1)) if (suitOf(p.card) !== led) (voids.get(p.seat) ?? voids.set(p.seat, new Set()).get(p.seat)!).add(led as Suit);
  }
  const opponents = [0, 1, 2, 3].filter((s) => teamOf(s as Seat) !== teamOf(seat)) as Seat[];
  const oppTrumpsLeft = trump !== null && unseen.some((c) => suitOf(c) === trump) && opponents.some((o) => !voids.get(o)?.has(trump));
  const play = (card: Card): Action => ({ type: 'play', card, declare: true });

  if (h.trick.length === 0) {
    const ourContract = !!h.contract && teamOf(h.contract.seat) === teamOf(seat);
    const myTrumps = legal.filter((c) => suitOf(c) === trump).sort((a, b) => cardStrength(b, trump) - cardStrength(a, trump));
    // pull the opponents' trumps with a master trump while they still have some
    if (ourContract && oppTrumpsLeft && myTrumps.length && isMaster(myTrumps[0])) return play(myTrumps[0]);
    // cash a master in a side suit the opponents can still follow (else they would trump it)
    const masters = legal
      .filter((c) => suitOf(c) !== trump && isMaster(c) && !(oppTrumpsLeft && opponents.some((o) => voids.get(o)?.has(suitOf(c)))))
      .sort((a, b) => cardPoints(b, trump) - cardPoints(a, trump));
    if (masters.length) return play(masters[0]);
    // otherwise lead low from a side suit, keeping trumps
    const side = legal.filter((c) => suitOf(c) !== trump).sort(byPoints);
    return play(side[0] ?? lowest);
  }

  const led = suitOf(h.trick[0].card);
  let winner = h.trick[0];
  for (const p of h.trick.slice(1)) if (beats(p.card, winner.card, led, trump)) winner = p;
  const last = h.trick.length === 3;
  const partnerWins = winner.seat === partnerOf(seat);
  // the partner's card cannot be beaten by the players still to come
  const partnerSafe = partnerWins && (last || (isMaster(winner.card) && !(trump !== null && suitOf(winner.card) !== trump && voids.get(nextSeatOf(seat))?.has(led) && oppTrumpsLeft)));
  if (partnerSafe) {
    // give points to the partner, but do not waste a trump
    const nonTrump = legal.filter((c) => suitOf(c) !== trump);
    const pool = nonTrump.length ? nonTrump : legal;
    return play([...pool].sort(byPoints).reverse()[0]);
  }
  const winning = legal.filter((c) => beats(c, winner.card, led, trump)).sort((a, b) => cardStrength(a, trump) - cardStrength(b, trump));
  if (winning.length) {
    // last to play: win as cheaply as possible; otherwise win with a card the next player cannot beat if we can
    if (last) return play(winning[0]);
    const safe = winning.filter((c) => isMaster(c));
    return play(safe[0] ?? winning[0]);
  }
  return play(lowest);
}

const nextSeatOf = (s: Seat) => ((s + 1) % 4) as Seat;
