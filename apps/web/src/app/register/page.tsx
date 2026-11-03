'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button, ErrorText, Field, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { AuthCard } from '@/components/AuthCard';
import { clearRef, readRef, saveRef } from '@/lib/referral';

function RegisterForm() {
  const { t, locale } = useI18n();
  const { refreshMe, config } = useApp();
  const router = useRouter();
  const nextParam = useSearchParams().get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const [f, setF] = useState({ email: '', nickname: '', password: '', birthDate: '', acceptTerms: false, ageConfirmed: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const refParam = useSearchParams().get('ref');
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    if (refParam) saveRef(refParam);
    setRef(refParam || readRef());
  }, [refParam]);
  const set = (k: keyof typeof f, v: any) => setF((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', body: { ...f, birthDate: f.birthDate || undefined, locale, ref: ref || undefined } });
      clearRef();
      await refreshMe();
      router.replace(next);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <AuthCard title={t('auth.createAccount')}>
      {ref && <p className="mb-4 rounded-xl bg-gold-400/10 px-3 py-2 text-center text-sm text-gold-200 ring-1 ring-gold-400/30">🎁 {t('invite.invitedBy', { name: ref })}{config?.economy.referral?.friend ? ` · +${config.economy.referral.friend} FC` : ''}</p>}
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('auth.email')}><input className={inputCls} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" required /></Field>
        <Field label={t('auth.nickname')}><input className={inputCls} value={f.nickname} onChange={(e) => set('nickname', e.target.value)} minLength={3} maxLength={20} autoComplete="nickname" required /></Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}><input className={inputCls} type="password" value={f.password} onChange={(e) => set('password', e.target.value)} minLength={8} autoComplete="new-password" required /></Field>
        <Field label={t('auth.birthDate')}><input className={inputCls} type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
        <label className="flex items-start gap-3 text-sm text-white/70">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-gold-400" checked={f.ageConfirmed} onChange={(e) => set('ageConfirmed', e.target.checked)} required />
          <span>{t('auth.ageConfirm')} ({config?.legal.minAge ?? 18}+)</span>
        </label>
        <label className="flex items-start gap-3 text-sm text-white/70">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-gold-400" checked={f.acceptTerms} onChange={(e) => set('acceptTerms', e.target.checked)} required />
          <span>{t('auth.acceptTerms')} — <Link href="/legal" target="_blank" className="text-gold-300 underline">{t('nav.legal')}</Link></span>
        </label>
        <ErrorText error={error} />
        <Button variant="gold" size="lg" className="w-full" loading={busy}>{t('auth.submitRegister')}</Button>
        <p className="text-center text-sm text-white/50">{t('auth.haveAccount')} <Link href="/login" className="font-semibold text-gold-300 hover:underline">{t('nav.login')}</Link></p>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}
