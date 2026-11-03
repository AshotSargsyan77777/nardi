'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { InviteFriends } from '@/components/InviteFriends';
import { Button, Coins, Empty, Loading, PageTitle, Pager, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp, useRequireAuth } from '@/lib/app-state';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/** Practice chips only: balance, the daily bonus and the history. Nothing can be bought or cashed out. */
export default function WalletPage() {
  const { t, locale } = useI18n();
  const me = useRequireAuth();
  const { config, refreshMe } = useApp();
  const [page, setPage] = useState(1);
  const { data: wallet, mutate: mutateWallet } = useSWR<any>(me ? '/wallet' : null);
  const { data: tx } = useSWR<any>(me ? `/users/me/transactions?page=${page}&pageSize=20&currency=FUN` : null);
  if (!me || !config) return <Loading />;

  return (
    <div className="space-y-5">
      <PageTitle>{t('wallet.title')}</PageTitle>
      <div className="rounded-2xl bg-gradient-to-br from-sky-500/15 to-ink-900 p-5 ring-1 ring-sky-400/25">
        <div className="text-sm text-white/60">{t('wallet.chips')}</div>
        <div className="mt-1 font-display text-4xl font-extrabold"><Coins amount={me.balances.FUN} currency="FUN" /></div>
        <p className="mt-2 text-xs text-white/45">{t('wallet.freeNote')}</p>
        {wallet?.dailyBonus?.available && (
          <Button className="mt-3" size="sm" variant="gold" onClick={async () => { await api('/wallet/daily-bonus', { method: 'POST' }); mutateWallet(); refreshMe(); }}>🎁 {t('home.dailyBonus')} +{wallet.dailyBonus.amount}</Button>
        )}
      </div>

      <InviteFriends />

      <Panel title={t('wallet.history')}>
        {!tx ? <Loading /> : !tx.items.length ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('common.date')}</th><th>{t('common.type')}</th><th>{t('common.amount')}</th><th>{t('wallet.balance')}</th></tr></thead>
              <tbody>
                {tx.items.map((e: any) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.createdAt, locale)}</td>
                    <td>{t(`tx.${e.type}`)}</td>
                    <td><Coins amount={e.amount} currency={e.currency} signed /></td>
                    <td className="text-white/60"><Coins amount={e.balanceAfter} currency={e.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tx && <Pager page={page} total={tx.total} pageSize={20} onPage={setPage} />}
      </Panel>
    </div>
  );
}
