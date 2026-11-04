'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Board as BoardState, Move, Seat, Variant, relOf } from '@nardi/engine';

/**
 * The nardi board. The wooden board itself is a pre-rendered image (scripts/board-texture.mjs);
 * the SVG on top draws the checkers, dice and highlights. Every player sees the board from their
 * own side: their home is bottom-right and they move counter-clockwise.
 *
 * Checkers keep a stable identity between renders, so when the board changes each moved checker
 * slides from where it was to where it went (hits fly to the bar, bear-offs into the tray).
 */
// geometry: keep in sync with scripts/board-texture.mjs
const VW = 1000;
const VH = 720;
const M = 24;
const OFF_W = 62;
const BAR_W = 46;
const GAP = 10;
const X0 = M;
const HALF = (VW - 2 * M - OFF_W - GAP - BAR_W) / 2;
const W = HALF / 6;
const R = W / 2 - 3;
const Y0 = M;
const Y1 = VH - M;
const MID = (Y0 + Y1) / 2;
const TRI_H = (Y1 - Y0) * 0.42;
const BAR_X = X0 + HALF;
const OFF_X = VW - M - OFF_W;

/** Column (0..11, left → right) and row of a point, as the viewer sees it. */
function place(rel: number): { col: number; top: boolean } {
  return rel >= 13 ? { col: rel - 13, top: true } : { col: 12 - rel, top: false };
}
const colX = (col: number) => X0 + (col < 6 ? col * W : HALF + BAR_W + (col - 6) * W) + W / 2;

type Loc = number | 'bar' | 'off';

export interface BoardProps {
  board: BoardState;
  variant: Variant;
  /** Whose side the board is seen from. */
  viewer: Seat;
  /** Points (absolute 0..23) or 'bar' the player may move from now. */
  sources: (number | 'bar')[];
  selected: number | 'bar' | null;
  /** Where the selected checker may go. */
  targets: (number | 'off')[];
  /** The opponent's last steps, to show where checkers came from and went. */
  lastMoves: Move[];
  dice: { value: number; used: boolean }[];
  /** Changes on every new roll (null when the dice shown are an old roll): starts the roll animation. */
  rollKey?: string | null;
  onPick: (where: number | 'bar' | 'off') => void;
}

interface Slot { seat: Seat; loc: Loc; i: number; n: number }
const slotKey = (s: { seat: Seat; loc: Loc; i: number }) => `${s.seat}:${s.loc}:${s.i}`;

function slotsOf(b: BoardState): Slot[] {
  const out: Slot[] = [];
  for (let abs = 0; abs < 24; abs++) {
    const v = b.points[abs];
    const n = Math.abs(v);
    for (let i = 0; i < n; i++) out.push({ seat: v > 0 ? 0 : 1, loc: abs, i, n });
  }
  for (const seat of [0, 1] as Seat[]) {
    for (let i = 0; i < b.bar[seat]; i++) out.push({ seat, loc: 'bar', i, n: b.bar[seat] });
    for (let i = 0; i < b.off[seat]; i++) out.push({ seat, loc: 'off', i, n: b.off[seat] });
  }
  return out;
}

/**
 * Gives every checker a stable id: checkers that stay put keep theirs, and for each colour the
 * checkers that left a place are matched, in order of progress, with the places that got one.
 */
function useCheckerIds(board: BoardState, variant: Variant) {
  const ref = useRef<{ board: BoardState; ids: Map<string, number>; next: number; movers: Map<number, number> } | null>(null);
  return useMemo(() => {
    const prev = ref.current;
    if (prev && prev.board === board) return prev;
    const slots = slotsOf(board);
    const ids = new Map<string, number>();
    const movers = new Map<number, number>();
    let next = prev?.next ?? 0;
    if (!prev) {
      for (const s of slots) ids.set(slotKey(s), next++);
    } else {
      const progress = (seat: Seat, loc: Loc) => (loc === 'bar' ? 0 : loc === 'off' ? 25 : 25 - relOf(variant, seat, loc));
      const parse = (k: string) => {
        const [seat, loc, i] = k.split(':');
        return { seat: Number(seat) as Seat, loc: (loc === 'bar' || loc === 'off' ? loc : Number(loc)) as Loc, i: Number(i) };
      };
      const fresh = new Set(slots.map(slotKey));
      for (const seat of [0, 1] as Seat[]) {
        const freed = [...prev.ids.keys()].filter((k) => !fresh.has(k)).map(parse).filter((s) => s.seat === seat)
          .sort((a, b) => progress(seat, a.loc) - progress(seat, b.loc) || a.i - b.i);
        const added = slots.filter((s) => s.seat === seat && !prev.ids.has(slotKey(s)))
          .sort((a, b) => progress(seat, a.loc) - progress(seat, b.loc) || a.i - b.i);
        added.forEach((s, j) => {
          const from = freed[j];
          const id = from ? prev.ids.get(slotKey(from))! : next++;
          ids.set(slotKey(s), id);
          movers.set(id, j);
        });
      }
      for (const s of slots) {
        const k = slotKey(s);
        if (!ids.has(k)) ids.set(k, prev.ids.get(k) ?? next++);
      }
    }
    const res = { board, ids, next, movers };
    ref.current = res;
    return res;
  }, [board, variant]);
}

