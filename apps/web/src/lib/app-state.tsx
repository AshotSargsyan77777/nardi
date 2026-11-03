'use client';
import { useRouter, usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import useSWR, { SWRConfig } from 'swr';
import { api, fetcher } from './api';
import { Locale, useI18n } from './i18n';

export interface Me {
  id: string; email: string; nickname: string; avatar: string; role: 'USER' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'; locale: Locale;
  createdAt: string; rating: number; xp: number; level: number; nextLevelXp: number; levelXp: number;
  stats: { games: number; wins: number; losses: number; winRate: number };
  balances: { BLOT: number; FUN: number };
  settings: { notifications?: Record<string, boolean>; privacy?: Record<string, boolean>; chatEnabled?: boolean };
  restrictions: Record<string, boolean>; kycStatus: string; achievements: { code: string; unlockedAt: string }[];
}

export interface PublicConfig {
  features: { platformMode: 'A' | 'B'; purchasesEnabled: boolean; blotStakesEnabled: boolean; funStakesEnabled: boolean; withdrawalsEnabled: boolean; tournamentsEnabled: boolean; practiceBotsEnabled: boolean; registrationOpen: boolean; moneyModeApproved: boolean };
  currencies: { code: 'BLOT' | 'FUN'; name: string; symbol: string }[];
  game: { defaultRules: Record<string, any>; allowedTargetScores: number[]; allowedTurnTimeouts: number[]; stakeOptions: { FUN: number[]; BLOT: number[] }; hostEditableRules: string[]; emotes?: import('@/components/game/EmotePanel').Emotes };
  economy: { dailyBonus: { FUN: number; belowBalance: number }; referral?: { inviter: number; friend: number; games: number } };
  legal: { minAge: number; supportEmail: string; termsVersion: string };
}

interface Ctx {
  me: Me | null | undefined;
  refreshMe: () => Promise<any>;
  config: PublicConfig | undefined;
  socket: Socket | null;
  connected: boolean;
  logout: () => Promise<void>;
}
const AppCtx = createContext<Ctx>(null!);

function wsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const { protocol, hostname, port } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:4000` : window.location.origin;
}

function Inner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setLocale, locale } = useI18n();
  const { data: me, mutate } = useSWR<Me | null>('/auth/me', (p: string) => api(p).catch(() => null), { revalidateOnFocus: true });
  const { data: config } = useSWR<PublicConfig>('/config', fetcher, { revalidateOnFocus: false });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (me?.locale && me.locale !== locale) setLocale(me.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.locale]);

  useEffect(() => {
    if (!me?.id) return;
    const s = io(wsUrl(), {
      path: '/socket.io',
      transports: ['websocket'],
      // a fresh one-time ticket for every (re)connection attempt
      auth: (cb) => {
        api<{ ticket: string }>('/auth/ws-ticket', { method: 'POST' }).then((r) => cb({ ticket: r.ticket })).catch(() => cb({ ticket: '' }));
      },
      reconnectionDelayMax: 5000,
    });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('match:started', ({ matchId }: { matchId: string }) => {
      if (!pathRef.current?.startsWith(`/match/${matchId}`)) router.push(`/match/${matchId}`);
    });
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
      setConnected(false);
    };
  }, [me?.id, router]);

  const value = useMemo<Ctx>(() => ({
    me, config, socket, connected,
    refreshMe: () => mutate(),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      await mutate(null, { revalidate: false });
      router.push('/');
    },
  }), [me, config, socket, connected, mutate, router]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, shouldRetryOnError: false }}>
      <Inner>{children}</Inner>
    </SWRConfig>
  );
}

export const useApp = () => useContext(AppCtx);

/** Redirects anonymous visitors to the login page. Returns the user once known. */
export function useRequireAuth() {
  const { me } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (me === null) router.replace(`/login?next=${encodeURIComponent(pathname ?? '/')}`);
  }, [me, router, pathname]);
  return me ?? null;
}

export function useSocketEvent<T = any>(event: string, handler: (data: T) => void) {
  const { socket } = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (d: T) => ref.current(d);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}
