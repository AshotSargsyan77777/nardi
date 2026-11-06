import { describe, expect, it } from 'vitest';
import {
  Card, sortHand, comboTalk, DECK_POINTS, HandState, MatchState, Seat, applyAction, autoAction, beats, biddingOptions, botAction,
  cardPoints, compareCombos, createMatch, dealHand, detectCombos, forfeit, fullDeck, legalCardsFor, normalizeRules,
  playerView, scoreHand, resolveCombos, DEFAULT_RULES, EngineError, RuleConfigError,
} from '../src/blot';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(seed: number): Card[] {
  const r = rng(seed);
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
const R = DEFAULT_RULES;

describe('cards', () => {
  it('has 32 unique cards worth 152 points regardless of trump', () => {
    const d = fullDeck();
    expect(new Set(d).size).toBe(32);
    for (const t of ['S', 'H', 'D', 'C'] as const) expect(d.reduce((s, c) => s + cardPoints(c, t), 0)).toBe(DECK_POINTS);
  });
  it('ranks trumps J > 9 > A > 10 > K > Q > 8 > 7', () => {
    expect(beats('JH', '9H', 'H', 'H')).toBe(true);
    expect(beats('9H', 'AH', 'H', 'H')).toBe(true);
    expect(beats('AH', '10H', 'H', 'H')).toBe(true);
    expect(beats('7H', 'AS', 'S', 'H')).toBe(true);
  });
  it('ranks plain suits A > 10 > K > Q > J > 9', () => {
    expect(beats('10S', 'KS', 'S', 'H')).toBe(true);
    expect(beats('JS', '9S', 'S', 'H')).toBe(true);
    expect(beats('AD', '7S', 'S', 'H')).toBe(false); // off-suit, non-trump never wins
  });
});

describe('hand order', () => {
  it('orders every suit 7 8 9 10 J Q K A, trump included', () => {
    expect(sortHand(['AH', 'JH', '7H', '9H', 'KS', '7S'], 'H')).toEqual(['7H', '9H', 'JH', 'AH', '7S', 'KS']);
  });
  const colours = (h: Card[]) => [...new Set(h.map((c) => c.slice(-1)))].map((x) => (x === 'H' || x === 'D' ? 'R' : 'B')).join('');
  it('puts trumps first and alternates red / black', () => {
    expect(colours(sortHand(['7S', 'AH', '9C', 'KD', 'JH', '8S', 'QC', '10D'], 'H'))).toBe('RBRB');
    expect(colours(sortHand(['7S', 'AH', '9C', 'KD', 'JH', '8S', 'QC', '10D'], 'S'))).toBe('BRBR');
    expect(colours(sortHand(['7S', 'AH', '9C', 'KD'], null))).toMatch(/^(RBRB|BRBR)$/);
    // three suits, two black: black-red-black
    expect(colours(sortHand(['7S', 'AH', '9C', 'KS'], null))).toBe('BRB');
  });
});

describe('combination talk', () => {
  const seq = (cards: string[]) => detectCombos(cards as Card[]);
  it('announces, asks the height and drops a lower one', () => {
    const declared = [seq(['7S', '8S', '9S', '10S']), seq(['QH', 'KH', 'AH', 'JH']), [], []];
    // seat 0 has 50 up to 10, seat 1 has 50 up to ace
    const t = comboTalk([0, 1, 2, 3], declared, 'D');
    expect(t.map((x) => [x.seat, x.say, x.rank ?? x.points])).toEqual([[0, 'announce', 50], [1, 'ask', undefined], [0, 'height', '10'], [1, 'drop', 'A']]);
  });
  it('drops a terz straight away with a bigger combination', () => {
    const t = comboTalk([2, 3], [[], [], seq(['7S', '8S', '9S']), seq(['9H', '10H', 'JH', 'QH', 'KH'])], 'D');
    expect(t.map((x) => [x.seat, x.say, x.points])).toEqual([[2, 'announce', 20], [3, 'drop', 100]]);
  });
  it('stays silent with a lower combination', () => {
    const t = comboTalk([0, 1], [seq(['7S', '8S', '9S', '10S']), seq(['7H', '8H', '9H']), [], []], 'D');
    expect(t.map((x) => x.say)).toEqual(['announce']);
  });
});

describe('combinations', () => {
  it('detects terz, fifty and hundred', () => {
    expect(detectCombos(['7S', '8S', '9S', 'AH', 'KD', 'QC', '7C', '10H']).map((c) => c.kind)).toEqual(['terz']);
    expect(detectCombos(['10S', 'JS', 'QS', 'KS', 'AH', '8D', '7C', '9H']).map((c) => c.kind)).toEqual(['fifty']);
    expect(detectCombos(['9D', '10D', 'JD', 'QD', 'KD', 'AD', '7C', '9H']).map((c) => [c.kind, c.points])).toEqual([['hundred', 100]]);
  });
  it('scores four jacks 200, four nines 140, ignores four 7s/8s', () => {
    expect(detectCombos(['JS', 'JH', 'JD', 'JC', '7S', '8H', 'AD', 'KC'])[0].points).toBe(200);
    expect(detectCombos(['9S', '9H', '9D', '9C', '7S', '8H', 'AD', 'KC'])[0].points).toBe(140);
    expect(detectCombos(['7S', '7H', '7D', '7C', '8S', '8H', '8D', '8C'])).toEqual([]);
  });
  it('does not reuse a card of a four-of-a-kind in a sequence', () => {
    const combos = detectCombos(['KS', 'KH', 'KD', 'KC', 'QS', 'AS', '7D', '8C']);
    expect(combos.map((c) => c.kind)).toEqual(['four']);
  });
  it('compares by points, then length, then top card, then trump', () => {
    const [terzLow] = detectCombos(['7S', '8S', '9S']);
    const [terzHigh] = detectCombos(['QH', 'KH', 'AH']);
    const [terzHighTrump] = detectCombos(['QD', 'KD', 'AD']);
    const [fifty] = detectCombos(['7C', '8C', '9C', '10C']);
    expect(compareCombos(fifty, terzHigh, 'S')).toBeGreaterThan(0);
    expect(compareCombos(terzHigh, terzLow, 'S')).toBeGreaterThan(0);
    expect(compareCombos(terzHighTrump, terzHigh, 'D')).toBeGreaterThan(0);
    expect(compareCombos(terzHigh, terzHighTrump, 'S')).toBe(0);
  });
});

describe('legal cards', () => {
  const p = (seat: Seat, card: Card) => ({ seat, card });
  it('requires following suit', () => {
    expect(legalCardsFor(['AS', '7S', 'JH'], [p(0, 'KS')], 'H', 1, R).sort()).toEqual(['7S', 'AS']);
  });
  it('requires overtrumping when trump is led', () => {
    expect(legalCardsFor(['JH', '7H', 'AS'], [p(0, '9H')], 'H', 1, R)).toEqual(['JH']);
    // cannot overtrump -> any trump
    expect(legalCardsFor(['8H', '7H', 'AS'], [p(0, '9H')], 'H', 1, R).sort()).toEqual(['7H', '8H']);
  });
  it('requires trumping when void in the led suit', () => {
    expect(legalCardsFor(['7H', 'AD'], [p(0, 'KS')], 'H', 1, R)).toEqual(['7H']);
  });
  it('requires overtrumping an opponent trump when void', () => {
    // seat 2: opponent (seat 1) is winning with a trump -> must overtrump
    expect(legalCardsFor(['7H', 'AH', 'AD'], [p(0, 'KS'), p(1, '10H')], 'H', 2, R)).toEqual(['AH']);
    // seat 3: partner (seat 1) is winning -> free choice
    expect(legalCardsFor(['7H', 'AH', 'AD'], [p(0, 'KS'), p(1, '10H'), p(2, '7S')], 'H', 3, R)).toEqual(['7H', 'AH', 'AD']);
  });
  it('never requires trumping when the partner is winning', () => {
    const trick = [p(0, 'AS'), p(1, '7S')];
    expect(legalCardsFor(['7H', 'AD'], trick, 'H', 2, R).sort()).toEqual(['7H', 'AD']);
    // an old stored setting is ignored
    expect(normalizeRules({ mustTrumpWhenPartnerWinning: true } as any)).not.toHaveProperty('mustTrumpWhenPartnerWinning');
  });
  it('allows anything when void in suit and trump', () => {
    expect(legalCardsFor(['AD', '7C'], [p(0, 'KS')], 'H', 1, R).sort()).toEqual(['7C', 'AD']);
  });
});

describe('bidding', () => {
  const start = () => dealHand(createMatch({}, 0), shuffled(1)).state;
  it('starts left of the dealer with the minimum bid', () => {
    const s = start();
    expect(s.hand!.dealer).toBe(0);
    expect(s.hand!.turn).toBe(1);
    expect(biddingOptions(s, 1)!.minBid).toBe(8);
    expect(() => applyAction(s, 2, { type: 'pass' })).toThrow(EngineError);
  });
  it('rejects bids not above the current contract', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 9, suit: 'H' }).state;
    expect(() => applyAction(s, 2, { type: 'bid', value: 9, suit: 'S' })).toThrow('BID_TOO_LOW');
    s = applyAction(s, 2, { type: 'bid', value: 10, suit: 'S' }).state;
    expect(s.hand!.contract).toEqual({ seat: 2, value: 10, suit: 'S' });
  });
  it('accepts bids up to 63 (reachable with combinations)', () => {
    const s = start();
    expect(biddingOptions(s, 1)!.maxBid).toBe(63);
    expect(applyAction(s, 1, { type: 'bid', value: 40, suit: 'C' }).state.hand!.contract).toEqual({ seat: 1, value: 40, suit: 'C' });
    expect(() => applyAction(s, 1, { type: 'bid', value: 64, suit: 'C' })).toThrow('BID_TOO_LOW');
  });
  it('comes back to the last bidder, who may raise; closes when all four passed', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 9, suit: 'H' }).state;
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    expect(s.hand!.phase).toBe('bidding');
    expect(s.hand!.turn).toBe(1);
    expect(biddingOptions(s, 1)!.minBid).toBe(10);
    s = applyAction(s, 1, { type: 'bid', value: 10, suit: 'H' }).state;
    for (const seat of [2, 3, 0, 1] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    expect(s.hand!.phase).toBe('playing');
    expect(s.hand!.contract).toEqual({ seat: 1, value: 10, suit: 'H' });
  });
  it('kapot can be raised with +N; numbers cannot follow a kapot', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 'kapot', suit: 'H' }).state;
    let o = biddingOptions(s, 2)!;
    expect(o.minBid).toBeNull();
    expect(o.minKapotPlus).toBe(1);
    expect(() => applyAction(s, 2, { type: 'bid', value: 'kapot', suit: 'S' })).toThrow('BID_NOT_ALLOWED');
    s = applyAction(s, 2, { type: 'bid', value: 'kapot', suit: 'S', plus: 2 }).state;
    expect(s.hand!.contract).toEqual({ seat: 2, value: 'kapot', suit: 'S', plus: 2 });
    o = biddingOptions(s, 3)!;
    expect(o.minKapotPlus).toBe(3);
    expect(() => applyAction(s, 3, { type: 'bid', value: 'kapot', suit: 'S', plus: 2 })).toThrow('BID_NOT_ALLOWED');
  });
  it('closes after everyone passes and sets trump', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 8, suit: 'D' }).state;
    for (const seat of [2, 3, 0, 1] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    expect(s.hand!.phase).toBe('playing');
    expect(s.hand!.trump).toBe('D');
    expect(s.hand!.turn).toBe(1);
    expect(s.hand!.hands.every((h) => h.length === 8)).toBe(true);
  });
  it('allows contra only by opponents and recontra only by the bidding team', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 8, suit: 'D' }).state;
    expect(biddingOptions(s, 2)!.canContra).toBe(true);
    s = applyAction(s, 2, { type: 'pass' }).state;
    expect(biddingOptions(s, 3)!.canContra).toBe(false); // partner of bidder
    s = applyAction(s, 3, { type: 'pass' }).state;
    s = applyAction(s, 0, { type: 'contra' }).state;
    expect(biddingOptions(s, 1)!.canRecontra).toBe(true);
    const r = applyAction(s, 1, { type: 'recontra' });
    expect(r.state.hand!.phase).toBe('playing');
    expect(r.events.some((e) => e.type === 'bidding_ended')).toBe(true);
  });
  it('stops the bazar after a contra: no more bids, only recontra or pass by the bidding team', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 9, suit: 'H' }).state;
    s = applyAction(s, 2, { type: 'contra' }).state;
    // turn goes to seat 3 (bidder's partner), not to seat 0's side for a new bid
    expect(s.hand!.turn).toBe(3);
    const o = biddingOptions(s, 3)!;
    expect(o.minBid).toBeNull();
    expect(o.canContra).toBe(false);
    expect(o.canRecontra).toBe(true);
    expect(() => applyAction(s, 3, { type: 'bid', value: 10, suit: 'S' })).toThrow('BIDDING_CLOSED');
    s = applyAction(s, 3, { type: 'pass' }).state;
    // the opponent (seat 0) is skipped: the bidder (seat 1) decides next
    expect(s.hand!.turn).toBe(1);
    s = applyAction(s, 1, { type: 'pass' }).state;
    expect(s.hand!.phase).toBe('playing');
    expect(s.hand!.contract).toEqual({ seat: 1, value: 9, suit: 'H' });
    expect(s.hand!.contra).toBe(2);
    expect(s.hand!.recontra).toBeNull();
  });
  it('ends the bazar immediately on contra when recontra is disabled', () => {
    let s = dealHand(createMatch({ recontraEnabled: false }, 0), shuffled(31)).state;
    s = applyAction(s, 1, { type: 'bid', value: 8, suit: 'S' }).state;
    s = applyAction(s, 2, { type: 'contra' }).state;
    expect(s.hand!.phase).toBe('playing');
  });
  it('forbids contra before any bid and on the partner’s bid', () => {
    let s = start();
    expect(biddingOptions(s, 1)!.canContra).toBe(false);
    expect(() => applyAction(s, 1, { type: 'contra' })).toThrow('CONTRA_NOT_ALLOWED');
    s = applyAction(s, 1, { type: 'bid', value: 8, suit: 'S' }).state;
    s = applyAction(s, 2, { type: 'pass' }).state;
    expect(() => applyAction(s, 3, { type: 'contra' })).toThrow('CONTRA_NOT_ALLOWED'); // seat 3 is seat 1's partner
  });
  it('redeals when everybody passes', () => {
    let s = start();
    const r1 = [1, 2, 3, 0].reduce((acc, seat) => applyAction(acc, seat as Seat, { type: 'pass' }).state, s);
    expect(r1.awaitingDeal).toBe(true);
    expect(r1.history[0].redeal).toBe(true);
    s = dealHand(r1, shuffled(2)).state;
    expect(s.hand!.dealer).toBe(1);
  });
  it('supports the 4 + 4 deal variant (old «5 + 3» settings become 4 + 4)', () => {
    let s = dealHand(createMatch({ cardsBeforeBidding: 4 }), shuffled(3)).state;
    expect(s.hand!.hands.map((h) => h.length)).toEqual([4, 4, 4, 4]);
    expect(createMatch({ cardsBeforeBidding: 5 as any }).config.cardsBeforeBidding).toBe(4);
    s = applyAction(s, 1, { type: 'bid', value: 8, suit: 'S' }).state;
    for (const seat of [2, 3, 0, 1] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    expect(s.hand!.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
    expect(new Set(s.hand!.hands.flat()).size).toBe(32);
  });
  it('passes a slammed card («ճտոց») on to the others as an event flag', () => {
    let s = applyAction(start(), 1, { type: 'bid', value: 8, suit: 'D' }).state;
    for (const seat of [2, 3, 0, 1] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    const card = legalCardsFor(s.hand!.hands[1], [], 'D', 1, s.config)[0];
    const r = applyAction(s, 1, { type: 'play', card, slap: true });
    expect(r.events.find((e) => e.type === 'card_played')).toMatchObject({ card, slap: true });
  });
  it('bots of every level only make legal moves', () => {
    for (const botLevel of ['easy', 'medium', 'strong'] as const) {
      for (let m = 0; m < 15; m++) {
        let s = createMatch({ botLevel, targetScore: 101 }, (m % 4) as Seat);
        let guard = 0;
        while (s.status === 'playing' && guard++ < 5000) {
          if (s.awaitingDeal) { s = dealHand(s, shuffled(1000 + m * 31 + guard)).state; continue; }
          s = applyAction(s, s.hand!.turn, botAction(s, s.hand!.turn)).state; // throws on an illegal move
        }
        expect(s.status).toBe('finished');
      }
    }
  });
  it('keeps the cards as picked up from the table for the next deal', () => {
    let s = dealHand(createMatch({}, 0), shuffled(4)).state;
    for (const seat of [1, 2, 3, 0] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state; // redeal
    expect(s.collected).toHaveLength(32);
    expect(new Set(s.collected).size).toBe(32);
    s = dealHand(s, shuffled(5)).state;
    s = applyAction(s, 2, { type: 'bid', value: 8, suit: 'S' }).state;
    for (const seat of [3, 0, 1, 2] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    while (s.hand) s = applyAction(s, s.hand.turn, botAction(s, s.hand.turn)).state;
    expect(s.collected).toHaveLength(32);
    expect(new Set(s.collected).size).toBe(32);
  });
});

describe('dealing', () => {
  it('rejects decks that are not exactly the 32 cards', () => {
    const bad = shuffled(4);
    bad[0] = bad[1];
    expect(() => dealHand(createMatch(), bad)).toThrow('BAD_DECK');
    expect(() => dealHand(createMatch(), bad.slice(1))).toThrow('BAD_DECK');
  });
  it('deals each player 8 distinct cards', () => {
    const s = dealHand(createMatch(), shuffled(5)).state;
    expect(new Set(s.hand!.hands.flat()).size).toBe(32);
  });
});

function handFor(overrides: Partial<HandState>): HandState {
  return {
    number: 1, phase: 'playing', dealer: 0, deck: [], hands: [[], [], [], []], pending: [[], [], [], []], bids: [],
    contract: { seat: 1, value: 8, suit: 'H' }, contra: null, recontra: null, passesInRow: 0, turn: 0, trump: 'H',
    trick: [], tricks: [], declared: [[], [], [], []], combosResolved: true, comboWinnerTeam: null, blotHolder: null, blotPlayed: 0,
    ...overrides,
  };
}
/** Builds 8 tricks so that team 0 gets `pointsTeam0` raw card points (approx.) and the rest goes to team 1. */
function tricks(winners: Seat[], points: number[]) {
  return winners.map((w, i) => ({ plays: [], winner: w, points: points[i] }));
}

describe('hand scoring', () => {
  const state = (): MatchState => createMatch();
  it('made contract: bidders write bid + (16 − defenders), defenders their own points', () => {
    const s = state();
    // team1 (bidder, 8) 92 raw, team0 60 raw, last trick to team1 (+10) -> 102 vs 60
    const h = handFor({ tricks: tricks([1, 0, 1, 0, 1, 0, 1, 3], [30, 30, 20, 20, 20, 10, 12, 10]) });
    const r = scoreHand(h, s);
    expect(r.trickRaw[0] + r.trickRaw[1]).toBe(162);
    expect(r.made).toBe(true);
    expect(r.awarded).toEqual([6, 18]); // defenders 60 -> 6; bidders 8 + (16 − 6)
  });
  it('failed contract: defenders write the bid + 16 + all combinations', () => {
    const s = state();
    const h = handFor({ contract: { seat: 1, value: 10, suit: 'H' }, tricks: tricks([1, 0, 1, 0, 1, 0, 0, 0], [30, 30, 20, 20, 10, 20, 12, 10]) });
    const r = scoreHand(h, s);
    expect(r.made).toBe(false);
    expect(r.awarded).toEqual([26, 0]); // 10 bid + 16
  });
  it('a quanche multiplies only the bid; the winner writes bid × k + 16 + combinations', () => {
    const s = state();
    const h = handFor({ contra: 0, tricks: tricks([1, 0, 1, 0, 1, 0, 1, 3], [30, 30, 20, 20, 20, 10, 12, 10]) });
    expect(scoreHand(h, s).awarded).toEqual([0, 32]); // 8×2 + 16
    const s2 = state();
    expect(scoreHand(handFor({ contra: 0, recontra: 1, tricks: h.tricks }), s2).awarded).toEqual([0, 48]); // 8×4 + 16
  });
  it('kapot is worth the configured kapot points', () => {
    const r = scoreHand(handFor({ tricks: tricks([1, 3, 1, 3, 1, 3, 1, 3], [30, 30, 20, 20, 20, 10, 12, 10]) }), state());
    expect(r.kapotTeam).toBe(1);
    expect(r.awarded).toEqual([0, 33]); // bid 8 + 25 instead of 16
  });
  it('a failed kapot bid gives defenders the kapot value', () => {
    const r = scoreHand(handFor({ contract: { seat: 1, value: 'kapot', suit: 'H' }, tricks: tricks([1, 3, 1, 3, 1, 3, 1, 0], [30, 30, 20, 20, 20, 10, 12, 10]) }), state());
    expect(r.made).toBe(false);
    expect(r.awarded).toEqual([41, 0]); // kapot bid counts as 25, + 16
  });
  it('combinations count toward the contract; a failed bid adds the bid value', () => {
    const h = handFor({
      contract: { seat: 1, value: 9, suit: 'H' },
      declared: [[], detectCombos(['7S', '8S', '9S']), [], []],
      comboWinnerTeam: 1, blotHolder: 0, blotPlayed: 2,
      tricks: tricks([1, 0, 1, 0, 1, 0, 0, 0], [30, 30, 20, 10, 10, 20, 12, 20]),
    });
    // bidder raw = 60 + 20 combo = 80 < 90 -> fails; defenders get 9 + 16 + 2 combo + their own blot 2
    const r = scoreHand(h, state());
    expect(r.made).toBe(false);
    expect(r.awarded).toEqual([29, 0]);
  });
  it("the bidders' blot goes to the defenders when the bid fails", () => {
    const h = handFor({
      contract: { seat: 1, value: 9, suit: 'H' }, blotHolder: 1, blotPlayed: 2,
      tricks: tricks([1, 0, 1, 0, 1, 0, 0, 0], [30, 30, 20, 10, 10, 20, 12, 20]),
    });
    const r = scoreHand(h, state());
    expect(r.made).toBe(false);
    expect(r.awarded).toEqual([27, 0]); // 9 + 16 + blot 2
  });
  it("owner's examples: bid 12 fails, defenders hold a fifty", () => {
    const run = (suit: 'H' | 'NT', contra: Seat | null, recontra: Seat | null) => scoreHand(handFor({
      contract: { seat: 1, value: 12, suit }, trump: suit === 'NT' ? null : 'H', contra, recontra,
      declared: [detectCombos(['7S', '8S', '9S', '10S']), [], [], []], comboWinnerTeam: 0,
      tricks: tricks([1, 0, 1, 0, 1, 0, 0, 0], [30, 30, 20, 10, 10, 20, 12, 20]),
    }), createMatch()).awarded[0];
    expect(run('H', null, null)).toBe(33); // 12 + 16 + 5
    expect(run('H', 0, null)).toBe(45); // 12×2 + 16 + 5
    expect(run('H', 0, 1)).toBe(69); // 12×4 + 16 + 5
    expect(run('NT', null, null)).toBe(45); // 12×2 + 16 + 5
    expect(run('NT', 0, null)).toBe(57); // 12×3 + 16 + 5
    expect(run('NT', 0, 1)).toBe(81); // 12×5 + 16 + 5
  });
  it('kapot +N counts as 25 + N', () => {
    const r = scoreHand(handFor({ contract: { seat: 1, value: 'kapot', suit: 'H', plus: 2 }, tricks: tricks([1, 3, 1, 3, 1, 3, 1, 0], [30, 30, 20, 20, 20, 10, 12, 10]) }), createMatch());
    expect(r.made).toBe(false);
    expect(r.awarded).toEqual([43, 0]); // 27 + 16
  });
  it("a failed bid gives the bidders' own combinations to the defenders", () => {
    const r = scoreHand(handFor({
      contract: { seat: 1, value: 12, suit: 'H' }, declared: [[], detectCombos(['7S', '8S', '9S', '10S']), [], []], comboWinnerTeam: 1,
      tricks: tricks([1, 0, 1, 0, 1, 0, 0, 0], [30, 30, 20, 10, 10, 20, 12, 20]),
    }), createMatch());
    expect(r.awarded).toEqual([33, 0]); // 12 + 16 + their 50
  });
  it('four of a kind: 9s are 140 (0 in no trump), jacks 100 in no trump; order J>9>A>10>K>Q, NT A>10>K>Q>J', () => {
    const four = (r: string, nt = false) => detectCombos(['S', 'H', 'D', 'C'].map((x) => r + x) as Card[], nt);
    expect(four('9')[0].points).toBe(140);
    expect(four('9', true)).toEqual([]);
    expect(four('J', true)[0].points).toBe(100);
    expect(compareCombos(four('10')[0], four('K')[0], 'H')).toBeGreaterThan(0);
    expect(compareCombos(four('J', true)[0], four('Q', true)[0], null)).toBeLessThan(0);
    // any four beats a 100 sequence of the same value
    expect(compareCombos(four('Q')[0], detectCombos(['7S', '8S', '9S', '10S', 'JS'])[0], 'H')).toBeGreaterThan(0);
  });
  it('equal combinations: the first one after the dealer wins', () => {
    const terz = (suit: string) => detectCombos(['7', '8', '9'].map((r) => r + suit) as Card[]);
    // dealer 0 -> order 1, 2, 3, 0: seat 3 (team 1) comes before seat 0 (team 0)
    const h = handFor({ declared: [terz('S'), [], [], terz('C')], combosResolved: false, trump: 'H' });
    resolveCombos(h);
    expect(h.comboWinnerTeam).toBe(1);
    const h2 = handFor({ dealer: 2, declared: [terz('S'), [], [], terz('C')], combosResolved: false, trump: 'H' });
    resolveCombos(h2); // dealer 2 -> order 3, 0, 1, 2: seat 3 again first
    expect(h2.comboWinnerTeam).toBe(1);
    const h3 = handFor({ dealer: 3, declared: [terz('S'), [], [], terz('C')], combosResolved: false, trump: 'H' });
    resolveCombos(h3); // dealer 3 -> order 0, 1, 2, 3: seat 0 first
    expect(h3.comboWinnerTeam).toBe(0);
  });
  // last card of a hand: seat 0 plays 9S into a trick won by seat 2 (team 0)
  const lastCard = (scores: [number, number], bidderTricks: number) => {
    const st = createMatch({ targetScore: 101 });
    st.status = 'playing';
    st.awaitingDeal = false;
    st.scores = scores;
    const winners: Seat[] = [...Array(7)].map((_, i) => (i < bidderTricks ? 1 : 0));
    st.hand = handFor({
      tricks: tricks(winners, [10, 10, 10, 10, 10, 10, 10]), hands: [['9S'], [], [], []],
      trick: [{ seat: 1, card: '7S' }, { seat: 2, card: 'AS' }, { seat: 3, card: '8S' }], turn: 0,
    });
    return applyAction(st, 0, { type: 'play', card: '9S' });
  };
  it('«թարս կապուտ»: bidders without a single trick lose the match at once', () => {
    const r = lastCard([0, 50], 0);
    expect(r.state.status).toBe('finished');
    expect(r.state.winnerTeam).toBe(0);
    expect(r.state.finishReason).toBe('tharsKapot');
  });
  it('a team at the target cannot win on its own failed bid', () => {
    let r = lastCard([80, 110], 1); // defenders: 8 + 16 = 24 -> 104 < 110, play goes on
    expect(r.state.scores).toEqual([104, 110]);
    expect(r.state.status).toBe('playing');
    r = lastCard([90, 110], 1); // 114 > 110 -> defenders win
    expect(r.state.status).toBe('finished');
    expect(r.state.winnerTeam).toBe(0);
  });
  it('four aces are worth 110, or 190 in a no-trump hand', () => {
    const aces = ['AS', 'AH', 'AD', 'AC', '7S'] as Card[];
    expect(detectCombos(aces).find((c) => c.kind === 'four')!.points).toBe(110);
    expect(detectCombos(aces, true).find((c) => c.kind === 'four')!.points).toBe(190);
  });
});

describe('match flow (randomised simulation)', () => {
  it('plays 300 full bot matches without violating invariants', () => {
    let hands = 0;
    for (let m = 0; m < 300; m++) {
      let s = createMatch({ targetScore: 51 }, (m % 4) as Seat);
      let deckSeed = m * 1000;
      let guard = 0;
      while (s.status === 'playing') {
        if (guard++ > 5000) throw new Error('match did not terminate');
        if (s.awaitingDeal) {
          s = dealHand(s, shuffled(deckSeed++)).state;
          continue;
        }
        const seat = s.hand!.turn;
        const view = playerView(s, seat);
        // privacy: only own cards are visible
        expect(view.myHand.length).toBe(s.hand!.hands[seat].length);
        const action = m % 3 === 0 && s.hand!.phase === 'playing' ? autoAction(s, seat) : botAction(s, seat);
        if (action.type === 'play') expect(view.legal.cards).toContain(action.card);
        const before = s;
        const res = applyAction(s, seat, action);
        s = res.state;
        expect(s.version).toBe(before.version + 1);
        const scored = res.events.find((e) => e.type === 'hand_scored');
        if (scored && scored.type === 'hand_scored') {
          hands++;
          const r = scored.result;
          expect(r.trickRaw[0] + r.trickRaw[1]).toBe(162);
          expect(r.tricksWon[0] + r.tricksWon[1]).toBe(8);
          expect(r.awarded[0]).toBeGreaterThanOrEqual(0);
          expect(r.awarded[1]).toBeGreaterThanOrEqual(0);
          expect(r.scoresAfter).toEqual([before.scores[0] + r.awarded[0], before.scores[1] + r.awarded[1]]);
        }
      }
      expect(s.winnerTeam).not.toBeNull();
      expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(51);
      expect(s.scores[s.winnerTeam!]).toBeGreaterThan(s.scores[1 - s.winnerTeam!]);
    }
    expect(hands).toBeGreaterThan(300);
  });

  it('rejects illegal moves and moves out of turn', () => {
    let s = dealHand(createMatch(), shuffled(9)).state;
    s = applyAction(s, 1, { type: 'bid', value: 8, suit: 'S' }).state;
    for (const seat of [2, 3, 0, 1] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    const notMine = s.hand!.hands[2][0];
    expect(() => applyAction(s, 1, { type: 'play', card: notMine })).toThrow('CARD_NOT_IN_HAND');
    expect(() => applyAction(s, 2, { type: 'play', card: notMine })).toThrow('NOT_YOUR_TURN');
    expect(() => applyAction(s, 1, { type: 'bid', value: 9, suit: 'S' })).toThrow('BAD_ACTION');
    expect(() => applyAction(s, 1, { type: 'play', card: 'XX' as Card })).toThrow('BAD_CARD');
  });

  it('never leaks other hands in the player view', () => {
    const s = dealHand(createMatch(), shuffled(11)).state;
    const v = playerView(s, 0);
    const json = JSON.stringify(v);
    for (const c of s.hand!.hands[1]) expect(v.myHand).not.toContain(c);
    expect(json).not.toContain('"deck"');
    expect(json).not.toContain('"hands"');
    expect(playerView(s, null).myHand).toEqual([]);
  });

  it('handles forfeit', () => {
    const s = forfeit(dealHand(createMatch(), shuffled(12)).state, 0).state;
    expect(s.status).toBe('finished');
    expect(s.winnerTeam).toBe(1);
    expect(s.finishReason).toBe('forfeit');
  });
});

describe('no-trump (անղոզ / բոյ)', () => {
  const ntStart = (rules = {}) => {
    let s = dealHand(createMatch(rules, 0), shuffled(21)).state;
    s = applyAction(s, 1, { type: 'bid', value: 8, suit: 'NT' }).state;
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
    return s;
  };
  it('has no trump suit and no blot', () => {
    const s = ntStart();
    expect(s.hand!.trump).toBeNull();
    expect(s.hand!.blotHolder).toBeNull();
    expect(s.hand!.contract!.suit).toBe('NT');
  });
  it('only requires following suit (no trumping obligation)', () => {
    const p = (seat: Seat, card: Card) => ({ seat, card });
    expect(legalCardsFor(['7H', 'AD', 'KC'], [p(0, 'KS')], null, 1, R).sort()).toEqual(['7H', 'AD', 'KC'].sort());
    expect(beats('7S', 'AH', 'S', null)).toBe(true); // led suit wins, others never do
  });
  it('can be disabled', () => {
    const s = dealHand(createMatch({ allowNoTrump: false }, 0), shuffled(22)).state;
    expect(biddingOptions(s, 1)!.canNoTrump).toBe(false);
    expect(() => applyAction(s, 1, { type: 'bid', value: 8, suit: 'NT' })).toThrow('NO_TRUMP_DISABLED');
  });
  it('aces are worth 19, so a hand is still 16 points; the bid counts ×2', () => {
    expect(cardPoints('AS', null)).toBe(19);
    expect(fullDeck().reduce((a, c) => a + cardPoints(c, null), 0)).toBe(DECK_POINTS);
    const t = (pts: number[]) => tricks([1, 0, 1, 0, 1, 0, 1, 3], pts);
    // 152 card points + 10 last trick = 162 raw
    const pts = [30, 10, 20, 10, 20, 10, 10, 42];
    const doubled = scoreHand(handFor({ trump: null, contract: { seat: 1, value: 8, suit: 'NT' }, tricks: t(pts) }), createMatch());
    expect(doubled.trickRaw[0] + doubled.trickRaw[1]).toBe(162);
    expect(doubled.made).toBe(true);
    expect(doubled.awarded).toEqual([3, 29]); // team0 30 raw → 3; bidders 8×2 + (16 − 3)
    const single = scoreHand(handFor({ trump: null, contract: { seat: 1, value: 8, suit: 'NT' }, tricks: t(pts) }), createMatch({ noTrumpDoubled: false }));
    expect(single.awarded).toEqual([3, 21]); // 8 + 13
  });
  it('plays complete no-trump hands without breaking invariants', () => {
    for (let m = 0; m < 40; m++) {
      let s = dealHand(createMatch({ targetScore: 51 }, 0), shuffled(500 + m)).state;
      s = applyAction(s, 1, { type: 'bid', value: 8, suit: 'NT' }).state;
      for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, seat, { type: 'pass' }).state;
      let scored: any = null;
      while (!scored) {
        const seat = s.hand!.turn;
        const r = applyAction(s, seat, botAction(s, seat));
        s = r.state;
        scored = r.events.find((e) => e.type === 'hand_scored');
      }
      expect(scored.result.trickRaw[0] + scored.result.trickRaw[1]).toBe(162);
      expect(scored.result.blotRaw).toEqual([0, 0]);
    }
  });
});

describe('rule config', () => {
  it('validates and strips unknown keys', () => {
    expect(normalizeRules({ targetScore: 101, foo: 1 } as any)).not.toHaveProperty('foo');
    expect(() => normalizeRules({ targetScore: 5 })).toThrow(RuleConfigError);
    expect(() => normalizeRules({ cardsBeforeBidding: 6 as any })).toThrow(RuleConfigError);
    expect(normalizeRules({ contraEnabled: false, recontraEnabled: true }).recontraEnabled).toBe(false);
  });
});
