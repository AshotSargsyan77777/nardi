'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { Badge, Empty, Loading, PageTitle, Pager, Panel } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'all' | 'month'>('month');
  const [variant, setVariant] = useState<'' | 'blot' | 'short' | 'long' | 'checkers' | 'chess'>('');
  const qs = `page=${page}&pageSize=50${tab === 'month' ? '&season=month' : ''}${variant ? `&variant=${variant}` : ''}`;
  const { data } = useSWR<any>(`/leaderboard?${qs}`);
  // the points table: this month, or all time for one variant
  const pointsTable = tab === 'month' || !!variant;
  const tabCls = (on: boolean) => `rounded-full px-4 py-1.5 text-sm font-bold ${on ? 'bg-gold-grad text-ink-950' : 'bg-white/5 text-white/70'}`;
  return (
    <div>
      <PageTitle>🏆 {t('lb.title')}</PageTitle>
      <div className="mb-3 flex gap-2">
        <button className={tabCls(tab === 'month')} onClick={() => { setTab('month'); setPage(1); }}>📅 {t('lb.month')}</button>
        <button className={tabCls(tab === 'all')} onClick={() => { setTab('all'); setPage(1); }}>⭐ {t('lb.allTime')}</button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', 'blot', 'short', 'long', 'checkers', 'chess'] as const).map((x) => (
          <button key={x || 'all'} onClick={() => { setVariant(x); setPage(1); }} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${variant === x ? 'bg-white/15 text-white ring-white/30' : 'bg-white/5 text-white/60 ring-white/10'}`}>
            {x ? t(`variant.${x}`) : t('lb.allVariants')}
          </button>
        ))}
      </div>
      {pointsTable && <p className="mb-3 text-xs text-white/45">{tab === 'month' ? t('lb.monthNote') : t('lb.variantNote')}</p>}
      <Panel>
        {pointsTable ? (!data ? <Loading /> : !data.items.length ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('lb.rank')}</th><th>{t('lb.player')}</th><th>{t('lb.points')}</th><th>{t('profile.wins')}</th><th>{t('profile.games')}</th><th>{t('profile.winRate')}</th></tr></thead>
              <tbody>
                {data.items.map((p: any) => (
                  <tr key={p.nickname}>
                    <td className={`font-bold ${p.rank <= 3 ? 'text-gold-300' : 'text-white/50'}`}>{p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank}</td>
                    <td><Link href={`/u/${p.nickname}`} className="flex items-center gap-2 font-semibold hover:underline"><Avatar name={p.avatar} size={28} />{p.nickname}</Link></td>
                    <td><Badge color="gold">{p.points}</Badge></td><td>{p.wins}</td><td>{p.games}</td><td>{p.winRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )) : <>
        {!data ? <Loading /> : !data.items.length ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('lb.rank')}</th><th>{t('lb.player')}</th><th>{t('profile.rating')}</th><th>{t('profile.level')}</th><th>{t('profile.wins')}</th><th>{t('profile.games')}</th><th>{t('profile.winRate')}</th></tr></thead>
              <tbody>
                {data.items.map((p: any) => (
                  <tr key={p.nickname}>
                    <td className={`font-bold ${p.rank <= 3 ? 'text-gold-300' : 'text-white/50'}`}>{p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank}</td>
                    <td><Link href={`/u/${p.nickname}`} className="flex items-center gap-2 font-semibold hover:underline"><Avatar name={p.avatar} size={28} />{p.nickname}</Link></td>
                    <td><Badge color="gold">{p.rating}</Badge></td>
                    <td>{p.level}</td><td>{p.wins}</td><td>{p.gamesPlayed}</td><td>{p.winRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} total={data.total} pageSize={50} onPage={setPage} />}
        </>}
      </Panel>
    </div>
  );
}
