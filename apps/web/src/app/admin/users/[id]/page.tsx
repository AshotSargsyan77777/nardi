'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { useReasonDialog } from '@/components/admin';
import { Badge, Button, Coins, ErrorText, Field, Loading, PageTitle, Panel, StatusBadge, Toggle, inputCls } from '@/components/ui';
import { api, newId } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { me } = useApp();
  const { data: d, mutate } = useSWR<any>(`/admin/users/${id}`);
  const { ask, dialog } = useReasonDialog();
  const [adj, setAdj] = useState({ currency: 'FUN', amount: '', reason: '' });
  const [error, setError] = useState<unknown>(null);
  if (!d) return <Loading />;
  const u = d.user;
  const run = async (fn: () => Promise<any>) => {
    setError(null);
    try { await fn(); await mutate(); } catch (e) { setError(e); }
  };
  const isAdmin = me && ['ADMIN', 'SUPERADMIN'].includes(me.role);
  return (
    <div className="space-y-5">
      {dialog}
      <PageTitle sub={`${u.email} · ${u.id}`} action={<StatusBadge status={u.status} />}>{u.nickname}</PageTitle>
      <ErrorText error={error} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t('wallet.balance')}>
          <div className="flex gap-6 text-xl"><Coins amount={d.balances.FUN} currency="FUN" /></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm text-white/60">
            <span>{t('profile.rating')}: <b className="text-white">{u.rating}</b></span>
            <span>{t('profile.games')}: <b className="text-white">{u.gamesPlayed}</b></span>
            <span>{t('profile.wins')}: <b className="text-white">{u.wins}</b></span>
          </div>
          {isAdmin && (
            <div className="mt-4 rounded-xl bg-black/25 p-3">
              <div className="mb-2 text-sm font-bold">{t('admin.adjust')}</div>
              <div className="grid gap-2 sm:grid-cols-[100px_120px_1fr_auto]">
                <select className={inputCls} value={adj.currency} onChange={(e) => setAdj({ ...adj, currency: e.target.value })}><option>FUN</option></select>
                <input className={inputCls} type="number" placeholder="±" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
                <input className={inputCls} placeholder={t('admin.reason')} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                <Button variant="gold" disabled={!adj.amount || adj.reason.length < 5} onClick={() => run(async () => {
                  await api(`/admin/users/${id}/adjust`, { method: 'POST', body: { currency: adj.currency, amount: Number(adj.amount), reason: adj.reason, idempotencyKey: newId() } });
                  setAdj({ ...adj, amount: '', reason: '' });
                })}>{t('common.confirm')}</Button>
              </div>
              <p className="mt-2 text-xs text-white/40">{t('admin.adjustNote')}</p>
            </div>
          )}
        </Panel>
        <Panel title={t('admin.restrictions')}>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (u.status === 'ACTIVE'
              ? <Button variant="danger" onClick={async () => { const r = await ask(t('admin.block')); if (r) run(() => api(`/admin/users/${id}/block`, { method: 'POST', body: { reason: r } })); }}>{t('admin.block')}</Button>
              : <Button variant="emerald" onClick={() => run(() => api(`/admin/users/${id}/unblock`, { method: 'POST' }))}>{t('admin.unblock')}</Button>)}
            {u.avatar?.startsWith('photo:') && <Button variant="subtle" onClick={() => run(() => api(`/admin/users/${id}/remove-photo`, { method: 'POST' }))}>{t('profile.photoRemove')}</Button>}
            {me?.role === 'SUPERADMIN' && (
              <select className={`${inputCls} w-40`} value={u.role} onChange={(e) => run(() => api(`/admin/users/${id}/role`, { method: 'PATCH', body: { role: e.target.value } }))}>
                {['USER', 'SUPPORT', 'ADMIN', 'SUPERADMIN'].map((r) => <option key={r}>{r}</option>)}
              </select>
            )}
          </div>
          {u.blockedReason && <p className="mt-2 text-sm text-ruby-400">{u.blockedReason}</p>}
          <div className="mt-3 divide-y divide-white/5">
            {(['noStakes', 'chatBanned', 'noPurchases'] as const).map((k) => (
              <Toggle key={k} disabled={!isAdmin} label={k} checked={!!u.restrictions?.[k]} onChange={(v) => run(() => api(`/admin/users/${id}/restrictions`, { method: 'PATCH', body: { [k]: v } }))} />
            ))}
          </div>
          <Field label={t('admin.kyc')}>
            <select disabled={!isAdmin} className={inputCls} value={u.kycStatus} onChange={(e) => run(() => api(`/admin/users/${id}/kyc`, { method: 'PATCH', body: { status: e.target.value } }))}>
              {['NONE', 'PENDING', 'VERIFIED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </Panel>
      </div>
      <Panel title={t('wallet.history')}>
        <div className="overflow-x-auto"><table className="data"><thead><tr><th>{t('common.date')}</th><th>{t('common.type')}</th><th>{t('common.amount')}</th><th>{t('wallet.balance')}</th><th>Tx</th></tr></thead>
          <tbody>{d.ledger.items.map((e: any) => <tr key={e.id}><td className="whitespace-nowrap text-xs">{fmtDate(e.createdAt, locale)}</td><td>{e.type}{e.description ? <span className="ml-1 text-xs text-white/40">{e.description}</span> : null}</td><td><Coins amount={e.amount} currency={e.currency} signed /></td><td>{e.balanceAfter}</td><td className="font-mono text-[10px] text-white/30">{e.transactionId.slice(0, 8)}</td></tr>)}</tbody>
        </table></div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t('admin.matches')}>
          <ul className="space-y-1 text-sm">{d.matches.map((m: any) => <li key={m.id} className="flex justify-between gap-2"><a className="font-mono text-xs text-gold-200 hover:underline" href={`/admin/games/${m.id}`}>{m.id.slice(0, 8)}</a><span>{m.mode}</span><span>{m.scoreTeam0}:{m.scoreTeam1}</span>{m.result ? <StatusBadge status={m.result} /> : <StatusBadge status={m.status} />}</li>)}</ul>
        </Panel>
        <Panel title="Sessions">
          <ul className="space-y-1 text-xs text-white/60">{d.sessions.map((s: any) => <li key={s.id} className="flex justify-between gap-2"><span>{fmtDate(s.createdAt, locale)}</span><span>{s.ip}</span>{s.revokedAt ? <Badge>revoked</Badge> : <Badge color="green">active</Badge>}</li>)}</ul>
        </Panel>
        <Panel title={t('admin.flags')}>
          <ul className="space-y-1 text-xs">{d.flags.map((f: any) => <li key={f.id} className="flex justify-between gap-2"><span>{f.type}</span><span className="text-white/40">{fmtDate(f.createdAt, locale)}</span>{f.resolvedAt ? <Badge color="green">ok</Badge> : <Badge color="red">open</Badge>}</li>)}</ul>
        </Panel>
      </div>
    </div>
  );
}
