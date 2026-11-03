import { describe, expect, it } from 'vitest';
import {
  Board, CHECKERS, Move, Seat, absIndex, applyAction, autoAction, botAction, createMatch, forfeit, legalSequences, nextMoveOptions,
  normalizeRules, own, pips, playerView, startBoard, stepOptions, turnCtx, whoseTurn,
} from '../src';

const total = (b: Board, s: Seat) => b.points.reduce((n, _, i) => n + own(b, s, i), 0) + b.bar[s] + b.off[s];
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const empty = (): Board => ({ points: new Array(24).fill(0), bar: [0, 0], off: [0, 0] });
const ctx = (variant: 'short' | 'long', seat: Seat = 0, headLimit = 1) => ({ variant, seat, headMoves: 0, headLimit: variant === 'long' ? headLimit : 99 });

describe('start position', () => {
  it('short: 15 checkers each, pip count 167', () => {
    const b = startBoard('short');
    expect(total(b, 0)).toBe(15);
    expect(total(b, 1)).toBe(15);
    expect(pips(b, 'short', 0)).toBe(167);
    expect(pips(b, 'short', 1)).toBe(167);
    expect(b.points[23]).toBe(2); // white on 24
    expect(b.points[0]).toBe(-2); // black on 1
  });
  it('long: everyone on the head, opposite corners', () => {
    const b = startBoard('long');
    expect(b.points[23]).toBe(15);
    expect(b.points[11]).toBe(-15);
    expect(absIndex('long', 1, 1)).toBe(12); // black home starts at point 13
  });
});

describe('short nardi moves', () => {
  it('opening 3-1 can make the 5 point', () => {
    const seqs = legalSequences(startBoard('short'), ctx('short'), [3, 1]);
    expect(seqs.some((s) => s.board.points[4] === 2)).toBe(true);
    for (const s of seqs) expect(s.moves).toHaveLength(2);
  });
  it('must enter from the bar first, and hits a lonely checker', () => {
    const b = empty();
    b.bar[0] = 1;
    b.points[20] = -1; // a black blot on white's 21 (enter with 4)
    b.points[5] = 5;
    b.points[0] = -14;
    const seqs = legalSequences(b, ctx('short'), [4, 2]);
    expect(seqs.every((s) => s.moves[0].from === 'bar' || s.moves[1].from === 'bar')).toBe(true);
    expect(seqs.some((s) => s.board.bar[1] === 1)).toBe(true);
  });
  it('cannot land on two or more opponent checkers; blocked entry means no move', () => {
    const b = empty();
    b.bar[0] = 1;
    for (let p = 18; p < 24; p++) b.points[p] = -2;
    b.points[0] = -3;
    b.points[5] = 14;
    expect(legalSequences(b, ctx('short'), [6, 5])[0].moves).toHaveLength(0);
  });
  it('plays the bigger die when only one can be played', () => {
    const b = empty();
    b.points[7] = 1; // a lone white checker on 8
    b.points[5] = -2; b.points[1] = -2; b.points[3] = -2; // 6 and 2 and 4 blocked
    b.points[23] = -7;
    b.off[0] = 14;
    // dice 6-4: 8→2 blocked, 8→4 blocked; dice 5-3: 8→3 open, 8→5 open
    const seqs = legalSequences(b, ctx('short'), [5, 3]);
    expect(seqs[0].moves.length).toBe(2);
  });
  it('bears off only with everyone home; a bigger die bears off from the highest point', () => {
    const b = empty();
    b.points[2] = 2; b.points[1] = 3; b.off[0] = 10;
    b.points[23] = -15;
    const seqs = legalSequences(b, ctx('short'), [6, 5]);
    expect(seqs[0].moves.every((m) => m.to === 'off')).toBe(true);
    const away = empty();
    away.points[10] = 1; away.points[1] = 4; away.off[0] = 10; away.points[23] = -15;
    expect(legalSequences(away, ctx('short'), [6, 1]).some((s) => s.moves.some((m) => m.to === 'off' && m.die === 6 && m.from === 1))).toBe(false);
  });
});

