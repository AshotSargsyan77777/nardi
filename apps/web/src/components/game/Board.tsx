'use client';
import { Board as BoardState, Move, Seat, Variant, relOf } from '@nardi/engine';

/**
 * The nardi board, drawn in SVG so it scales to any screen. Every player sees it from their own
 * side: their home is bottom-right and they move counter-clockwise (top-right → top-left →
 * bottom-left → bottom-right). Points, the bar and the off tray are big tap targets.
 */
const VW = 1000;
const VH = 720;
const M = 16;
const OFF_W = 64;
const BAR_W = 48;
const X0 = M;
const HALF = (VW - 2 * M - OFF_W - 8 - BAR_W) / 2; // width of one half (6 points)
const W = HALF / 6;
const R = W / 2 - 3;
const Y0 = M;
const Y1 = VH - M;
const TRI_H = (Y1 - Y0) * 0.41;
const BAR_X = X0 + HALF;
const OFF_X = VW - M - OFF_W;

const COLORS = {
  light: { fill: '#f4ead2', stroke: '#b9a57a', text: '#3b2f1a' },
  dark: { fill: '#2a1a14', stroke: '#c9a86a', text: '#f4ead2' },
};

/** Column (0..11, left → right) and row of a point, as the viewer sees it. */
function place(rel: number): { col: number; top: boolean } {
  return rel >= 13 ? { col: rel - 13, top: true } : { col: 12 - rel, top: false };
}
const colX = (col: number) => X0 + (col < 6 ? col * W : HALF + BAR_W + (col - 6) * W) + W / 2;

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
  onPick: (where: number | 'bar' | 'off') => void;
}

