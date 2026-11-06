'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { HandSummary } from '@/components/game/BlotTable';
import { GameSummary } from '@/components/game/GameTable';
import { Badge, Button, Coins, ErrorText, Loading, PageTitle, Panel, StatusBadge } from '@/components/ui';
import { useRequireAuth } from '@/lib/app-state';
import { fmtDate, fmtDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export default function MatchDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const me = useRequireAuth();
  const { data: m, error } = useSWR<any>(me ? `/matches/${id}` : null);
  if (error) return <ErrorText error={error} />;
  if (!m || !me) return <Loading />;
  const mine = m.players.find((p: any) => p.nickname === me.nickname);
  const myTeam = mine?.team ?? 0;
  const nameOf = (s: number) => m.players[s]?.nickname ?? `#${s}`;
  return (
    <div className="space-y-5">
      <PageTitle sub={`${t(`history.mode.${m.mode}`)} · ${fmtDate(m.startedAt, locale)} · ${fmtDuration(m.durationSec)}`} action={m.status === 'ACTIVE' ? <Link href={`/match/${m.id}`}><Button variant="gold">{t('home.resume')}</Button></Link> : m.rules?.game === 'blot' ? undefined : <Link href={`/matches/${m.id}/replay`}><Button variant="gold">▶ {t('replay.watch')}</Button></Link>}>
        {t('game.details')}
      </PageTitle>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="font-display text-4xl font-extrabold"><span className="text-felt-500">{m.scores[myTeam]}</span> : <span className="text-gold-300">{m.scores[1 - myTeam]}</span></div>
          <div className="flex items-center gap-2"><StatusBadge status={m.status} />{mine?.result && <StatusBadge status={mine.result} />}{m.stake > 0 && <Coins amount={m.stake} currency={m.currency} />}</div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {m.players.map((p: any) => (
            <div key={p.seat} className={`flex items-center gap-3 rounded-xl p-2.5 ring-1 ${p.team === myTeam ? 'bg-felt-900/40 ring-felt-500/30' : 'bg-gold-600/10 ring-gold-400/25'}`}>
              <Avatar name={p.avatar} size={36} />
              <div className="min-w-0 flex-1"><div className="truncate font-semibold">{p.nickname}</div><div className="text-xs text-white/40">{p.seat === 0 ? t('game.light') : t('game.dark')}{p.isBot ? ` · ${t('common.bot')}` : ''}</div></div>
              {p.ratingBefore !== null && p.ratingAfter !== null && <span className="text-xs text-white/50">{p.ratingBefore} → {p.ratingAfter}</span>}
              {p.result && <StatusBadge status={p.result} />}
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        {m.hands.map((h: any) => (
          m.rules?.game === 'blot'
            ? <Panel key={h.hand} title={t('game.hand', { n: h.hand })}><HandSummary r={h} myTeam={myTeam} nameOf={nameOf} /></Panel>
            : <Panel key={h.game} title={t('game.gameN', { n: h.game })}><GameSummary r={h} mySeat={myTeam} nameOf={nameOf} /></Panel>
        ))}
      </div>
      <Panel title={`🛡️ ${t('game.fairness')}`}>
        <p className="mb-3 text-sm text-white/60">{t('game.fairnessText')}</p>
        <div className="space-y-2 text-xs">
          {m.fairness.map((f: any) => (
            <div key={f.deck ? `h${f.hand}` : f.game} className="rounded-xl bg-black/25 p-3">
              <div className="mb-1 flex items-center gap-2 font-semibold">{f.deck ? t('game.hand', { n: f.hand }) : t('game.gameN', { n: f.game })} {f.verified && <Badge color="green">✓ {t('game.verified')}</Badge>}</div>
              <div className="break-all font-mono text-white/45">{f.deck ? f.deck.join(' ') : `${t('game.rolled')}: ${f.rolls.slice(0, f.used).map((r: number[]) => r.join('')).join(' ')}`}</div>
              <div className="break-all font-mono text-felt-500">{f.commitment}</div>
            </div>
          ))}
        </div>
        {m.resultHash && <p className="mt-3 break-all font-mono text-[11px] text-white/35">result: {m.resultHash}</p>}
      </Panel>
    </div>
  );
}
