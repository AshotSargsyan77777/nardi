'use client';
import { useI18n } from '@/lib/i18n';
import { Panel } from './ui';

export interface DetailedStats {
  matches: number; shortMatches: number; shortWins: number; longMatches: number; longWins: number;
  games: number; gamesWonPct: number; mars: number; marsAgainst: number; rolls: number; doublesPct: number; sheshBesh: number;
  checkersMatches?: number; checkersWins?: number; checkersDraws?: number; chessMatches?: number; chessWins?: number; chessDraws?: number;
}

/** Short and long nardi, games won, mars, doubles… from the last 200 matches. */
export function StatsPanel({ s }: { s: DetailedStats | undefined }) {
  const { t } = useI18n();
  if (!s || !s.games) return null;
  const tiles: [string, React.ReactNode][] = [
    [t('variant.short'), `${s.shortWins} / ${s.shortMatches}`],
    [t('variant.long'), `${s.longWins} / ${s.longMatches}`],
    [t('variant.checkers'), `${s.checkersWins ?? 0} / ${s.checkersMatches ?? 0}${s.checkersDraws ? ` · ${s.checkersDraws} ${t('stats.draws')}` : ''}`],
    [t('variant.chess'), `${s.chessWins ?? 0} / ${s.chessMatches ?? 0}${s.chessDraws ? ` · ${s.chessDraws} ${t('stats.draws')}` : ''}`],
    [t('stats.gamesWon'), `${s.gamesWonPct}%`],
    [t('stats.mars'), s.mars],
    [t('stats.marsAgainst'), s.marsAgainst],
    [t('stats.doubles'), `${s.doublesPct}%`],
    [t('stats.sheshBesh'), s.sheshBesh],
    [t('stats.games'), s.games],
    [t('stats.rolls'), s.rolls],
  ];
  return (
    <Panel title={`📊 ${t('stats.title')}`}>
      <div className="grid grid-cols-3 gap-2 text-center">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-black/20 px-1 py-2">
            <div className="font-display text-lg font-bold">{value}</div>
            <div className="text-[11px] leading-tight text-white/45">{label}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/35">{t('stats.note', { n: s.matches })}</p>
    </Panel>
  );
}
