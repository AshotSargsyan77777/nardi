'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

function LoginForm() {
  const { t } = useI18n();
  const { refreshMe } = useApp();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { login, password } });
      await refreshMe();
      router.replace(next);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <AuthCard title={t('auth.welcomeBack')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.loginOrEmail')}><input className={inputCls} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Field>
        <Field label={t('auth.password')}><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        <ErrorText error={error} />
        <Button variant="gold" size="lg" className="w-full" loading={busy}>{t('auth.submitLogin')}</Button>
        <p className="text-center text-sm text-white/50">{t('auth.noAccount')} <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-gold-300 hover:underline">{t('nav.register')}</Link></p>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
