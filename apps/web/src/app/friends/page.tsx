'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { Button, Empty, ErrorText, Loading, PageTitle, Panel, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useRequireAuth, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

interface Person { nickname: string; avatar: string; rating: number; level: number; online: boolean; playing: boolean; matchId?: string | null }

function Row({ p, children }: { p: Person; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2">
      <span className="relative">
        <Avatar name={p.avatar} size={40} />
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-ink-900 ${p.online ? 'bg-felt-500' : 'bg-white/25'}`} />
      </span>
      <Link href={`/u/${encodeURIComponent(p.nickname)}`} className="min-w-0 flex-1">
        <div className="truncate font-semibold">{p.nickname}</div>
        <div className="text-[11px] text-white/45">★ {p.rating} · {p.playing ? t('friendsList.playing') : p.online ? t('friendsList.online') : t('friendsList.offline')}</div>
      </Link>
      <div className="flex shrink-0 gap-1.5">{children}</div>
    </li>
  );
}

export default function FriendsListPage() {
  const { t } = useI18n();
  const me = useRequireAuth();
  const { data, mutate } = useSWR<{ friends: Person[]; incoming: Person[]; outgoing: Person[] }>(me ? '/friends' : null, { refreshInterval: 20_000 });
  useSocketEvent('friends:changed', () => mutate());
  const [nick, setNick] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setError(e);
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = nick.trim();
    if (!n) return;
    act(async () => {
      const r = await api(`/friends/${encodeURIComponent(n)}`, { method: 'POST' });
      setNotice(r.status === 'friends' ? t('friendsList.nowFriends', { name: n }) : t('friendsList.sent', { name: n }));
      setNick('');
    });
  };
  if (!me) return <Loading />;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle sub={t('friendsList.sub')}>{t('nav.myFriends')}</PageTitle>
      <Panel>
        <form onSubmit={add} className="flex gap-2">
          <input className={inputCls} placeholder={t('friendsList.addPlaceholder')} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} />
          <Button variant="gold" type="submit">➕ {t('friendsList.add')}</Button>
        </form>
        {notice && <p className="mt-2 text-sm text-felt-500">{notice}</p>}
        <ErrorText error={error} />
      </Panel>
      {!data ? <Loading /> : (
        <>
          {data.incoming.length > 0 && (
            <Panel title={`📩 ${t('friendsList.incoming')}`}>
              <ul className="space-y-2">
                {data.incoming.map((p) => (
                  <Row key={p.nickname} p={p}>
                    <Button size="sm" variant="emerald" onClick={() => act(() => api(`/friends/${encodeURIComponent(p.nickname)}/accept`, { method: 'POST' }))}>{t('friendsList.accept')}</Button>
                    <Button size="sm" variant="subtle" onClick={() => act(() => api(`/friends/${encodeURIComponent(p.nickname)}`, { method: 'DELETE' }))}>✕</Button>
                  </Row>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title={`👥 ${t('nav.myFriends')} (${data.friends.length})`}>
            {!data.friends.length ? <Empty /> : (
              <ul className="space-y-2">
                {data.friends.map((p) => (
                  <Row key={p.nickname} p={p}>
                    {p.matchId && <Link href={`/watch/${p.matchId}`}><Button size="sm" variant="emerald">👁 {t('watch.watch')}</Button></Link>}
                    <Button size="sm" variant="subtle" onClick={() => confirm(t('friendsList.removeConfirm', { name: p.nickname })) && act(() => api(`/friends/${encodeURIComponent(p.nickname)}`, { method: 'DELETE' }))}>✕</Button>
                  </Row>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-white/40">{t('friendsList.inviteHint')}</p>
          </Panel>
          {data.outgoing.length > 0 && (
            <Panel title={`⏳ ${t('friendsList.outgoing')}`}>
              <ul className="space-y-2">
                {data.outgoing.map((p) => (
                  <Row key={p.nickname} p={p}>
                    <Button size="sm" variant="subtle" onClick={() => act(() => api(`/friends/${encodeURIComponent(p.nickname)}`, { method: 'DELETE' }))}>{t('friendsList.cancel')}</Button>
                  </Row>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