describe('long nardi moves', () => {
  it('only one checker leaves the head per turn', () => {
    const seqs = legalSequences(startBoard('long'), ctx('long'), [5, 3]);
    for (const s of seqs) expect(s.board.points[23]).toBe(14);
  });
  it('the first 6-6 lets two checkers leave the head', () => {
    const m = createMatch({ variant: 'long' }, 0);
    const r = applyAction(m, 0, { type: 'roll', dice: [6, 6] }).state;
    const seqs = legalSequences(r.game!.board, turnCtx(r), [6, 6]);
    expect(seqs.some((s) => s.board.points[23] === 13)).toBe(true);
  });
  it('never lands on an opponent checker', () => {
    const b = startBoard('long');
    const seqs = legalSequences(b, ctx('long'), [6, 6]);
    // 24 → 12 is black's head
    for (const s of seqs) expect(s.moves.some((m) => m.to === 11)).toBe(false);
  });
  it('may not build six in a row in front of every opponent checker', () => {
    const b = empty();
    // white holds 18..22 (five points); black all on its head (white's 12)
    for (const p of [17, 18, 19, 20, 21]) b.points[p] = 2;
    b.points[23] = 5;
    b.points[11] = -15;
    // 24 → 23 with a 1 would make 18..23: six in a row, all black checkers still behind it
    const steps = legalSequences(b, ctx('long'), [1, 1]);
    for (const s of steps) {
      let run = 0, worst = 0;
      for (let p = 0; p < 24; p++) { run = s.board.points[p] > 0 ? run + 1 : 0; worst = Math.max(worst, run); }
      expect(worst).toBeLessThan(6);
    }
  });
});

describe('free order of steps', () => {
  it('either die may be played first', () => {
    const b = startBoard('short');
    const first = stepOptions(b, ctx('short'), [6, 1], []);
    expect(first.some((m) => m.die === 6)).toBe(true);
    expect(first.some((m) => m.die === 1)).toBe(true);
  });
  it('rejects a turn that plays fewer dice than possible', () => {
    const m = applyAction(createMatch({ variant: 'short' }, 0), 0, { type: 'roll', dice: [6, 1] }).state;
    const one: Move[] = [nextMoveOptions(m, [])[0]];
    expect(() => applyAction(m, 0, { type: 'move', moves: one })).toThrow('ILLEGAL_MOVE');
  });
});

describe('whole games', () => {
  for (const variant of ['short', 'long'] as const) {
    it(`${variant}: bots finish a 3-point match, checkers are never lost`, () => {
      const r = rng(variant === 'short' ? 7 : 11);
      let s = createMatch({ variant, targetScore: 3, botLevel: 'medium' }, 0);
      let turns = 0;
      while (s.status === 'playing' && turns < 6000) {
        const seat = whoseTurn(s)!;
        let a = botAction(s, seat, r);
        if (a.type === 'roll') a = { type: 'roll', dice: [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)] };
        s = applyAction(s, seat, a).state;
        if (s.game) for (const p of [0, 1] as Seat[]) expect(total(s.game.board, p)).toBe(CHECKERS);
        turns++;
      }
      expect(s.status).toBe('finished');
      expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(3);
      for (const g of s.history) expect(g.points).toBe(g.mars ? 2 : 1);
      const v = playerView(s, null);
      expect(v.phase).toBe('finished');
    });
  }

  it('many random matches stay legal for every bot level', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const r = rng(seed * 97);
      const variant = seed % 2 ? 'short' : 'long';
      let s = createMatch({ variant, targetScore: 1, botLevel: (['easy', 'medium', 'strong'] as const)[seed % 3] }, (seed % 2) as Seat);
      for (let i = 0; i < 3000 && s.status === 'playing'; i++) {
        const seat = whoseTurn(s)!;
        let a = botAction(s, seat, r);
        if (a.type === 'roll') a = { type: 'roll', dice: [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)] };
        s = applyAction(s, seat, a).state;
      }
      expect(s.status).toBe('finished');
    }
  });

  it('mars counts double', () => {
    let s = createMatch({ variant: 'short', targetScore: 5 }, 0);
    const b = empty();
    b.points[0] = 1; b.off[0] = 14; b.points[23] = -15;
    s = { ...s, game: { ...s.game!, board: b } };
    s = applyAction(s, 0, { type: 'roll', dice: [3, 2] }).state;
    s = applyAction(s, 0, { type: 'move', moves: [nextMoveOptions(s, [])[0]] }).state;
    expect(s.scores).toEqual([2, 0]);
    expect(s.history[0].mars).toBe(true);
    expect(s.game!.turn).toBe(0); // the winner starts the next game
  });

  it('timeouts roll and move; forfeit ends the match', () => {
    let s = createMatch({ variant: 'long' }, 1);
    expect(autoAction(s, 1)).toEqual({ type: 'roll' });
    s = applyAction(s, 1, { type: 'roll', dice: [5, 2] }).state;
    const a = autoAction(s, 1);
    s = applyAction(s, 1, a).state;
    expect(whoseTurn(s)).toBe(0);
    const f = forfeit(s, 0).state;
    expect(f.winnerTeam).toBe(1);
  });

  it('validates options', () => {
    expect(() => normalizeRules({ variant: 'x' as any })).toThrow();
    expect(normalizeRules({}).variant).toBe('short');
  });
});
