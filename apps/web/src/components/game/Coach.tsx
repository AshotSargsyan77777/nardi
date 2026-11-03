'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

const KEY = 'bb_tips';
export const TIP_IDS = ['roll', 'move', 'bearoff', 'result'] as const;
export type TipId = (typeof TIP_IDS)[number];

function load(): { seen: string[]; off: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { seen: Array.isArray(v.seen) ? v.seen : [], off: v.off === true };
  } catch {
    return { seen: [], off: false };
  }
}
function save(v: { seen: string[]; off: boolean }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** Show the beginner tips again (the «learn to play» game). */
export function resetTips() {
  save({ seen: [], off: false });
}

/**
 * Beginner tips: one short explanation the first time each moment comes up
 * (the first roll, the first move, bearing off, a game's result).
 */
export function Coach({ moment }: { moment: TipId | null }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ seen: string[]; off: boolean } | null>(null);
  useEffect(() => setState(load()), []);
  if (!state || state.off || !moment || state.seen.includes(moment)) return null;
  const close = (all = false) => {
    const next = { seen: [...state.seen, moment], off: all };
    save(next);
    setState(next);
  };
  return (
    <AnimatePresence>
      <motion.div
        key={moment}
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="absolute left-1/2 top-14 z-[60] w-[340px] max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-2xl bg-ink-850/95 p-3 text-sm shadow-2xl ring-1 ring-gold-400/40"
      >
        <div className="mb-1 font-bold text-gold-200">🎓 {t(`tip.${moment}.title`)}</div>
        <p className="leading-snug text-white/80">{t(`tip.${moment}`)}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={() => close(true)} className="rounded-lg px-2 py-1 text-xs text-white/45">{t('tip.skipAll')}</button>
          <button onClick={() => close()} className="rounded-lg bg-gold-grad px-3 py-1 text-xs font-bold text-ink-950">{t('tip.ok')}</button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
