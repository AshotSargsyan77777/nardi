'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { Avatar } from './Avatar';
import { Button } from './ui';

/** Live «X invites you to a table» pop-up, on every page. */
export function FriendInviteToast() {
  const { t } = useI18n();
  const router = useRouter();
  const [invite, setInvite] = useState<{ from: string; avatar: string; roomCode: string } | null>(null);
  useSocketEvent<{ from: string; avatar: string; roomCode: string }>('friend:invite', (d) => {
    setInvite(d);
    sound()?.pop();
  });
  return (
    <AnimatePresence>
      {invite && (
        <motion.div initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }} className="fixed inset-x-2 top-[max(8px,env(safe-area-inset-top))] z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-850 p-3 shadow-2xl ring-1 ring-gold-400/40">
          <Avatar name={invite.avatar} size={40} />
          <div className="min-w-0 flex-1 text-sm"><b>{invite.from}</b> {t('friendsList.invitesYou')}</div>
          <Button size="sm" variant="gold" onClick={() => { const c = invite.roomCode; setInvite(null); router.push(`/room/${c}`); }}>{t('friendsList.join')}</Button>
          <button onClick={() => setInvite(null)} className="px-1 text-white/40" aria-label="close">✕</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** In a room: invite online friends to it. */
export function InviteFriends({ roomCode }: { roomCode: string }) {
  const { t } = useI18n();
  const { data } = useSWR<{ friends: { nickname: string; avatar: string; online: boolean; playing: boolean }[] }>('/friends', { refreshInterval: 15_000 });
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const online = (data?.friends ?? []).filter((f) => f.online && !f.playing);
  if (!data) return null;
  return (
    <div>
      <div className="mb-2 text-sm font-semibold">👥 {t('friendsList.inviteTitle')}</div>
      {!online.length ? <p className="text-xs text-white/40">{t('friendsList.noneOnline')}</p> : (
        <div className="flex flex-wrap gap-2">
          {online.map((f) => (
            <button
              key={f.nickname}
              disabled={sent[f.nickname]}
              onClick={async () => { await api(`/friends/${encodeURIComponent(f.nickname)}/invite`, { method: 'POST', body: { roomCode } }); setSent((s) => ({ ...s, [f.nickname]: true })); }}
              className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3 text-sm ring-1 ring-white/10 disabled:opacity-50"
            >
              <Avatar name={f.avatar} size={26} />
              {f.nickname} {sent[f.nickname] ? '✓' : '➕'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
