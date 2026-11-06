'use client';
import { AnyAction, AnyEvent, CMove, CMoveC, CheckersView, ChessView, MatchDTO, Seat } from '@nardi/engine';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { Chat } from '../Chat';
import { MusicButton } from '../Sound';
import { Badge, Button, Coins, Modal } from '../ui';
import { Confetti } from './Confetti';
import { DuelBoard, Highlight } from './DuelBoard';
import { EmotePanel, useEmoteText } from './EmotePanel';
import { Plate, PlayerMenu, useCountdown } from './GameTable';

type DuelView = ChessView | CheckersView;

/** Remaining time of each chess clock, ticking locally from the server's numbers. */
function useClocks(v: DuelView, serverTime: number) {
  const offset = useRef(0);
  useEffect(() => {
    offset.current = serverTime - Date.now();
  }, [serverTime]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (v.game !== 'chess' || v.status !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [v.game, v.status]);
  if (v.game !== 'chess') return null;
  const c = v.clock;
  const running = v.status === 'playing' ? v.turn : null;
  return ([0, 1] as Seat[]).map((s) => Math.max(0, s === running ? c.left[s] - (now + offset.current - c.since) : c.left[s]));
}

const fmtClock = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), sec = total % 60;
  return ms < 10_000 ? `${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}` : `${m}:${String(sec).padStart(2, '0')}`;
};

function Clock({ ms, active }: { ms: number; active: boolean }) {
  return (
    <div className={`mt-1 inline-block rounded-lg px-2.5 py-0.5 font-mono text-lg font-bold tabular-nums ${active ? (ms < 20_000 ? 'bg-ruby-500 text-white' : 'bg-white text-ink-950') : 'bg-black/40 text-white/70'}`}>
      {fmtClock(ms)}
    </div>
  );
}

