'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Avatar } from './Avatar';
import { Button, Coins, Panel } from './ui';
import { useI18n } from '@/lib/i18n';
import { inviteUrl } from '@/lib/referral';

/** «Invite a friend»: the personal link, share/copy buttons, the reward and who has joined. */
export function InviteFriends() {
  const { t } = useI18n();
  const { data } = useSWR<any>('/referrals');
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const url = inviteUrl(data.code);
  const text = t('invite.shareText');
  const share = async () => {
    if (navigator.share) return navigator.share({ title: 'NARDI', text, url }).catch(() => undefined);
    copy();
  };
  const copy = async () => {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const enc = encodeURIComponent;
  const links: [string, string][] = [
    ['WhatsApp', `https://wa.me/?text=${enc(`${text} ${url}`)}`],
    ['Telegram', `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
    ['Viber', `viber://forward?text=${enc(`${text} ${url}`)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
  ];
  return (
    <Panel title={`🎁 ${t('invite.title')}`}>
      <p className="text-sm text-white/75">{t('invite.how', { inviter: data.reward.inviter, friend: data.reward.friend, n: data.reward.games })}</p>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/30 p-2 ring-1 ring-white/10">
        <span className="min-w-0 flex-1 truncate px-2 font-mono text-sm text-gold-200">{url.replace(/^https?:\/\//, '')}</span>
        <Button size="sm" onClick={copy}>{copied ? '✓' : t('invite.copy')}</Button>
      </div>
      <Button variant="gold" className="mt-3 w-full" onClick={share}>📤 {t('invite.share')}</Button>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {links.map(([name, href]) => (
          <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-white/5 py-2 text-center text-xs font-semibold text-white/80 ring-1 ring-white/10">{name}</a>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-white/60">{t('invite.friends')}: <b className="text-white">{data.friends.length}</b></span>
        <span className="text-white/60">{t('invite.earned')}: <Coins amount={data.earned} currency="FUN" /></span>
      </div>
      {data.friends.length > 0 && (
        <ul className="mt-2 divide-y divide-white/5">
          {data.friends.map((f: any) => (
            <li key={f.nickname} className="flex items-center gap-2 py-2 text-sm">
              <Avatar name={f.avatar} size={26} />
              <span className="flex-1 truncate">{f.nickname}</span>
              {f.done ? <span className="text-xs font-bold text-felt-500">✓ {t('invite.rewarded')}</span>
                : <span className="text-xs text-white/50">{t('invite.games', { n: f.games, total: data.reward.games })}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
