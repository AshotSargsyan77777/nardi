'use client';
import { DiceArt } from './DiceArt';
import { useSection } from './PlayActions';
import { PlayingCard } from './PlayingCard';

/** A large picture of the section's game for the lobby. */
export function SectionArt({ small = false }: { small?: boolean }) {
  const { section } = useSection();
  const scale = small ? 'scale-75' : '';
  if (section === 'blot') {
    return (
      <div className={`relative h-40 w-56 ${scale}`}>
        {['JH', 'AS', '9D', 'KC'].map((c, i) => (
          <div key={c} className="absolute top-2" style={{ left: `${10 + i * 38}px`, transform: `rotate(${(i - 1.5) * 10}deg)` }}><PlayingCard card={c} size="lg" /></div>
        ))}
      </div>
    );
  }
  if (section === 'checkers') {
    return (
      <div className={`flex items-end gap-2 ${scale}`}>
        {[0, 1, 0].map((d, i) => (
          <span key={i} className={`h-24 w-24 rounded-full shadow-2xl ring-2 ${d ? 'bg-[radial-gradient(circle_at_38%_32%,#5a5148,#2a2420_55%,#141110_90%,#070606)] ring-black' : 'bg-[radial-gradient(circle_at_38%_32%,#fffdf6,#efe4cc_55%,#cdbb93_90%,#a8936a)] ring-[#8d7a52]'} ${i === 1 ? '-mb-4' : ''}`} />
        ))}
      </div>
    );
  }
  if (section === 'chess') {
    return (
      <div className={`flex items-end ${scale}`}>
        <img alt="" src="/pieces/wQ.svg" className="h-32 w-32 drop-shadow-2xl" />
        <img alt="" src="/pieces/bN.svg" className="-ml-8 h-28 w-28 drop-shadow-2xl" />
        <img alt="" src="/pieces/wK.svg" className="-ml-8 h-36 w-36 drop-shadow-2xl" />
      </div>
    );
  }
  return <div className={scale}><DiceArt a={6} b={5} /></div>;
}
