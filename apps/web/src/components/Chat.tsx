'use client';
import { useEffect, useRef, useState } from 'react';
import { ChatMessageDTO } from '@nardi/engine';
import { useApp, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';

/** Safe chat: messages are rendered as plain text (no HTML), sent through the authenticated socket. */
export function Chat({ channel, enabled, className = '', compact = false }: { channel: string; enabled: boolean; className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const { socket, me } = useApp();
  const [items, setItems] = useState<ChatMessageDTO[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(me?.settings?.chatEnabled === false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;
    socket.emit('chat:history', { channel }, (r: any) => r?.items && setItems(r.items));
  }, [socket, channel]);
  useSocketEvent<{ channel: string; items: ChatMessageDTO[] }>('chat:history', (d) => d.channel === channel && setItems(d.items));
  useSocketEvent<ChatMessageDTO>('chat:message', (m) => m.channel.toUpperCase() === channel.toUpperCase() && setItems((x) => [...x.slice(-49), m]));
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, muted]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !socket) return;
    socket.emit('chat:send', { channel, text }, (r: any) => {
      if (r?.error) setError(r.error.message);
      else {
        setError(null);
        setText('');
      }
    });
  };

  return (
    <div className={`flex flex-col rounded-2xl border border-white/10 bg-ink-900/90 ${className}`}>
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="text-sm font-bold">💬 {t('game.chat')}</span>
        <button onClick={() => setMuted(!muted)} className="text-xs text-white/50 hover:text-white">{muted ? '🔇' : '🔊'} {muted ? t('common.off') : t('common.on')}</button>
      </div>
      {!enabled ? (
        <p className="p-4 text-center text-sm text-white/40">{t('game.chatDisabled')}</p>
      ) : muted ? (
        <p className="p-4 text-center text-sm text-white/40">{t('game.hideChat')}</p>
      ) : (
        <>
          <div ref={listRef} className={`scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto ${compact ? 'p-2 text-xs' : 'h-48 p-3 text-sm'}`}>
            {items.map((m) => (
              <div key={m.id} className="break-words">
                <span className={`font-semibold ${m.userId === me?.id ? 'text-gold-300' : 'text-felt-500'}`}>{m.nickname}: </span>
                <span className="text-white/80">{m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={send} className={`flex gap-2 border-t border-white/5 ${compact ? 'p-1.5' : 'p-2'}`}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={t('game.chatPlaceholder')} className={`${compact ? 'h-8 text-xs' : 'h-10 text-sm'} min-w-0 flex-1 rounded-lg bg-black/30 px-3 outline-none ring-1 ring-white/10 focus:ring-gold-400/40`} />
            <button className="rounded-lg bg-felt-600 px-3 text-sm font-semibold">{t('game.send')}</button>
          </form>
          {error && <p className="px-3 pb-2 text-xs text-ruby-400">{error}</p>}
        </>
      )}
    </div>
  );
}
