'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { LogoMark, Rosette } from '@/components/Logo';
import { InstallBanner } from '@/components/InstallApp';
import { MobileLobby } from '@/components/MobileLobby';
import { NextTournament } from '@/components/NextTournament';
import { QuestsPanel } from '@/components/Quests';
import { PlayModal, usePractice } from '@/components/PlayActions';
import { DiceArt } from '@/components/DiceArt';
import { Badge, Button, Coins, Empty, Loading, Panel, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { fmtDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

function Hero({ onPlay }: { onPlay: () => void }) {
  const { t } = useI18n();
  const { me } = useApp();
  const practice = usePractice();
  return (
    <section className="relative overflow-hidden rounded-3xl border border-gold-400/15 bg-gradient-to-br from-felt-800 via-felt-900 to-ink-900 p-6 shadow-soft sm:p-10">
      <svg className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 opacity-[0.07]" viewBox="-20 -20 40 40" aria-hidden><Rosette cx={0} cy={0} r={18} fill="#eabd55" /></svg>
      <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          {me && <p className="mb-2 text-sm font-semibold text-gold-300">{t('home.hello', { name: me.nickname })}</p>}
          <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-5xl">{t('home.heroTitle')}</h1>
          <p className="mt-3 max-w-lg text-white/70">{t('home.heroText')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="gold" size="lg" onClick={onPlay} className="min-w-[160px] text-lg">▶ {t('home.play')}</Button>
            <Link href="/play/friends"><Button variant="emerald" size="lg">🤝 {t('home.playFriends')}</Button></Link>
            <Link href="/play/random"><Button size="lg">🎲 {t('home.playRandom')}</Button></Link>
            <Button size="lg" onClick={practice.start} loading={practice.busy}>🤖 {t('home.playFree')}</Button>
          </div>
          {practice.error && <p className="mt-2 text-sm text-ruby-400">{practice.error}</p>}
        </div>
        <div className="relative hidden h-56 lg:block">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <DiceArt a={6} b={6} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Guest() {
  const { t } = useI18n();
  const features = [
    ['🛡️', t('home.featureFair'), t('home.featureFairText')],
    ['⚡', t('home.featureRealtime'), t('home.featureRealtimeText')],
    ['🤝', t('home.featureFriends'), t('home.featureFriendsText')],
  ];
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-gold-400/15 felt p-8 text-center shadow-soft sm:p-14">
        <div className="mx-auto mb-5 w-fit"><LogoMark size={84} /></div>
        <h1 className="font-display text-3xl font-extrabold sm:text-5xl">{t('home.guestTitle')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-white/75">{t('home.guestText')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/register"><Button variant="gold" size="lg">{t('nav.register')}</Button></Link>
          <Link href="/login"><Button size="lg">{t('nav.login')}</Button></Link>
        </div>
        <div className="mt-8 flex justify-center gap-2">
          <DiceArt a={6} b={5} />
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-3 phone:hidden">
        {features.map(([icon, title, text]) => (
          <Panel key={title}>
            <div className="text-3xl">{icon}</div>
            <h3 className="mt-2 font-display text-lg font-bold">{title}</h3>
            <p className="mt-1 text-sm text-white/60">{text}</p>
          </Panel>
        ))}
      </div>
      <div className="phone:hidden"><RulesTeaser /></div>
    </div>
  );
}

function RulesTeaser() {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel title={`📜 ${t('home.rulesTitle')}`}>
        <p className="text-sm text-white/60">{t('home.rulesText')}</p>
        <Link href="/rules" className="mt-3 inline-block text-sm font-semibold text-gold-300 hover:underline">{t('nav.rules')} →</Link>
      </Panel>
      <Panel title={`💬 ${t('home.supportTitle')}`}>
        <p className="text-sm text-white/60">{t('home.supportText')}</p>
        <Link href="/support" className="mt-3 inline-block text-sm font-semibold text-gold-300 hover:underline">{t('nav.support')} →</Link>
      </Panel>
    </div>
  );
}

function Dashboard() {
  const { t, locale } = useI18n();
  const { me, refreshMe } = useApp();
  const [playOpen, setPlayOpen] = useState(false);
  const { data: matches } = useSWR<any>('/users/me/matches?pageSize=5');
  const { data: lb } = useSWR<any>('/leaderboard?pageSize=5');
  const { data: tx } = useSWR<any>('/users/me/transactions?pageSize=6');
  const { data: wallet, mutate: mutateWallet } = useSWR<any>('/wallet');
  const { data: active } = useSWR<{ matchId: string | null }>('/matches/active');
  if (!me) return null;
  const lvlPct = Math.min(100, Math.round(((me.xp - me.levelXp) / Math.max(1, me.nextLevelXp - me.levelXp)) * 100));

  return (
    <div className="space-y-5">
      {active?.matchId && (
        <Link href={`/match/${active.matchId}`} className="flex items-center justify-between rounded-2xl bg-gold-400/10 px-4 py-3 ring-1 ring-gold-400/30">
          <span className="font-semibold text-gold-200">🎲 {t('home.activeMatch')}</span>
          <span className="text-sm font-bold text-gold-300">{t('home.resume')} →</span>
        </Link>
      )}
      <Hero onPlay={() => setPlayOpen(true)} />
      <NextTournament />
      <QuestsPanel />
      <PlayModal open={playOpen} onClose={() => setPlayOpen(false)} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t('nav.profile')} action={<Link href="/profile" className="text-xs text-gold-300 hover:underline">{t('common.more')} →</Link>}>
          <div className="flex items-center gap-4">
            <Avatar name={me.avatar} size={64} ring="ring-2 ring-gold-400/50" />
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-bold">{me.nickname}</div>
              <div className="text-xs text-white/50">{t('profile.level')} {me.level} · {t('profile.rating')} <span className="font-semibold text-gold-300">{me.rating}</span></div>
              <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gold-grad" style={{ width: `${lvlPct}%` }} /></div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[[t('profile.games'), me.stats.games], [t('profile.wins'), me.stats.wins], [t('profile.winRate'), `${me.stats.winRate}%`]].map(([l, v]) => (
              <div key={String(l)} className="rounded-xl bg-black/20 py-2"><div className="font-display text-lg font-bold">{v}</div><div className="text-[11px] text-white/45">{l}</div></div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-black/20 px-3 py-2.5">
            <div className="space-y-0.5 text-sm">
              <div><Coins amount={me.balances.FUN} currency="FUN" /></div>
            </div>
            {wallet?.dailyBonus?.available ? (
              <Button size="sm" variant="gold" onClick={async () => { await api('/wallet/daily-bonus', { method: 'POST' }); mutateWallet(); refreshMe(); }}>
                🎁 {t('home.claim')} +{wallet.dailyBonus.amount}
              </Button>
            ) : (
              <Link href="/wallet" className="text-xs text-gold-300 hover:underline">{t('nav.wallet')} →</Link>
            )}
          </div>
        </Panel>

        <Panel title={t('home.recentMatches')} action={<Link href="/history" className="text-xs text-gold-300 hover:underline">{t('common.seeAll')} →</Link>}>
          {!matches ? <Loading /> : !matches.items.length ? <Empty /> : (
            <ul className="space-y-2">
              {matches.items.map((m: any) => (
                <li key={m.matchId}>
                  <Link href={`/matches/${m.matchId}`} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2 hover:bg-black/30">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{t(`history.mode.${m.mode}`)}</div>
                      <div className="text-[11px] text-white/40">{fmtDate(m.startedAt, locale)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{m.scores[m.myTeam]}:{m.scores[1 - m.myTeam]}</span>
                      {m.result ? <StatusBadge status={m.result} /> : <StatusBadge status={m.status} />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`🏆 ${t('home.leaders')}`} action={<Link href="/leaderboard" className="text-xs text-gold-300 hover:underline">{t('common.seeAll')} →</Link>}>
          {!lb ? <Loading /> : !lb.items.length ? <Empty /> : (
            <ol className="space-y-2">
              {lb.items.map((p: any) => (
                <li key={p.nickname} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2">
                  <span className={`w-5 text-center font-bold ${p.rank <= 3 ? 'text-gold-300' : 'text-white/40'}`}>{p.rank}</span>
                  <Avatar name={p.avatar} size={28} />
                  <Link href={`/u/${p.nickname}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">{p.nickname}</Link>
                  <Badge color="gold">{p.rating}</Badge>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Panel title={t('home.transactions')} action={<Link href="/wallet" className="text-xs text-gold-300 hover:underline">{t('common.seeAll')} →</Link>}>
          {!tx ? <Loading /> : !tx.items.length ? <Empty /> : (
            <ul className="divide-y divide-white/5">
              {tx.items.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{t(`tx.${e.type}`)}</div>
                    <div className="text-[11px] text-white/40">{fmtDate(e.createdAt, locale)}</div>
                  </div>
                  <Coins amount={e.amount} currency={e.currency} signed />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <RulesTeaser />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { me } = useApp();
  if (me === undefined) return <Loading />;
  return (
    <>
      <div className={me ? 'phone:hidden' : ''}><InstallBanner /></div>
      {me ? (
        <>
          <div className="hidden phone:block"><MobileLobby /></div>
          <div className="phone:hidden"><Dashboard /></div>
        </>
      ) : <Guest />}
    </>
  );
}
