'use client';
import { useState } from 'react';
import { Button, ErrorText, Field, Modal, inputCls } from './ui';
import { useI18n } from '@/lib/i18n';

/** Promise-based dialog asking for a mandatory reason (every admin change is audited with it). */
export function useReasonDialog() {
  const { t } = useI18n();
  const [state, setState] = useState<{ title: string; resolve: (v: string | null) => void; extra?: string } | null>(null);
  const [text, setText] = useState('');
  const ask = (title: string, extra?: string) => new Promise<string | null>((resolve) => { setText(''); setState({ title, resolve, extra }); });
  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const dialog = (
    <Modal open={!!state} onClose={() => close(null)} title={state?.title}>
      <Field label={state?.extra ?? t('admin.reason')}><textarea autoFocus className={`${inputCls} h-24 py-2`} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="subtle" onClick={() => close(null)}>{t('common.cancel')}</Button>
        <Button variant="gold" disabled={text.trim().length < 3} onClick={() => close(text.trim())}>{t('common.confirm')}</Button>
      </div>
    </Modal>
  );
  return { ask, dialog };
}

export function Kpi({ label, value, sub, accent = 'text-white' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-ink-800 to-ink-900 p-4 ring-1 ring-white/[0.07]">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/45">{label}</div>
      <div className={`mt-1 font-display text-2xl font-extrabold ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/45">{sub}</div>}
    </div>
  );
}

/** JSON editor for structured settings; the server validates and rejects bad values. */
export function JsonEditor({ value, onSave }: { value: unknown; onSave: (v: unknown) => Promise<void> }) {
  const { t } = useI18n();
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <textarea className="h-72 w-full rounded-xl border border-white/10 bg-ink-950/70 p-3 font-mono text-xs text-white/85 outline-none focus:border-gold-400/50" value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} spellCheck={false} />
      <p className="mt-1 text-xs text-white/40">{t('admin.jsonHint')}</p>
      <ErrorText error={error} />
      <Button className="mt-2" variant="gold" size="sm" onClick={async () => {
        setError(null);
        try { await onSave(JSON.parse(text)); setSaved(true); } catch (e) { setError(e); }
      }}>{saved ? `✓ ${t('common.saved')}` : t('common.save')}</Button>
    </div>
  );
}
