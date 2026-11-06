'use client';
import { Action, BidSuit, BiddingOptions, Suit } from '@nardi/engine/dist/blot';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { SUIT_SYMBOL, isRed } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

/**
 * Bazar: pick a number (or kapot) and a trump (or no trump), then confirm with «Խոսալ».
 * Nothing is sent until both are chosen.
 */
export function BiddingPanel({ options, onAction, busy, compact = false }: { options: BiddingOptions; onAction: (a: Action) => void; busy: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState<number | 'kapot' | null>(null);
  // «Կապոտ +N»
  const [plus, setPlus] = useState(options.minKapotPlus ?? 0);
  const [suit, setSuit] = useState<BidSuit | null>(null);
  const values: number[] = [];
  if (options.minBid !== null) for (let v = options.minBid; v <= options.maxBid; v++) values.push(v);
  const canBid = values.length > 0 || options.canKapot;
  const surOnly = options.minBid === null && !options.canKapot && options.canRecontra;
  const ready = value !== null && suit !== null;
  const chip = (on: boolean) => (on ? 'bg-gold-grad text-ink-950' : 'bg-white/5 ring-1 ring-white/10 hover:bg-white/10');

  return (
    <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-full max-w-xl rounded-2xl border border-gold-400/30 bg-ink-900 p-3 shadow-2xl sm:p-4 short:max-w-2xl short:p-1.5">
      <div className={`mb-2 flex items-center justify-between short:mb-1 ${surOnly ? '' : 'short:hidden'}`}>
        <span className="text-sm font-bold text-gold-300">{surOnly ? t('game.surOrPass') : t('game.chooseBid')}</span>
        <span className="text-xs text-white/40">{t('game.bidding')}</span>
      </div>
      {canBid && (
        <>
          <div className="mb-2 flex items-center gap-1.5 short:mb-1">
            <div className="scrollbar-thin -mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 short:pb-0">
              {values.map((v) => (
                <button key={v} onClick={() => setValue(v)} className={`h-11 min-w-[44px] shrink-0 rounded-xl px-2 font-display text-lg font-bold transition short:h-8 short:min-w-[36px] short:text-base ${chip(value === v)}`}>{v}</button>
              ))}
            </div>
            {options.canKapot && (
              <button onClick={() => setValue('kapot')} className={`h-11 shrink-0 rounded-xl px-3 text-sm font-bold transition short:h-8 ${chip(value === 'kapot')}`}>
                {t('game.kapot')}{plus ? ` +${plus}` : ''}
              </button>
            )}
            {value === 'kapot' && options.minKapotPlus !== null && (
              <div className="flex shrink-0 items-center gap-1 rounded-xl bg-black/40 p-0.5 ring-1 ring-white/10">
                <button type="button" aria-label="−" disabled={plus <= options.minKapotPlus} onClick={() => setPlus(plus - 1)} className="grid h-10 w-9 place-items-center rounded-lg bg-white/10 text-lg font-bold disabled:opacity-30 short:h-7 short:w-7">−</button>
                <span className="w-8 text-center font-display font-extrabold tabular-nums">+{plus}</span>
                <button type="button" aria-label="+" disabled={plus >= options.maxKapotPlus} onClick={() => setPlus(plus + 1)} className="grid h-10 w-9 place-items-center rounded-lg bg-white/10 text-lg font-bold disabled:opacity-30 short:h-7 short:w-7">+</button>
              </div>
            )}
          </div>
          <div className="mb-1.5 text-xs text-white/50 short:hidden">{t('game.chooseSuit')}</div>
          <div className={`mb-3 grid gap-2 short:mb-1 ${options.canNoTrump ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {SUITS.map((s) => (
              <button
                key={s}
                onClick={() => setSuit(s)}
                className={`h-12 rounded-xl bg-[#fffaf0] text-3xl font-bold shadow-card transition short:h-8 short:text-xl ${isRed(s) ? 'text-ruby-600' : 'text-ink-900'} ${
                  suit === s ? 'ring-4 ring-gold-400' : suit ? 'opacity-50' : ''
                }`}
                aria-label={SUIT_SYMBOL[s]}
                aria-pressed={suit === s}
              >
                {SUIT_SYMBOL[s]}
              </button>
            ))}
            {options.canNoTrump && (
              <button
                onClick={() => setSuit('NT')}
                className={`h-12 rounded-xl bg-gold-grad text-sm font-extrabold leading-tight text-ink-950 shadow-card transition short:h-8 ${suit === 'NT' ? 'ring-4 ring-white' : suit ? 'opacity-50' : ''}`}
                aria-pressed={suit === 'NT'}
              >
                {t('game.noTrump')}
              </button>
            )}
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onAction({ type: 'pass' })} className="h-12 flex-1 rounded-xl bg-white/10 font-bold ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-50 short:h-8">{t('game.pass')}</button>
        {options.canContra && <button disabled={busy} onClick={() => onAction({ type: 'contra' })} className="h-12 flex-1 rounded-xl bg-ruby-600 font-bold hover:bg-ruby-500 disabled:opacity-50 short:h-8">{t('game.contra')}</button>}
        {options.canRecontra && <button disabled={busy} onClick={() => onAction({ type: 'recontra' })} className="h-12 flex-1 rounded-xl bg-ruby-600 font-bold hover:bg-ruby-500 disabled:opacity-50 short:h-8">{t('game.recontra')}</button>}
        {canBid && (
          <button
            disabled={busy || !ready}
            onClick={() => ready && onAction(value === 'kapot' ? { type: 'bid', value, suit: suit!, plus } : { type: 'bid', value: value!, suit: suit! })}
            className="h-12 flex-[1.4] rounded-xl bg-gold-grad font-extrabold text-ink-950 shadow-glow transition disabled:bg-none disabled:bg-white/5 disabled:text-white/30 disabled:shadow-none disabled:ring-1 disabled:ring-white/10 short:h-8"
          >
            {t('game.bid')}
            {value !== null && <span className="ml-1.5">{value === 'kapot' ? `${t('game.kapot')}${plus ? ` +${plus}` : ''}` : value}</span>}
            {suit !== null && <span className={`ml-1 ${suit !== 'NT' && isRed(suit) ? 'text-ruby-600' : ''}`}>{suit === 'NT' ? t('game.noTrump') : SUIT_SYMBOL[suit]}</span>}
          </button>
        )}
      </div>
    </motion.div>
  );
}
