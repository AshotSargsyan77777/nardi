import { describe, expect, it } from 'vitest';
import { Position, applyChess, chessBotMove, createChess, legal, make, san, sqIndex, startPosition, ChessState } from '../src/chess';

function fen(f: string): Position {
  const [placement, turn, castle, ep, half, full] = f.split(' ');
  const board = Array(64).fill(0);
  let i = 0;
  for (const ch of placement.replace(/\//g, '')) {
    if (/\d/.test(ch)) { i += Number(ch); continue; }
    const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
    board[i++] = ch === ch.toUpperCase() ? t : -t;
  }
  let castling = 0;
  if (castle.includes('K')) castling |= 1;
  if (castle.includes('Q')) castling |= 2;
  if (castle.includes('k')) castling |= 4;
  if (castle.includes('q')) castling |= 8;
  return { board, turn: turn === 'w' ? 0 : 1, castling, ep: ep === '-' ? -1 : sqIndex(ep), half: Number(half ?? 0), full: Number(full ?? 1) };
}
const perft = (p: Position, d: number): number => (d === 0 ? 1 : legal(p).reduce((n, m) => n + perft(make(p, m), d - 1), 0));

describe('chess move generation (perft)', () => {
  it('start position', () => {
    const p = startPosition();
    expect(perft(p, 1)).toBe(20);
    expect(perft(p, 2)).toBe(400);
    expect(perft(p, 3)).toBe(8902);
  });
  it('kiwipete (castling, en passant, promotions)', () => {
    const p = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect(perft(p, 1)).toBe(48);
    expect(perft(p, 2)).toBe(2039);
    expect(perft(p, 3)).toBe(97862);
  }, 60_000);
  it('position 3 (en passant pins)', () => {
    const p = fen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(perft(p, 1)).toBe(14);
    expect(perft(p, 2)).toBe(191);
    expect(perft(p, 3)).toBe(2812);
    expect(perft(p, 4)).toBe(43238);
  }, 60_000);
  it('position 4 (promotions, castling through check)', () => {
    const p = fen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    expect(perft(p, 1)).toBe(6);
    expect(perft(p, 2)).toBe(264);
    expect(perft(p, 3)).toBe(9467);
  }, 60_000);
});

describe('chess game', () => {
  it('writes moves in standard notation and finds fool’s mate', () => {
    let s: ChessState = createChess({ clockMin: 5, clockInc: 0 }, 0);
    const play = (seat: 0 | 1, from: string, to: string, t: number) => { s = applyChess(s, seat, { type: 'move', move: { from: sqIndex(from), to: sqIndex(to) }, at: t }).state; };
    play(0, 'f2', 'f3', 1000);
    play(1, 'e7', 'e5', 2000);
    play(0, 'g2', 'g4', 3000);
    play(1, 'd8', 'h4', 4000);
    expect(s.game.sans).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(s.status).toBe('finished');
    expect(s.winnerTeam).toBe(1);
    expect(s.finishReason).toBe('checkmate');
  });
  it('runs the clocks and loses on time', () => {
    let s: ChessState = createChess({ clockMin: 1, clockInc: 0 }, 0);
    s = applyChess(s, 0, { type: 'move', move: { from: sqIndex('e2'), to: sqIndex('e4') }, at: 10_000 }).state;
    expect(s.game.clock.left[0]).toBe(50_000);
    expect(() => applyChess(s, 1, { type: 'flag', at: 20_000 })).toThrow();
    const late = applyChess(s, 1, { type: 'flag', at: 10_000 + 60_000 }).state;
    expect(late.status).toBe('finished');
    expect(late.winnerTeam).toBe(0);
    expect(late.finishReason).toBe('timeout');
  });
  it('disambiguates and castles in notation', () => {
    const p = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castles = legal(p).filter((m) => m.castle).map((m) => san(p, m));
    expect(castles.sort()).toEqual(['O-O', 'O-O-O']);
    const q = fen('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
    const rook = legal(q).find((m) => m.from === sqIndex('a1') && m.to === sqIndex('d1'))!;
    expect(san(q, rook)).toBe('Rad1');
  });
  it('bots play whole games to a legal end', () => {
    for (let n = 0; n < 3; n++) {
      let s: ChessState = createChess({ botLevel: 'easy', clockMin: 30 }, 0);
      let t = 0;
      for (let i = 0; i < 300 && s.status === 'playing'; i++) {
        const seat = s.game.pos.turn;
        t += 100;
        s = applyChess(s, seat, { type: 'move', move: chessBotMove(s, seat), at: t }).state;
      }
      if (s.status === 'finished') expect(['checkmate', 'stalemate', 'repetition', 'fifty_moves', 'material']).toContain(s.finishReason);
    }
  }, 120_000);
  it('a strong bot takes a hanging queen and mates in one', () => {
    const s0 = createChess({ botLevel: 'strong' }, 0);
    const mate = { ...s0, game: { ...s0.game, pos: fen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1') } };
    const m = chessBotMove(mate, 0);
    expect([m.from, m.to]).toEqual([sqIndex('d1'), sqIndex('d8')]);
    const hang = { ...s0, game: { ...s0.game, pos: fen('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1') } };
    const t = chessBotMove(hang, 0);
    expect([t.from, t.to]).toEqual([sqIndex('d2'), sqIndex('d5')]);
  }, 30_000);
});
