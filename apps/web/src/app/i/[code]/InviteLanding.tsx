'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import useSWR from 'swr';
import { LogoMark } from '@/components/Logo';
import { Avatar } from '@/components/Avatar';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { saveRef } from '@/lib/referral';

/** Where an invite link lands: remembers who invited, then sends the friend to sign up. */
export function InviteLanding({ code }: { code: string }) {
  const { t } = useI18n();
  const { me, config } = useApp();
  const { data: inviter } = useSWR<any>(`/users/profile/${encodeURIComponent(code)}`, { shouldRetryOnError: false });
  useEffect(() => { if (!me) saveRef(code); }, [code, me]);
  const bonus = config?.economy.referral?.friend ?? 0;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8 text-center">
      <LogoMark size={96} />
      {inviter?.nickname && <Avatar name={inviter.avatar} size={56} />}
      <h1 className="font-display text-2xl font-extrabold">{t('invite.landingTitle', { name: inviter?.nickname ?? code })}</h1>
      <p className="text-white/70">{t('invite.landingText')}</p>
      {!!bonus && <p className="rounded-full bg-gold-400/15 px-4 py-1.5 text-sm font-bold text-gold-200 ring-1 ring-gold-400/40">🎁 +{bonus} FC · {t('invite.afterGames', { n: config?.economy.referral?.games ?? 3 })}</p>}
      {me ? (
        <Link href="/" className="w-full rounded-2xl bg-gold-grad py-3 font-display text-lg font-extrabold text-ink-950">▶ {t('home.play')}</Link>
      ) : (
        <>
          <Link href="/register" className="w-full rounded-2xl bg-gold-grad py-3 font-display text-lg font-extrabold text-ink-950">{t('nav.register')}</Link>
          <Link href="/login" className="text-sm text-white/60 underline">{t('nav.login')}</Link>
        </>
      )}
    </div>
  );
}
