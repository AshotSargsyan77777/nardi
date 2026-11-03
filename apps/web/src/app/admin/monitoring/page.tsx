'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { useReasonDialog } from '@/components/admin';
import { Badge, Button, Empty, Loading, PageTitle, Pager, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminMonitoring() {
  const { t, locale } = useI18n();
  const [auditPage, setAuditPage] = useState(1);
  const { data: flags, mutate } = useSWR<any>('/admin/flags?pageSize=50');
  const { data: errors } = useSWR<any>('/admin/errors?pageSize=30');
  const { data: audit } = useSWR<any>(`/admin/audit?page=${auditPage}&pageSize=30`);
  const [chain, setChain] = useState<any>(null);
  const { ask, dialog } = useReasonDialog();
  if (!flags || !errors || !audit) return <Loading />;
  return (
    <div className="space-y-5">
      {dialog}
      <PageTitle>{t('admin.monitoring')}</PageTitle>
      <Panel title={`⚠️ ${t('admin.flags')} (${flags.total})`}>
        {!flags.items.length ? <Empty /> : (
          <div className="overflow-x-auto"><table className="data"><thead><tr><th>{t('common.date')}</th><th>Type</th><th>Severity</th><th>{t('common.details')}</th><th /></tr></thead>
            <tbody>{flags.items.map((f: any) => (
              <tr key={f.id}>
                <td className="whitespace-nowrap text-xs">{fmtDate(f.createdAt, locale)}</td><td className="font-semibold">{f.type}</td>
                <td><Badge color={f.severity === 'high' ? 'red' : 'gold'}>{f.severity}</Badge></td>
                <td className="max-w-md truncate font-mono text-[10px] text-white/50">{JSON.stringify(f.details)}</td>
                <td><Button size="sm" onClick={async () => { const r = await ask(t('admin.resolve')); if (r) { await api(`/admin/flags/${f.id}/resolve`, { method: 'POST', body: { reason: r } }); mutate(); } }}>{t('admin.resolve')}</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title={`🧯 ${t('admin.serverErrors')} (${errors.total})`}>
        {!errors.items.length ? <Empty /> : (
          <ul className="space-y-1 font-mono text-[11px]">{errors.items.map((e: any) => (
            <li key={e.id}><details><summary className="cursor-pointer"><span className="text-white/40">{fmtDate(e.createdAt, locale)}</span> <span className="text-ruby-400">{e.path}</span> {e.message.slice(0, 120)}</summary><pre className="whitespace-pre-wrap p-2 text-white/50">{e.stack}</pre></details></li>
          ))}</ul>
        )}
      </Panel>
      <Panel title={`📒 ${t('admin.audit')}`} action={<Button size="sm" onClick={async () => setChain(await api('/admin/audit/verify'))}>{t('admin.verifyChain')}</Button>}>
        {chain && <p className={`mb-3 text-sm ${chain.ok ? 'text-felt-500' : 'text-ruby-400'}`}>{chain.ok ? t('admin.chainOk', { n: chain.checked }) : `${t('admin.chainBad')} #${chain.brokenAt}`}</p>}
        <div className="overflow-x-auto"><table className="data"><thead><tr><th>#</th><th>{t('common.date')}</th><th>Action</th><th>Actor</th><th>Target</th><th>Before → After</th></tr></thead>
          <tbody>{audit.items.map((a: any) => (
            <tr key={a.id}>
              <td className="text-xs text-white/40">{a.id}</td><td className="whitespace-nowrap text-xs">{fmtDate(a.createdAt, locale)}</td><td className="font-semibold">{a.action}</td>
              <td className="font-mono text-[10px]">{a.actorId?.slice(0, 8) ?? a.actorRole}</td><td className="font-mono text-[10px]">{a.targetType}:{a.targetId?.slice(0, 12)}</td>
              <td className="max-w-sm truncate font-mono text-[10px] text-white/50">{JSON.stringify(a.before)} → {JSON.stringify(a.after)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <Pager page={auditPage} total={audit.total} pageSize={30} onPage={setAuditPage} />
      </Panel>
    </div>
  );
}
