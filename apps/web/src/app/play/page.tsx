'use client';
import { PlayModes } from '@/components/PlayActions';
import { PageTitle } from '@/components/ui';
import { useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export default function PlayPage() {
  const { t } = useI18n();
  useRequireAuth();
  return (
    <div>
      <PageTitle sub={t('home.playSub')}>{t('nav.play')}</PageTitle>
      <PlayModes />
    </div>
  );
}
