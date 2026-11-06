'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useRef } from 'react';
import { useApp } from '@/lib/app-state';
import { CheckerColors, checkerColors, useLook } from '@/lib/look';

/**
 * The 8×8 board for chess and checkers. The wooden board is a pre-rendered image
 * (scripts/board-texture.mjs: squares-*.webp); this SVG draws highlights, pieces and coordinates.
 * Squares are 0..63 from the top-left as white sees it; black players see the board turned round.
 * Pieces keep their identity between positions, so moves slide (checkers captures hop square by
 * square) and taken pieces fade out.
 */
const VB = 1000;
const M = 40;
const SQ = (VB - 2 * M) / 8;
const FILES = 'abcdefgh';

export interface Highlight { sq: number; kind: 'from' | 'last' | 'target' | 'capture' | 'check' | 'selected' }

export interface DuelBoardProps {
  game: 'chess' | 'checkers';
  board: number[];
  /** Seen from black's side when 1. */
  flipped: boolean;
  highlights: Highlight[];
  /** The last move as the squares it went through (chess: [from, to]; checkers: the whole path). */
  lastPath: number[] | null;
  onSquare: (sq: number) => void;
  /** Squares that can be tapped (shown with a pointer). */
  clickable: Set<number>;
}

/** Pixel centre of a square as the viewer sees it. */
const centre = (sq: number, flipped: boolean) => {
  const r = sq >> 3, c = sq & 7;
  const vr = flipped ? 7 - r : r, vc = flipped ? 7 - c : c;
  return { x: M + vc * SQ + SQ / 2, y: M + vr * SQ + SQ / 2 };
};

interface Placed { id: number; sq: number; piece: number; path: number[] | null }

/**
 * Stable ids: the piece that moved keeps its id from the last move's start to its end; other
 * pieces that stayed keep theirs; a castling rook is matched by type; anything new gets a new id.
 */
function usePlaced(board: number[], lastPath: number[] | null): Placed[] {
  const ref = useRef<{ board: number[]; ids: Map<number, number>; next: number } | null>(null);
  return useMemo(() => {
    const prev = ref.current;
    const ids = new Map<number, number>();
    const paths = new Map<number, number[]>();
    let next = prev?.next ?? 0;
    if (prev && prev.board !== board) {
      const free = new Map(prev.ids);
      // stayed in place
      for (let sq = 0; sq < 64; sq++) {
        if (board[sq] && prev.board[sq] === board[sq] && free.has(sq)) { ids.set(sq, free.get(sq)!); free.delete(sq); }
      }
      // the moved piece (it may have been promoted)
      if (lastPath && lastPath.length >= 2) {
        const from = lastPath[0], to = lastPath[lastPath.length - 1];
        if (free.has(from) && board[to] && !ids.has(to) && Math.sign(prev.board[from]) === Math.sign(board[to])) {
          ids.set(to, free.get(from)!);
          free.delete(from);
          if (lastPath.length > 2) paths.set(to, lastPath);
        }
      }
      // anything else that moved (a castling rook): same piece, nearest square
      for (let sq = 0; sq < 64; sq++) {
        if (!board[sq] || ids.has(sq)) continue;
        let best = -1, dist = 99;
        for (const [from] of free) {
          if (prev.board[from] !== board[sq]) continue;
          const d = Math.abs((from >> 3) - (sq >> 3)) + Math.abs((from & 7) - (sq & 7));
          if (d < dist) { dist = d; best = from; }
        }
        if (best >= 0 && dist <= 3) { ids.set(sq, free.get(best)!); free.delete(best); }
      }
    }
    for (let sq = 0; sq < 64; sq++) if (board[sq] && !ids.has(sq)) ids.set(sq, prev && prev.board === board ? prev.ids.get(sq) ?? next++ : next++);
    ref.current = { board, ids, next };
    return [...ids.entries()].map(([sq, id]) => ({ id, sq, piece: board[sq], path: paths.get(sq) ?? null }));
  }, [board, lastPath]);
}

