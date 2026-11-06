'use client';
import {
  Action, Card, ComboTalk, CompletedTrick, PublicCombo, GameEvent, HandResult, Play, Seat, detectCombos,
} from '@nardi/engine/dist/blot';
import type { PlayerView as BlotPlayerView } from '@nardi/engine/dist/blot';
import type { MatchDTO, SeatInfo } from '@nardi/engine';

type BlotView = BlotPlayerView & { game: 'blot' };
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '@/lib/api';
import { useApp, useSocketEvent } from '@/lib/app-state';
import { SUIT_SYMBOL, isRed } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { MusicButton } from '../Sound';
import { Coach, TipId } from './BlotCoach';
import { EmotePanel, useEmoteText } from './EmotePanel';
import { PlayerActions } from '../PlayerActions';
import useSWR from 'swr';
import { Avatar } from '../Avatar';
import { Chat } from '../Chat';
import { PlayingCard } from '../PlayingCard';
import { Badge, Button, Coins, Modal } from '../ui';
import { BiddingPanel } from './BiddingPanel';
import { Confetti } from './Confetti';

type Pos = 'bottom' | 'left' | 'top' | 'right';
const POS: Pos[] = ['bottom', 'left', 'top', 'right'];
const TRICK_OFFSET: Record<Pos, { x: number; y: number; r: number }> = {
  bottom: { x: 0, y: 34, r: 0 }, left: { x: -52, y: 0, r: -9 }, top: { x: 0, y: -34, r: 4 }, right: { x: 52, y: 0, r: 9 },
};
const FLY_FROM: Record<Pos, { x: number; y: number }> = { bottom: { x: 0, y: 220 }, left: { x: -260, y: 0 }, top: { x: 0, y: -220 }, right: { x: 260, y: 0 } };

/** Stable pseudo-random value in [-1, 1] per card, so a card lands at the same angle on every render. */
function jitter(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2001) / 1000 - 1;
}

/** Phones (portrait, or landscape with little height) get a simplified, full-screen game layout. */
const COMPACT_QUERY = '(max-height: 520px) and (orientation: landscape), (max-width: 767px)';
function useCompact() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

function BidLabel({ v }: { v: { type: string; value?: any; suit?: string; plus?: number } }) {
  const { t } = useI18n();
  if (v.type === 'pass') return <>{t('game.pass')}</>;
  if (v.type === 'contra') return <span className="text-ruby-400">{t('game.contra')}</span>;
  if (v.type === 'recontra') return <span className="text-ruby-400">{t('game.recontra')}</span>;
  return (
    <span>
      {v.value === 'kapot' ? `${t('game.kapot')}${v.plus ? ` +${v.plus}` : ''}` : v.value}{' '}
      {v.suit === 'NT' ? <span className="text-gold-300">{t('game.noTrump')}</span> : <span className={isRed(v.suit!) ? 'text-ruby-400' : ''}>{SUIT_SYMBOL[v.suit!]}</span>}
    </span>
  );
}

/** What a player says out loud about combinations ("50!", "Բոյը ինչ ա՞", "Ջրի, իմը տուզ ա"). */
function useTalkText() {
  const { t } = useI18n();
  const kind = (k?: string) => t(`talk.kind.${k}`);
  const rank = (r?: string) => (r && ['J', 'Q', 'K', 'A'].includes(r) ? t(`rank.${r}`) : r ?? '');
  return (x: ComboTalk) => {
    switch (x.say) {
      case 'announce': return kind(x.kind);
      case 'ask': return t('talk.ask');
      case 'height': return rank(x.rank);
      case 'drop': return t('talk.drop', { x: x.rank ? rank(x.rank) : kind(x.kind) });
      case 'same': return t('talk.same', { x: rank(x.rank) });
    }
  };
}

