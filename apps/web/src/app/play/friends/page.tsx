'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { kindRules, useChessClock, useVariant } from '@/components/PlayActions';
import { RoomSettingsForm, RoomSettingsValue, defaultRoomSettings } from '@/components/RoomSettingsForm';
import { Button, Empty, ErrorText, PageTitle, Panel, StatusBadge, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp, useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export default function FriendsPage() {
  const { t } = useI18n();
  const me = useRequireAuth();
  const { config } = useApp();
  const router = useRouter();
  const [settings, setSettings] = useState<RoomSettingsValue | null>(null);
  const [variant] = useVariant();
  const [clock] = useChessClock();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data: rooms } = useSWR<any[]>(me ? '/rooms/mine' : null);
  useEffect(() => {
    if (config && !settings) {
      const base = defaultRoomSettings(config.game.defaultRules);
      // start from the game picked on the home page
      setSettings(variant === 'short' || variant === 'long' ? { ...base, rules: { ...base.rules, variant } } : { ...base, rules: kindRules(variant, clock) });
    }
  }, [config, settings]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api('/rooms', { method: 'POST', body: settings });
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(c)) router.push(`/room/${c}`);
  };

  return (
    <div>
      <PageTitle sub={t('home.playFriendsSub')}>{t('friends.title')}</PageTitle>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel title={`➕ ${t('friends.create')}`}>
          {settings && <RoomSettingsForm value={settings} onChange={setSettings} />}
          <div className="mt-4 space-y-3">
            <ErrorText error={error} />
            <Button variant="gold" size="lg" className="w-full" onClick={create} loading={busy}>{t('friends.create')}</Button>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title={`🔑 ${t('friends.join')}`}>
            <form onSubmit={join} className="flex gap-2">
              <input className={`${inputCls} font-mono uppercase tracking-[0.3em]`} placeholder="ABC123" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('friends.code')} />
              <Button variant="emerald">{t('friends.joinBtn')}</Button>
            </form>
          </Panel>
          <Panel title={t('friends.myRooms')}>
            {!rooms?.length ? <Empty /> : (
              <ul className="space-y-2">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Link href={`/room/${r.code}`} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2.5 hover:bg-black/30">
                      <span className="font-mono font-bold tracking-widest">{r.code}</span>
                      <span className="flex items-center gap-2 text-xs text-white/50">{r.seats.filter((s: any) => s.userId || s.isBot).length}/4 <StatusBadge status={r.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