export function DuelBoard({ game, board, flipped, highlights, lastPath, onSquare, clickable }: DuelBoardProps) {
  const { me } = useApp();
  const look = useLook(me?.level ?? 1);
  const ck = checkerColors(look.checkers);
  const placed = usePlaced(board, lastPath);
  const image = look.board === 'felt' ? 'squares-green' : 'squares-walnut';
  const hl = (kind: Highlight['kind']) => highlights.filter((h) => h.kind === kind);

  return (
    <svg viewBox={`0 0 ${VB} ${VB}`} className="h-full w-full select-none" style={{ touchAction: 'manipulation' }} role="img" aria-label="board">
      <defs>
        {([['dk-light', ck.light], ['dk-dark', ck.dark]] as const).map(([id, c]) => (
          <radialGradient key={id} id={id} cx="0.38" cy="0.32" r="0.75">
            <stop offset="0" stopColor={c.stops[0]} /><stop offset="0.55" stopColor={c.stops[1]} /><stop offset="0.9" stopColor={c.stops[2]} /><stop offset="1" stopColor={c.stops[3]} />
          </radialGradient>
        ))}
        <radialGradient id="dk-shadow"><stop offset="0.55" stopColor="#000" stopOpacity="0.5" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <radialGradient id="dk-check"><stop offset="0" stopColor="#ff3b3b" stopOpacity="0.9" /><stop offset="1" stopColor="#ff3b3b" stopOpacity="0" /></radialGradient>
        <filter id="dk-drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2" dy="5" stdDeviation="4" floodOpacity="0.45" /></filter>
      </defs>
      <image href={`/board/${image}.webp`} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" />

      {/* coordinates in the frame */}
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} fill="#f3dca9" opacity={0.75} fontSize={22} fontWeight={700} textAnchor="middle" style={{ pointerEvents: 'none' }}>
          <text x={M + i * SQ + SQ / 2} y={VB - 12}>{FILES[flipped ? 7 - i : i]}</text>
          <text x={20} y={M + i * SQ + SQ / 2 + 8}>{flipped ? i + 1 : 8 - i}</text>
        </g>
      ))}

      {/* last move, selection, check */}
      {hl('last').map((h) => { const p = centre(h.sq, flipped); return <rect key={`l${h.sq}`} x={p.x - SQ / 2} y={p.y - SQ / 2} width={SQ} height={SQ} fill="#ffd36a" opacity={0.32} />; })}
      {hl('selected').map((h) => { const p = centre(h.sq, flipped); return <rect key={`s${h.sq}`} x={p.x - SQ / 2} y={p.y - SQ / 2} width={SQ} height={SQ} fill="#7fd36a" opacity={0.45} />; })}
      {hl('from').map((h) => { const p = centre(h.sq, flipped); return <rect key={`f${h.sq}`} x={p.x - SQ / 2 + 3} y={p.y - SQ / 2 + 3} width={SQ - 6} height={SQ - 6} fill="none" stroke="#ffd36a" strokeOpacity={0.7} strokeWidth={4} rx={6} className="nb-pulse" />; })}
      {hl('check').map((h) => { const p = centre(h.sq, flipped); return <circle key={`c${h.sq}`} cx={p.x} cy={p.y} r={SQ * 0.62} fill="url(#dk-check)" />; })}

      {/* pieces */}
      <AnimatePresence initial={false}>
        {placed.map(({ id, sq, piece, path }) => {
          const p = centre(sq, flipped);
          const hop = path ? path.map((s) => centre(s, flipped)) : null;
          return (
            <motion.g
              key={id}
              initial={{ x: p.x, y: p.y, opacity: 0, scale: 0.6 }}
              animate={hop ? { x: hop.map((h) => h.x), y: hop.map((h) => h.y), opacity: 1, scale: 1 } : { x: p.x, y: p.y, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.35, delay: 0.25 } }}
              transition={{ duration: hop ? 0.32 * (hop.length - 1) : 0.3, ease: [0.25, 0.8, 0.3, 1] }}
              style={{ pointerEvents: 'none' }}
            >
              {game === 'chess' ? <ChessPiece piece={piece} /> : <Draught piece={piece} colors={piece > 0 ? ck.light : ck.dark} />}
            </motion.g>
          );
        })}
      </AnimatePresence>

      {/* where the selected piece can go */}
      {hl('target').map((h) => { const p = centre(h.sq, flipped); return <circle key={`t${h.sq}`} cx={p.x} cy={p.y} r={SQ * 0.15} fill="#1b1209" opacity={0.45} style={{ pointerEvents: 'none' }} />; })}
      {hl('capture').map((h) => { const p = centre(h.sq, flipped); return <circle key={`x${h.sq}`} cx={p.x} cy={p.y} r={SQ * 0.44} fill="none" stroke="#1b1209" strokeOpacity={0.5} strokeWidth={9} style={{ pointerEvents: 'none' }} />; })}

      {/* tap targets */}
      {Array.from({ length: 64 }, (_, sq) => {
        const p = centre(sq, flipped);
        return <rect key={`h${sq}`} x={p.x - SQ / 2} y={p.y - SQ / 2} width={SQ} height={SQ} fill="transparent" onClick={() => onSquare(sq)} style={{ cursor: clickable.has(sq) ? 'pointer' : 'default' }} />;
      })}
      <style>{`.nb-pulse{animation:nbPulse 1.1s ease-in-out infinite}@keyframes nbPulse{0%,100%{opacity:.45}50%{opacity:1}}@media (prefers-reduced-motion: reduce){.nb-pulse{animation:none}}`}</style>
    </svg>
  );
}

