/** The NARDI emblem: two dice. */
export function LogoMark({ size = 40 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/emblem-160.png" width={size} height={size} alt="" aria-hidden="true" className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]" draggable={false} />;
}

export function Rosette({ cx, cy, r, fill, opacity = 1 }: { cx: number; cy: number; r: number; fill: string; opacity?: number }) {
  const s = r / 16;
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`} opacity={opacity}>
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d="M0 0 C 7 -3 11 -10 5 -16 C 3 -10 -1 -6 0 0 Z" fill={fill} transform={`rotate(${i * 45})`} />
      ))}
    </g>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <LogoMark size={compact ? 34 : 42} />
      {!compact && (
        <span className="leading-none">
          <span className="font-display text-[22px] font-extrabold tracking-[0.12em] text-[#f6ead0]">NARD</span>
          <span className="bg-gold-grad bg-clip-text font-display text-[22px] font-extrabold tracking-[0.12em] text-transparent">I</span>
        </span>
      )}
    </span>
  );
}
