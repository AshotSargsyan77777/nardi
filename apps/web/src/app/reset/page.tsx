'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

/** Opened from the reset e-mail: set a new password, then you are signed in. */
function ResetForm() {
  const { t } = useI18n();
  const { refreshMe } = useApp();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError(new Error(t('reset.mismatch')));
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset', { method: 'POST', body: { token, password } });
      await refreshMe();
      router.replace('/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  if (!token) return <AuthCard title={t('reset.title')}><p className="text-sm text-white/70">{t('reset.badLink')} <Link href="/forgot" className="font-semibold text-gold-300 hover:underline">{t('reset.again')}</Link></p></AuthCard>;
  return (
    <AuthCard title={t('reset.title')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('reset.newPassword')}><input className={inputCls} type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></Field>
        <Field label={t('reset.repeat')}><input className={inputCls} type="password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required /></Field>
        <ErrorText error={error} />
        <Button variant="gold" size="lg" className="w-full" loading={busy}>{t('reset.save')}</Button>
        <p className="text-center text-sm"><Link href="/forgot" className="text-white/50 hover:underline">{t('reset.again')}</Link></p>
      </form>
    </AuthCard>
  );
}

export default function ResetPage() {
  return <Suspense><ResetForm /></Suspense>;
}
