'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { CARD_SOUNDS, CardSound, MUSIC_THEMES, MusicTheme, sound } from '@/lib/sound';

/** Starts the music on the first tap and turns it down at the game table. */
export function SoundProvider() {
  const path = usePathname();
  useEffect(() => {
    const unlock = () => sound()?.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  useEffect(() => {
    sound()?.setLevel(path?.startsWith('/match/') ? 'game' : 'lobby');
  }, [path]);
  return null;
}

export function useSoundPrefs() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = sound();
    if (!s) return;
    force((n) => n + 1);
    return s.subscribe(() => force((n) => n + 1)) as () => void;
  }, []);
  const s = sound();
  return {
    music: s?.musicOn ?? true,
    sfx: s?.sfxOn ?? true,
    theme: s?.theme ?? 'jazz',
    cardSound: s?.cardSound ?? 'paper',
    toggleMusic: () => s?.toggleMusic(),
    toggleSfx: () => s?.toggleSfx(),
    setTheme: (x: MusicTheme) => {
      s?.unlock();
      s?.setTheme(x);
    },
    setCardSound: (x: CardSound) => {
      s?.unlock();
      s?.setCardSound(x);
    },
  };
}

/** Music style and card sound choice (menu and settings page). */
export function SoundChoices({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const p = useSoundPrefs();
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? 'bg-gold-grad text-ink-950' : 'bg-white/5 text-white/75 ring-1 ring-white/10'}`;
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      <div>
        <div className="mb-1.5 text-xs text-white/50">{t('sound.theme')}</div>
        <div className="flex flex-wrap gap-1.5">
          {MUSIC_THEMES.map((x) => <button key={x} onClick={() => p.setTheme(x)} className={chip(p.theme === x)}>{t(`sound.theme.${x}`)}</button>)}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs text-white/50">{t('sound.card')}</div>
        <div className="flex flex-wrap gap-1.5">
          {CARD_SOUNDS.map((x) => <button key={x} onClick={() => p.setCardSound(x)} className={chip(p.cardSound === x)}>{t(`sound.card.${x}`)}</button>)}
        </div>
      </div>
    </div>
  );
}

/** One button: music on/off (🎵 / 🔇). */
export function MusicButton({ className = '' }: { className?: string }) {
  const { music, toggleMusic } = useSoundPrefs();
  return (
    <button type="button" onClick={toggleMusic} aria-label="music" className={className}>
      {music ? '🎵' : '🔇'}
    </button>
  );
}
