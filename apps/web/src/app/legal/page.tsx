'use client';
import { PageTitle, Panel } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { LEGAL } from '@/lib/rules-content';

export default function LegalPage() {
  const { t, locale } = useI18n();
  const { config } = useApp();
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle sub={config ? `v${config.legal.termsVersion} · ${config.legal.supportEmail}` : undefined}>{t('legal.title')}</PageTitle>
      <div className="space-y-4">
        {LEGAL[locale].map((s) => (
          <Panel key={s.title} title={s.title}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/75">{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