export function DuelTable({ dto, onAction, onLeave, busy, actionError, spectator = false }: { dto: MatchDTO<DuelView>; onAction: (a: AnyAction) => void; onLeave: () => void; busy: boolean; actionError: string | null; spectator?: boolean }) {
  const { t } = useI18n();
  const { connected, socket } = useApp();
  const router = useRouter();
  const v = dto.view;
  const chess = v.game === 'chess';
  const mySeat = (v.seat ?? 0) as Seat;
  const oppSeat = (1 - mySeat) as Seat;
  const players = dto.players;
  const nameOf = (s: number) => players[s]?.nickname ?? `#${s}`;
  const secondsLeft = useCountdown(chess ? null : dto.deadline);
  const clocks = useClocks(v, dto.serverTime);
  const finished = v.status === 'finished';
  const myTurn = !spectator && !finished && v.turn === mySeat;

  useEffect(() => {
    const el = [document.documentElement, document.body];
    const prev = el.map((e) => e.style.overflow);
    el.forEach((e) => (e.style.overflow = 'hidden'));
    return () => el.forEach((e, i) => (e.style.overflow = prev[i]));
  }, []);

  const [selected, setSelected] = useState<number | null>(null);
  const [prefix, setPrefix] = useState<number[]>([]);
  const [promo, setPromo] = useState<CMoveC[] | null>(null);
  const [confirm, setConfirm] = useState<'resign' | 'leave' | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showEmotes, setShowEmotes] = useState(false);
  const [menuSeat, setMenuSeat] = useState<number | null>(null);
  const [muted, setMuted] = useState<Record<number, boolean>>({});
  const [emotes, setEmotes] = useState<Record<number, { key: number; text: string }>>({});
  const [toast, setToast] = useState<string | null>(null);
  const emoteText = useEmoteText();

  // sounds and notices for what just happened
  const seen = useRef(0);
  useEffect(() => {
    if (v.version <= seen.current) return;
    const first = seen.current === 0;
    seen.current = v.version;
    setSelected(null);
    setPrefix([]);
    setPromo(null);
    if (first) return;
    for (const e of dto.events as AnyEvent[]) {
      if (e.type === 'moved') {
        const m = e as { capture?: boolean; check?: boolean };
        sound()?.checker();
        if (m.capture) setTimeout(() => sound()?.checker(), 120);
      }
      if (e.type === 'draw_offered' && (e as { seat: Seat }).seat !== mySeat && !spectator) setToast(t('duel.drawOffered', { name: nameOf((e as { seat: Seat }).seat) }));
      if (e.type === 'draw_declined' && (e as { seat: Seat }).seat !== mySeat && !spectator) setToast(t('duel.drawDeclined'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.version]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

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

  // rematch with colours swapped
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

  // ---------------------------------------------------------------- moving
  const chessLegal = chess && myTurn ? (v as ChessView).legal : [];
  const checkersLegal: CMove[] = !chess && myTurn ? (v as CheckersView).legal : [];
  // checkers: the moves that still fit the squares tapped so far
  const fitting = checkersLegal.filter((m) => prefix.every((sq, i) => m.path[i] === sq));
  const sources = useMemo(() => new Set(chess ? chessLegal.map((m) => m.from) : checkersLegal.map((m) => m.path[0])), [chess, chessLegal, checkersLegal]);

  const highlights: Highlight[] = [];
  const lastPath = chess ? ((v as ChessView).lastMove ? [(v as ChessView).lastMove!.from, (v as ChessView).lastMove!.to] : null) : (v as CheckersView).lastMove?.path ?? null;
  for (const sq of lastPath ?? []) highlights.push({ sq, kind: 'last' });
  if (chess && (v as ChessView).check !== null) highlights.push({ sq: (v as ChessView).check!, kind: 'check' });
  if (myTurn && selected === null && prefix.length === 0 && !busy) for (const sq of sources) highlights.push({ sq, kind: 'from' });
  const clickable = new Set<number>();
  if (chess && selected !== null) {
    highlights.push({ sq: selected, kind: 'selected' });
    for (const m of chessLegal.filter((x) => x.from === selected)) {
      highlights.push({ sq: m.to, kind: v.board[m.to] ? 'capture' : 'target' });
      clickable.add(m.to);
    }
  }
  if (!chess && prefix.length) {
    prefix.forEach((sq) => highlights.push({ sq, kind: 'selected' }));
    for (const m of fitting) {
      const nxt = m.path[prefix.length];
      if (nxt !== undefined) { highlights.push({ sq: nxt, kind: 'target' }); clickable.add(nxt); }
      m.captures.forEach((c) => highlights.push({ sq: c, kind: 'capture' }));
    }
  }
  sources.forEach((s) => clickable.add(s));

  const sendChess = (m: CMoveC) => {
    setSelected(null);
    onAction({ type: 'move', move: m });
  };
  const onSquare = (sq: number) => {
    if (!myTurn || busy) return;
    if (chess) {
      if (selected !== null) {
        const opts = chessLegal.filter((m) => m.from === selected && m.to === sq);
        if (opts.length === 1) return sendChess(opts[0]);
        if (opts.length > 1) return setPromo(opts);
      }
      setSelected(sources.has(sq) && selected !== sq ? sq : null);
      return;
    }
    // checkers: tap the piece, then each landing square (a single way goes by itself)
    if (prefix.length === 0 || (sources.has(sq) && prefix.length === 1)) {
      if (!sources.has(sq)) return;
      if (prefix[0] === sq) return setPrefix([]);
      const mine = checkersLegal.filter((m) => m.path[0] === sq);
      if (mine.length === 1) return onAction({ type: 'move', move: mine[0].path });
      return setPrefix([sq]);
    }
    const next = [...prefix, sq];
    const still = fitting.filter((m) => m.path[prefix.length] === sq);
    if (!still.length) return setPrefix([]);
    const done = still.find((m) => m.path.length === next.length);
    if (still.length === 1) return onAction({ type: 'move', move: still[0].path });
    if (done && still.every((m) => m.path.length === next.length)) return onAction({ type: 'move', move: done.path });
    setPrefix(next);
  };

  // ---------------------------------------------------------------- result
  const won = finished && v.winnerTeam === mySeat;
  const draw = finished && v.winnerTeam === null;
  const reason = v.finishReason ? t(`duel.reason.${v.finishReason}`) : '';
  const offerFromOpp = !spectator && !finished && v.drawOffer === oppSeat;
  const offerMine = v.drawOffer === mySeat;

  const plate = (s: Seat, right = false) => (
    <Plate
      info={players[s]}
      seat={s}
      active={!finished && v.turn === s}
      secondsLeft={chess ? null : secondsLeft}
      total={v.config.turnTimeoutSec}
      pips={null}
      emote={emotes[s] ?? null}
      right={right}
      dotClass={s === 0 ? 'bg-[#f4ead2]' : 'bg-[#1a1612] ring-gold-500/60'}
      onClick={() => s !== mySeat && !players[s]?.isBot && !spectator && setMenuSeat(s)}
      extra={clocks ? <Clock ms={clocks[s]} active={!finished && v.turn === s} /> : (
        <div className="text-[11px] text-white/45">{t('duel.pieces', { n: (v as CheckersView).pieces[s] })}</div>
      )}
    />
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {actionError && <span className="text-xs text-ruby-400">{actionError}</span>}
      {offerFromOpp && (
        <>
          <span className="text-xs font-bold text-gold-200">🤝 {t('duel.drawOfferedShort')}</span>
          <Button size="sm" variant="emerald" disabled={busy} onClick={() => onAction({ type: 'accept_draw' })}>✓ {t('duel.accept')}</Button>
          <Button size="sm" disabled={busy} onClick={() => onAction({ type: 'decline_draw' })}>✕ {t('duel.decline')}</Button>
        </>
      )}
      {!spectator && !finished && !offerFromOpp && (
        <>
          <Button size="sm" disabled={busy || offerMine} onClick={() => onAction({ type: 'offer_draw' })}>🤝 {offerMine ? t('duel.drawSent') : t('duel.offerDraw')}</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm('resign')}>🏳️ {t('duel.resign')}</Button>
        </>
      )}
      {myTurn && !offerFromOpp && <span className="rounded-full bg-gold-400/15 px-3 py-1 text-xs font-bold text-gold-200">{t('game.yourMove')}</span>}
      {!myTurn && !finished && !spectator && <span className="text-xs text-white/50">{t('game.waitingFor', { name: nameOf(v.turn ?? oppSeat) })}</span>}
    </div>
  );

  const sans = chess ? (v as ChessView).sans : [];
  const moveList = chess && sans.length > 0 && (
    <div className="max-h-[30vh] overflow-y-auto rounded-xl bg-black/30 p-2 font-mono text-xs leading-6 text-white/75 short:max-h-[40vh]">
      {Array.from({ length: Math.ceil(sans.length / 2) }, (_, i) => (
        <span key={i} className="mr-2 inline-block whitespace-nowrap">
          <span className="text-white/35">{i + 1}.</span> {sans[2 * i]} {sans[2 * i + 1] ?? ''}
        </span>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] flex-col overflow-hidden bg-ink-950 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="z-20 flex flex-wrap items-center gap-2 border-b border-white/5 bg-ink-950/80 px-3 py-1.5 pt-[calc(env(safe-area-inset-top)+6px)] short:flex-nowrap short:py-1 short:pt-1">
        <Badge color="gold">{chess ? `♞ ${t('variant.chess')} · ${(v as ChessView).config.clockMin}+${(v as ChessView).config.clockInc}` : `⛀ ${t('variant.checkers')}`}</Badge>
        {dto.stake > 0 && <span className="text-xs text-white/50">{t('game.stake')}: <Coins amount={dto.stake} currency={dto.currency} /></span>}
        {dto.mode === 'PRACTICE' && <span className="short:hidden"><Badge color="blue">{t('game.practice')}</Badge></span>}
        {dto.mode === 'TOURNAMENT' && <span className="short:hidden"><Badge color="gold">🏟️ {t('nav.tournaments')}</Badge></span>}
        <div className="ml-auto flex items-center gap-1">
          {!connected && <Badge color="red">{t('game.reconnecting')}</Badge>}
          <MusicButton className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5" />
          {!finished && !spectator && <button onClick={() => setShowEmotes((x) => !x)} aria-label="emotes" className="rounded-lg px-2 py-1.5 text-base hover:bg-white/5">😀</button>}
          {spectator && <button onClick={onLeave} className="whitespace-nowrap rounded-lg bg-white/5 px-2 py-1.5 text-sm text-white/80">👁 {t('watch.watching')} · ✕</button>}
          {dto.mode !== 'PRACTICE' && <button onClick={() => setShowChat(!showChat)} className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5">💬</button>}
          {!finished && !spectator && <button onClick={() => setConfirm('leave')} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-ruby-400 hover:bg-white/5">{t('game.leave')}</button>}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col short:flex-row">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 short:w-[190px] short:shrink-0 short:flex-col short:items-start short:justify-between short:py-2">
          {plate(oppSeat)}
          <div className="hidden w-full short:flex short:flex-col short:gap-2">
            {moveList}
            {controls}
            {plate(mySeat)}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-1">
          <div className="relative aspect-square max-h-full w-full max-w-[min(100%,760px)]">
            <DuelBoard game={chess ? 'chess' : 'checkers'} board={v.board} flipped={mySeat === 1} highlights={highlights} lastPath={lastPath} onSquare={onSquare} clickable={clickable} />
            <AnimatePresence>
              {toast && (
                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[44%] z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold-grad px-5 py-2 font-bold text-ink-950 shadow-glow">
                  {toast}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-1.5 short:hidden">
          <div className="flex items-center justify-between gap-2">
            {plate(mySeat)}
            {controls}
          </div>
          {moveList && <div className="max-h-16 overflow-y-auto">{moveList}</div>}
        </div>
      </div>

      {menuSeat !== null && players[menuSeat]?.nickname && (
        <PlayerMenu nickname={players[menuSeat].nickname!} matchId={dto.matchId} muted={!!muted[menuSeat]} onMute={() => setMuted((m) => ({ ...m, [menuSeat]: !m[menuSeat] }))} onClose={() => setMenuSeat(null)} />
      )}
      {showEmotes && (
        <EmotePanel phase="move" game={v.game} onSend={sendEmote} others={players[oppSeat]?.isBot ? [] : [{ seat: oppSeat, nickname: nameOf(oppSeat) }]} muted={muted} onToggleMute={(seat) => setMuted((m) => ({ ...m, [seat]: !m[seat] }))} onClose={() => setShowEmotes(false)} />
      )}
      <AnimatePresence>
        {showChat && (
          <motion.div initial={{ x: 280, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 280, opacity: 0 }} className="absolute right-2 top-14 z-30 h-[210px] w-[230px] max-w-[calc(100%-1rem)] short:top-10 short:h-[150px]">
            <Chat channel={`match:${dto.matchId}`} enabled={dto.chatEnabled} className="h-full" compact />
          </motion.div>
        )}
      </AnimatePresence>

      {/* promotion: which piece */}
      <Modal open={!!promo} onClose={() => setPromo(null)} title={t('duel.promote')}>
        <div className="flex justify-center gap-3">
          {[5, 4, 3, 2].map((p) => {
            const m = promo?.find((x) => x.promo === p);
            if (!m) return null;
            return (
              <button key={p} onClick={() => { setPromo(null); sendChess(m); }} className="h-20 w-20 rounded-2xl bg-[#e6c493] p-1 ring-2 ring-gold-400/40 hover:ring-gold-400">
                <img alt="" src={`/pieces/${mySeat === 0 ? 'w' : 'b'}${['', 'P', 'N', 'B', 'R', 'Q'][p]}.svg`} className="h-full w-full" />
              </button>
            );
          })}
        </div>
      </Modal>

      <Confetti run={won && !spectator} />
      <Modal open={finished} title={spectator ? t('duel.over') : draw ? `🤝 ${t('duel.draw')}` : won ? `🏆 ${t('game.youWon')}` : t('game.youLost')}>
        <div className="text-center">
          <p className="text-white/70">{reason}{!draw && v.winnerTeam !== null && spectator ? ` · ${nameOf(v.winnerTeam)}` : ''}</p>
          {dto.stake > 0 && !spectator && !draw && <p className="mt-2"><Coins amount={won ? dto.stake : -dto.stake} currency={dto.currency} signed /></p>}
          {dto.mode === 'TOURNAMENT' && !spectator && <Link href="/tournaments" className="mt-5 block"><Button variant="emerald" size="lg">🏟️ {t('tourney.title')} →</Button></Link>}
          {v.finishReason !== 'forfeit' && !spectator && dto.mode !== 'TOURNAMENT' && (
            <div className="mt-5">
              <Button variant="emerald" size="lg" loading={rematch.sent && !rematch.needed} disabled={rematch.sent} onClick={askRematch}>🔁 {t('game.rematch')}</Button>
              {rematch.sent && rematch.needed > 1 && <p className="mt-2 text-sm text-white/60">{t('game.rematchWaiting', { n: rematch.seats.length, total: rematch.needed })}</p>}
              {!rematch.sent && rematch.seats.length > 0 && <p className="mt-2 text-sm text-gold-200">{t('game.rematchAsked', { n: rematch.seats.length, total: rematch.needed })}</p>}
              {rematch.error && <p className="mt-2 text-sm text-ruby-400">{rematch.error}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/"><Button variant="gold">{t('game.backHome')}</Button></Link>
            {!spectator && <Link href={`/matches/${dto.matchId}/replay`}><Button>▶ {t('replay.watch')}</Button></Link>}
          </div>
        </div>
      </Modal>

      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'resign' ? t('duel.resign') : t('game.leave')}>
        <p className="text-white/70">{confirm === 'resign' ? t('duel.resignConfirm') : t('game.leaveConfirm')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => { const c = confirm; setConfirm(null); if (c === 'resign') onAction({ type: 'resign' }); else onLeave(); }}>{confirm === 'resign' ? t('duel.resign') : t('game.leave')}</Button>
        </div>
      </Modal>
    </div>
  );
}
