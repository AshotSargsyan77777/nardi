'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Button, ErrorText, Field, inputCls, Loading, PageTitle, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

/** My clubs, start a new one, or join one with an invite code. */
export default function ClubsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useRequireAuth();
  const { data } = useSWR<{ items: any[]; emblems: string[] }>(me ? '/clubs' : null);
  const [name, setName] = useState('');
  const [emblem, setEmblem] = useState('🎲');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!me || !data) return <Loading />;
  const run = async (fn: () => Promise<{ id: string }>) => {
    setBusy(true); setErr(null);
    try { const r = await fn(); router.push(`/clubs/${r.id}`); } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <PageTitle sub={t('clubs.sub')}>🏘️ {t('clubs.title')}</PageTitle>
      {data.items.length > 0 && (
        <Panel title={t('clubs.mine')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.items.map((c) => (
              <Link key={c.id} href={`/clubs/${c.id}`} className="flex items-center gap-3 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10 hover:bg-black/35">
                <span className="text-3xl">{c.emblem}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-lg font-extrabold">{c.name}</div>
                  <div className="text-xs text-white/50">👥 {c.members}{c.role === 'OWNER' ? ` · 👑 ${t('clubs.owner')}` : ''}</div>
                </div>
                <span className="text-white/40">→</span>
              </Link>
            ))}
          </div>
        </Panel>
      )}
      <ErrorText error={err} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={`➕ ${t('clubs.create')}`}>
          <div className="space-y-3">
            <Field label={t('clubs.name')}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder={t('clubs.namePh')} /></Field>
            <div className="flex flex-wrap gap-1.5">
              {data.emblems.map((e) => <button key={e} onClick={() => setEmblem(e)} className={`grid h-10 w-10 place-items-center rounded-xl text-xl ring-2 ${emblem === e ? 'bg-gold-400/15 ring-gold-400' : 'bg-white/5 ring-white/10'}`}>{e}</button>)}
            </div>
            <Field label={t('clubs.description')}><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></Field>
            <Button variant="gold" className="w-full" loading={busy} disabled={name.trim().length < 3} onClick={() => run(() => api('/clubs', { method: 'POST', body: { name, emblem, description } }))}>{t('clubs.createBtn')}</Button>
          </div>
        </Panel>
        <Panel title={`🔑 ${t('clubs.joinTitle')}`}>
          <p className="mb-3 text-sm text-white/55">{t('clubs.joinText')}</p>
          <div className="flex gap-2">
            <input className={`${inputCls} font-mono uppercase tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="ABC123" />
            <Button variant="gold" loading={busy} disabled={code.length !== 6} onClick={() => run(() => api(`/clubs/invite/${code}/join`, { method: 'POST' }))}>{t('clubs.joinBtn')}</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