export function NardiBoard({ board, variant, viewer, sources, selected, targets, lastMoves, dice, onPick }: BoardProps) {
  const rel = (abs: number) => relOf(variant, viewer, abs);
  const colorOf = (seat: Seat) => (seat === 0 ? COLORS.light : COLORS.dark);
  const opp = (1 - viewer) as Seat;
  const lastTo = new Set(lastMoves.map((m) => m.to));
  const lastFrom = new Set(lastMoves.map((m) => m.from));

  const points = Array.from({ length: 24 }, (_, abs) => {
    const { col, top } = place(rel(abs));
    const n = board.points[abs];
    const owner: Seat | null = n > 0 ? 0 : n < 0 ? 1 : null;
    return { abs, col, top, count: Math.abs(n), owner };
  });

  const stack = (cx: number, top: boolean, count: number, seat: Seat, key: string, glow: boolean, maxH = (Y1 - Y0) / 2 - 14) => {
    const c = colorOf(seat);
    const step = count > 1 ? Math.min(2 * R + 1, (maxH - 2 * R) / (count - 1)) : 0;
    return Array.from({ length: count }, (_, i) => {
      const cy = top ? Y0 + R + 2 + i * step : Y1 - R - 2 - i * step;
      const last = i === count - 1;
      return (
        <g key={`${key}-${i}`}>
          <circle cx={cx} cy={cy} r={R} fill={c.fill} stroke={last && glow ? '#eabd55' : c.stroke} strokeWidth={last && glow ? 6 : 3} />
          <circle cx={cx} cy={cy} r={R * 0.62} fill="none" stroke={c.stroke} strokeWidth={2} opacity={0.6} />
          {last && count > 5 && <text x={cx} y={cy + 9} textAnchor="middle" fontSize={26} fontWeight={800} fill={c.text}>{count}</text>}
        </g>
      );
    });
  };

  const isSource = (w: number | 'bar') => sources.includes(w);
  const isTarget = (w: number | 'off') => targets.includes(w);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="h-full w-full select-none" style={{ touchAction: 'manipulation' }} role="img" aria-label="board">
      <defs>
        <linearGradient id="nb-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b3f1f" /><stop offset="1" stopColor="#3d220f" />
        </linearGradient>
        <linearGradient id="nb-felt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f5a3f" /><stop offset="1" stopColor="#0a4430" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={VW} height={VH} rx={26} fill="url(#nb-wood)" />
      <rect x={X0} y={Y0} width={HALF} height={Y1 - Y0} rx={8} fill="url(#nb-felt)" />
      <rect x={BAR_X + BAR_W} y={Y0} width={HALF} height={Y1 - Y0} rx={8} fill="url(#nb-felt)" />
      <rect x={BAR_X + 4} y={Y0} width={BAR_W - 8} height={Y1 - Y0} rx={6} fill="#2b170a" />
      <rect x={OFF_X} y={Y0} width={OFF_W} height={Y1 - Y0} rx={8} fill="#2b170a" />

      {/* points */}
      {points.map((p) => {
        const x = colX(p.col);
        const dark = p.col % 2 === (p.top ? 0 : 1);
        const tip = p.top ? Y0 + TRI_H : Y1 - TRI_H;
        const base = p.top ? Y0 : Y1;
        const target = isTarget(p.abs);
        return (
          <g key={p.abs}>
            <polygon points={`${x - W / 2 + 2},${base} ${x + W / 2 - 2},${base} ${x},${tip}`} fill={dark ? '#a3472f' : '#e8d6aa'} opacity={dark ? 0.95 : 0.85} />
            {target && <polygon points={`${x - W / 2 + 2},${base} ${x + W / 2 - 2},${base} ${x},${tip}`} fill="#eabd55" opacity={0.55} />}
            {(lastFrom.has(p.abs) || lastTo.has(p.abs)) && <circle cx={x} cy={p.top ? Y0 + TRI_H + 18 : Y1 - TRI_H - 18} r={6} fill={lastTo.has(p.abs) ? '#eabd55' : '#ffffff55'} />}
          </g>
        );
      })}

      {/* checkers */}
      {points.filter((p) => p.owner !== null).map((p) => stack(colX(p.col), p.top, p.count, p.owner!, `p${p.abs}`, selected === p.abs || (selected === null && isSource(p.abs))))}

      {/* the bar: my hit checkers below, the opponent's above */}
      {board.bar[viewer] > 0 && stack(BAR_X + BAR_W / 2, false, board.bar[viewer], viewer, 'barme', selected === 'bar' || (selected === null && isSource('bar')), 200)}
      {board.bar[opp] > 0 && stack(BAR_X + BAR_W / 2, true, board.bar[opp], opp, 'barop', false, 200)}

      {/* borne off: thin slabs in the tray */}
      {([viewer, opp] as Seat[]).map((s) => Array.from({ length: board.off[s] }, (_, i) => {
        const c = colorOf(s);
        const y = s === viewer ? Y1 - 6 - (i + 1) * 15 : Y0 + 6 + i * 15;
        return <rect key={`off${s}-${i}`} x={OFF_X + 8} y={y} width={OFF_W - 16} height={12} rx={3} fill={c.fill} stroke={c.stroke} strokeWidth={2} />;
      }))}
      {isTarget('off') && <rect x={OFF_X + 2} y={(Y0 + Y1) / 2} width={OFF_W - 4} height={(Y1 - Y0) / 2 - 2} rx={8} fill="#eabd55" opacity={0.45} />}

      {/* dice, on the viewer's right half */}
      {dice.length > 0 && (
        <g>
          {dice.map((d, i) => {
            const size = dice.length > 2 ? 54 : 70;
            const gap = 14;
            const total = dice.length * size + (dice.length - 1) * gap;
            const x = BAR_X + BAR_W + HALF / 2 - total / 2 + i * (size + gap);
            const y = (Y0 + Y1) / 2 - size / 2;
            return <Die key={i} x={x} y={y} size={size} value={d.value} used={d.used} />;
          })}
        </g>
      )}

      {/* tap targets (on top, invisible) */}
      {points.map((p) => {
        const x = colX(p.col) - W / 2;
        return <rect key={`hit${p.abs}`} x={x} y={p.top ? Y0 : (Y0 + Y1) / 2} width={W} height={(Y1 - Y0) / 2} fill="transparent" onClick={() => onPick(p.abs)} style={{ cursor: isSource(p.abs) || isTarget(p.abs) ? 'pointer' : 'default' }} />;
      })}
      <rect x={BAR_X} y={(Y0 + Y1) / 2} width={BAR_W} height={(Y1 - Y0) / 2} fill="transparent" onClick={() => onPick('bar')} />
      <rect x={OFF_X} y={Y0} width={OFF_W} height={Y1 - Y0} fill="transparent" onClick={() => onPick('off')} style={{ cursor: isTarget('off') ? 'pointer' : 'default' }} />
    </svg>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function Die({ x, y, size, value, used }: { x: number; y: number; size: number; value: number; used: boolean }) {
  return (
    <g opacity={used ? 0.3 : 1}>
      <rect x={x} y={y} width={size} height={size} rx={size * 0.18} fill="#fffaf0" stroke="#c9a86a" strokeWidth={3} />
      {PIPS[value]?.map(([px, py], i) => <circle key={i} cx={x + px * size} cy={y + py * size} r={size * 0.085} fill={value === 1 ? '#b3261e' : '#1a1a1a'} />)}
    </g>
  );
}
