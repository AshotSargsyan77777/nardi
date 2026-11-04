'use client';
import { Action, GameEvent, GameResult, MatchDTO, Move, Seat, SeatInfo, diceMoves, remainingDice, viewBoardAfter, viewMoveOptions } from '@nardi/engine';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useApp, useSocketEvent } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { sound } from '@/lib/sound';
import { Avatar } from '../Avatar';
import { Chat } from '../Chat';
import { PlayerActions } from '../PlayerActions';
import { MusicButton } from '../Sound';
import { Badge, Button, Coins, Modal } from '../ui';
import { NardiBoard } from './Board';
import { Coach, TipId } from './Coach';
import { Confetti } from './Confetti';
import { EmotePanel, useEmoteText } from './EmotePanel';

function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

/** A player's plate: avatar with the turn timer, name, checker colour, pips and a speech bubble. */
function Plate({ info, seat, active, secondsLeft, total, pips, emote, onClick, right = false }: {
  info: SeatInfo; seat: Seat; active: boolean; secondsLeft: number | null; total: number; pips: number;
  emote: { key: number; text: string } | null; onClick?: () => void; right?: boolean;
}) {
  const { t } = useI18n();
  const pct = active && secondsLeft !== null && total ? secondsLeft / total : 1;
  return (
    <div className={`relative flex items-center gap-2 ${right ? 'flex-row-reverse text-right' : ''}`} onClick={onClick}>
      <div className="relative shrink-0">
        {active && <span className="absolute -inset-1.5 animate-pulse-ring rounded-full border-2 border-gold-400" />}
        <svg className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] -rotate-90" viewBox="0 0 36 36" aria-hidden>
          {active && <circle cx="18" cy="18" r="16.5" fill="none" stroke={pct < 0.3 ? '#e0435c' : '#eabd55'} strokeWidth="2.5" strokeDasharray={`${pct * 103.7} 103.7`} strokeLinecap="round" />}
        </svg>
        <Avatar name={info.avatar} size={40} />
        <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full ring-2 ring-ink-900 ${seat === 0 ? 'bg-[#f4ead2]' : 'bg-[#2a1a14] ring-gold-500/60'}`} title={seat === 0 ? t('game.light') : t('game.dark')} />
        {!info.connected && <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full bg-ruby-500 ring-2 ring-ink-900" title={t('game.disconnected')} />}
      </div>
      <div className="min-w-0">
        <div className="max-w-[130px] truncate text-sm font-bold">{info.nickname}</div>
        <div className={`flex items-center gap-1.5 text-[11px] text-white/50 ${right ? 'justify-end' : ''}`}>
          {info.isBot ? <span>{t('common.bot')}</span> : info.rating ? <span>★ {info.rating}</span> : null}
          <span title={t('game.pipsHint')}>{t('game.pips')}: <b className="text-white/80">{pips}</b></span>
          {active && secondsLeft !== null && <span className="font-bold text-gold-300">{secondsLeft}s</span>}
        </div>
      </div>
      <AnimatePresence>
        {emote && (
          <motion.div
            key={emote.key}
            initial={{ scale: 0.4, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`absolute ${right ? 'right-12' : 'left-12'} -top-9 z-30 ${/^\P{L}{1,4}$/u.test(emote.text) ? 'text-4xl leading-none drop-shadow' : 'w-max max-w-[180px] rounded-2xl bg-white px-3 py-1 text-sm font-bold text-ink-900 shadow-lg'}`}
          >
            {emote.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function GameTable({ dto, onAction, onLeave, busy, actionError, spectator = false }: { dto: MatchDTO; onAction: (a: Action) => void; onLeave: () => void; busy: boolean; actionError: string | null; spectator?: boolean }) {
  const { t } = useI18n();
  const { connected, socket } = useApp();
  const v = dto.view;
  const mySeat = (v.seat ?? 0) as Seat;
  const oppSeat = (1 - mySeat) as Seat;
  const secondsLeft = useCountdown(dto.deadline);
  const players = dto.players;
  const nameOf = (s: number) => players[s]?.nickname ?? `#${s}`;

  // the game owns the whole screen on phones: no page scrolling underneath
  useEffect(() => {
    const el = [document.documentElement, document.body];
    const prev = el.map((e) => e.style.overflow);
    el.forEach((e) => (e.style.overflow = 'hidden'));
    return () => el.forEach((e, i) => (e.style.overflow = prev[i]));
  }, []);

  const [prefix, setPrefix] = useState<Move[]>([]);
  const [selected, setSelected] = useState<number | 'bar' | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [showEmotes, setShowEmotes] = useState(false);
  const [menuSeat, setMenuSeat] = useState<number | null>(null);
  const emoteText = useEmoteText();

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

  // react to the events that produced this state (sounds, toasts, the game summary)
  const seenVersion = useRef(0);
  useEffect(() => {
    if (v.version <= seenVersion.current) return;
    seenVersion.current = v.version;
    for (const e of dto.events as GameEvent[]) {
      if (e.type === 'rolled') sound()?.dice();
      if (e.type === 'moved' && e.seat !== mySeat) e.moves.forEach((_, i) => setTimeout(() => sound()?.checker(), i * 120));
      if (e.type === 'no_moves') setToast(e.seat === mySeat && !spectator ? t('game.noMoves') : t('game.oppNoMoves', { name: nameOf(e.seat) }));
      if (e.type === 'game_won') setTimeout(() => setGameResult(e.result), 500);
    }
    setPrefix([]);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.version]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!gameResult) return;
    const id = setTimeout(() => setGameResult(null), 5000);
    return () => clearTimeout(id);
  }, [gameResult]);

  const finished = v.status === 'finished';
  const myTurn = !spectator && v.turn === mySeat && !finished;
  const myMove = myTurn && v.phase === 'move';
  const options = useMemo(() => (myMove ? viewMoveOptions(v, prefix) : []), [myMove, v, prefix]);
  const shownBoard = useMemo(() => (myMove ? viewBoardAfter(v, prefix) : v.board), [myMove, v, prefix]);
  const sources = useMemo(() => [...new Set(options.map((o) => o.from))], [options]);
  const targets = selected === null ? [] : [...new Set(options.filter((o) => o.from === selected).map((o) => o.to))];
  const complete = myMove && prefix.length === v.movesRequired;

  const step = (m: Move) => {
    setPrefix((p) => [...p, m]);
    setSelected(null);
    sound()?.checker();
  };
  const onPick = (w: number | 'bar' | 'off') => {
    if (!myMove || busy || complete) return;
    if (selected !== null && w !== 'bar' && targets.includes(w)) {
      // two dice may lead to the same place (bearing off): use the smaller one
      const opts = options.filter((o) => o.from === selected && o.to === w).sort((a, b) => a.die - b.die);
      if (opts.length) step(opts[0]);
      return;
    }
    if (w !== 'off' && sources.includes(w)) {
      if (selected === w) return setSelected(null);
      const mine = options.filter((o) => o.from === w);
      // one place to go: move straight away
      if (new Set(mine.map((o) => o.to)).size === 1) return step([...mine].sort((a, b) => a.die - b.die)[0]);
      setSelected(w);
      return;
    }
    setSelected(null);
  };
  const submit = () => onAction({ type: 'move', moves: prefix });
  const undo = () => { setPrefix((p) => p.slice(0, -1)); setSelected(null); };

  // dice on the board: mine with the used ones dimmed; the opponent's while they move; else the last roll
  const dice = useMemo(() => {
    if (v.dice) {
      const left = myMove ? remainingDice(v.dice, prefix) : diceMoves(v.dice);
      const all = diceMoves(v.dice);
      const pool = [...left];
      return all.map((d) => {
        const i = pool.indexOf(d);
        if (i >= 0) { pool.splice(i, 1); return { value: d, used: false }; }
        return { value: d, used: true };
      });
    }
    return v.lastTurn && v.phase === 'roll' ? v.lastTurn.dice.map((d) => ({ value: d, used: true })) : [];
  }, [v.dice, v.lastTurn, v.phase, myMove, prefix]);
  const lastMoves = v.lastTurn && v.lastTurn.seat !== mySeat && !prefix.length ? v.lastTurn.moves : [];

  const won = finished && v.winnerTeam === mySeat;
  const total = v.config.turnTimeoutSec;
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {actionError && <span className="text-xs text-ruby-400">{actionError}</span>}
      {myMove && prefix.length > 0 && <Button size="sm" onClick={undo} disabled={busy}>↶ {t('game.undo')}</Button>}
      {complete && <Button variant="gold" onClick={submit} loading={busy}>✓ {t('game.done')}</Button>}
      {!myTurn && !finished && v.turn !== null && <span className="text-xs text-white/50">{t('game.waitingFor', { name: nameOf(v.turn) })}</span>}
      {myMove && !complete && <span className="rounded-full bg-gold-400/15 px-3 py-1 text-xs font-bold text-gold-200">{t('game.yourMove')}</span>}
    </div>
  );
  const canBearOff = options.some((o) => o.to === 'off');

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] flex-col overflow-hidden bg-ink-950 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* top bar */}
      <div className="z-20 flex flex-wrap items-center gap-2 border-b border-white/5 bg-ink-950/80 px-3 py-1.5 pt-[calc(env(safe-area-inset-top)+6px)] short:flex-nowrap short:py-1 short:pt-1">
        <div className="flex items-center gap-1.5 rounded-xl bg-black/40 px-2.5 py-1 ring-1 ring-white/10">
          <span className="text-[11px] text-felt-500">{spectator ? nameOf(0) : t('game.you')}</span>
          <span className="font-display text-lg font-extrabold tabular-nums">{v.scores[mySeat]}</span>
          <span className="text-white/30">:</span>
          <span className="font-display text-lg font-extrabold tabular-nums">{v.scores[oppSeat]}</span>
          <span className="text-[11px] text-gold-300">{spectator ? nameOf(1) : t('game.opp')}</span>
          <span className="ml-1 text-[10px] text-white/40">{t('game.toPoints', { n: v.config.targetScore })}</span>
        </div>
        <Badge color="gold">{t(`variant.${v.config.variant}`)}</Badge>
        <span className="hidden text-xs text-white/40 sm:inline short:hidden">{t('game.gameN', { n: v.handNumber })}</span>
        {dto.stake > 0 && <span className="text-xs text-white/50">{t('game.stake')}: <Coins amount={dto.stake} currency={dto.currency} /></span>}
        {dto.mode === 'PRACTICE' && <span className="short:hidden"><Badge color="blue">{t('game.practice')}</Badge></span>}
        <div className="ml-auto flex items-center gap-1">
          {!connected && <Badge color="red">{t('game.reconnecting')}</Badge>}
          <button onClick={() => setShowFair(true)} className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5" title={t('game.fairness')}>🛡️</button>
          <MusicButton className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5" />
          {!finished && !spectator && <button onClick={() => setShowEmotes((x) => !x)} aria-label="emotes" className="rounded-lg px-2 py-1.5 text-base hover:bg-white/5">😀</button>}
          {spectator && <button onClick={onLeave} className="whitespace-nowrap rounded-lg bg-white/5 px-2 py-1.5 text-sm text-white/80">👁 {t('watch.watching')} · ✕</button>}
          {dto.mode !== 'PRACTICE' && <button onClick={() => setShowChat(!showChat)} className="rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/5">💬</button>}
          {!finished && !spectator && <button onClick={() => setConfirmLeave(true)} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-ruby-400 hover:bg-white/5">{t('game.leave')}</button>}
        </div>
      </div>

      {/* table: plates above/below the board on portrait, beside it on landscape phones */}
      <div className="relative flex min-h-0 flex-1 flex-col short:flex-row">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 short:w-[170px] short:shrink-0 short:flex-col short:items-start short:justify-between short:py-2">
          <div className={players[oppSeat]?.isBot ? '' : 'cursor-pointer'}>
            <Plate info={players[oppSeat]} seat={oppSeat} active={v.turn === oppSeat && !finished} secondsLeft={secondsLeft} total={total} pips={v.pips[oppSeat]} emote={emotes[oppSeat] ?? null} onClick={() => !players[oppSeat]?.isBot && !spectator && setMenuSeat(oppSeat)} />
          </div>
          <div className="hidden short:flex short:flex-col short:gap-2">
            {controls}
            <Plate info={players[mySeat]} seat={mySeat} active={myTurn} secondsLeft={secondsLeft} total={total} pips={v.pips[mySeat]} emote={emotes[mySeat] ?? null} />
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-1">
          <div className="relative aspect-[1000/720] max-h-full w-full max-w-[1100px]">
            <NardiBoard
              board={shownBoard}
              variant={v.config.variant}
              viewer={mySeat}
              sources={myMove && !complete ? sources : []}
              selected={selected}
              targets={targets}
              lastMoves={lastMoves}
              dice={dice}
              rollKey={v.dice ? `${v.handNumber}:${v.turns[0] + v.turns[1]}` : null}
              onPick={onPick}
            />
            {myTurn && v.phase === 'roll' && (
              <div className="absolute inset-y-0 right-[8%] flex w-[44%] items-center justify-center">
                <motion.button
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  disabled={busy}
                  onClick={() => onAction({ type: 'roll' })}
                  className="rounded-2xl bg-gold-grad px-6 py-3 font-display text-lg font-extrabold text-ink-950 shadow-glow active:scale-95 disabled:opacity-60"
                >
                  🎲 {t('game.roll')}
                </motion.button>
              </div>
            )}
            <AnimatePresence>
              {toast && (
                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-[44%] z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold-grad px-5 py-2 font-bold text-ink-950 shadow-glow">
                  {toast}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* me + turn controls */}
        <div className="flex items-center justify-between gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-1.5 short:hidden">
          <div>
            <Plate info={players[mySeat]} seat={mySeat} active={myTurn} secondsLeft={secondsLeft} total={total} pips={v.pips[mySeat]} emote={emotes[mySeat] ?? null} />
          </div>
          {controls}
        </div>
      </div>

      {/* beginner tips */}
      {!spectator && !finished && (
        <Coach moment={((): TipId | null => {
          if (gameResult) return 'result';
          if (myMove && canBearOff) return 'bearoff';
          if (myMove) return 'move';
          if (myTurn && v.phase === 'roll') return 'roll';
          return null;
        })()} />
      )}

      {menuSeat !== null && players[menuSeat]?.nickname && (
        <PlayerMenu nickname={players[menuSeat].nickname!} matchId={dto.matchId} muted={!!muted[menuSeat]} onMute={() => setMuted((m) => ({ ...m, [menuSeat]: !m[menuSeat] }))} onClose={() => setMenuSeat(null)} />
      )}

      {showEmotes && (
        <EmotePanel
          phase={v.phase}
          onSend={sendEmote}
          others={players[oppSeat]?.isBot ? [] : [{ seat: oppSeat, nickname: nameOf(oppSeat) }]}
          muted={muted}
          onToggleMute={(seat) => setMuted((m) => ({ ...m, [seat]: !m[seat] }))}
          onClose={() => setShowEmotes(false)}
        />
      )}

      <AnimatePresence>
        {showChat && (
          <motion.div initial={{ x: 280, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 280, opacity: 0 }} className="absolute right-2 top-14 z-30 h-[210px] w-[230px] max-w-[calc(100%-1rem)] short:top-10 short:h-[150px]">
            <Chat channel={`match:${dto.matchId}`} enabled={dto.chatEnabled} className="h-full" compact />
          </motion.div>
        )}
      </AnimatePresence>

      {/* one game of the match is over */}
      <Modal open={!!gameResult && !finished} onClose={() => setGameResult(null)} title={t('game.gameN', { n: gameResult?.game ?? 0 })}>
        {gameResult && <GameSummary r={gameResult} mySeat={mySeat} nameOf={nameOf} spectator={spectator} />}
      </Modal>

      {/* the match is over */}
      <Confetti run={won && !spectator} />
      <Modal open={finished} title={spectator ? t('game.finalScore') : won ? `🏆 ${t('game.youWon')}` : t('game.youLost')}>
        <div className="text-center">
          <div className="mb-1 text-xs uppercase tracking-wider text-white/40">{t('game.finalScore')}</div>
          <div className="font-display text-5xl font-extrabold">
            <span className="text-felt-500">{v.scores[mySeat]}</span> <span className="text-white/30">:</span> <span className="text-gold-300">{v.scores[oppSeat]}</span>
          </div>
          {v.history.some((h) => h.mars) && <p className="mt-2 text-sm text-gold-200">{t('game.marsCount', { n: v.history.filter((h) => h.mars && h.winner === mySeat).length, m: v.history.filter((h) => h.mars && h.winner !== mySeat).length })}</p>}
          {v.finishReason === 'forfeit' && <p className="mt-2 text-sm text-white/50">{t('game.forfeit')}</p>}
          {dto.stake > 0 && !spectator && <p className="mt-2"><Coins amount={won ? dto.stake : -dto.stake} currency={dto.currency} signed /></p>}
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
            {!spectator && <Link href={`/matches/${dto.matchId}`}><Button>{t('game.details')}</Button></Link>}
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
        <p className="text-sm text-white/70">{t('game.fairnessText')}</p>
        <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs">
          <div className="text-white/40">{t('game.commitment')}</div>
          <code className="break-all text-gold-200">{dto.diceCommitment ?? '—'}</code>
        </div>
        {dto.revealedDice.length > 0 && (
          <div className="mt-3 max-h-60 space-y-2 overflow-y-auto text-xs">
            {dto.revealedDice.map((d) => (
              <div key={d.game} className="rounded-xl bg-black/20 p-2">
                <div className="font-semibold">{t('game.gameN', { n: d.game })}</div>
                <div className="break-all text-white/50">sha256({d.salt}:{d.rolls.slice(0, 12).map((r) => r.join('')).join(',')},…)</div>
                <div className="break-all text-felt-500">= {d.commitment}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function GameSummary({ r, mySeat, nameOf, spectator = false }: { r: GameResult; mySeat: number; nameOf: (s: number) => string; spectator?: boolean }) {
  const { t } = useI18n();
  const mine = r.winner === mySeat && !spectator;
  return (
    <div className="text-center">
      <div className="text-lg font-bold">{spectator ? t('game.gameWonBy', { name: nameOf(r.winner) }) : mine ? t('game.youWonGame') : t('game.gameWonBy', { name: nameOf(r.winner) })}</div>
      {r.mars && <div className="mt-2 inline-block rounded-full bg-gold-grad px-4 py-1 font-display text-lg font-extrabold text-ink-950">{t('game.mars')} ×2</div>}
      <div className="mt-3 text-sm text-white/60">+{r.points} {t('game.points')}</div>
      <div className="mt-2 font-display text-3xl font-extrabold">
        <span className="text-felt-500">{r.scoresAfter[mySeat]}</span> <span className="text-white/30">:</span> <span className="text-gold-300">{r.scoresAfter[1 - mySeat]}</span>
      </div>
    </div>
  );
}

/** The other player: profile, mute, block, report. */
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
