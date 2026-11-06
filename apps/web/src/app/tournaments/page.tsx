'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { Badge, Empty, Loading, PageTitle, Panel } from '@/components/ui';
import { useRequireAuth, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { TourneyTime, tourneyName } from './shared';

export default function TournamentsPage() {
  const { t, locale } = useI18n();
  const me = useRequireAuth();
  const { data, mutate } = useSWR<any>(me ? '/tournaments' : null, { refreshInterval: 30000 });
  useSocketEvent('tournament:update', () => mutate());
  if (!me || !data) return <Loading />;
  const card = (x: any) => (
    <Link key={x.id} href={`/tournaments/${x.id}`} className="flex flex-wrap items-center gap-3 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10 transition hover:bg-black/35">
      <div className="text-3xl">🏆</div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-lg font-extrabold">{tourneyName(x, t)}</div>
        <div className="text-xs text-white/55">{t(`variant.${x.variant}`)}{x.variant === 'short' || x.variant === 'long' ? ` · ${t('game.toPoints', { n: x.targetScore })}` : x.clock ? ` · ⏱ ${x.clock}` : ''} · 👥 {x.players}/{x.maxPlayers}</div>
        <div className="mt-1 text-xs text-gold-200">{x.status === 'FINISHED' ? `🥇 ${x.winner ?? '—'}` : <TourneyTime t={x} locale={locale} />}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {x.status === 'RUNNING' && <Badge color="red">● {t('tourney.live')}</Badge>}
        {x.joined && x.status !== 'FINISHED' && <Badge color="green">✓ {t('tourney.joined')}</Badge>}
        {(x.prizes as number[]).length > 0 && <span className="text-xs text-white/60">🥇 {x.prizes[0].toLocaleString()} FC</span>}
      </div>
    </Link>
  );
  return (
    <div className="space-y-5">
      <PageTitle sub={t('tourney.sub')}>🏆 {t('tourney.title')}</PageTitle>
      <Panel title={t('tourney.upcoming')}>{data.open.length ? <div className="space-y-3">{data.open.map(card)}</div> : <Empty />}</Panel>
      {data.recent.length > 0 && <Panel title={t('tourney.finished')}><div className="space-y-3">{data.recent.map(card)}</div></Panel>}
    </div>
  );
}
