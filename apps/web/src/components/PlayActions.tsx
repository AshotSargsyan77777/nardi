'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { resetTips } from './game/Coach';
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

export type Variant = 'short' | 'long';
const VARIANT_KEY = 'bb_variant';

/** Short or long nardi, as this device last chose (remembered). */
export function useVariant() {
  const [variant, setVariant] = useState<Variant>('short');
  useEffect(() => {
    try {
      const v = localStorage.getItem(VARIANT_KEY);
      if (v === 'short' || v === 'long') setVariant(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const set = (v: Variant) => {
    setVariant(v);
    try {
      localStorage.setItem(VARIANT_KEY, v);
    } catch {
      /* ignore */
    }
  };
  return [variant, set] as const;
}

/** Two chips: short / long nardi. */
export function VariantPicker({ variant, onChange }: { variant: Variant; onChange: (v: Variant) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {(['short', 'long'] as const).map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${variant === v ? 'bg-felt-600 text-white ring-1 ring-felt-500' : 'bg-white/10 text-white/70'}`}>
          {t(`variant.${v}`)}
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
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ matchId: string }>('/matches/practice', { method: 'POST', body: { rules: { botLevel: level, variant } } });
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
      const r = await api<{ matchId: string }>('/matches/practice', { method: 'POST', body: { rules: { botLevel: 'easy', variant } } });
      router.push(`/match/${r.matchId}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  return { start, learn, busy, error, level, setLevel, variant, setVariant };
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
      <PlayModes compact />
    </Modal>
  );
}
