'use client';
import { StatsPanel } from '@/components/StatsPanel';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { MatchList } from '@/components/MatchList';
import { PlayerActions } from '@/components/PlayerActions';
import { Button, ErrorText, Loading, PageTitle, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function PublicProfilePage() {
  const { nickname } = useParams<{ nickname: string }>();
  const { t, locale } = useI18n();
  const { data: p, error, mutate } = useSWR<any>(`/users/profile/${encodeURIComponent(nickname)}`);
  if (error) return <ErrorText error={error} />;
  if (!p) return <Loading />;
  return (
    <div className="space-y-5">
      <PageTitle>{p.nickname}</PageTitle>
      <Panel>
        <div className="flex items-center gap-5">
          <Avatar name={p.avatar} size={80} />
          {p.private ? <p className="text-white/50">{t('profile.private')}</p> : (
            <div>
              <div className="text-sm text-white/50">{t('profile.memberSince')}: {fmtDate(p.createdAt, locale, false)}</div>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <span>{t('profile.rating')}: <b className="text-gold-300">{p.rating}</b></span>
                <span>{t('profile.level')}: <b>{p.level}</b></span>
                <span>{t('profile.games')}: <b>{p.stats.games}</b></span>
                <span>{t('profile.winRate')}: <b>{p.stats.winRate}%</b></span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{p.achievements.map((a: string) => <span key={a} className="rounded-full bg-gold-400/10 px-2 py-0.5 text-xs text-gold-200">{t(`ach.${a}`)}</span>)}</div>
            </div>
          )}
        </div>
        {p.friendship && (
          <div className="mt-4">
            {p.friendship === 'friends' ? <span className="text-sm text-felt-500">✓ {t('friendsList.areFriends')}</span>
              : p.friendship === 'sent' ? <span className="text-sm text-white/50">⏳ {t('friendsList.requested')}</span>
              : <Button variant="emerald" size="sm" onClick={async () => { await api(`/friends/${encodeURIComponent(p.nickname)}`, { method: 'POST' }); mutate(); }}>➕ {p.friendship === 'received' ? t('friendsList.accept') : t('friendsList.add')}</Button>}
          </div>
        )}
        <div className="mt-4"><PlayerActions nickname={p.nickname} blocked={!!p.blocked} onChange={() => mutate()} /></div>
      </Panel>
      {!p.private && <StatsPanel s={p.details} />}
      {!p.private && p.recentMatches?.length > 0 && <Panel title={t('home.recentMatches')}><MatchList items={p.recentMatches} /></Panel>}
    </div>
  );
}
