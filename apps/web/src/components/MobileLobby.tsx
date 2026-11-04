'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { InstallBanner } from './InstallApp';
import { QuestsChip } from './Quests';
import { PushToggle } from './PushToggle';
import { NextTournament } from './NextTournament';
import { BotLevelPicker, VariantPicker, usePractice } from './PlayActions';
import { DiceArt } from './DiceArt';

type Mode = { key: string; title: string; sub: string; art: React.ReactNode; play: () => void; busy?: boolean };

/**
 * Phone home screen, styled like a game lobby: swipe between game modes, one big «Play» button.
 */
export function MobileLobby() {
  const { t } = useI18n();
  const router = useRouter();
  const { config, refreshMe } = useApp();
  const practice = usePractice();
  const { data: active } = useSWR<{ matchId: string | null }>('/matches/active');
  const { data: wallet, mutate: mutateWallet } = useSWR<any>('/wallet');

  const modes: Mode[] = [
    ...(config?.features.practiceBotsEnabled !== false
      ? [{ key: 'practice', title: t('home.playFree'), sub: practice.error ?? t('home.playFreeSub'), art: <DiceArt a={6} b={5} />, play: practice.start, busy: practice.busy }]
      : []),
    { key: 'random', title: t('home.playRandom'), sub: t('home.playRandomSub'), art: <><span className="text-6xl short:text-4xl">⚡</span><DiceArt a={3} b={3} small /></>, play: () => router.push('/play/random') },
    { key: 'friends', title: t('nav.friends'), sub: t('home.playFriendsSub'), art: <><span className="text-6xl short:text-4xl">🤝</span><DiceArt a={4} b={2} small /></>, play: () => router.push('/play/friends') },
  ];
  const start = modes.findIndex((m) => m.key === 'random');
  const [idx, setIdx] = useState(start);
  const track = useRef<HTMLDivElement>(null);

  const scrollTo = (i: number, smooth = true) => {
    const el = track.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  };
  useEffect(() => scrollTo(start, false), [start]);
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    Array.from(el.children).forEach((c, i) => {
      const ch = c as HTMLElement;
      if (Math.abs(ch.offsetLeft + ch.offsetWidth / 2 - mid) < Math.abs((el.children[best] as HTMLElement).offsetLeft + (el.children[best] as HTMLElement).offsetWidth / 2 - mid)) best = i;
    });
    setIdx(best);
  };
  const cur = modes[idx] ?? modes[0];

  return (
    <div className="-mx-3 flex h-[calc(100dvh-64px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[260px] flex-col rounded-t-3xl bg-[radial-gradient(ellipse_at_50%_45%,rgba(13,94,65,0.55),transparent_70%)] px-3">
      <div className="flex flex-wrap items-center justify-center gap-2 pt-2 empty:hidden">
        {active?.matchId && (
          <Link href={`/match/${active.matchId}`} className="rounded-full bg-gold-400/15 px-4 py-1.5 text-sm font-bold text-gold-200 ring-1 ring-gold-400/40">
            🎲 {t('home.activeMatch')} · {t('home.resume')} →
          </Link>
        )}
        <QuestsChip />
        <NextTournament chip />
        <Link href="/invite" className="rounded-full bg-white/5 px-4 py-1.5 text-sm font-bold text-gold-200 ring-1 ring-gold-400/30">🎁 {t('invite.title')}</Link>
        <PushToggle chip />
        <InstallBanner chip />
        {wallet?.dailyBonus?.available && (
          <button
            onClick={async () => { await api('/wallet/daily-bonus', { method: 'POST' }); mutateWallet(); refreshMe(); }}
            className="rounded-full bg-felt-600/30 px-4 py-1.5 text-sm font-bold text-white ring-1 ring-felt-500/50"
          >
            🎁 {t('home.claim')} +{wallet.dailyBonus.amount}
          </button>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center">
        <div ref={track} onScroll={onScroll} className="no-scrollbar flex h-full w-full snap-x snap-mandatory items-center overflow-x-auto px-[22vw] short:px-[30vw]">
          {modes.map((m, i) => {
            const on = i === idx;
            return (
              <button
                key={m.key}
                onClick={() => (on ? m.play() : scrollTo(i))}
                className={`flex h-[92%] w-[56vw] shrink-0 snap-center flex-col items-center justify-center gap-2 transition duration-300 short:w-[40vw] ${on ? 'scale-100 opacity-100' : 'scale-[0.8] opacity-40 grayscale'}`}
                style={{ minWidth: 0 }}
              >
                <span className={`ribbon relative w-max whitespace-nowrap px-7 py-1.5 font-display font-extrabold uppercase tracking-wide ${on ? 'text-[15px]' : 'text-[11px]'} ${on ? 'bg-gold-grad text-ink-950' : 'bg-white/10 text-white/80'}`}>
                  {on && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white">★</span>}
                  {m.title}
                  {on && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white">★</span>}
                </span>
                <span className="relative grid w-full flex-1 place-items-center rounded-[28px] bg-[radial-gradient(ellipse_at_center,rgba(22,153,106,0.45),transparent_70%)]">
                  <span className="flex flex-col items-center gap-1 drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]">{m.art}</span>
                </span>
              </button>
            );
          })}
        </div>
        {idx > 0 && <button onClick={() => scrollTo(idx - 1)} aria-label="prev" className="absolute left-0 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-2xl text-white/70">‹</button>}
        {idx < modes.length - 1 && <button onClick={() => scrollTo(idx + 1)} aria-label="next" className="absolute right-0 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-2xl text-white/70">›</button>}
      </div>

      <div className="flex flex-col items-center gap-1.5 pt-2 short:gap-1 short:pt-0">
        <div className="flex gap-1.5 short:hidden">
          {modes.map((m, i) => <span key={m.key} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-gold-400' : 'w-1.5 bg-white/25'}`} />)}
        </div>
        {cur.key === 'practice' ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <VariantPicker variant={practice.variant} onChange={practice.setVariant} />
            <BotLevelPicker level={practice.level} onChange={practice.setLevel} />
            <button onClick={practice.learn} className="rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-gold-300 ring-1 ring-gold-400/30">🎓 {t('tip.learn')}</button>
          </div>
        ) : <p className="text-center text-xs text-white/55 short:text-[11px]">{cur.sub}</p>}
        <button onClick={cur.play} disabled={cur.busy} className="w-full max-w-xs rounded-2xl bg-gold-grad py-3 font-display text-lg font-extrabold text-ink-950 shadow-glow active:scale-[0.98] disabled:opacity-60 short:py-2">
          ▶ {t('home.play')}
        </button>
      </div>
    </div>
  );
}
