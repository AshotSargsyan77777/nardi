'use client';
import { GAME_KINDS, MatchmakingStatus } from '@nardi/engine';
import { ClockPicker, KIND_ICON, queueSuffix, useChessClock, useVariant } from '@/components/PlayActions';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Rosette } from '@/components/Logo';
import { Button, Coins, ErrorText, Loading, Modal, PageTitle, Panel } from '@/components/ui';
import { useApp, useRequireAuth, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export default function RandomPage() {
  const { t } = useI18n();
  const me = useRequireAuth();
  const { socket, config, connected } = useApp();
  const router = useRouter();
  const { data: initial } = useSWR<MatchmakingStatus>(me ? '/matchmaking/status' : null);
  const [status, setStatus] = useState<MatchmakingStatus | null>(null);
  const [queue, setQueue] = useState('casual');
  const [variant, setVariant] = useVariant();
  const [clock, setClock] = useChessClock();
  const [error, setError] = useState<string | null>(null);
  const st = status ?? initial ?? null;
  const now = useNow(st?.state === 'searching' || st?.state === 'proposal');

  useSocketEvent<MatchmakingStatus>('mm:status', setStatus);
  useSocketEvent<{ message: string }>('mm:error', (e) => setError(e.message));
  useEffect(() => {
    if (st?.state === 'matched' && st.matchId) router.push(`/match/${st.matchId}`);
  }, [st?.state, st?.matchId, router]);

  if (!me || !config) return <Loading />;
  const queues: { id: string; title: string; sub: string; icon: string }[] = [
    { id: 'casual', title: t('random.casual'), sub: t('random.casualSub'), icon: '☕' },
    { id: 'ranked', title: t('random.ranked'), sub: t('random.rankedSub'), icon: '⭐' },
    ...config.game.stakeOptions.FUN.filter((n) => n > 0).map((n) => ({ id: `fun:${n}`, title: t('random.stakeQueue', { amount: `${n} ${config.currencies.find((c) => c.code === 'FUN')?.symbol}` }), sub: t('wallet.practiceNote'), icon: '🎯' })),
  ];
  const emit = (ev: string, body?: any) =>
    new Promise<any>((res) => socket?.emit(ev, body ?? {}, (r: any) => {
      if (r?.error) setError(r.error.message);
      else {
        setError(null);
        if (r?.state) setStatus(r);
      }
      res(r);
    }));
  const waited = st?.since ? Math.floor((now - st.since) / 1000) : 0;
  const proposalLeft = st?.proposal ? Math.max(0, Math.ceil((st.proposal.expiresAt - now) / 1000)) : 0;

  return (
    <div>
      <PageTitle sub={t('random.matchingNote')}>{t('random.title')}</PageTitle>
      {st?.state === 'searching' ? (
        <Panel className="mx-auto max-w-lg text-center">
          <div className="relative mx-auto my-6 grid h-40 w-40 place-items-center">
            <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-gold-400/50" />
            <span className="absolute inset-4 animate-pulse-ring rounded-full border-2 border-felt-500/50 [animation-delay:0.6s]" />
            <motion.svg viewBox="-20 -20 40 40" className="h-24 w-24" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}>
              <Rosette cx={0} cy={0} r={18} fill="#eabd55" />
            </motion.svg>
          </div>
          <h2 className="font-display text-xl font-bold">{t('random.searching')}</h2>
          <p className="mt-1 text-white/55">{t('random.waiting')}: {Math.floor(waited / 60)}:{String(waited % 60).padStart(2, '0')}</p>
          {!!st.estimatedPlayers && <p className="text-sm text-white/40">{t('random.inQueue', { n: st.estimatedPlayers })}</p>}
          <Button className="mt-5" onClick={() => emit('mm:leave')}>{t('random.stop')}</Button>
        </Panel>
      ) : (
        <Panel title={t('random.chooseQueue')}>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {GAME_KINDS.map((v) => (
              <button key={v} onClick={() => setVariant(v)} className={`rounded-2xl p-3 text-left ring-1 transition ${variant === v ? 'bg-gold-400/15 ring-gold-400/60' : 'bg-black/20 ring-white/10'}`}>
                <div className="font-bold">{KIND_ICON[v]} {t(`variant.${v}`)}</div>
                <div className="text-xs text-white/50">{t(`variant.${v}.sub`)}</div>
              </button>
            ))}
          </div>
          {variant === 'chess' && <div className="mb-3"><ClockPicker clock={clock} onChange={setClock} /></div>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {queues.map((q) => (
              <button key={q.id} onClick={() => setQueue(q.id)} className={`flex items-center gap-3 rounded-2xl p-4 text-left ring-1 transition ${queue === q.id ? 'bg-gold-400/10 ring-gold-400/60' : 'bg-black/20 ring-white/10 hover:ring-white/25'}`}>
                <span className="text-2xl">{q.icon}</span>
                <span>
                  <span className="block font-bold">{q.title}</span>
                  {q.sub && <span className="block text-xs text-white/50">{q.sub}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-5 space-y-3">
            {error && <ErrorText error={error} />}
            <Button variant="gold" size="lg" className="w-full sm:w-auto" disabled={!connected} onClick={() => emit('mm:join', { queue: `${queue}@${queueSuffix(variant, clock)}` })}>🎲 {t('random.search')}</Button>
            <p className="text-xs text-white/40">{t('wallet.balance')}: <Coins amount={me.balances.FUN} currency="FUN" /></p>
          </div>
        </Panel>
      )}

      <Modal open={st?.state === 'proposal'} title={`🎉 ${t('random.found')}`}>
        {st?.proposal && (
          <div className="text-center">
            <p className="text-white/70">{t('random.foundText')}</p>
            <div className="my-5 font-display text-5xl font-extrabold text-gold-300">{proposalLeft}</div>
            <p className="mb-4 text-sm text-white/50">{t('random.acceptedCount', { n: st.proposal.accepted })}</p>
            <div className="flex justify-center gap-3">
              <Button variant="gold" size="lg" disabled={st.proposal.youAccepted} onClick={() => emit('mm:respond', { proposalId: st.proposal!.id, accept: true })}>✓ {t('random.accept')}</Button>
              <Button size="lg" variant="subtle" onClick={() => emit('mm:respond', { proposalId: st.proposal!.id, accept: false })}>{t('random.decline')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
