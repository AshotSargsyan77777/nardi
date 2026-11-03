'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { disablePush, enablePush, pushEnabled, pushSupported } from '@/lib/push';

/** «Notifications on this phone» switch (your turn, invites, friends). */
export function PushToggle({ chip = false }: { chip?: boolean }) {
  const { t } = useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    pushEnabled().then(setOn).catch(() => setOn(false));
  }, []);
  if (on === null) return null;
  if (!pushSupported()) return chip ? null : <p className="text-xs text-white/45">{t('push.unsupported')}</p>;
  if (chip && (on || Notification.permission === 'denied')) return null;
  const toggle = async () => {
    setMsg(null);
    try {
      if (on) await disablePush();
      else await enablePush();
      setOn(!on);
    } catch (e: any) {
      setMsg(e?.message === 'DENIED' ? t('push.denied') : t('push.failed'));
    }
  };
  if (chip) {
    return <button onClick={toggle} className="rounded-full bg-white/5 px-4 py-1.5 text-sm font-bold text-white/80 ring-1 ring-white/10">🔔 {t('push.enable')}</button>;
  }
  return (
    <div>
      <button onClick={toggle} className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold">
        🔔 {t('push.title')}
        <span className={`h-5 w-9 rounded-full p-0.5 transition ${on ? 'bg-felt-500' : 'bg-white/15'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} /></span>
      </button>
      <p className="mt-1 text-[11px] text-white/40">{msg ?? t('push.note')}</p>
    </div>
  );
}
