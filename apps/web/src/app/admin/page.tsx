'use client';
import useSWR from 'swr';
import { Kpi } from '@/components/admin';
import { Loading, PageTitle, Panel } from '@/components/ui';
import { fmtDuration, fmtMoney, fmtNum } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function AdminDashboard() {
  const { t, locale } = useI18n();
  const { data: o } = useSWR<any>('/admin/analytics/overview', { refreshInterval: 15000 });
  if (!o) return <Loading />;
  const max = Math.max(1, ...o.daily.map((d: any) => Math.max(d.matches, d.users)));
  return (
    <div className="space-y-5">
      <PageTitle>{t('admin.dashboard')}</PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('admin.registered')} value={fmtNum(o.users.total, locale)} sub={`+${o.users.new7d} / 7d`} />
        <Kpi label={t('admin.active24h')} value={fmtNum(o.users.active24h, locale)} sub={`${t('admin.online')}: ${o.users.onlineNow} · 7d: ${o.users.active7d}`} accent="text-felt-500" />
        <Kpi label={t('admin.matches')} value={fmtNum(o.matches.total, locale)} sub={`${t('admin.live')}: ${o.matches.active} · 7d: ${o.matches.last7d}`} />
        <Kpi label={t('admin.avgDuration')} value={fmtDuration(o.matches.avgDurationSec)} sub="30d" />
        <Kpi label={t('admin.errors24h')} value={o.errors24h} accent={o.errors24h ? 'text-ruby-400' : 'text-felt-500'} />
        <Kpi label={t('admin.openFlags')} value={o.openFlags} accent={o.openFlags ? 'text-gold-300' : 'text-felt-500'} />
      </div>
      <Panel title="14d">
        <div className="flex h-44 items-end gap-1.5">
          {o.daily.map((d: any) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.matches} / ${d.users}`}>
              <div className="flex h-36 w-full items-end gap-0.5">
                <div className="flex-1 rounded-t bg-felt-500/80" style={{ height: `${(d.matches / max) * 100}%` }} />
                <div className="flex-1 rounded-t bg-gold-400/80" style={{ height: `${(d.users / max) * 100}%` }} />
              </div>
              <span className="text-[9px] text-white/35">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-white/50"><span><span className="mr-1 inline-block h-2 w-2 rounded bg-felt-500" />{t('admin.matches')}</span><span><span className="mr-1 inline-block h-2 w-2 rounded bg-gold-400" />{t('admin.registered')}</span></div>
      </Panel>
      <Panel title={t('admin.emission')}>
        <table className="data">
          <thead><tr><th>Currency</th><th>Account</th><th>#</th><th>{t('wallet.balance')}</th></tr></thead>
          <tbody>{o.emission.map((e: any) => <tr key={e.currency + e.type}><td>{e.currency}</td><td className="font-mono text-xs">{e.type}</td><td>{e.accounts}</td><td className="tabular-nums">{fmtNum(e.balance, locale)}</td></tr>)}</tbody>
        </table>
      </Panel>
    </div>
  );
}