function SeatBadge({ info, pos, active, secondsLeft, total, lastBid, dealer, talk, comboCards, cardCount, myTeam, compact = false, emote = null }: {
  info: SeatInfo; pos: Pos; active: boolean; secondsLeft: number | null; total: number; lastBid: any; dealer: boolean;
  talk: ComboTalk | null; comboCards: PublicCombo[]; cardCount: number; myTeam: boolean; compact?: boolean; emote?: { key: number; text: string } | null;
}) {
  const talkText = useTalkText();
  const { t } = useI18n();
  const pct = active && secondsLeft !== null && total ? secondsLeft / total : 1;
  const vertical = pos === 'left' || pos === 'right';
  return (
    <div className={`relative flex items-center gap-2 ${vertical ? 'flex-col' : 'flex-row'}`}>
      <div className="relative">
        {active && <span className="absolute -inset-1.5 animate-pulse-ring rounded-full border-2 border-gold-400" />}
        <svg className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] -rotate-90" viewBox="0 0 36 36" aria-hidden>
          {active && <circle cx="18" cy="18" r="16.5" fill="none" stroke={pct < 0.3 ? '#e0435c' : '#eabd55'} strokeWidth="2.5" strokeDasharray={`${pct * 103.7} 103.7`} strokeLinecap="round" />}
        </svg>
        <Avatar name={info.avatar} size={compact ? 40 : 44} ring={myTeam ? 'ring-2 ring-felt-500/70' : 'ring-2 ring-gold-500/50'} />
        {dealer && <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] font-black text-ink-900 shadow" title={t('game.dealer')}>D</span>}
        {!info.connected && <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full bg-ruby-500 ring-2 ring-ink-900" title={t('game.disconnected')} />}
      </div>
      <div className={`min-w-0 ${vertical ? 'text-center' : ''}`}>
        <div className="max-w-[96px] truncate text-xs font-bold sm:max-w-[140px] sm:text-sm">{info.nickname}</div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-white/50">
          {info.isBot ? <span>{t('common.bot')}</span> : info.rating ? <span>★ {info.rating}</span> : null}
          {pos !== 'bottom' && cardCount > 0 && <span>🂠 {cardCount}</span>}
          {active && secondsLeft !== null && <span className="font-bold text-gold-300">{secondsLeft}s</span>}
        </div>
        <AnimatePresence>
          {lastBid && (
            <motion.div key={JSON.stringify(lastBid)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 inline-block whitespace-nowrap rounded-full bg-white px-3 py-1 font-display text-lg font-extrabold leading-none text-ink-900 shadow">
              <BidLabel v={lastBid} />
            </motion.div>
          )}
        </AnimatePresence>
        {/* on landscape phones my own talk/combos sit beside the badge so the felt keeps its height */}
        <div className={pos !== 'bottom' ? '' : compact ? 'absolute bottom-full left-0 mb-2 flex flex-col items-start' : 'short:absolute short:bottom-0 short:left-full short:ml-2 short:flex short:flex-col short:items-start'}>
        <AnimatePresence>
          {emote && (
            <motion.div
              key={emote.key}
              initial={{ scale: 0.4, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className={/^\P{L}{1,4}$/u.test(emote.text) ? 'mt-1 block text-4xl leading-none drop-shadow' : 'relative mt-1 block w-max max-w-[160px] rounded-2xl bg-white px-3 py-1 text-sm font-bold text-ink-900 shadow-lg'}
            >
              {emote.text}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {talk && (
            <motion.div
              key={JSON.stringify(talk)}
              initial={{ scale: 0.5, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className={`relative mt-1 inline-block whitespace-nowrap rounded-2xl px-3 py-1 font-extrabold shadow-glow ${
                talk.say === 'announce' ? 'bg-gold-grad text-lg uppercase tracking-wide text-ink-950' : talk.say === 'drop' ? 'bg-ruby-600 text-sm text-white' : 'bg-white text-sm text-ink-900'
              }`}
            >
              {talkText(talk)}
            </motion.div>
          )}
        </AnimatePresence>
        {comboCards.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {comboCards.map((c, i) => (
              <div key={i} className={`flex -space-x-3 ${c.counts ? '' : 'opacity-40 grayscale'}`}>
                {c.cards?.map((card) => <PlayingCard key={card} card={card} size="xs" />)}
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export function BlotTable({ dto, onAction, onLeave, busy, actionError, spectator = false }: { dto: MatchDTO<BlotView>; onAction: (a: Action) => void; onLeave: () => void; busy: boolean; actionError: string | null; spectator?: boolean }) {
  const { t } = useI18n();
  const { connected, socket } = useApp();
  const v = dto.view;
  const mySeat = (v.seat ?? 0) as Seat;
  const myTeam = mySeat % 2;
  const rel = (s: number): Pos => POS[(s - mySeat + 4) % 4];
  const secondsLeft = useCountdown(dto.deadline);
  const compact = useCompact();
  // the game owns the whole screen on phones: no page scrolling underneath
  useEffect(() => {
    if (!compact) return;
    const el = [document.documentElement, document.body];
    const prev = el.map((e) => e.style.overflow);
    el.forEach((e) => (e.style.overflow = 'hidden'));
    return () => el.forEach((e, i) => (e.style.overflow = prev[i]));
  }, [compact]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [handResult, setHandResult] = useState<HandResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shownTrick, setShownTrick] = useState<CompletedTrick | null>(null);
  const [showFair, setShowFair] = useState(false);
  // quick phrases / emojis shown over a seat for 3 s
  const emoteText = useEmoteText();
  const [showEmotes, setShowEmotes] = useState(false);
  const [showLast, setShowLast] = useState(false);
  const [menuSeat, setMenuSeat] = useState<number | null>(null);
  // «Մի հատ էլ խաղանք»: who already agreed to play again
  const router = useRouter();
  const [rematch, setRematch] = useState<{ sent: boolean; seats: number[]; needed: number; error?: string }>({ sent: false, seats: [], needed: 0 });
  useSocketEvent<{ matchId: string; seats?: number[]; needed?: number; newMatchId?: string; error?: string }>('match:rematch', (d) => {
    if (d.matchId !== dto.matchId) return;
    if (d.newMatchId) router.push(`/match/${d.newMatchId}`);
    else if (d.error) setRematch((r) => ({ ...r, sent: false, error: d.error }));
    else setRematch((r) => ({ ...r, seats: d.seats ?? r.seats, needed: d.needed ?? r.needed }));
  });
  const askRematch = () => {
    setRematch((r) => ({ ...r, sent: true, error: undefined }));
    socket?.emit('match:rematch', { matchId: dto.matchId }, (res: any) => {
      if (res?.error) setRematch((r) => ({ ...r, sent: false, error: res.error.message ?? res.error.code }));
      else if (res?.newMatchId) router.push(`/match/${res.newMatchId}`);
    });
  };
  const [emotes, setEmotes] = useState<Record<number, { key: number; text: string }>>({});
  const [muted, setMuted] = useState<Record<number, boolean>>({});
  useSocketEvent<{ matchId: string; seat: number; id: string }>('match:emote', (d) => {
    if (d.matchId !== dto.matchId || muted[d.seat]) return;
    const key = Date.now();
    setEmotes((m) => ({ ...m, [d.seat]: { key, text: emoteText(d.id) } }));
    sound()?.pop();
    setTimeout(() => setEmotes((m) => (m[d.seat]?.key === key ? (({ [d.seat]: _, ...rest }) => rest)(m) : m)), 3000);
  });
  const sendEmote = (id: string) => {
    setShowEmotes(false);
    socket?.emit('match:emote', { matchId: dto.matchId, id });
  };
  const seenVersion = useRef(0);

  const players = dto.players;
  const nameOf = (s: number) => players[s]?.nickname ?? `#${s}`;

  // React to the events that produced this state (animations, toasts, hand summary).
  useEffect(() => {
    if (v.version <= seenVersion.current) return;
    seenVersion.current = v.version;
    for (const e of dto.events as GameEvent[]) {
      if (e.type === 'card_played') {
        if (e.slap) sound()?.slap();
        else sound()?.card();
      }
      if (e.type === 'trick_won') {
        const lt = v.lastTrick;
        if (lt) {
          setShownTrick(lt);
          setTimeout(() => setShownTrick(null), 1300);
        }
      }
      if (e.type === 'hand_scored') setTimeout(() => setHandResult(e.result), 1300);
      if (e.type === 'redeal') setToast(t('game.redeal'));
      if (e.type === 'blot') setToast(`${nameOf(e.seat)}: ${t('game.blot')}!`);
      if (e.type === 'contra') setToast(`${nameOf(e.seat)}: ${t('game.contra')}!`);
      if (e.type === 'recontra') setToast(`${nameOf(e.seat)}: ${t('game.recontra')}!`);
    }
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.version]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!handResult) return;
    const id = setTimeout(() => setHandResult(null), 6000);
    return () => clearTimeout(id);
  }, [handResult]);

  const myTurn = !spectator && v.turn === mySeat && v.status === 'playing';
  const legal = new Set(v.legal.cards);
  const firstPlay = v.phase === 'playing' && v.tricksWon[0] + v.tricksWon[1] === 0 && v.declaredKinds[mySeat] === null;
  const myCombos = useMemo(() => (firstPlay ? detectCombos(v.myHand as Card[], v.contract?.suit === 'NT') : []), [firstPlay, v.myHand, v.contract]);

  const lastBids = useMemo(() => {
    const m: Record<number, any> = {};
    if (v.phase === 'bidding') for (const b of v.bids) m[b.seat] = b;
    return m;
  }, [v.bids, v.phase]);

  // one tap plays the card; a quick second tap on it slams it down («ճտոց») — everybody hears it
  const pendingTap = useRef<{ card: Card; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clickCard = (c: Card) => {
    if (!myTurn || v.phase !== 'playing' || !legal.has(c) || busy) return;
    const p = pendingTap.current;
    if (p) {
      clearTimeout(p.timer);
      pendingTap.current = null;
      onAction({ type: 'play', card: p.card, declare: true, ...(p.card === c ? { slap: true } : {}) });
      return;
    }
    pendingTap.current = {
      card: c,
      timer: setTimeout(() => {
        pendingTap.current = null;
        onAction({ type: 'play', card: c, declare: true });
      }, 230),
    };
  };

  // combination talk during the first two rounds; combination cards shown to everyone in round two
  const talkBySeat: Record<number, ComboTalk> = {};
  for (const x of v.comboTalk ?? []) talkBySeat[x.seat] = x;
  const comboCardsBySeat: Record<number, PublicCombo[]> = {};
  if (v.phase === 'playing' && v.tricksWon[0] + v.tricksWon[1] === 1) for (const c of v.combos) (comboCardsBySeat[c.seat] ??= []).push(c);

  const trickToShow: Play[] = v.trick.length ? v.trick : shownTrick?.plays ?? [];
  const finished = v.status === 'finished';
  const won = finished && v.winnerTeam === myTeam;
  const total = v.config.turnTimeoutSec;
  const contract = v.contract;

  return (
    <div className={`fixed inset-0 z-40 flex h-[100dvh] flex-col ${compact ? 'overflow-clip' : 'overflow-hidden'} bg-ink-950 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:relative md:inset-auto md:z-auto md:h-auto md:min-h-[calc(100dvh-110px)] md:rounded-3xl short:fixed short:inset-0 short:z-40 short:h-[100dvh] short:min-h-0 short:rounded-none`}>
      {/* top bar */}
      {/* on phones the bar floats over the felt so the table uses the whole screen */}
      <div className={`z-20 flex flex-wrap items-center gap-2 px-3 py-2 pt-[calc(env(safe-area-inset-top)+8px)] short:flex-nowrap short:gap-1.5 short:py-1 short:pt-1 ${compact ? 'absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent' : 'border-b border-white/5 bg-ink-950/80'}`}>
        <div className="flex items-center gap-1.5 rounded-xl bg-black/40 px-2.5 py-1.5 ring-1 ring-white/10">
          <span className="text-[11px] text-felt-500">{t('game.us')}</span>
          <span className="font-display text-lg font-extrabold tabular-nums">{v.scores[myTeam]}</span>
          <span className="text-white/30">:</span>
          <span className="font-display text-lg font-extrabold tabular-nums">{v.scores[1 - myTeam]}</span>
          <span className="text-[11px] text-gold-300">{t('game.them')}</span>
          <span className="ml-1 text-[10px] text-white/40 short:hidden">{t('game.target', { n: v.config.targetScore })}</span>
        </div>
        {contract && (
          <div className="flex items-center gap-1.5 rounded-xl bg-black/40 px-2.5 py-1.5 text-sm ring-1 ring-white/10">
            <span className="text-[11px] text-white/45 short:hidden">{t('game.contract')}</span>
            <span className="font-display text-lg font-extrabold leading-none"><BidLabel v={{ type: 'bid', value: contract.value, suit: contract.suit, plus: contract.plus }} /></span>
            <span className={`text-[11px] ${contract.seat % 2 === myTeam ? 'text-felt-500' : 'text-gold-300'}`}>{nameOf(contract.seat)}</span>
            {v.recontra !== null ? <Badge color="red">×4</Badge> : v.contra !== null ? <Badge color="red">×2</Badge> : null}
          </div>
        )}
        {contract?.suit === 'NT' && (
          <div className="flex items-center gap-1 rounded-xl bg-black/40 px-2.5 py-1.5 ring-1 ring-gold-400/30">
            <span className="text-sm font-bold text-gold-200">{t('game.noTrump')}</span>
            {v.config.noTrumpDoubled && <Badge color="gold">×2</Badge>}
          </div>
        )}
        {v.trump && (
          <div className="flex items-center gap-1 rounded-xl bg-black/40 px-2.5 py-1.5 ring-1 ring-white/10">
            <span className="text-[11px] text-white/45 short:hidden">{t('game.trump')}</span>
            <span className={`text-xl leading-none ${isRed(v.trump) ? 'text-ruby-400' : ''}`}>{SUIT_SYMBOL[v.trump]}</span>
          </div>
        )}
        <span className="hidden text-xs text-white/40 sm:inline short:hidden">{t('game.hand', { n: v.handNumber })}</span>
        {dto.stake > 0 && <span className="text-xs text-white/50">{t('game.stake')}: <Coins amount={dto.stake} currency={dto.currency} /></span>}
        {dto.mode === 'PRACTICE' && <span className="short:hidden"><Badge color="blue">{t('game.practice')}</Badge></span>}
        <div className="ml-auto flex items-center gap-1">
          {!connected && <Badge color="red">{t('game.reconnecting')}</Badge>}
          <button onClick={() => setShowFair(true)} className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5" title={t('game.fairness')}>🛡️</button>
          <MusicButton className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5" />
          {v.phase === 'playing' && v.lastTrick && <button onClick={() => setShowLast(true)} aria-label={t('game.lastTrick')} title={t('game.lastTrick')} className="rounded-lg px-2 py-1.5 text-base hover:bg-white/5">↺</button>}
          {!finished && !spectator && <button onClick={() => setShowEmotes((x) => !x)} aria-label="emotes" className="rounded-lg px-2 py-1.5 text-base hover:bg-white/5">😀</button>}
          {spectator && <button onClick={onLeave} className="whitespace-nowrap rounded-lg bg-white/5 px-2 py-1.5 text-sm text-white/80">👁 {t('watch.watching')} · ✕</button>}
          {dto.mode !== 'PRACTICE' && <button onClick={() => setShowChat(!showChat)} className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5">💬</button>}
          {!finished && !spectator && <button onClick={() => setConfirmLeave(true)} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-ruby-400 hover:bg-white/5">{t('game.leave')}</button>}
        </div>
      </div>

      {/* felt */}
      <div className="felt relative flex-1">
        {!compact && <div className="pointer-events-none absolute inset-3 rounded-[48px] border border-gold-400/15 sm:inset-6" />}
        {/* opponents & partner */}
        {([1, 2, 3] as const).map((off) => {
          const seat = ((mySeat + off) % 4) as Seat;
          const pos = rel(seat);
          const place = pos === 'top' ? `left-1/2 -translate-x-1/2 ${compact ? 'top-[150px] short:top-10' : 'top-3 short:top-1'}` : pos === 'left' ? 'left-2 top-1/2 -translate-y-1/2 sm:left-6' : 'right-2 top-1/2 -translate-y-1/2 sm:right-6';
          return (
            <div key={seat} className={`absolute z-10 ${place} ${players[seat]?.isBot ? '' : 'cursor-pointer'}`} onClick={() => !players[seat]?.isBot && players[seat]?.nickname && setMenuSeat(seat)}>
              <SeatBadge info={players[seat]} pos={pos} active={v.turn === seat && !finished} secondsLeft={secondsLeft} total={total} lastBid={lastBids[seat]} dealer={v.dealer === seat} talk={talkBySeat[seat] ?? null} comboCards={comboCardsBySeat[seat] ?? []} cardCount={v.cardCounts[seat]} myTeam={seat % 2 === myTeam} compact={compact} emote={emotes[seat] ?? null} />
            </div>
          );
        })}

        {/* trick */}
        <div className={`absolute left-1/2 h-0 w-0 ${compact ? 'top-[48%] short:top-[45%]' : 'top-[46%]'}`}>
          <AnimatePresence>
            {trickToShow.map((p) => {
              const pos = rel(p.seat);
              const k = compact ? 0.8 : 1;
              const o = { x: TRICK_OFFSET[pos].x * k, y: TRICK_OFFSET[pos].y * k, r: TRICK_OFFSET[pos].r };
              const winner = shownTrick && !v.trick.length ? rel(shownTrick.winner) : null;
              return (
                <motion.div
                  key={`${v.handNumber}-${p.card}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  initial={{ x: FLY_FROM[pos].x * 0.75, y: FLY_FROM[pos].y * 0.75, opacity: 0, scale: 1.35, rotate: o.r + jitter(p.card) * 6 }}
                  animate={{
                    x: o.x + jitter(p.card + 'x') * 6,
                    y: o.y + jitter(p.card + 'y') * 6,
                    opacity: 1,
                    scale: [1.35, 0.96, 1],
                    rotate: o.r + jitter(p.card),
                    transition: { x: { type: 'spring', stiffness: 170, damping: 20 }, y: { type: 'spring', stiffness: 170, damping: 20 }, rotate: { type: 'spring', stiffness: 120, damping: 12 }, scale: { duration: 0.42, times: [0, 0.75, 1], ease: 'easeOut' }, opacity: { duration: 0.15 } },
                  }}
                  exit={winner ? { x: FLY_FROM[winner].x * 0.8, y: FLY_FROM[winner].y * 0.8, opacity: 0, scale: 0.55, rotate: 0, transition: { duration: 0.45, ease: 'easeIn' } } : { opacity: 0 }}
                  style={{ marginLeft: compact ? -30 : -35, marginTop: compact ? -43 : -50, filter: 'drop-shadow(0 8px 10px rgba(0,0,0,0.45))' }}
                >
                  <PlayingCard card={p.card} size="md" />
                </motion.div>
              );
            })}
          </AnimatePresence>
          {v.phase === 'bidding' && !myTurn && v.turn !== null && (
            <div className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/40 px-4 py-2 text-sm text-white/80">{t('game.bidding')}: {t('game.waitingFor', { name: nameOf(v.turn) })}</div>
          )}
        </div>

        {/* combos announced after the first trick */}

        <AnimatePresence>
          {toast && (
            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[30%] z-20 -translate-x-1/2 rounded-full bg-gold-grad px-5 py-2 font-bold text-ink-950 shadow-glow">
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {compact && (
        <>
          {/* me: avatar on the left, turn / tricks on the right, the hand in between */}
          <div className="absolute bottom-[110px] right-2 z-20 text-right text-xs short:bottom-[max(8px,env(safe-area-inset-bottom))]">
            {myTurn ? <span className="rounded-full bg-gold-400/20 px-3 py-1 font-bold text-gold-200">{t('game.yourTurn')}</span> : v.turn !== null && !finished ? <span className="text-white/60">{t('game.waitingFor', { name: nameOf(v.turn) })}</span> : null}
            <div className="mt-1.5 text-white/45">{t('game.tricks')}: {v.tricksWon[myTeam]} : {v.tricksWon[1 - myTeam]}</div>
          </div>
          {firstPlay && myCombos.length > 0 && (
            <div className="absolute bottom-[108px] left-1/2 z-20 w-max max-w-[60%] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-center text-xs ring-1 ring-gold-400/30 short:bottom-[112px]">
              {t('game.yourCombos')}: {myCombos.map((c) => `${t(`combo.${c.kind}`)} (${c.points})`).join(', ')}
            </div>
          )}
          <div className="absolute bottom-[110px] left-2 z-20 short:bottom-[max(8px,env(safe-area-inset-bottom))] short:max-w-[110px]">
            <SeatBadge info={players[mySeat]} pos="bottom" active={myTurn} secondsLeft={secondsLeft} total={total} lastBid={lastBids[mySeat]} dealer={v.dealer === mySeat} talk={talkBySeat[mySeat] ?? null} comboCards={[]} cardCount={0} myTeam compact emote={emotes[mySeat] ?? null} />
          </div>
          {actionError && <p className="absolute bottom-[120px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-ruby-400">{actionError}</p>}
          <div className="pointer-events-none absolute inset-x-0 -bottom-3.5 z-10 flex justify-center short:-bottom-[18px]">
            <div className="pointer-events-auto flex -space-x-9 short:-space-x-4">
              {v.myHand.map((c, i) => {
                const playable = myTurn && v.phase === 'playing' && legal.has(c as Card);
                const dim = myTurn && v.phase === 'playing' && !playable;
                const mid = (v.myHand.length - 1) / 2;
                return (
                  <motion.div key={c} layout initial={{ y: 60, opacity: 0 }} animate={{ y: Math.abs(i - mid) * 3 + (playable ? -6 : 0), opacity: 1, rotate: (i - mid) * 2.5 }} transition={{ delay: i * 0.03 }}>
                    <PlayingCard card={c} size="hand" dim={dim} onClick={playable ? () => clickCard(c as Card) : undefined} className={playable ? 'ring-2 ring-gold-400/70' : ''} />
                  </motion.div>
                );
              })}
            </div>
          </div>
          {myTurn && v.phase === 'bidding' && v.legal.bidding && (
            <div className="absolute inset-x-2 bottom-[104px] z-30 flex justify-center short:inset-x-[85px] short:bottom-[82px]">
              <BiddingPanel key={v.version} options={v.legal.bidding} onAction={onAction} busy={busy} compact />
            </div>
          )}
        </>
      )}

      {/* me */}
      {!compact && <div className="relative z-10 border-t border-white/5 bg-gradient-to-t from-ink-950 to-ink-950/70 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 short:flex short:items-end short:gap-2 short:pb-[max(4px,env(safe-area-inset-bottom))] short:pt-1">
        <div className="mb-2 flex items-center justify-between gap-2 px-1 short:mb-1 short:w-[150px] short:shrink-0 short:flex-col short:items-start short:justify-end short:gap-1">
          <SeatBadge info={players[mySeat]} pos="bottom" active={myTurn} secondsLeft={secondsLeft} total={total} lastBid={lastBids[mySeat]} dealer={v.dealer === mySeat} talk={talkBySeat[mySeat] ?? null} comboCards={comboCardsBySeat[mySeat] ?? []} cardCount={0} myTeam emote={emotes[mySeat] ?? null} />
          <div className="text-right text-xs short:text-left">
            {myTurn ? <span className="rounded-full bg-gold-400/20 px-3 py-1 font-bold text-gold-200">{t('game.yourTurn')}</span> : v.turn !== null && !finished ? <span className="text-white/50">{t('game.waitingFor', { name: nameOf(v.turn) })}</span> : null}
            <div className="mt-1 text-white/40">{t('game.tricks')}: {v.tricksWon[myTeam]} : {v.tricksWon[1 - myTeam]}</div>
          </div>
        </div>
        {firstPlay && myCombos.length > 0 && (
          <div className="mx-auto mb-2 w-fit rounded-full bg-gold-400/10 px-3 py-1.5 text-xs ring-1 ring-gold-400/30 short:absolute short:-top-9 short:left-1/2 short:z-20 short:mb-0 short:-translate-x-1/2">
            {t('game.yourCombos')}: {myCombos.map((c) => `${t(`combo.${c.kind}`)} (${c.points})`).join(', ')}
          </div>
        )}
        {actionError && <p className="mb-1 text-center text-xs text-ruby-400 short:absolute short:-top-6 short:left-1/2 short:-translate-x-1/2">{actionError}</p>}
        <div className="flex justify-center px-1 pb-1 pt-4 short:flex-1 short:pb-0 short:pt-1">
          <div className="flex -space-x-7 sm:-space-x-3 short:-space-x-2">
            {v.myHand.map((c, i) => {
              const playable = myTurn && v.phase === 'playing' && legal.has(c as Card);
              const dim = myTurn && v.phase === 'playing' && !playable;
              const mid = (v.myHand.length - 1) / 2;
              return (
                <motion.div key={c} layout initial={{ y: 60, opacity: 0 }} animate={{ y: Math.abs(i - mid) * 3, opacity: 1, rotate: (i - mid) * 2.5 }} transition={{ delay: i * 0.03 }}>
                  <PlayingCard card={c} size="lg" dim={dim} selected={selected === c} onClick={playable ? () => clickCard(c as Card) : undefined} className={playable ? 'ring-1 ring-gold-400/40' : ''} />
                </motion.div>
              );
            })}
          </div>
        </div>
        {myTurn && v.phase === 'bidding' && v.legal.bidding && (
          <div className="absolute inset-x-2 bottom-full mb-2 flex justify-center short:mb-1">
            <BiddingPanel key={v.version} options={v.legal.bidding} onAction={onAction} busy={busy} />
          </div>
        )}
      </div>}

      {/* beginner tips at the first bazar, card, combinations, trick and result */}
      {!spectator && !finished && (
        <Coach
          moment={((): TipId | null => {
            if (handResult) return 'result';
            if (myTurn && v.phase === 'bidding') return 'bazar';
            if ((v.comboTalk ?? []).length) return 'combos';
            if (v.lastTrick && v.tricksWon[0] + v.tricksWon[1] === 1) return 'trick';
            if (myTurn && v.phase === 'playing') return 'play';
            return null;
          })()}
        />
      )}

      {/* the previous trick, laid out by seat */}
      {showLast && v.lastTrick && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/60" onClick={() => setShowLast(false)}>
          <div className="rounded-3xl bg-felt-800/95 p-4 shadow-2xl ring-1 ring-gold-400/30">
            <div className="mb-2 text-center text-sm font-bold text-gold-200">{t('game.lastTrick')}</div>
            <div className="grid grid-cols-3 grid-rows-3 place-items-center gap-1">
              {v.lastTrick.plays.map((p) => {
                const pos = rel(p.seat);
                const cell = pos === 'top' ? 'col-start-2 row-start-1' : pos === 'left' ? 'col-start-1 row-start-2' : pos === 'right' ? 'col-start-3 row-start-2' : 'col-start-2 row-start-3';
                const won = p.seat === v.lastTrick!.winner;
                return (
                  <div key={p.seat} className={`flex flex-col items-center gap-0.5 ${cell}`}>
                    <PlayingCard card={p.card} size="md" className={won ? 'ring-2 ring-gold-400' : ''} />
                    <span className={`max-w-[80px] truncate text-[11px] ${won ? 'font-bold text-gold-200' : 'text-white/70'}`}>{p.seat === mySeat ? t('game.you') : nameOf(p.seat)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {menuSeat !== null && players[menuSeat]?.nickname && (
        <PlayerMenu
          nickname={players[menuSeat].nickname!}
          matchId={dto.matchId}
          muted={!!muted[menuSeat]}
          onMute={() => setMuted((m) => ({ ...m, [menuSeat]: !m[menuSeat] }))}
          onClose={() => setMenuSeat(null)}
        />
      )}

      {showEmotes && (
        <EmotePanel
          game="blot"
          phase={v.phase}
          onSend={sendEmote}
          others={([1, 2, 3] as const).map((o) => (mySeat + o) % 4).filter((s) => !players[s]?.isBot).map((s) => ({ seat: s, nickname: nameOf(s) }))}
          muted={muted}
          onToggleMute={(seat) => setMuted((m) => ({ ...m, [seat]: !m[seat] }))}
          onClose={() => setShowEmotes(false)}
        />
      )}

      {/* chat drawer */}
      <AnimatePresence>
        {showChat && (
          <motion.div initial={{ x: 280, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 280, opacity: 0 }} className={`absolute right-2 z-30 h-[210px] w-[230px] max-w-[calc(100%-1rem)] short:h-[150px] ${compact ? 'top-14' : 'top-14 short:top-10'}`}>
            <Chat channel={`match:${dto.matchId}`} enabled={dto.chatEnabled} className="h-full" compact />
          </motion.div>
        )}
      </AnimatePresence>

      {/* hand result */}
      <Modal open={!!handResult && !finished} onClose={() => setHandResult(null)} title={t('game.handResult')}>
        {handResult && <HandSummary r={handResult} myTeam={myTeam} nameOf={nameOf} />}
      </Modal>

      {/* final */}
      <Confetti run={won && !spectator} />
      <Modal open={finished} title={spectator ? t('game.finalScore') : won ? `🏆 ${t('game.youWon')}` : t('game.youLost')}>
        <div className="text-center">
          <div className="mb-1 text-xs uppercase tracking-wider text-white/40">{t('game.finalScore')}</div>
          <div className="font-display text-5xl font-extrabold">
            <span className="text-felt-500">{v.scores[myTeam]}</span> <span className="text-white/30">:</span> <span className="text-gold-300">{v.scores[1 - myTeam]}</span>
          </div>
          {v.finishReason === 'forfeit' && <p className="mt-2 text-sm text-white/50">{t('game.forfeit')}</p>}
          {v.finishReason === 'tharsKapot' && <p className="mt-2 text-sm text-white/50">{t('game.tharsKapot')}</p>}
          {v.finishReason === 'kapot' && <p className="mt-2 text-sm text-white/50">{t('game.kapotWin')}</p>}
          {dto.stake > 0 && <p className="mt-2"><Coins amount={won ? dto.stake : -dto.stake} currency={dto.currency} signed /></p>}
          {v.finishReason !== 'forfeit' && !spectator && (
            <div className="mt-5">
              <Button variant="emerald" size="lg" loading={rematch.sent && !rematch.needed} disabled={rematch.sent} onClick={askRematch}>🔁 {t('game.rematch')}</Button>
              {rematch.sent && rematch.needed > 1 && <p className="mt-2 text-sm text-white/60">{t('game.rematchWaiting', { n: rematch.seats.length, total: rematch.needed })}</p>}
              {!rematch.sent && rematch.seats.length > 0 && <p className="mt-2 text-sm text-gold-200">{t('game.rematchAsked', { n: rematch.seats.length, total: rematch.needed })}</p>}
              {rematch.error && <p className="mt-2 text-sm text-ruby-400">{rematch.error}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/"><Button variant="gold">{t('game.backHome')}</Button></Link>
            <Link href={`/matches/${dto.matchId}`}><Button>{t('game.details')}</Button></Link>
          </div>
        </div>
      </Modal>

      <Modal open={confirmLeave} onClose={() => setConfirmLeave(false)} title={t('game.leave')}>
        <p className="text-white/70">{t('game.leaveConfirm')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" onClick={() => setConfirmLeave(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => { setConfirmLeave(false); onLeave(); }}>{t('game.leave')}</Button>
        </div>
      </Modal>

      <Modal open={showFair} onClose={() => setShowFair(false)} title={`🛡️ ${t('game.fairness')}`} wide>
        <p className="text-sm text-white/70">{t('bgame.fairnessText')}</p>
        <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs">
          <div className="text-white/40">{t('bgame.commitment')}</div>
          <code className="break-all text-gold-200">{dto.deckCommitment ?? '—'}</code>
        </div>
        {(dto.revealedDecks ?? []).length > 0 && (
          <div className="mt-3 max-h-60 space-y-2 overflow-y-auto text-xs">
            {(dto.revealedDecks ?? []).map((d) => (
              <div key={d.hand} className="rounded-xl bg-black/20 p-2">
                <div className="font-semibold">{t('game.hand', { n: d.hand })}</div>
                <div className="break-all text-white/50">sha256({d.salt}:{d.deck.join(',')})</div>
                <div className="break-all text-felt-500">= {d.commitment}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function HandSummary({ r, myTeam, nameOf }: { r: HandResult; myTeam: number; nameOf: (s: number) => string }) {
  const { t } = useI18n();
  if (r.redeal) return <p>{t('game.redeal')}</p>;
  const row = (label: string, a: number, b: number) => (
    <tr><td className="py-1 text-white/60">{label}</td><td className="text-center font-semibold">{a}</td><td className="text-center font-semibold">{b}</td></tr>
  );
  const other = 1 - myTeam;
  return (
    <div>
      {r.contract && (
        <p className="mb-3 text-sm">
          {t('game.contract')}: <b><BidLabel v={{ type: 'bid', value: r.contract.value, suit: r.contract.suit, plus: r.contract.plus }} /></b> — {nameOf(r.contract.seat)}{' '}
          {r.recontra ? '×4' : r.contra ? '×2' : ''} · {r.made ? <span className="text-felt-500">{t('game.made')}</span> : <span className="text-ruby-400">{t('game.failed')}</span>}
          {r.kapotTeam !== null && <Badge color="gold">{t('game.kapot')}</Badge>}
        </p>
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-white/40"><th /><th>{t('game.us')}</th><th>{t('game.them')}</th></tr></thead>
        <tbody>
          {row(t('game.tricks'), r.tricksWon[myTeam], r.tricksWon[other])}
          {row(t('game.cardPoints'), r.trickRaw[myTeam], r.trickRaw[other])}
          {row(t('game.combos'), r.comboRaw[myTeam], r.comboRaw[other])}
          {row(t('game.blot'), r.blotRaw[myTeam], r.blotRaw[other])}
          <tr className="border-t border-white/10 text-gold-200">{[t('game.awarded'), r.awarded[myTeam], r.awarded[other]].map((x, i) => <td key={i} className={`py-1.5 ${i ? 'text-center' : ''} font-bold`}>{x}</td>)}</tr>
          <tr>{[t('game.total'), r.scoresAfter[myTeam], r.scoresAfter[other]].map((x, i) => <td key={i} className={`py-1 ${i ? 'text-center' : ''} font-display text-lg font-extrabold`}>{x}</td>)}</tr>
        </tbody>
      </table>
      {r.lines && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-black/25 p-3 text-sm">
          <div className="text-xs text-white/40">{t('score.how')}</div>
          {[myTeam, other].map((team) => {
            const ls = r.lines![team];
            return (
              <div key={team} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={`w-14 shrink-0 text-xs ${team === myTeam ? 'text-felt-500' : 'text-gold-300'}`}>{team === myTeam ? t('game.us') : t('game.them')}</span>
                {ls.length === 0 ? <span className="font-bold">0</span> : ls.map((l, i) => (
                  <span key={i} className="whitespace-nowrap">
                    {i > 0 && <span className="text-white/30"> + </span>}
                    <span className="font-bold">{l.kind === 'bid' && l.mult && l.mult > 1 ? `${l.bid} × ${l.mult}` : l.points}</span>
                    <span className="ml-1 text-[11px] text-white/45">{t(`score.${l.kind}`)}</span>
                  </span>
                ))}
                <span className="text-white/30"> = </span><span className="font-display font-extrabold text-gold-200">{r.awarded[team]}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const _newActionId = newId;

/** Another player at the table: profile, mute, block, report. */
function PlayerMenu({ nickname, matchId, muted, onMute, onClose }: { nickname: string; matchId: string; muted: boolean; onMute: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const { data: p, mutate } = useSWR<any>(`/users/profile/${encodeURIComponent(nickname)}`);
  return (
    <Modal open onClose={onClose} title={nickname}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Link href={`/u/${encodeURIComponent(nickname)}`} target="_blank"><Button size="sm">👤 {t('player.profile')}</Button></Link>
          <Button size="sm" onClick={onMute}>{muted ? `🔈 ${t('player.unmute')}` : `🔇 ${t('player.mute')}`}</Button>
        </div>
        <PlayerActions nickname={nickname} blocked={!!p?.blocked} matchId={matchId} onChange={() => mutate()} />
      </div>
    </Modal>
  );
}
