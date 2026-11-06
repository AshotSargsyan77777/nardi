'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CHESS_CLOCKS, GAME_KINDS, GameKind, rulesForKind } from '@nardi/engine';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { resetTips } from './game/Coach';
import { GameTiles } from './GameTiles';
import { LinkCard, Modal } from './ui';

export type BotLevel = 'easy' | 'medium' | 'strong';
const BOT_LEVEL_KEY = 'bb_bot_level';

/** The practice bot level this device prefers (remembered). */
export function useBotLevel() {
  const [level, setLevel] = useState<BotLevel>('medium');
  useEffect(() => {
    try {
      const v = localStorage.getItem(BOT_LEVEL_KEY);
      if (v === 'easy' || v === 'medium' || v === 'strong') setLevel(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const set = (l: BotLevel) => {
    setLevel(l);
    try {
      localStorage.setItem(BOT_LEVEL_KEY, l);
    } catch {
      /* ignore */
    }
  };
  return [level, set] as const;
}

/** Three chips: easy / medium / strong bots. */
export function BotLevelPicker({ level, onChange }: { level: BotLevel; onChange: (l: BotLevel) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {(['easy', 'medium', 'strong'] as const).map((l) => (
        <button key={l} type="button" onClick={() => onChange(l)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${level === l ? 'bg-gold-grad text-ink-950' : 'bg-white/10 text-white/70'}`}>
          {t(`bots.${l}`)}
        </button>
      ))}
    </div>
  );
}

/** What to play: short or long nardi, checkers or chess (remembered on this device). */
export type Variant = GameKind;
const VARIANT_KEY = 'bb_variant';
const CLOCK_KEY = 'bb_chess_clock';
export const KIND_ICON: Record<GameKind, string> = { blot: '🃏', short: '🎲', long: '🎲', checkers: '⛀', chess: '♞' };

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    const read = () => {
      try {
        const x = localStorage.getItem(key);
        if (x && (allowed as readonly string[]).includes(x)) setV(x as T);
      } catch {
        /* storage unavailable */
      }
    };
    read();
    // every picker on the page follows the latest choice
    window.addEventListener(`pref:${key}`, read);
    return () => window.removeEventListener(`pref:${key}`, read);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, x);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(`pref:${key}`));
  };
  return [v, set] as const;
}

export function useVariant() {
  return remembered<GameKind>(VARIANT_KEY, GAME_KINDS, 'short');
}
export const CLOCKS = CHESS_CLOCKS.map(([m, i]) => `${m}+${i}`);
/** The chess clock this device prefers, like «5+0». */
export function useChessClock() {
  return remembered<string>(CLOCK_KEY, CLOCKS, '5+0');
}
/** The rules (and random-queue suffix) for a kind and, for chess, a clock. */
export function kindRules(kind: GameKind, clock = '5+0'): Record<string, unknown> {
  const [m, i] = clock.split('+').map(Number);
  return rulesForKind(kind, {}, kind === 'chess' ? { clockMin: m, clockInc: i } : {});
}
export const queueSuffix = (kind: GameKind, clock = '5+0') => (kind === 'chess' ? `chess:${clock}` : kind);

/** Four chips: short nardi, long nardi, checkers, chess. */
export function VariantPicker({ variant, onChange }: { variant: Variant; onChange: (v: Variant) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {GAME_KINDS.map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${variant === v ? 'bg-felt-600 text-white ring-1 ring-felt-500' : 'bg-white/10 text-white/70'}`}>
          {KIND_ICON[v]} {t(`variant.${v}`)}
        </button>
      ))}
    </div>
  );
}

/** Chess clocks: 1+0, 3+2, 5+0 … */
export function ClockPicker({ clock, onChange }: { clock: string; onChange: (c: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {CLOCKS.map((c) => (
        <button key={c} type="button" title={t('chess.clockHint')} onClick={() => onChange(c)} className={`rounded-full px-2.5 py-1 font-mono text-xs font-bold transition ${clock === c ? 'bg-gold-grad text-ink-950' : 'bg-white/10 text-white/70'}`}>
          ⏱ {c}
        </button>
      ))}
    </div>
  );
}

/** Starts (or resumes) a free practice match against labelled bots. */
export function usePractice() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useBotLevel();
  const [variant, setVariant] = useVariant();
  const [clock, setClock] = useChessClock();
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ matchId: string }>('/matches/practice', { method: 'POST', body: { rules: { ...kindRules(variant, clock), botLevel: level } } });
      router.push(`/match/${r.matchId}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  /** «Learn to play»: easy bots and the beginner tips from the start. */
  const learn = async () => {
    resetTips();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ matchId: string }>('/matches/practice', { method: 'POST', body: { rules: { ...kindRules(variant, clock), botLevel: 'easy' } } });
      router.push(`/match/${r.matchId}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  return { start, learn, busy, error, level, setLevel, variant, setVariant, clock, setClock };
}

export function PlayModes({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { config } = useApp();
  const practice = usePractice();
  return (
    <div className={`grid gap-3 ${compact ? 'sm:grid-cols-3' : 'sm:grid-cols-3'}`}>
      <LinkCard href="/play/friends" icon="🤝" title={t('home.playFriends')} sub={t('home.playFriendsSub')} accent="gold" />
      <LinkCard href="/play/random" icon="🎲" title={t('home.playRandom')} sub={t('home.playRandomSub')} accent="sky" />
      {config?.features.practiceBotsEnabled !== false && (
        <div className="space-y-2">
          <LinkCard onClick={practice.start} disabled={practice.busy} icon="🤖" title={t('home.playFree')} sub={practice.error ?? t('home.playFreeSub')} accent="emerald" />
          <BotLevelPicker level={practice.level} onChange={practice.setLevel} />
          <button onClick={practice.learn} className="block w-full text-center text-xs font-semibold text-gold-300 hover:underline">🎓 {t('tip.learn')}</button>
        </div>
      )}
    </div>
  );
}

export function PlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t('home.playSub')} wide>
      <div className="mb-4"><GameTiles /></div>
      <PlayModes compact />
    </Modal>
  );
}