export function NardiBoard({ board, variant, viewer, sources, selected, targets, lastMoves, dice, rollKey = null, onPick }: BoardProps) {
  const rel = (abs: number) => relOf(variant, viewer, abs);
  const opp = (1 - viewer) as Seat;
  const lastTo = new Set(lastMoves.map((m) => m.to));
  const lastFrom = new Set(lastMoves.map((m) => m.from));
  const { ids, movers } = useCheckerIds(board, variant);

  const isSource = (w: number | 'bar') => sources.includes(w);
  const isTarget = (w: number | 'off') => targets.includes(w);

  /** Centre of the i-th checker of a stack of n. */
  const stackPos = (cx: number, top: boolean, i: number, n: number, maxH = (Y1 - Y0) / 2 - 12) => {
    const step = n > 1 ? Math.min(2 * R + 1, (maxH - 2 * R) / (n - 1)) : 0;
    return { x: cx, y: top ? Y0 + R + 3 + i * step : Y1 - R - 3 - i * step };
  };
  const posOf = (s: Slot) => {
    if (s.loc === 'bar') {
      const mine = s.seat === viewer;
      return stackPos(BAR_X + BAR_W / 2, !mine, s.i, s.n, 210);
    }
    if (s.loc === 'off') {
      const mine = s.seat === viewer;
      const y = mine ? Y1 - 16 - s.i * 14 : Y0 + 16 + s.i * 14;
      return { x: OFF_X + OFF_W / 2, y };
    }
    const { col, top } = place(rel(s.loc));
    return stackPos(colX(col), top, s.i, s.n);
  };

  const slots = slotsOf(board);
  const checkers = slots.map((s) => {
    const id = ids.get(slotKey(s))!;
    const p = posOf(s);
    const topOfStack = s.i === s.n - 1;
    const glow = topOfStack && s.seat === viewer && (selected !== null ? selected === s.loc : s.loc !== 'off' && isSource(s.loc));
    return { id, s, p, glow, chosen: topOfStack && selected === s.loc && s.seat === viewer, moving: movers.get(id) };
  });
  // moving checkers are drawn last so they fly over the others
  checkers.sort((a, b) => (a.moving === undefined ? 0 : 1) - (b.moving === undefined ? 0 : 1));

  const points = Array.from({ length: 24 }, (_, abs) => ({ abs, ...place(rel(abs)) }));
  const tri = (col: number, top: boolean) => {
    const x = colX(col);
    const base = top ? Y0 : Y1;
    const tip = top ? Y0 + TRI_H : Y1 - TRI_H;
    return `${x - W / 2 + 3},${base} ${x + W / 2 - 3},${base} ${x},${tip}`;
  };

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-full w-full select-none" style={{ touchAction: 'manipulation' }} role="img" aria-label="board">
      <defs>
        <radialGradient id="ck-light" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="0.55" stopColor="#efe4cc" />
          <stop offset="0.9" stopColor="#cdbb93" />
          <stop offset="1" stopColor="#a8936a" />
        </radialGradient>
        <radialGradient id="ck-dark" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#5a5148" />
          <stop offset="0.5" stopColor="#2a2420" />
          <stop offset="0.92" stopColor="#141110" />
          <stop offset="1" stopColor="#070606" />
        </radialGradient>
        <radialGradient id="ck-shadow">
          <stop offset="0.55" stopColor="#000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ck-shine" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="die-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f6f0e2" />
          <stop offset="1" stopColor="#d9cfb8" />
        </linearGradient>
        <radialGradient id="die-pip" cx="0.4" cy="0.35" r="0.65">
          <stop offset="0" stopColor="#4a4038" />
          <stop offset="1" stopColor="#0e0b09" />
        </radialGradient>
        <radialGradient id="die-pip-red" cx="0.4" cy="0.35" r="0.65">
          <stop offset="0" stopColor="#d2463a" />
          <stop offset="1" stopColor="#7a120c" />
        </radialGradient>
      </defs>

      <image href="/board/board.webp" x={0} y={0} width={VW} height={VH} preserveAspectRatio="none" />

      {/* where the selected checker can go */}
      {points.map((p) => isTarget(p.abs) && (
        <polygon key={`t${p.abs}`} points={tri(p.col, p.top)} fill="#ffd36a" opacity={0.38} className="nb-pulse" />
      ))}
      {points.map((p) => {
        if (!isTarget(p.abs)) return null;
        const n = Math.abs(board.points[p.abs]);
        const mineHere = board.points[p.abs] !== 0 && (board.points[p.abs] > 0 ? 0 : 1) === viewer;
        const pos = stackPos(colX(p.col), p.top, mineHere ? n : 0, mineHere ? n + 1 : 1);
        return <circle key={`g${p.abs}`} cx={pos.x} cy={pos.y} r={R - 2} fill="#ffe7a6" fillOpacity={0.18} stroke="#ffd36a" strokeWidth={3} strokeDasharray="7 6" />;
      })}
      {isTarget('off') && <rect x={OFF_X + 3} y={MID + 3} width={OFF_W - 6} height={(Y1 - Y0) / 2 - 6} rx={7} fill="#ffd36a" opacity={0.35} className="nb-pulse" />}

      {/* the opponent's last move */}
      {points.map((p) => (lastFrom.has(p.abs) || lastTo.has(p.abs)) && (
        <circle key={`l${p.abs}`} cx={colX(p.col)} cy={p.top ? Y0 + TRI_H + 16 : Y1 - TRI_H - 16} r={5} fill={lastTo.has(p.abs) ? '#ffd36a' : '#ffffff'} opacity={lastTo.has(p.abs) ? 0.9 : 0.45} />
      ))}

      {/* checkers */}
      {checkers.map(({ id, s, p, glow, chosen, moving }) => {
        const inTray = s.loc === 'off';
        return (
          <motion.g
            key={id}
            initial={false}
            animate={{ x: p.x, y: p.y, scaleX: inTray ? 0.82 : 1, scaleY: inTray ? 0.3 : 1 }}
            transition={{ duration: moving !== undefined ? 0.48 : 0.25, delay: moving !== undefined ? moving * 0.16 : 0, ease: [0.25, 0.8, 0.3, 1] }}
            style={{ pointerEvents: 'none' }}
          >
            <Checker seat={s.seat} glow={glow} chosen={chosen} />
            {s.i === s.n - 1 && s.n > 5 && !inTray && (
              <text x={0} y={9} textAnchor="middle" fontSize={25} fontWeight={800} fill={s.seat === 0 ? '#3b2f1a' : '#f4ead2'}>{s.n}</text>
            )}
          </motion.g>
        );
      })}
      {/* borne-off counters */}
      {([viewer, opp] as Seat[]).map((s) => board.off[s] > 0 && (
        <text key={`oc${s}`} x={OFF_X + OFF_W / 2} y={s === viewer ? MID + 30 : MID - 14} textAnchor="middle" fontSize={20} fontWeight={800} fill="#f3dca9" opacity={0.8}>{board.off[s]}</text>
      ))}

      <Dice dice={dice} rollKey={rollKey} />

      {/* tap targets (on top, invisible) */}
      {points.map((p) => (
        <rect key={`hit${p.abs}`} x={colX(p.col) - W / 2} y={p.top ? Y0 : MID} width={W} height={(Y1 - Y0) / 2} fill="transparent" onClick={() => onPick(p.abs)} style={{ cursor: isSource(p.abs) || isTarget(p.abs) ? 'pointer' : 'default' }} />
      ))}
      <rect x={BAR_X} y={MID} width={BAR_W} height={(Y1 - Y0) / 2} fill="transparent" onClick={() => onPick('bar')} />
      <rect x={OFF_X} y={Y0} width={OFF_W} height={Y1 - Y0} fill="transparent" onClick={() => onPick('off')} style={{ cursor: isTarget('off') ? 'pointer' : 'default' }} />
      <style>{`
        .nb-pulse { animation: nbPulse 1.1s ease-in-out infinite; }
        @keyframes nbPulse { 0%, 100% { opacity: .22 } 50% { opacity: .5 } }
        @media (prefers-reduced-motion: reduce) { .nb-pulse { animation: none } }
      `}</style>
    </svg>
  );
}