const CODE = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
function ChessPiece({ piece }: { piece: number }) {
  const size = SQ * 0.92;
  return <image href={`/pieces/${piece > 0 ? 'w' : 'b'}${CODE[Math.abs(piece)]}.svg`} x={-size / 2} y={-size / 2} width={size} height={size} filter="url(#dk-drop)" />;
}

/** A draughts piece: a turned disc like the nardi checkers; a king carries a crown. */
function Draught({ piece, colors }: { piece: number; colors: CheckerColors }) {
  const R = SQ * 0.4;
  const king = Math.abs(piece) === 2;
  return (
    <g>
      <ellipse cx={4} cy={7} rx={R + 4} ry={R + 3} fill="url(#dk-shadow)" />
      {king && <circle cx={0} cy={5} r={R} fill={piece > 0 ? 'url(#dk-light)' : 'url(#dk-dark)'} stroke={colors.rim} strokeWidth={2} />}
      <circle cx={0} cy={king ? -3 : 0} r={R} fill={piece > 0 ? 'url(#dk-light)' : 'url(#dk-dark)'} stroke={colors.rim} strokeWidth={2} />
      <circle cx={0} cy={king ? -3 : 0} r={R * 0.78} fill="none" stroke={colors.groove} strokeWidth={2.5} />
      <circle cx={0} cy={king ? -3 : 0} r={R * 0.78 + 2} fill="none" stroke={colors.ridge} strokeWidth={1.2} />
      <circle cx={0} cy={king ? -3 : 0} r={R * 0.4} fill="none" stroke={colors.groove} strokeWidth={1.8} />
      {king && (
        <path d={`M ${-R * 0.42} ${R * 0.12 - 3} L ${-R * 0.5} ${-R * 0.32 - 3} L ${-R * 0.22} ${-R * 0.1 - 3} L 0 ${-R * 0.42 - 3} L ${R * 0.22} ${-R * 0.1 - 3} L ${R * 0.5} ${-R * 0.32 - 3} L ${R * 0.42} ${R * 0.12 - 3} Z`} fill="#e8b84a" stroke="#7a5212" strokeWidth={2} />
      )}
      <ellipse cx={-R * 0.3} cy={-R * 0.38 - (king ? 3 : 0)} rx={R * 0.42} ry={R * 0.26} fill="#fff" opacity={colors.shine * 0.35} />
    </g>
  );
}
