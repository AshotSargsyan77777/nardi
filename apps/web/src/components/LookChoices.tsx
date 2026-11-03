'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { TABLE_COLORS, applyLook, readLook } from '@/lib/look';

const SWATCH: Record<string, string> = { green: '#0d5e41', blue: '#124a7a', red: '#6e1b2a', black: '#23272f' };

/** Applies the saved look on every page. */
export function LookProvider() {
  useEffect(() => applyLook(readLook()), []);
  return null;
}

/** Table cloth colour (free). */
export function LookChoices({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [look, setLook] = useState<ReturnType<typeof readLook>>({ table: 'green', back: 'green' });
  useEffect(() => setLook(readLook()), []);
  const set = (next: typeof look) => {
    setLook(next);
    applyLook(next);
  };
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      <div>
        <div className="mb-1.5 text-xs text-white/50">{t('look.table')}</div>
        <div className="flex gap-2">
          {TABLE_COLORS.map((c) => (
            <button key={c} aria-label={c} onClick={() => set({ ...look, table: c })} className={`h-9 w-9 rounded-full ring-2 transition ${look.table === c ? 'ring-gold-400' : 'ring-white/10'}`} style={{ background: SWATCH[c] }} />
          ))}
        </div>
      </div>
    </div>
  );
}
