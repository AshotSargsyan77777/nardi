const AVATARS: Record<string, { icon: string; bg: string }> = {
  pomegranate: { icon: '🍎', bg: 'from-ruby-500 to-ruby-600' },
  apricot: { icon: '🍑', bg: 'from-orange-400 to-amber-600' },
  ararat: { icon: '🏔️', bg: 'from-sky-400 to-indigo-700' },
  eagle: { icon: '🦅', bg: 'from-amber-500 to-yellow-800' },
  lion: { icon: '🦁', bg: 'from-yellow-400 to-orange-700' },
  grapes: { icon: '🍇', bg: 'from-purple-500 to-fuchsia-800' },
  sun: { icon: '☀️', bg: 'from-yellow-300 to-orange-500' },
  star: { icon: '⭐', bg: 'from-indigo-500 to-violet-800' },
  knight: { icon: '♞', bg: 'from-slate-500 to-slate-800' },
  queen: { icon: '♛', bg: 'from-rose-400 to-rose-700' },
  ace: { icon: '🎲', bg: 'from-emerald-500 to-emerald-800' },
  jack: { icon: '🏺', bg: 'from-teal-400 to-cyan-800' },
  bot: { icon: '🤖', bg: 'from-zinc-500 to-zinc-700' },
};
export const AVATAR_KEYS = Object.keys(AVATARS).filter((k) => k !== 'bot');

export function Avatar({ name, size = 40, ring }: { name?: string | null; size?: number; ring?: string }) {
  // an uploaded profile photo: "photo:<id>"
  if (name?.startsWith('photo:')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/avatars/${encodeURIComponent(name.slice(6))}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={`inline-block shrink-0 rounded-full bg-ink-800 object-cover shadow-card ${ring ?? 'ring-2 ring-white/10'}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const a = AVATARS[name ?? ''] ?? AVATARS.pomegranate;
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${a.bg} shadow-card ${ring ?? 'ring-2 ring-white/10'}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      <span className="leading-none text-white drop-shadow">{a.icon}</span>
    </span>
  );
}
