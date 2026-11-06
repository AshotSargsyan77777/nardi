'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { TourneyTime, tourneyName } from '@/app/tournaments/shared';
import { useApp } from '@/lib/app-state';
import { useSection } from './PlayActions';
import { useI18n } from '@/lib/i18n';

/** The next tournament: a chip on phones, a banner on wider screens. */
export function NextTournament({ chip = false }: { chip?: boolean }) {
  const { t, locale } = useI18n();
  const { me } = useApp();
  const { data } = useSWR<any>(me ? '/tournaments' : null, { refreshInterval: 60000 });
  const { section } = useSection();
  // only this game's tournaments
  const x = data?.open?.find((o: any) => (o.variant === 'short' || o.variant === 'long' ? 'nardi' : o.variant) === section);
  if (!x) return null;
  if (chip) {
    return (
      <Link href={`/tournaments/${x.id}`} className="rounded-full bg-white/5 px-4 py-1.5 text-sm font-bold text-gold-200 ring-1 ring-gold-400/30">
        🏟️ <TourneyTime t={x} locale={locale} />{x.joined ? ' ✓' : ''}
      </Link>
    );
  }
  return (
    <Link href={`/tournaments/${x.id}`} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-gold-500/20 to-ink-850 px-4 py-3 ring-1 ring-gold-400/30 transition hover:-translate-y-0.5">
      <span className="text-3xl">🏟️</span>
      <div className="min-w-0 flex-1">
        <div className="font-display font-extrabold">{tourneyName(x, t)}</div>
        <div className="text-xs text-white/60"><TourneyTime t={x} locale={locale} /> · 👥 {x.players}/{x.maxPlayers}{x.prizes?.[0] ? ` · 🥇 ${Number(x.prizes[0]).toLocaleString()} FC` : ''}</div>
      </div>
      <span className="rounded-full bg-gold-grad px-4 py-1.5 text-sm font-bold text-ink-950">{x.joined ? `✓ ${t('tourney.joined')}` : x.status === 'RUNNING' ? t('tourney.live') : t('tourney.join')}</span>
    </Link>
  );
}
