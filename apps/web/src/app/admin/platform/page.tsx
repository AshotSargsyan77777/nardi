'use client';
import useSWR from 'swr';
import { JsonEditor } from '@/components/admin';
import { Badge, ErrorText, Loading, PageTitle, Panel, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useState } from 'react';

export default function AdminPlatform() {
  const { t, locale } = useI18n();
  const { me } = useApp();
  const { data, mutate } = useSWR<any>('/admin/settings');
  const [err, setErr] = useState<unknown>(null);
  if (!data) return <Loading />;
  const f = data.settings.features;
  const eff = data.effective;
  const set = async (patch: any) => {
    setErr(null);
    try { await api('/admin/settings/features', { method: 'PUT', body: patch }); mutate(); } catch (e) { setErr(e); }
  };
  const flags = ['funStakesEnabled', 'practiceBotsEnabled', 'registrationOpen', 'tournamentsEnabled'];
  return (
    <div className="space-y-5">
      <PageTitle>{t('admin.platform')}</PageTitle>
      <Panel title={t('admin.features')}>
        <div className="divide-y divide-white/5">
          {flags.map((k) => <Toggle key={k} label={t(`admin.f.${k}`)} checked={!!f[k]} onChange={(v) => set({ [k]: v })} />)}
        </div>
        <ErrorText error={err} />
      </Panel>
      <Panel title={t('admin.legal')}>
        <JsonEditor key={JSON.stringify(data.settings.legal)} value={data.settings.legal} onSave={async (v) => { await api('/admin/settings/legal', { method: 'PUT', body: v }); mutate(); }} />
      </Panel>
      <Panel title={t('admin.changes')}>
        <div className="max-h-80 overflow-y-auto"><table className="data"><thead><tr><th>{t('common.date')}</th><th>Key</th><th>Admin</th><th>Old → New</th></tr></thead>
          <tbody>{data.history.map((h: any) => (
            <tr key={h.id}><td className="whitespace-nowrap text-xs">{fmtDate(h.createdAt, locale)}</td><td>{h.key}</td><td className="font-mono text-[10px]">{h.adminId?.slice(0, 8)}</td><td className="max-w-md truncate font-mono text-[10px] text-white/50">{JSON.stringify(h.oldValue)} → {JSON.stringify(h.newValue)}</td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </div>
  );
}
