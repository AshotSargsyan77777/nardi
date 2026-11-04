'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export const tourneyName = (x: { name: string; variant: string }, t: (k: string, v?: Record<string, string | number>) => string) =>
  x.name === 'daily' ? t('tourney.daily', { variant: t(`variant.${x.variant}`) }) : x.name;

/** «Starts in 1:23:45» / «Started» / start date. */
export function TourneyTime({ t: x, locale }: { t: { status: string; startsAt: string | null }; locale: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!x.startsAt) return null;
  const at = new Date(x.startsAt).getTime();
  if (x.status === 'RUNNING') return <>{t('tourney.running')}</>;
  if (x.status === 'CANCELLED') return <>{t('tourney.cancelled')}</>;
  const left = Math.max(0, Math.floor((at - now) / 1000));
  const d = new Date(at);
  const today = new Date(now);
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400_000);
  const day = dayDiff === 0 ? t('tourney.today') : dayDiff === 1 ? t('tourney.tomorrow') : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  const date = `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  void locale;
  if (left > 6 * 3600) return <>{t('tourney.startsAt', { date })}</>;
  const hh = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
  return <>{t('tourney.startsIn', { time: `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` })}</>;
}
