'use client';
import Link from 'next/link';
import { fmtDate, fmtDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { Avatar } from './Avatar';
import { Coins, Empty, StatusBadge } from './ui';

export function MatchList({ items }: { items: any[] }) {
  const { t, locale } = useI18n();
  if (!items.length) return <Empty />;
  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <li key={m.matchId}>
          <Link href={`/matches/${m.matchId}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-black/20 px-3 py-2.5 hover:bg-black/30">
            <div className="min-w-[120px]">
              <div className="text-sm font-semibold">{t(`history.mode.${m.mode}`)}</div>
              <div className="text-[11px] text-white/40">{fmtDate(m.startedAt, locale)} · {fmtDuration(m.durationSec)}</div>
            </div>
            <div className="flex -space-x-2">{m.players.map((p: any) => <Avatar key={p.seat} name={p.avatar} size={26} ring={p.seat === m.myTeam ? 'ring-2 ring-felt-500' : 'ring-2 ring-gold-500/60'} />)}</div>
            <div className="ml-auto flex items-center gap-3">
              {m.stake > 0 && <Coins amount={m.result === 'WIN' ? m.stake : -m.stake} currency={m.currency} signed className="text-sm" />}
              {m.ratingChange !== null && m.ratingChange !== 0 && <span className={`text-xs font-bold ${m.ratingChange > 0 ? 'text-felt-500' : 'text-ruby-400'}`}>{m.ratingChange > 0 ? '+' : ''}{m.ratingChange}</span>}
              <span className="font-mono text-sm">{m.scores[m.myTeam]}:{m.scores[1 - m.myTeam]}</span>
              {m.result ? <StatusBadge status={m.result} /> : <StatusBadge status={m.status} />}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
