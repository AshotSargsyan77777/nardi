'use client';
import { motion } from 'framer-motion';
import { SUIT_SYMBOL, isRed } from '@/lib/format';
import { Rosette } from './Logo';

const SIZES = {
  xs: 'w-8 h-11',
  sm: 'w-11 h-16',
  md: 'w-[58px] h-[84px] sm:w-[70px] sm:h-[100px] short:w-[60px] short:h-[86px]',
  lg: 'w-[64px] h-[92px] sm:w-[84px] sm:h-[120px] short:w-[52px] short:h-[76px]',
  /** the player's own hand on phones */
  hand: 'w-[74px] h-[106px] short:w-[68px] short:h-[96px]',
};
/**
 * Simple, readable face: a big rank + suit in the top-left corner (the part that stays visible when
 * cards overlap in the hand) and one large symbol in the lower right. Sizes are relative to the
 * card width (container query units), so every card size looks the same.
 */
function Face({ rank, suit }: { rank: string; suit: string }) {
  const sym = SUIT_SYMBOL[suit];
  const face = rank === 'J' || rank === 'Q' || rank === 'K';
  return (
    <>
      <span className="absolute left-[7%] top-[4%] flex flex-col items-center leading-[0.9]">
        <span className={`font-black ${rank === '10' ? 'text-[30cqw] tracking-[-0.08em]' : 'text-[36cqw]'}`}>{rank}</span>
        <span className="text-[30cqw]">{sym}</span>
      </span>
      {rank === 'A' ? (
        <span className="absolute bottom-[6%] right-[8%] text-[64cqw] leading-none">{sym}</span>
      ) : face ? (
        <span className="absolute bottom-[5%] right-[6%] flex h-[56%] w-[52%] flex-col items-center justify-center rounded-[10cqw] leading-none">
          <span className="absolute inset-0 rounded-[10cqw] bg-current opacity-[0.08]" />
          <span className="text-[34cqw] font-black">{rank}</span>
          <span className="text-[26cqw]">{sym}</span>
        </span>
      ) : (
        <span className="absolute bottom-[5%] right-[8%] text-[48cqw] leading-none">{sym}</span>
      )}
    </>
  );
}

export function PlayingCard({ card, size = 'md', dim, selected, onClick, className = '', layoutId }: { card: string; size?: keyof typeof SIZES; dim?: boolean; selected?: boolean; onClick?: () => void; className?: string; layoutId?: string }) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const red = isRed(suit);
  return (
    <motion.button
      type="button"
      layoutId={layoutId}
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${rank}${SUIT_SYMBOL[suit]}`}
      className={`relative shrink-0 select-none overflow-hidden rounded-[9px] border bg-[#fdfcf8] font-bold shadow-card transition [container-type:inline-size] ${SIZES[size]} ${
        selected ? 'border-gold-400 ring-2 ring-gold-400' : 'border-black/15'
      } ${dim ? 'opacity-45 saturate-50' : ''} ${onClick ? 'cursor-pointer' : 'cursor-default'} ${red ? 'text-ruby-600' : 'text-ink-900'} ${className}`}
      animate={{ y: selected ? -16 : 0 }}
      whileHover={onClick && !dim ? { y: selected ? -18 : -8 } : undefined}
    >
      <Face rank={rank} suit={suit} />
    </motion.button>
  );
}

export function CardBack({ size = 'sm', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-[9px] card-back border border-gold-500/50 shadow-card ${SIZES[size]} ${className}`}>
      <span className="absolute inset-[3px] rounded-[7px] border border-gold-400/30 bg-[repeating-linear-gradient(45deg,rgba(234,189,85,0.10)_0_4px,transparent_4px_8px)]" />
      <svg className="absolute inset-0 m-auto h-1/2 w-1/2" viewBox="-20 -20 40 40" aria-hidden>
        <Rosette cx={0} cy={0} r={16} fill="#eabd55" opacity={0.75} />
      </svg>
    </span>
  );
}
