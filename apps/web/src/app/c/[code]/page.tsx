'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

/** A club invite link: shows the club and joins it (after signing in or up). */
export default function ClubInvitePage() {
  const { code } = useParams<{ code: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const { me } = useApp();
  const { data, error } = useSWR<any>(me ? `/clubs/invite/${code}` : null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const back = encodeURIComponent(`/c/${code}`);
  if (me === undefined) return <Loading />;
  if (!me) {
    return (
      <AuthCard title={t('clubs.inviteTitle')}>
        <p className="mb-4 text-sm text-white/65">{t('clubs.inviteSignIn')}</p>
        <div className="flex gap-2">
          <Link href={`/register?next=${back}`} className="flex-1"><Button variant="gold" className="w-full">{t('nav.register')}</Button></Link>
          <Link href={`/login?next=${back}`} className="flex-1"><Button className="w-full">{t('nav.login')}</Button></Link>
        </div>
      </AuthCard>
    );
  }
  if (error) return <AuthCard title={t('clubs.inviteTitle')}><ErrorText error={error} /></AuthCard>;
  if (!data) return <Loading />;
  const join = async () => {
    setBusy(true); setErr(null);
    try { const r = await api<{ id: string }>(`/clubs/invite/${code}/join`, { method: 'POST' }); router.replace(`/clubs/${r.id}`); } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <AuthCard title={t('clubs.inviteTitle')}>
      <div className="mb-4 text-center">
        <div className="text-5xl">{data.emblem}</div>
        <div className="mt-2 font-display text-2xl font-extrabold">{data.name}</div>
        {data.description && <p className="mt-1 text-sm text-white/60">{data.description}</p>}
        <p className="mt-1 text-xs text-white/45">👥 {data.members}</p>
      </div>
      <ErrorText error={err} />
      <Button variant="gold" size="lg" className="w-full" loading={busy} onClick={join}>{t('clubs.joinBtn')}</Button>
    </AuthCard>
  );
}
