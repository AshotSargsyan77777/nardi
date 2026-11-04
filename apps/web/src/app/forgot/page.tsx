'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Button, ErrorText, Field, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** «Forgot password»: asks for the e-mail and sends a reset link. */
export default function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <AuthCard title={t('reset.forgotTitle')}>
      {sent ? (
        <div className="space-y-4 text-sm text-white/75">
          <p>📬 {t('reset.sent', { email })}</p>
          <p className="text-white/50">{t('reset.sentHint')}</p>
          <Link href="/login" className="block text-center font-semibold text-gold-300 hover:underline">← {t('nav.login')}</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-white/60">{t('reset.forgotText')}</p>
          <Field label={t('auth.email')}><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
          <ErrorText error={error} />
          <Button variant="gold" size="lg" className="w-full" loading={busy}>{t('reset.send')}</Button>
          <p className="text-center text-sm"><Link href="/login" className="text-white/50 hover:underline">← {t('nav.login')}</Link></p>
        </form>
      )}
    </AuthCard>
  );
}
