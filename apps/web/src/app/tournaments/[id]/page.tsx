'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { Badge, Button, ErrorText, Loading, PageTitle, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { TourneyTime, tourneyName } from '../shared';

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const me = useRequireAuth();
  const { data: x, error, mutate } = useSWR<any>(me ? `/tournaments/${id}` : null, { refreshInterval: 15000 });
  useSocketEvent<{ tournamentId: string }>('tournament:update', (d) => d.tournamentId === id && mutate());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <ErrorText error={error} />;
  if (!x || !me) return <Loading />;
  const who = new Map<string, any>(x.players.map((p: any) => [p.userId, p]));
  const act = async (path: string) => {
    setBusy(true); setErr(null);
    try { await api(`/tournaments/${id}/${path}`, { method: 'POST' }); await mutate(); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const roundName = (r: number, total: number) => {
    const left = total - r;
    return left === 1 ? t('tourney.final') : left === 2 ? t('tourney.semi') : left === 3 ? t('tourney.quarter') : t('tourney.round', { n: r + 1 });
  };
  // the full bracket depth from the first round's size
  const rounds = x.bracket.length ? Math.round(Math.log2(x.bracket[0].length * 2)) : 0;
  const slot = (uid: string | null, winner: string | null) => {
    if (!uid) return <div className="rounded-lg bg-black/20 px-2 py-1.5 text-xs italic text-white/30">{t('tourney.bye')}</div>;
    const p = who.get(uid);
    const won = winner === uid, lost = !!winner && winner !== uid;
    return (
      <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${won ? 'bg-gold-400/20 font-bold text-gold-100' : lost ? 'bg-black/20 text-white/35 line-through' : 'bg-white/5'} ${uid === me.id ? 'ring-1 ring-felt-500' : ''}`}>
        <Avatar name={p?.avatar} size={18} /><span className="truncate">{p?.nickname ?? '?'}</span>
      </div>
    );
  };
  return (
    <div className="space-y-5">
      <PageTitle sub={`${t(`variant.${x.variant}`)} · ${t('game.toPoints', { n: x.targetScore })} · 👥 ${x.players.length}/${x.maxPlayers}`} action={<Link href="/tournaments"><Button size="sm">← {t('tourney.title')}</Button></Link>}>
        🏆 {tourneyName(x, t)}
      </PageTitle>

      {x.myMatchId && (
        <Link href={`/match/${x.myMatchId}`} className="block rounded-2xl bg-gold-grad p-4 text-center font-display text-lg font-extrabold text-ink-950 shadow-glow">▶ {t('tourney.yourMatch')}</Link>
      )}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gold-200"><TourneyTime t={x} locale={locale} /></div>
            <div className="mt-1 flex gap-3 text-sm">
              {(x.prizes as number[]).map((n, i) => <span key={i}>{['🥇', '🥈', '🥉'][i]} {n.toLocaleString()} FC</span>)}
            </div>
          </div>
          {x.status === 'REGISTRATION' && (x.joined
            ? <Button onClick={() => act('leave')} loading={busy}>{t('tourney.leave')}</Button>
            : <Button variant="gold" onClick={() => act('join')} loading={busy} disabled={x.players.length >= x.maxPlayers}>{x.players.length >= x.maxPlayers ? t('tourney.full') : t('tourney.join')}</Button>)}
          {x.status === 'FINISHED' && <Badge color="gold">{t('tourney.over')}</Badge>}
          {x.status === 'CANCELLED' && <Badge color="red">{t('tourney.cancelled')}</Badge>}
        </div>
        <ErrorText error={err} />
        {x.status === 'REGISTRATION' && <p className="mt-3 text-xs text-white/45">{t('tourney.howItWorks', { min: x.minPlayers })}</p>}
      </Panel>

      {x.bracket.length > 0 && (
        <Panel title={t('tourney.bracket')}>
          <div className="overflow-x-auto pb-2">
            <div className="flex min-w-max gap-4">
              {Array.from({ length: rounds }, (_, r) => (
                <div key={r} className="flex w-44 flex-col">
                  <div className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-white/50">{roundName(r, rounds)}</div>
                  <div className="flex flex-1 flex-col justify-around gap-3">
                    {(x.bracket[r] ?? Array.from({ length: Math.max(1, x.bracket[0].length / 2 ** r) }, () => ({ a: null, b: null, pending: true }))).map((p: any, k: number) => (
                      <div key={k} className="space-y-1 rounded-xl bg-black/20 p-1.5 ring-1 ring-white/5">
                        {p.pending ? <><div className="h-7 rounded-lg bg-white/5" /><div className="h-7 rounded-lg bg-white/5" /></> : <>{slot(p.a, p.winner)}{slot(p.b, p.winner)}</>}
                        {p.matchId && !p.winner && <Link href={`/match/${p.matchId}`} className="block text-center text-[10px] text-gold-300 hover:underline">● {t('tourney.live')}</Link>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      <Panel title={`${t('tourney.players')} (${x.players.length})`}>
        <div className="grid gap-2 sm:grid-cols-2">
          {[...x.players].sort((a: any, b: any) => (a.place ?? 99) - (b.place ?? 99)).map((p: any) => (
            <Link key={p.userId} href={`/u/${p.nickname}`} className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2 hover:bg-black/30">
              {p.place ? <span className="w-6 text-lg">{['🥇', '🥈', '🥉'][p.place - 1]}</span> : null}
              <Avatar name={p.avatar} size={28} /><span className="flex-1 truncate font-semibold">{p.nickname}</span>
              <span className="text-xs text-white/40">★ {p.rating}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
