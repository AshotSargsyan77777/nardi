'use client';
import { useApp } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

export interface EmotePhrase { id: string; group: 'play' | 'general'; hy: string; ru: string; en: string }
export interface Emotes { phrases: EmotePhrase[]; emojis: string[] }

/** Text of a phrase id (in the viewer's language) or the emoji itself. */
export function useEmoteText() {
  const { config } = useApp();
  const { locale } = useI18n();
  const phrases = config?.game.emotes?.phrases ?? [];
  return (id: string) => {
    const p = phrases.find((x) => x.id === id);
    return p ? p[locale] ?? p.hy : id;
  };
}

/** Quick phrases and emojis; the current phase's group comes first. Other players can be muted here. */
export function EmotePanel({ phase, onSend, others, muted, onToggleMute, onClose }: {
  phase: string;
  onSend: (id: string) => void;
  others: { seat: number; nickname: string }[];
  muted: Record<number, boolean>;
  onToggleMute: (seat: number) => void;
  onClose: () => void;
}) {
  const { config } = useApp();
  const { t, locale } = useI18n();
  const emotes = config?.game.emotes;
  if (!emotes) return null;
  const order = phase === 'finished' ? ['general', 'play'] : ['play', 'general'];
  const phrases = [...emotes.phrases].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-2 top-12 z-50 max-h-[calc(100%-4rem)] w-[320px] max-w-[calc(100%-1rem)] overflow-y-auto rounded-2xl border border-white/10 bg-ink-900 p-2.5 shadow-2xl">
        <div className="mb-2 grid grid-cols-8 gap-1">
          {emotes.emojis.map((e) => (
            <button key={e} onClick={() => onSend(e)} className="grid h-9 place-items-center rounded-lg text-2xl active:bg-white/10">{e}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {phrases.map((p) => (
            <button key={p.id} onClick={() => onSend(p.id)} className="rounded-full bg-white/5 px-3 py-1.5 text-sm font-semibold ring-1 ring-white/10 active:bg-white/15">
              {p[locale] ?? p.hy}
            </button>
          ))}
        </div>
        {others.length > 0 && (
          <div className="mt-3 border-t border-white/5 pt-2">
            <div className="mb-1 text-[11px] text-white/40">{t('emote.mute')}</div>
            <div className="flex flex-wrap gap-1.5">
              {others.map((o) => (
                <button key={o.seat} onClick={() => onToggleMute(o.seat)} className={`rounded-full px-2.5 py-1 text-xs ${muted[o.seat] ? 'bg-ruby-600/30 text-ruby-300' : 'bg-white/5 text-white/60'}`}>
                  {muted[o.seat] ? '🔇' : '🔈'} {o.nickname}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
