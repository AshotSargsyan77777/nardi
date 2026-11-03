'use client';
import { InviteFriends } from '@/components/FriendInvites';
import { RoomDTO, SeatInfo } from '@nardi/engine';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Chat } from '@/components/Chat';
import { RoomSettingsForm, RoomSettingsValue } from '@/components/RoomSettingsForm';
import { Badge, Button, Coins, ErrorText, Loading, Modal, PageTitle, Panel, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp, useRequireAuth, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const { t } = useI18n();
  const me = useRequireAuth();
  const { socket } = useApp();
  const router = useRouter();
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<RoomSettingsValue | null>(null);

  const load = useCallback(() => api<RoomDTO>(`/rooms/${code}`).then(setRoom).catch(setError), [code]);
  useEffect(() => {
    if (me) load();
  }, [me, load]);
  useEffect(() => {
    if (!socket || !room) return;
    socket.emit('room:subscribe', { code: room.code });
    const resub = () => socket.emit('room:subscribe', { code: room.code });
    socket.on('connect', resub);
    return () => {
      socket.off('connect', resub);
      socket.emit('room:unsubscribe', { code: room.code });
    };
  }, [socket, room?.code]); // eslint-disable-line react-hooks/exhaustive-deps
  useSocketEvent<RoomDTO>('room:state', (r) => r.code === room?.code && setRoom(r));
  useSocketEvent<{ code: string }>('room:kicked', (d) => {
    if (d.code === room?.code) {
      alert(t('room.kicked'));
      router.push('/play/friends');
    }
  });

  if (!me) return <Loading />;
  if (!room) return error ? <ErrorText error={error} /> : <Loading />;

  const mySeat = room.seats.find((s) => s.userId === me.id);
  const isHost = room.hostId === me.id;
  const open = ['WAITING', 'READY', 'FINISHED'].includes(room.status);
  const filled = room.seats.filter((s) => s.userId || s.isBot).length;
  const act = async (key: string, path: string, body?: any, method = 'POST') => {
    setBusy(key);
    setError(null);
    try {
      setRoom(await api(path, { method, body }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const base = `/rooms/${room.code}`;
  const share = async () => {
    if (navigator.share) await navigator.share({ title: 'NARDI', url: room.inviteUrl }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(room.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const SeatCard = ({ s }: { s: SeatInfo }) => {
    const taken = s.userId || s.isBot;
    return (
      <div className={`relative flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center ${s.seat === 0 ? 'border-felt-500/30 bg-felt-900/40' : 'border-gold-400/25 bg-gold-600/10'}`}>
        <span className="absolute left-2 top-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/40"><span className={`h-2.5 w-2.5 rounded-full ${s.seat === 0 ? 'bg-[#f4ead2]' : 'bg-[#2a1a14] ring-1 ring-gold-500/60'}`} />{s.seat === 0 ? t('game.light') : t('game.dark')}</span>
        {taken ? (
          <>
            <Avatar name={s.avatar} size={48} ring={s.ready ? 'ring-2 ring-felt-500' : 'ring-2 ring-white/10'} />
            <div className="max-w-full truncate text-sm font-bold">{s.nickname}{s.userId === me.id && ` (${t('common.you')})`}</div>
            <div className="flex flex-wrap justify-center gap-1">
              {s.userId === room.hostId && <Badge color="gold">{t('room.host')}</Badge>}
              {s.isBot && <Badge>{t('common.bot')}</Badge>}
              {s.ready ? <Badge color="green">✓ {t('room.isReady')}</Badge> : <Badge>{t('room.notReady')}</Badge>}
              {!s.isBot && !s.connected && <Badge color="red">offline</Badge>}
            </div>
            {isHost && open && s.userId !== me.id && <button onClick={() => act(`rm${s.seat}`, `${base}/seats/${s.seat}`, undefined, 'DELETE')} className="text-xs text-ruby-400 hover:underline">{t('room.remove')}</button>}
          </>
        ) : (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-dashed border-white/15 text-white/30">+</div>
            <div className="text-sm text-white/40">{t('room.emptySeat')}</div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {open && (mySeat ? <Button size="sm" onClick={() => act(`seat${s.seat}`, `${base}/seat`, { seat: s.seat })}>{t('room.takeSeat')}</Button> : <Button size="sm" variant="emerald" onClick={() => act('join', `${base}/join`, { seat: s.seat })}>{t('room.takeSeat')}</Button>)}
              {isHost && open && room.settings.allowBots && room.settings.stake === 0 && <Button size="sm" onClick={() => act(`bot${s.seat}`, `${base}/bots`, { seat: s.seat })}>🤖 {t('room.addBot')}</Button>}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageTitle sub={<span className="flex items-center gap-2"><StatusBadge status={room.status} /> {filled}/2</span>} action={room.matchId && room.status === 'PLAYING' ? <Link href={`/match/${room.matchId}`}><Button variant="gold">{t('room.goToMatch')}</Button></Link> : undefined}>
        {t('room.title', { code: room.code })}
      </PageTitle>
      {room.status === 'CANCELLED' && <Panel className="mb-4"><p className="text-ruby-400">{t('room.cancelled')}</p></Panel>}
      {room.status === 'FINISHED' && <Panel className="mb-4"><p className="text-gold-200">🏁 {t('room.finished')}</p></Panel>}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Panel>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => <SeatCard key={i} s={room.seats[i]} />)}
            </div>
            <ErrorText error={error} />
            <div className="mt-4 flex flex-wrap gap-2">
              {!mySeat && open && <Button variant="emerald" size="lg" onClick={() => act('join', `${base}/join`, {})} loading={busy === 'join'}>{t('room.joinRoom')}</Button>}
              {mySeat && open && (
                <Button variant={mySeat.ready ? 'ghost' : 'emerald'} size="lg" onClick={() => act('ready', `${base}/ready`, { ready: !mySeat.ready })} loading={busy === 'ready'}>
                  {mySeat.ready ? t('room.notReady') : `✓ ${t('room.ready')}`}
                </Button>
              )}
              {isHost && open && (
                <Button variant="gold" size="lg" disabled={room.status !== 'READY'} onClick={() => act('start', `${base}/start`)} loading={busy === 'start'} title={t('room.needAll')}>
                  ▶ {t('room.start')}
                </Button>
              )}
              {mySeat && open && <Button size="lg" variant="subtle" onClick={async () => { await act('leave', `${base}/leave`); router.push('/play/friends'); }}>{t('room.leave')}</Button>}
              {isHost && open && <Button size="lg" variant="subtle" onClick={() => act('cancel', `${base}/cancel`)}>{t('room.cancelRoom')}</Button>}
            </div>
            {isHost && room.status !== 'READY' && open && <p className="mt-2 text-xs text-white/40">{t('room.needAll')}</p>}
            {mySeat && open && <div className="mt-4 border-t border-white/5 pt-3"><InviteFriends roomCode={room.code} /></div>}
          </Panel>

          <Panel title={t('friends.settings')} action={isHost && open ? <Button size="sm" onClick={() => setEditing({ ...room.settings, rules: { ...room.settings.rules } } as any)}>{t('profile.edit')}</Button> : undefined}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-white/40">{t('friends.variant')}</dt><dd className="font-semibold">{t(`variant.${(room.settings.rules as any).variant ?? 'short'}`)}</dd></div>
              <div><dt className="text-white/40">{t('friends.targetScore')}</dt><dd className="font-semibold">{(room.settings.rules as any).targetScore}</dd></div>
              <div><dt className="text-white/40">{t('friends.turnTimer')}</dt><dd className="font-semibold">{(room.settings.rules as any).turnTimeoutSec} {t('common.seconds')}</dd></div>
              <div><dt className="text-white/40">{t('friends.stake')}</dt><dd className="font-semibold">{room.settings.stake ? <Coins amount={room.settings.stake} currency={room.settings.currency} /> : t('friends.noStake')}</dd></div>
              <div><dt className="text-white/40">{t('friends.chat')}</dt><dd className="font-semibold">{room.settings.chatEnabled ? t('common.on') : t('common.off')}</dd></div>
              <div><dt className="text-white/40">{t('friends.allowBots')}</dt><dd className="font-semibold">{room.settings.allowBots ? t('common.yes') : t('common.no')}</dd></div>
            </dl>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title={`📨 ${t('room.invite')}`}>
            <p className="mb-2 text-sm text-white/55">{t('room.inviteText')}</p>
            <div className="mb-3 rounded-xl bg-black/30 p-3 text-center font-mono text-3xl font-extrabold tracking-[0.35em] text-gold-300">{room.code}</div>
            <div className="flex gap-2">
              <input readOnly value={room.inviteUrl} className="h-10 min-w-0 flex-1 rounded-lg bg-black/30 px-3 text-xs text-white/60 ring-1 ring-white/10" onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="emerald" onClick={share}>{copied ? t('common.copied') : typeof navigator !== 'undefined' && 'share' in navigator ? t('common.share') : t('common.copy')}</Button>
            </div>
          </Panel>
          {mySeat && <Chat channel={`room:${room.code}`} enabled={room.settings.chatEnabled} />}
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('friends.settings')} wide>
        {editing && <RoomSettingsForm value={editing} onChange={setEditing} />}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="subtle" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="gold" onClick={async () => { await act('settings', `${base}/settings`, editing, 'PATCH'); setEditing(null); }}>{t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}
