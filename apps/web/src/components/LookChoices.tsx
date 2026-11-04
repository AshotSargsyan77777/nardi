'use client';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { BOARDS, CHECKERS, readLook, saveLook, useLook } from '@/lib/look';

/** Kept for the layout: looks are read where they are drawn, nothing to apply globally. */
export function LookProvider() {
  return null;
}

/** Board and checker choice. Locked ones show the level that opens them. */
export function LookChoices({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { me } = useApp();
  const level = me?.level ?? 1;
  const look = useLook();
  const pick = (patch: Partial<typeof look>) => saveLook({ ...readLook(), ...patch });
  const lockBadge = (need: number) => (
    <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/60 text-[10px] font-bold text-white/85">🔒 {need}</span>
  );
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      <div>
        <div className="mb-1.5 text-xs text-white/50">{t('look.board')}</div>
        <div className="flex flex-wrap gap-2">
          {BOARDS.map((b) => {
            const locked = b.level > level;
            const on = look.board === b.id;
            return (
              <button
                key={b.id}
                title={locked ? t('look.unlockAt', { n: b.level }) : t(`look.board.${b.id}`)}
                disabled={locked}
                onClick={() => pick({ board: b.id })}
                className={`relative h-10 w-14 overflow-hidden rounded-lg ring-2 transition ${on ? 'ring-gold-400' : 'ring-white/10'}`}
                style={{ background: b.swatch[0] }}
              >
                <span className="absolute inset-[5px] rounded" style={{ background: b.swatch[1] }} />
                <span className="absolute bottom-[5px] left-[10px] h-0 w-0 border-x-[5px] border-b-[18px] border-x-transparent" style={{ borderBottomColor: b.swatch[2] }} />
                <span className="absolute bottom-[5px] right-[10px] h-0 w-0 border-x-[5px] border-b-[18px] border-x-transparent" style={{ borderBottomColor: b.swatch[2] }} />
                {locked && lockBadge(b.level)}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs text-white/50">{t('look.checkers')}</div>
        <div className="flex flex-wrap gap-2">
          {CHECKERS.map((c) => {
            const locked = c.level > level;
            const on = look.checkers === c.id;
            const disc = (x: typeof c.light) => (
              <span className="h-6 w-6 rounded-full" style={{ background: `radial-gradient(circle at 38% 32%, ${x.stops[0]}, ${x.stops[1]} 55%, ${x.stops[2]} 90%, ${x.stops[3]})`, boxShadow: `0 0 0 1px ${x.rim}` }} />
            );
            return (
              <button
                key={c.id}
                title={locked ? t('look.unlockAt', { n: c.level }) : t(`look.checkers.${c.id}`)}
                disabled={locked}
                onClick={() => pick({ checkers: c.id })}
                className={`relative flex h-10 items-center gap-0.5 rounded-full bg-white/5 px-2 ring-2 transition ${on ? 'ring-gold-400' : 'ring-white/10'}`}
              >
                {disc(c.light)}
                {disc(c.dark)}
                {locked && lockBadge(c.level)}
              </button>
            );
          })}
        </div>
      </div>
      {!compact && <p className="text-xs text-white/40">{t('look.levelHint')}</p>}
    </div>
  );
}
