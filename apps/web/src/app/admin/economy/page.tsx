'use client';
import useSWR from 'swr';
import { Badge, Loading, PageTitle, Panel } from '@/components/ui';
import { JsonEditor } from '@/components/admin';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/** Practice-chip bonuses, the donation links and the ledger totals. There is nothing for sale. */
export default function AdminEconomyPage() {
  const { t, locale } = useI18n();
  const { data: settings, mutate: ms } = useSWR<any>('/admin/settings');
  const { data: emission } = useSWR<any>('/admin/economy/emission');
  if (!settings) return <Loading />;
  return (
    <div className="space-y-5">
      <PageTitle>{t('admin.economy')}</PageTitle>
      <Panel title={t('admin.bonuses')}>
        <JsonEditor key={JSON.stringify(settings.settings.economy)} value={settings.settings.economy} onSave={async (v) => { await api('/admin/settings/economy', { method: 'PUT', body: v }); ms(); }} />
      </Panel>
      {emission && (
        <Panel title={t('admin.emission')} action={emission.check.ok ? <Badge color="green">✓ {t('admin.ledgerOk')}</Badge> : <Badge color="red">{t('admin.ledgerBad')}</Badge>}>
          <table className="data"><thead><tr><th>Currency</th><th>Account</th><th>#</th><th>{t('wallet.balance')}</th></tr></thead>
            <tbody>{emission.accounts.map((e: any) => <tr key={e.currency + e.type}><td>{e.currency}</td><td className="font-mono text-xs">{e.type}</td><td>{e.accounts}</td><td>{fmtNum(e.balance, locale)}</td></tr>)}</tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
