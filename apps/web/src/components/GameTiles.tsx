'use client';
import { GameKind } from '@nardi/engine';
import { useI18n } from '@/lib/i18n';
import { DiceArt } from './DiceArt';
import { PlayingCard } from './PlayingCard';
import { ClockPicker, useChessClock, useVariant } from './PlayActions';

/** The four games as big tiles; the choice is remembered and used by every «play» button. */
export function GameTiles({ compact = false }: { compact?: boolean }) {
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
            onClick={() => setKind(x.pick)}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center ring-2 transition ${x.on ? 'bg-gold-400/15 ring-gold-400 shadow-glow' : 'bg-black/25 ring-white/10 hover:ring-white/30'} ${compact ? 'min-h-[118px]' : 'min-h-[150px]'}`}
          >
            <div className="grid h-16 place-items-center">{x.art}</div>
            <div className="font-display text-lg font-extrabold">{t(`games.${x.id}`)}</div>
          </button>
        ))}
      </div>
      {nardi && (
        <div className="flex justify-center gap-1.5">
          {(['short', 'long'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setKind(v)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${kind === v ? 'bg-felt-600 text-white ring-1 ring-felt-500' : 'bg-white/10 text-white/70'}`}>{t(`variant.${v}`)}</button>
          ))}
        </div>
      )}
      {kind === 'chess' && <ClockPicker clock={clock} onChange={setClock} />}
    </div>
  );
}
