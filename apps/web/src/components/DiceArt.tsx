const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

function Die({ n, rotate }: { n: number; rotate: number }) {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]" style={{ transform: `rotate(${rotate}deg)` }}>
      <rect x={4} y={4} width={92} height={92} rx={18} fill="#fffaf0" stroke="#c9a86a" strokeWidth={4} />
      {PIPS[n].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={8.5} fill={n === 1 ? '#b3261e' : '#1a1a1a'} />)}
    </svg>
  );
}

/** Two dice, for the lobby and empty states. */
export function DiceArt({ a, b, small = false }: { a: number; b: number; small?: boolean }) {
  const s = small ? 'h-12 w-12 short:h-9 short:w-9' : 'h-20 w-20 short:h-12 short:w-12';
  return (
    <span className="flex items-end gap-2">
      <span className={s}><Die n={a} rotate={-12} /></span>
      <span className={`${s} -mb-2`}><Die n={b} rotate={9} /></span>
    </span>
  );
}
