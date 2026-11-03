'use client';
import { DiceArt } from '@/components/DiceArt';
import { PageTitle, Panel } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { RULES } from '@/lib/rules-content';

export default function RulesPage() {
  const { t, locale } = useI18n();
  const { config } = useApp();
  const r = config?.game.defaultRules;
  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle sub={r ? `${t('friends.turnTimer')}: ${r.turnTimeoutSec} ${t('common.seconds')}` : undefined}>📜 {t('rules.title')}</PageTitle>
      <div className="mb-5 flex flex-wrap justify-center gap-1.5">
        <DiceArt a={5} b={3} small />
      </div>
      <div className="space-y-4">
        {RULES[locale].map((s) => (
          <Panel key={s.title} title={s.title}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/75">{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
