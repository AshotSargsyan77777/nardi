'use client';
import { useState } from 'react';
import { SoundChoices } from '@/components/Sound';
import { LookChoices } from '@/components/LookChoices';
import { PushToggle } from '@/components/PushToggle';
import { Button, ErrorText, Field, Loading, PageTitle, Panel, Toggle, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import { useApp, useRequireAuth } from '@/lib/app-state';
import { LOCALES, Locale, useI18n } from '@/lib/i18n';

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const me = useRequireAuth();
  const { refreshMe, logout } = useApp();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!me) return <Loading />;
  const s = me.settings ?? {};
  const update = async (patch: any) => {
    await api('/users/me/settings', { method: 'PATCH', body: patch });
    refreshMe();
  };
  const changeLang = async (l: Locale) => {
    setLocale(l);
    await api('/users/me', { method: 'PATCH', body: { locale: l } });
    refreshMe();
  };
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPwMsg(null);
    try {
      await api('/auth/password', { method: 'POST', body: pw });
      setPw({ current: '', next: '' });
      setPwMsg(t('settings.passwordChanged'));
    } catch (err) {
      setError(err);
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle>{t('settings.title')}</PageTitle>
      <Panel title={`🌐 ${t('settings.language')}`}>
        <div className="flex flex-wrap gap-2">
          {LOCALES.map((l) => <Button key={l.code} variant={locale === l.code ? 'gold' : 'ghost'} onClick={() => changeLang(l.code)}>{l.label}</Button>)}
        </div>
      </Panel>
      <Panel title={`🎨 ${t('look.title')}`}>
        <LookChoices />
      </Panel>
      <Panel title={`🎵 ${t('sound.title')}`}>
        <SoundChoices />
      </Panel>
      <Panel title={`🔔 ${t('settings.notifications')}`}>
        <div className="mb-3"><PushToggle /></div>
        <div className="divide-y divide-white/5">
          {(['matchInvites', 'payments', 'news'] as const).map((k) => (
            <Toggle key={k} label={t(`settings.notif.${k}`)} checked={s.notifications?.[k] ?? false} onChange={(v) => update({ notifications: { [k]: v } })} />
          ))}
        </div>
      </Panel>
      <Panel title={`🔒 ${t('settings.privacy')}`}>
        <div className="divide-y divide-white/5">
          {(['showProfile', 'showHistory', 'showOnLeaderboard'] as const).map((k) => (
            <Toggle key={k} label={t(`settings.privacy.${k}`)} checked={s.privacy?.[k] ?? true} onChange={(v) => update({ privacy: { [k]: v } })} />
          ))}
        </div>
      </Panel>
      <Panel title={`💬 ${t('settings.chat')}`}>
        <Toggle label={t('settings.chatEnabled')} checked={s.chatEnabled !== false} onChange={(v) => update({ chatEnabled: v })} />
      </Panel>
      <Panel title={`🔑 ${t('settings.password')}`}>
        <form onSubmit={changePw} className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.currentPassword')}><input type="password" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></Field>
          <Field label={t('settings.newPassword')} hint={t('auth.passwordHint')}><input type="password" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} autoComplete="new-password" required /></Field>
          <div className="sm:col-span-2 space-y-2">
            <ErrorText error={error} />
            {pwMsg && <p className="text-sm text-felt-500">{pwMsg}</p>}
            <Button variant="emerald">{t('settings.changePassword')}</Button>
          </div>
        </form>
      </Panel>
      <Button variant="danger" onClick={logout}>{t('settings.logout')}</Button>
    </div>
  );
}
