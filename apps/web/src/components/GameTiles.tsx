'use client';
import { GameKind } from '@nardi/engine';
import { useI18n } from '@/lib/i18n';
import { DiceArt } from './DiceArt';
import { PlayingCard } from './PlayingCard';
import { ClockPicker, Section, sectionOf, useChessClock, useSection, useVariant } from './PlayActions';

/** The four games as big tiles; the choice is remembered and used by every «play» button. */
export function GameTiles({ compact = false, onPick }: { compact?: boolean; onPick?: (s: Section) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useVariant();
  const [clock, setClock] = useChessClock();
  const nardi = kind === 'short' || kind === 'long';
  const tiles: { id: 'blot' | 'nardi' | 'checkers' | 'chess'; art: React.ReactNode; on: boolean; pick: GameKind }[] = [
    {
      id: 'blot', on: kind === 'blot', pick: 'blot',
      art: (
        <div className="relative h-16 w-24">
          {['AS', 'KH', 'QD'].map((c, i) => (
            <div key={c} className="absolute top-0" style={{ left: `${i * 18}px`, transform: `rotate(${(i - 1) * 12}deg)` }}><PlayingCard card={c} size="xs" /></div>
          ))}
        </div>
      ),
    },
    { id: 'nardi', on: nardi, pick: nardi ? kind : 'short', art: <div className="origin-center scale-[0.55]"><DiceArt a={6} b={5} /></div> },
    {
      id: 'checkers', on: kind === 'checkers', pick: 'checkers',
      art: (
        <div className="flex gap-1">
          <span className="h-11 w-11 rounded-full bg-[radial-gradient(circle_at_38%_32%,#fffdf6,#efe4cc_55%,#cdbb93_90%,#a8936a)] shadow-lg ring-1 ring-[#8d7a52]" />
          <span className="h-11 w-11 rounded-full bg-[radial-gradient(circle_at_38%_32%,#5a5148,#2a2420_55%,#141110_90%,#070606)] shadow-lg ring-1 ring-black" />
        </div>
      ),
    },
    {
      id: 'chess', on: kind === 'chess', pick: 'chess',
      art: (
        <div className="flex">
          <img alt="" src="/pieces/wN.svg" className="h-14 w-14 drop-shadow-lg" />
          <img alt="" src="/pieces/bK.svg" className="-ml-3 h-14 w-14 drop-shadow-lg" />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {tiles.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => (onPick ? onPick(sectionOf(x.pick)) : setKind(x.pick))}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center ring-2 transition ${x.on && !onPick ? 'bg-gold-400/15 ring-gold-400 shadow-glow' : 'bg-black/25 ring-white/10 hover:-translate-y-0.5 hover:ring-gold-400/60'} ${compact ? 'min-h-[118px]' : onPick ? 'min-h-[170px] sm:min-h-[210px]' : 'min-h-[150px]'}`}
          >
            <div className="grid h-16 place-items-center">{x.art}</div>
            <div className="font-display text-lg font-extrabold">{t(`games.${x.id}`)}</div>
          </button>
        ))}
      </div>
      {nardi && !onPick && (
        <div className="flex justify-center gap-1.5">
          {(['short', 'long'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setKind(v)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${kind === v ? 'bg-felt-600 text-white ring-1 ring-felt-500' : 'bg-white/10 text-white/70'}`}>{t(`variant.${v}`)}</button>
          ))}
        </div>
      )}
      {kind === 'chess' && !onPick && <ClockPicker clock={clock} onChange={setClock} />}
    </div>
  );
}


/** The first screen of every visit: only the four games. Picking one enters that game's lobby. */
export function SectionPicker() {
  const { t } = useI18n();
  const { choose } = useSection();
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-140px)] max-w-3xl flex-col justify-center gap-6 py-6">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold sm:text-5xl">{t('home.pickTitle')}</h1>
        <p className="mt-2 text-white/60">{t('home.pickText')}</p>
      </div>
      <GameTiles onPick={choose} />
    </div>
  );
}

/** The game the visitor is in, with a way back to the picker. */
export function SectionBar() {
  const { t } = useI18n();
  const { section, leave } = useSection();
  const icon: Record<Section, string> = { blot: '🃏', nardi: '🎲', checkers: '⛀', chess: '♞' };
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-black/30 px-4 py-2.5 ring-1 ring-white/10">
      <span className="font-display text-lg font-extrabold">{icon[section]} {t(`games.${section}`)}</span>
      <button onClick={leave} className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-gold-200 ring-1 ring-gold-400/30 hover:bg-white/10">⇄ {t('home.changeGame')}</button>
    </div>
  );
}

/** The options of the section's game: short/long nardi, the chess clock. */
export function SectionOptions() {
  const [kind, setKind] = useVariant();
  const [clock, setClock] = useChessClock();
  const { t } = useI18n();
  if (kind === 'short' || kind === 'long') {
    return (
      <div className="flex justify-center gap-1.5">
        {(['short', 'long'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setKind(v)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${kind === v ? 'bg-felt-600 text-white ring-1 ring-felt-500' : 'bg-white/10 text-white/70'}`}>{t(`variant.${v}`)}</button>
        ))}
      </div>
    );
  }
  if (kind === 'chess') return <ClockPicker clock={clock} onChange={setClock} />;
  return null;
}
