'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { fmtDate } from '@/lib/format';
import { LOCALES, useI18n } from '@/lib/i18n';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import { LookChoices } from './LookChoices';
import { PushToggle } from './PushToggle';
import { MusicButton, SoundChoices, useSoundPrefs } from './Sound';
import { Coins } from './ui';

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOut]);
  return ref;
}

function Notifications() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const { data, mutate } = useSWR<{ unread: number; items: any[] }>('/notifications', { refreshInterval: 30000 });
  const ref = useClickOutside(() => setOpen(false));
  const label = (n: any) => {
    const key = `notif.${n.title}`;
    const title = t(key) !== key ? t(key) : t(`notif.${n.type}`);
    const body = n.type === 'achievement' ? t(`ach.${n.body}`)
      : n.title === 'tournament.place' ? t('notif.tournament.placeBody', { n: n.body, prize: n.data?.prize ? ` · +${Number(n.data.prize).toLocaleString()} FC` : '' })
      : n.body;
    return { title, body };
  };
  return (
    <div className="relative" ref={ref}>
      <button aria-label={t('nav.notifications')} onClick={() => setOpen(!open)} className="relative grid h-10 w-10 place-items-center rounded-xl text-lg text-white/70 hover:bg-white/5 hover:text-white">
        🔔
        {!!data?.unread && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ruby-500 px-1 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <span className="text-sm font-bold">{t('nav.notifications')}</span>
            {!!data?.unread && (
              <button className="text-xs text-gold-300 hover:underline" onClick={async () => { await api('/notifications/read', { method: 'POST' }); mutate(); }}>
                {t('notif.markRead')}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="p-6 text-center text-sm text-white/40">{t('notif.empty')}</p>}
            {data?.items.map((n) => {
              const l = label(n);
              return (
                <div key={n.id} className={`border-b border-white/5 px-4 py-3 text-sm ${n.readAt ? 'opacity-60' : ''}`}>
                  <div className="font-semibold">{l.title}</div>
                  {l.body && <div className="text-white/60">{l.body}</div>}
                  <div className="mt-1 text-[11px] text-white/35">{fmtDate(n.createdAt, locale)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useApp();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  if (!me) return null;
  const isStaff = me.role !== 'USER';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-white/5" aria-label={t('nav.profile')}>
        <Avatar name={me.avatar} size={34} />
        <span className="hidden max-w-[110px] truncate text-sm font-semibold lg:block">{me.nickname}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-2xl border border-white/10 bg-ink-850 py-1 shadow-2xl" onClick={() => setOpen(false)}>
          {[
            ['/profile', t('nav.profile')], ['/friends', t('nav.myFriends')], ['/invite', t('invite.title')], ['/history', t('nav.history')], ['/wallet', t('nav.wallet')], ['/profile/settings', t('nav.settings')], ['/support', t('nav.support')],
            ...(isStaff ? [['/admin', t('nav.admin')]] : []),
          ].map(([href, label]) => (
            <Link key={href} href={href} className="block px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 hover:text-white">{label}</Link>
          ))}
          <button onClick={logout} className="block w-full px-4 py-2.5 text-left text-sm text-ruby-400 hover:bg-white/5">{t('nav.logout')}</button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { me, config } = useApp();
  const { t } = useI18n();
  const path = usePathname();
  const links = [
    ['/', t('nav.home')], ['/play/friends', t('nav.friends')], ['/play/random', t('nav.random')], ['/leaderboard', t('nav.leaderboard')], ['/rules', t('nav.rules')],
  ];
  return (
    <>
    <PhoneBar />
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl phone:hidden">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link href="/" className="shrink-0"><Logo /></Link>
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${path === href ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'}`}>{label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          {me ? (
            <>
              <Link href="/wallet" className="flex items-center gap-2 rounded-xl bg-black/30 px-3 py-1.5 ring-1 ring-gold-400/20 hover:ring-gold-400/40" aria-label={t('wallet.balance')}>
                <span className="text-gold-300">◉</span>
                <Coins amount={me.balances.FUN} currency="FUN" className="text-sm" />
              </Link>
              <MusicButton className="grid h-10 w-10 place-items-center rounded-xl text-lg text-white/70 hover:bg-white/5" />
              <Notifications />
              <UserMenu />
            </>
          ) : me === null ? (
            <>
              <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-white/80 hover:text-white">{t('nav.login')}</Link>
              {config?.features.registrationOpen !== false && <Link href="/register" className="rounded-xl bg-gold-grad px-4 py-2 text-sm font-bold text-ink-950">{t('nav.register')}</Link>}
            </>
          ) : null}
        </div>
      </div>
    </header>
    </>
  );
}

/** Phones: a game-style bar — avatar & level on the lobby, «Back» elsewhere, coins and a ☰ menu. */
function PhoneBar() {
  const { me, config } = useApp();
  const { t } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const home = path === '/';
  const lvlPct = me ? Math.min(100, Math.round(((me.xp - me.levelXp) / Math.max(1, me.nextLevelXp - me.levelXp)) * 100)) : 0;
  return (
    <header className="sticky top-0 z-30 hidden items-center gap-2 bg-ink-950 px-3 pb-2 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] pt-[max(8px,env(safe-area-inset-top))] phone:flex">
      {me && home ? (
        <Link href="/profile" className="flex min-w-0 items-center gap-2">
          <span className="relative">
            <Avatar name={me.avatar} size={38} ring="ring-2 ring-gold-400/60" />
            <span className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold-grad px-1 text-[10px] font-black text-ink-950">{me.level}</span>
          </span>
          <span className="min-w-0">
            <span className="block max-w-[120px] truncate text-sm font-bold">{me.nickname}</span>
            <span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-gold-grad" style={{ width: `${lvlPct}%` }} /></span>
          </span>
        </Link>
      ) : !home ? (
        <button onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))} className="flex items-center gap-1.5 rounded-full bg-white/5 py-1.5 pl-2 pr-3 text-sm font-semibold text-white/80 ring-1 ring-white/10">
          <span className="grid h-6 w-6 place-items-center rounded-full ring-1 ring-white/30">‹</span>{t('common.back')}
        </button>
      ) : (
        <Link href="/"><Logo /></Link>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {me ? (
          <>
            <Link href="/wallet" className="flex items-center gap-3 rounded-full bg-black/40 px-3 py-1.5 text-sm ring-1 ring-white/10" aria-label={t('wallet.balance')}>
              <Coins amount={me.balances.FUN} currency="FUN" />
            </Link>
            <MusicButton className="grid h-10 w-9 place-items-center rounded-xl text-lg" />
            <span className="hidden short:block"><Notifications /></span>
            <button onClick={() => setMenu(true)} aria-label="menu" className="grid h-10 w-10 place-items-center rounded-xl text-2xl leading-none text-white/80">☰</button>
          </>
        ) : me === null ? (
          <>
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-white/80">{t('nav.login')}</Link>
            {config?.features.registrationOpen !== false && <Link href="/register" className="rounded-xl bg-gold-grad px-4 py-2 text-sm font-bold text-ink-950">{t('nav.register')}</Link>}
          </>
        ) : null}
      </div>
      {menu && <PhoneMenu onClose={() => setMenu(false)} />}
    </header>
  );
}

function PhoneMenu({ onClose }: { onClose: () => void }) {
  const { me, logout } = useApp();
  const { t, locale, setLocale } = useI18n();
  const { refreshMe, config } = useApp();
  if (!me) return null;
  const items: [string, string, string][] = [
    ['/', '🏠', t('nav.home')], ['/play', '🎲', t('nav.play')], ['/friends', '👥', t('nav.myFriends')], ['/invite', '🎁', t('invite.title')], ['/tournaments', '🏟️', t('nav.tournaments')], ['/leaderboard', '🏆', t('nav.leaderboard')], ['/history', '📜', t('nav.history')],
    ['/wallet', '◉', t('nav.wallet')], ['/profile', '👤', t('nav.profile')], ['/profile/settings', '⚙️', t('nav.settings')],
    ['/rules', '📖', t('nav.rules')], ['/support', '💬', t('nav.support')],
    ...(me.role !== 'USER' ? [['/admin', '🛠️', t('nav.admin')] as [string, string, string]] : []),
  ];
  const snd = useSoundPrefs();
  const change = async (l: any) => {
    setLocale(l);
    await api('/users/me', { method: 'PATCH', body: { locale: l } }).catch(() => undefined);
    refreshMe();
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70" onClick={onClose}>
      <nav className="flex h-full w-[290px] max-w-[85%] flex-col overflow-y-auto bg-ink-900 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-display text-lg font-extrabold text-gold-300">NARDI</span>
          <button onClick={onClose} aria-label="close" className="grid h-9 w-9 place-items-center rounded-xl text-xl text-white/60">✕</button>
        </div>
        <div className="flex-1 px-2">
          {items.map(([href, icon, label]) => (
            <Link key={href} href={href} onClick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold text-white/85 active:bg-white/10">
              <span className="w-6 text-center text-lg">{icon}</span>{label}
            </Link>
          ))}
        </div>
        <div className="space-y-1 px-4 pt-2">
          {([[t('sound.music'), snd.music, snd.toggleMusic], [t('sound.sfx'), snd.sfx, snd.toggleSfx]] as const).map(([label, on, toggle]) => (
            <button key={label} onClick={toggle} className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold">
              {label}
              <span className={`h-5 w-9 rounded-full p-0.5 transition ${on ? 'bg-felt-500' : 'bg-white/15'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} /></span>
            </button>
          ))}
          <div className="pt-1"><PushToggle /></div>
          <div className="pt-1"><SoundChoices compact /></div>
          <div className="pt-1"><LookChoices compact /></div>
        </div>
        <div className="flex gap-1 px-4 py-3">
          {LOCALES.map((l) => (
            <button key={l.code} onClick={() => change(l.code)} className={`flex-1 rounded-lg py-1.5 text-sm ${locale === l.code ? 'bg-white/10 text-white' : 'text-white/50'}`}>{l.label}</button>
          ))}
        </div>
        <button onClick={logout} className="mx-4 mb-4 rounded-xl bg-white/5 py-2.5 text-sm font-semibold text-ruby-400">{t('nav.logout')}</button>
      </nav>
    </div>
  );
}

export function MobileNav() {
  const { me } = useApp();
  const { t } = useI18n();
  const path = usePathname();
  if (!me || path?.startsWith('/match/')) return null;
  const items = [
    ['/', '🏠', t('nav.home')], ['/play', '🎲', t('nav.play')], ['/leaderboard', '🏆', t('nav.leaderboard')], ['/wallet', '◉', t('nav.wallet')], ['/profile', '👤', t('nav.profile')],
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden phone:hidden">
      <div className="grid grid-cols-5">
        {items.map(([href, icon, label]) => {
          const active = href === '/' ? path === '/' : path?.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? 'text-gold-300' : 'text-white/55'}`}>
              <span className="text-lg leading-none">{icon}</span>
              <span className="max-w-full truncate px-1">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Footer() {
  const { t, locale, setLocale } = useI18n();
  const { me, refreshMe, config } = useApp();
  const change = async (l: any) => {
    setLocale(l);
    if (me) {
      await api('/users/me', { method: 'PATCH', body: { locale: l } }).catch(() => undefined);
      refreshMe();
    }
  };
  return (
    <footer className="mt-16 border-t border-white/[0.06] pb-24 lg:pb-8 phone:hidden">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-4">
          <Link href="/rules" className="hover:text-white">{t('nav.rules')}</Link>
          <Link href="/support" className="hover:text-white">{t('nav.support')}</Link>
          <Link href="/legal" className="hover:text-white">{t('nav.legal')}</Link>
          <span>© NARDI</span>
        </div>
        <div className="flex gap-1">
          {LOCALES.map((l) => (
            <button key={l.code} onClick={() => change(l.code)} className={`rounded-lg px-2.5 py-1 ${locale === l.code ? 'bg-white/10 text-white' : 'hover:text-white'}`}>{l.label}</button>
          ))}
        </div>
      </div>
    </footer>
  );
}
