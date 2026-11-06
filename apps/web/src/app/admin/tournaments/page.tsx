'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { tourneyName } from '@/app/tournaments/shared';
import { Badge, Button, ErrorText, Field, inputCls, Loading, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const inHour = () => {
  const d = new Date(Date.now() + 3600_000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Create and cancel tournaments. The daily one is configured in Platform → game → tournaments. */
export default function AdminTournaments() {
  const { t } = useI18n();
  const { data, mutate } = useSWR<any>('/tournaments');
  const [f, setF] = useState({ name: '', variant: 'short', targetScore: 3, maxPlayers: 16, prizes: '5000, 2500, 1000', startsAt: inHour(), minPlayers: 4 });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/admin/tournaments', { method: 'POST', body: {
        name: f.name, variant: f.variant, targetScore: Number(f.targetScore), maxPlayers: Number(f.maxPlayers), minPlayers: Number(f.minPlayers),
        prizes: f.prizes.split(/[,\s]+/).filter(Boolean).map(Number), startsAt: new Date(f.startsAt).toISOString(),
      } });
      setF({ ...f, name: '' });
      await mutate();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const cancel = async (id: string) => {
    if (!confirm(t('admin.tourneyCancel') + '?')) return;
    try { await api(`/admin/tournaments/${id}/cancel`, { method: 'POST' }); await mutate(); } catch (e) { setErr(e); }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-5">
      <Panel title={t('admin.tourneyCreate')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.tourneyName')}><input className={inputCls} value={f.name} onChange={set('name')} maxLength={60} /></Field>
          <Field label={t('admin.tourneyStarts')}><input className={inputCls} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} /></Field>
          <Field label={t('friends.variant')}><select className={inputCls} value={f.variant} onChange={set('variant')}>{['short', 'long', 'checkers', 'chess'].map((k) => <option key={k} value={k}>{t(`variant.${k}`)}</option>)}</select></Field>
          <Field label={t('friends.targetScore')}><select className={inputCls} value={f.targetScore} onChange={set('targetScore')}>{[1, 3, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label={t('admin.tourneyMax')}><select className={inputCls} value={f.maxPlayers} onChange={set('maxPlayers')}>{[4, 8, 16, 32].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label={t('admin.tourneyPrizes')}><input className={inputCls} value={f.prizes} onChange={set('prizes')} /></Field>
        </div>
        <ErrorText error={err} />
        <Button variant="gold" className="mt-3" onClick={create} loading={busy} disabled={f.name.trim().length < 2}>{t('admin.tourneyCreate')}</Button>
      </Panel>
      <Panel title={t('admin.tournaments')}>
        {!data ? <Loading /> : (
          <div className="space-y-2">
            {[...data.open, ...data.recent].map((x: any) => (
              <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-black/20 px-3 py-2 text-sm">
                <Link href={`/tournaments/${x.id}`} className="flex-1 font-semibold hover:underline">{tourneyName(x, t)}</Link>
                <span className="text-xs text-white/50">{x.startsAt ? new Date(x.startsAt).toLocaleString() : ''} · 👥 {x.players}/{x.maxPlayers}</span>
                <Badge color={x.status === 'RUNNING' ? 'red' : x.status === 'FINISHED' ? 'gold' : 'blue'}>{x.status}</Badge>
                {(x.status === 'REGISTRATION' || x.status === 'RUNNING') && <Button size="sm" variant="danger" onClick={() => cancel(x.id)}>{t('admin.tourneyCancel')}</Button>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
