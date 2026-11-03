'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button, Modal } from './ui';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the service worker once for the whole app. */
export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return null;
}

const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Install the app" banner: native prompt on Android/Chrome, step-by-step help on iPhone. */
/** Install prompt: a banner, or (`chip`) a small pill for the phone lobby. */
export function InstallBanner({ chip = false }: { chip?: boolean }) {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('bb_install_dismissed') === '1';
    } catch {
      /* storage unavailable */
    }
    if (isStandalone() || dismissed) return;
    setVisible(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as PromptEvent);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;
  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') setVisible(false);
      setDeferred(null);
    } else setHelp(true);
  };
  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem('bb_install_dismissed', '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {chip ? (
        <span className="flex items-center rounded-full bg-felt-700/50 text-sm font-bold ring-1 ring-felt-500/40">
          <button onClick={install} className="py-1.5 pl-3 pr-1">📲 {t('install.button')}</button>
          <button onClick={dismiss} aria-label={t('common.close')} className="px-2 py-1.5 text-white/40">✕</button>
        </span>
      ) : (
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-felt-700/60 to-ink-800 px-4 py-3 ring-1 ring-felt-500/30">
        <img src="/pwa/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t('install.title')}</div>
          <div className="hidden text-xs text-white/55 sm:block">{t('install.text')}</div>
        </div>
        <Button size="sm" variant="gold" onClick={install}>📲 {t('install.button')}</Button>
        <button onClick={dismiss} aria-label={t('common.close')} className="px-1 text-white/40 hover:text-white">✕</button>
      </div>
      )}
      <Modal open={help} onClose={() => setHelp(false)} title={`📲 ${t('install.title')}`}>
        {isIos() ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-white/80">
            <li>{t('install.ios1')}</li>
            <li>{t('install.ios2')}</li>
            <li>{t('install.ios3')}</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-white/80">
            <li>{t('install.android1')}</li>
            <li>{t('install.android2')}</li>
          </ol>
        )}
        <div className="mt-5 flex justify-end"><Button onClick={() => setHelp(false)}>{t('common.close')}</Button></div>
      </Modal>
    </>
  );
}