/** One checker, drawn around (0, 0): soft shadow, turned body with grooves and a highlight. */
function Checker({ seat, glow, chosen }: { seat: Seat; glow: boolean; chosen: boolean }) {
  const light = seat === 0;
  const rim = light ? '#8d7a52' : '#000';
  const groove = light ? 'rgba(90,70,35,.35)' : 'rgba(0,0,0,.65)';
  const ridge = light ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.13)';
  return (
    <g>
      <ellipse cx={3} cy={6} rx={R + 3} ry={R + 2} fill="url(#ck-shadow)" />
      <circle r={R} fill={light ? 'url(#ck-light)' : 'url(#ck-dark)'} stroke={rim} strokeWidth={1.5} />
      <circle r={R * 0.8} fill="none" stroke={groove} strokeWidth={2} />
      <circle r={R * 0.8 + 1.6} fill="none" stroke={ridge} strokeWidth={1} />
      <circle r={R * 0.42} fill="none" stroke={groove} strokeWidth={1.4} />
      <circle r={R * 0.42 + 1.3} fill="none" stroke={ridge} strokeWidth={0.8} />
      <ellipse cx={-R * 0.3} cy={-R * 0.38} rx={R * 0.42} ry={R * 0.26} fill="url(#ck-shine)" opacity={light ? 0.9 : 0.5} />
      {(glow || chosen) && (
        <circle r={R + 2} fill="none" stroke="#ffd36a" strokeWidth={chosen ? 6 : 4} className={chosen ? undefined : 'nb-pulse'} style={chosen ? { filter: 'drop-shadow(0 0 6px #ffd36a)' } : undefined} />
      )}
    </g>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

/**
 * The dice on the viewer's right half. On a new roll they tumble in from the side, showing random
 * faces until they settle on the real ones.
 */
function Dice({ dice, rollKey }: { dice: { value: number; used: boolean }[]; rollKey: string | null }) {
  const mounted = useRef(false);
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<number[]>([]);
  const animate = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!rollKey) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    animate.current = true;
    setRolling(true);
    const tick = setInterval(() => setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 75);
    const done = setTimeout(() => { clearInterval(tick); setRolling(false); }, 700);
    return () => { clearInterval(tick); clearTimeout(done); setRolling(false); };
  }, [rollKey]);

  if (!dice.length) return null;
  // while rolling show the two physical dice; doubles split into four only once they land
  const shown = rolling ? [0, 1].map((i) => ({ value: faces[i] ?? dice[i]?.value ?? 1, used: false })) : dice;
  const size = shown.length > 2 ? 56 : 72;
  const gap = 16;
  const total = shown.length * size + (shown.length - 1) * gap;
  const cx = BAR_X + BAR_W + HALF / 2;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {shown.map((d, i) => {
        const x = cx - total / 2 + i * (size + gap) + size / 2;
        const y = MID;
        const tilt = rolling ? 0 : ((i % 2 ? 1 : -1) * (4 + i * 2));
        const fromRoll = animate.current && rolling;
        return (
          <motion.g
            key={`${rollKey ?? 'old'}-${rolling ? 'r' : 's'}-${i}-${shown.length}`}
            initial={fromRoll ? { x: x + 230 + i * 30, y: y - 150 + i * 120, rotate: 300 + i * 140, scale: 0.75 } : rolling || !animate.current ? false : { x, y, rotate: tilt * 3, scale: 1.08 }}
            animate={{ x, y, rotate: tilt, scale: 1, opacity: d.used ? 0.35 : 1 }}
            transition={fromRoll ? { duration: 0.7, ease: [0.15, 0.9, 0.3, 1] } : { type: 'spring', stiffness: 420, damping: 18 }}
          >
            <Die size={size} value={d.value} />
          </motion.g>
        );
      })}
    </g>
  );
}

function Die({ size, value }: { size: number; value: number }) {
  const h = size / 2;
  return (
    <g>
      <rect x={-h + 4} y={-h + 7} width={size} height={size} rx={size * 0.2} fill="#000" opacity={0.35} style={{ filter: 'blur(3px)' }} />
      <rect x={-h} y={-h} width={size} height={size} rx={size * 0.2} fill="url(#die-face)" stroke="#a8997a" strokeWidth={1.2} />
      <rect x={-h + 3} y={-h + 3} width={size - 6} height={size - 6} rx={size * 0.17} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.4} />
      {PIPS[value]?.map(([px, py], i) => (
        <g key={i}>
          <circle cx={-h + px * size} cy={-h + py * size + 0.8} r={size * 0.088} fill="#fff" opacity={0.7} />
          <circle cx={-h + px * size} cy={-h + py * size} r={size * 0.085} fill={value === 1 ? 'url(#die-pip-red)' : 'url(#die-pip)'} />
        </g>
      ))}
    </g>
  );
}
