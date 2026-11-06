import { Card, Rank, SEATS, SEQUENCE_ORDER, Seat, Suit, Team, sortHand, teamOf } from './cards';
import { Combo, ComboKind, bestCombo, compareCombos } from './combos';
import {
  BidRecord, BiddingOptions, CompletedTrick, Contract, HandResult, MatchState, Play, biddingOptions, legalCards,
} from './game';
import { RuleConfig } from './rules';

/**
 * Table talk about combinations during the first round, as players say it out loud:
 * - `announce`: "50!" (best combination of the player, said when playing the first card)
 * - `ask`: an opponent with an equal combination asks "what's its height?"
 * - `height`: the owner answers with the top card ("king")
 * - `drop`: the opponent beats it — "drop it, mine is the ace" / "drop it, mine is 50"
 * - `same`: exactly equal ("mine is a king too") — nobody scores
 */
export interface ComboTalk { seat: Seat; say: 'announce' | 'ask' | 'height' | 'drop' | 'same'; kind?: ComboKind; points?: number; rank?: Rank }

const topRank = (c: Combo): Rank => SEQUENCE_ORDER[c.top];

export function comboTalk(order: Seat[], declared: (Combo[] | null)[], trump: Suit | null): ComboTalk[] {
  const talk: ComboTalk[] = [];
  let cur: { seat: Seat; combo: Combo } | null = null;
  for (const seat of order) {
    const mine = bestCombo(declared[seat] ?? [], trump);
    if (!mine) continue;
    if (!cur) {
      talk.push({ seat, say: 'announce', kind: mine.kind, points: mine.points });
      cur = { seat, combo: mine };
      continue;
    }
    if (teamOf(seat) === teamOf(cur.seat)) {
      // partner: only speaks up when it improves the team's best
      if (compareCombos(mine, cur.combo, trump) > 0) {
        talk.push({ seat, say: 'announce', kind: mine.kind, points: mine.points });
        cur = { seat, combo: mine };
      }
      continue;
    }
    if (mine.points > cur.combo.points) {
      talk.push({ seat, say: 'drop', kind: mine.kind, points: mine.points });
      cur = { seat, combo: mine };
    } else if (mine.points === cur.combo.points) {
      talk.push({ seat, say: 'ask' });
      talk.push({ seat: cur.seat, say: 'height', rank: topRank(cur.combo) });
      const cmp = compareCombos(mine, cur.combo, trump);
      if (cmp > 0) {
        talk.push({ seat, say: 'drop', kind: mine.kind, points: mine.points, rank: topRank(mine) });
        cur = { seat, combo: mine };
      } else if (cmp === 0) {
        talk.push({ seat, say: 'same', rank: topRank(mine) });
      }
    }
  }
  return talk;
}

/** A declared combination; `counts` tells whether it scores (only the strongest team's do). */
export interface PublicCombo { seat: Seat; kind: ComboKind; points: number; cards: Card[] | null; counts: boolean }

/**
 * What a single seat is allowed to see. Opponents' and partner's cards are never included;
 * only counts. After the first trick every declared combination (terz, 50, 100, four of a kind) is
 * shown with its cards and owner; `counts` marks the ones that score.
 */
export interface PlayerView {
  seat: Seat | null;
  config: RuleConfig;
  status: MatchState['status'];
  version: number;
  scores: [number, number];
  handNumber: number;
  dealer: Seat;
  phase: 'bidding' | 'playing' | 'between_hands' | 'finished';
  turn: Seat | null;
  myHand: Card[];
  cardCounts: number[];
  bids: BidRecord[];
  contract: Contract | null;
  contra: Seat | null;
  recontra: Seat | null;
  trump: Suit | null;
  trick: Play[];
  lastTrick: CompletedTrick | null;
  tricksWon: [number, number];
  declaredKinds: (ComboKind[] | null)[];
  combos: PublicCombo[];
  /** Combination talk of the first round (shown during the first two rounds). */
  comboTalk: ComboTalk[];
  comboWinnerTeam: Team | null;
  blotAnnounced: Seat | null;
  history: HandResult[];
  winnerTeam: Team | null;
  finishReason: MatchState['finishReason'];
  legal: { cards: Card[]; bidding: BiddingOptions | null };
}

export function playerView(state: MatchState, seat: Seat | null): PlayerView {
  const h = state.hand;
  const phase: PlayerView['phase'] = state.status === 'finished' ? 'finished' : !h ? 'between_hands' : h.phase;
  const tricksWon: [number, number] = [0, 0];
  h?.tricks.forEach((t) => (tricksWon[teamOf(t.winner)] += 1));

  const combos: PublicCombo[] = [];
  // after the first trick everybody sees who holds which combination
  if (h?.combosResolved) {
    for (const s of SEATS) {
      for (const c of h.declared[s] ?? []) combos.push({ seat: s, kind: c.kind, points: c.points, cards: c.cards, counts: teamOf(s) === h.comboWinnerTeam });
    }
  }

  return {
    seat,
    config: state.config,
    status: state.status,
    version: state.version,
    scores: state.scores,
    handNumber: state.handNumber,
    dealer: state.dealer,
    phase,
    turn: h && state.status === 'playing' ? h.turn : null,
    myHand: h && seat !== null ? sortHand(h.hands[seat], h.trump) : [],
    cardCounts: h ? h.hands.map((x) => x.length) : [0, 0, 0, 0],
    bids: h?.bids ?? [],
    contract: h?.contract ?? null,
    contra: h?.contra ?? null,
    recontra: h?.recontra ?? null,
    trump: h?.trump ?? null,
    trick: h?.trick ?? [],
    lastTrick: h && h.tricks.length ? h.tricks[h.tricks.length - 1] : null,
    tricksWon,
    declaredKinds: h ? h.declared.map((d) => (d ? d.map((c) => c.kind) : null)) : [null, null, null, null],
    combos,
    comboTalk: h && h.tricks.length <= 1 ? comboTalk((h.tricks[0]?.plays ?? h.trick).map((p) => p.seat), h.declared, h.trump) : [],
    comboWinnerTeam: h?.comboWinnerTeam ?? null,
    blotAnnounced: h && h.blotHolder !== null && h.blotPlayed >= 2 ? h.blotHolder : null,
    history: state.history,
    winnerTeam: state.winnerTeam,
    finishReason: state.finishReason,
    legal: {
      cards: seat === null ? [] : legalCards(state, seat),
      bidding: seat === null ? null : biddingOptions(state, seat),
    },
  };
}
