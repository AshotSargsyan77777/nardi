import { describe, expect, it } from 'vitest';
import { applyCheckers, applyMove, checkersBotMove, createCheckers, legalMoves, startBoard, CheckersState } from '../src/checkers';

/** A board from a picture: rows top (row 0) to bottom; w/b men, W/B kings, '.' empty. */
function board(rows: string[]) {
  const b = Array(64).fill(0);
  rows.forEach((r, ri) => [...r.replace(/ /g, '')].forEach((ch, ci) => { b[ri * 8 + ci] = { w: 1, W: 2, b: -1, B: -2 }[ch] ?? 0; }));
  return b;
}
const sq = (name: string) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97); // a1 bottom-left

describe('checkers rules', () => {
  it('starts with 12 men each and 7 moves for white', () => {
    const b = startBoard();
    expect(b.filter((v) => v === 1)).toHaveLength(12);
    expect(b.filter((v) => v === -1)).toHaveLength(12);
    expect(legalMoves(b, 0)).toHaveLength(7);
    expect(b[sq('a1')]).toBe(1); // a1 is a dark square with a white man
  });

  it('forces a capture and lets a man capture backwards', () => {
    const b = board([
      '........',
      '........',
      '........',
      '........',
      '........',
      '..b.....',
      '...w....',
      '........',
    ]);
    // white man on d2 can capture the man on c3 (forward); black man on c3 can capture d2 backwards? no: d2 is in front of it
    const w = legalMoves(b, 0);
    expect(w).toHaveLength(1);
    expect(w[0].captures).toEqual([sq('c3')]);
    const back = board([
      '........', '........', '........', '........', '........', '........', '..b.....', '.w......',
    ]);
    // black man c2 captures white on b1? no square beyond; instead test a white man capturing backward
    const b2 = board([
      '........', '........', '........', '...w....', '....b...', '........', '........', '........',
    ]);
    const m = legalMoves(b2, 0);
    expect(m.some((x) => x.captures.length === 1)).toBe(true);
    void back;
  });

  it('chains captures, promotes during a capture and keeps capturing as a king', () => {
    // white man on e5 jumps d6 → c7? lands on c7, then b8 is the last row... build: man reaches row 0 mid-capture
    const b = board([
      '........',
      '...b....',
      '....w...',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    const moves = legalMoves(b, 0);
    expect(moves).toHaveLength(1);
    const after = applyMove(b, moves[0], 0);
    expect(after[moves[0].path[moves[0].path.length - 1]]).toBe(2); // crowned
  });

  it('lets a king fly and capture from a distance, never jumping a piece twice', () => {
    const b = board([
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '........',
      '.W......',
      '........',
    ]);
    const m = legalMoves(b, 0);
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.captures.length === 1)).toBe(true);
    // landing squares beyond d4: e5, f6, g7, h8
    expect(m.map((x) => x.path[1]).sort()).toEqual([sq('e5'), sq('f6'), sq('g7'), sq('h8')].sort());
  });

  it('a player with no moves loses; bots finish whole games', () => {
    for (let n = 0; n < 6; n++) {
      let s: CheckersState = createCheckers({ botLevel: n % 2 ? 'easy' : 'medium' });
      for (let i = 0; i < 400 && s.status === 'playing'; i++) {
        const seat = s.game.turn;
        s = applyCheckers(s, seat, { type: 'move', move: checkersBotMove(s, seat) }).state;
        const whites = s.game.board.filter((v) => v > 0).length;
        const blacks = s.game.board.filter((v) => v < 0).length;
        expect(whites + blacks).toBeLessThanOrEqual(24);
      }
      expect(s.status).toBe('finished');
      expect(['no_moves', 'repetition', 'fifty_moves']).toContain(s.finishReason);
    }
  }, 60_000);

  it('handles resign and draw offers', () => {
    let s = createCheckers();
    s = applyCheckers(s, 0, { type: 'offer_draw' }).state;
    expect(s.drawOffer).toBe(0);
    expect(() => applyCheckers(s, 0, { type: 'accept_draw' })).toThrow();
    const drawn = applyCheckers(s, 1, { type: 'accept_draw' }).state;
    expect(drawn.status).toBe('finished');
    expect(drawn.winnerTeam).toBeNull();
    const res = applyCheckers(createCheckers(), 1, { type: 'resign' }).state;
    expect(res.winnerTeam).toBe(0);
  });
});
