'use client';
import { Board, GameResult, Move, Seat, Variant, applySteps, startBoard } from '@nardi/engine';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Avatar } from '@/components/Avatar';
import { NardiBoard } from '@/components/game/Board';
import { usePortraitPhone } from '@/components/game/GameTable';
import { Button, ErrorText, Loading, PageTitle } from '@/components/ui';
import { useRequireAuth } from '@/lib/app-state';
import { useI18n } from '@/lib/i18n';
import { sound } from '@/lib/sound';

interface Frame {
  board: Board;
  game: number;
  scores: [number, number];
  dice: { value: number; used: boolean }[];
  /** Who acts in this frame. */
  seat: Seat | null;
  /** What happened, for the caption. */
  kind: 'start' | 'rolled' | 'moved' | 'no_moves' | 'won';
  move?: Move;
  result?: GameResult;
  rollKey?: string;
}

/** Turns the stored match events into one frame per roll and per checker step. */
function framesOf(variant: Variant, events: any[]): Frame[] {
  const out: Frame[] = [];
  let board = startBoard(variant);
  let game = 1;
  let scores: [number, number] = [0, 0];
  let dice: number[] = [];
  let used: number[] = [];
  let rolls = 0;
  const diceView = () => {
    const all = dice.length === 2 && dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice;
    const left = [...used];
    return all.map((value) => {
      const i = left.indexOf(value);
      if (i >= 0) { left.splice(i, 1); return { value, used: true }; }
      return { value, used: false };
    });
  };
  for (const e of events) {
    if (e.type === 'game_started') {
      game = e.game ?? game;
      board = startBoard(variant);
      dice = []; used = [];
      out.push({ board, game, scores, dice: [], seat: e.turn ?? null, kind: 'start' });
    } else if (e.type === 'rolled') {
      dice = e.dice; used = []; rolls += 1;
      out.push({ board, game, scores, dice: diceView(), seat: e.seat, kind: 'rolled', rollKey: `r${rolls}` });
    } else if (e.type === 'no_moves') {
      out.push({ board, game, scores, dice: diceView().map((d) => ({ ...d, used: true })), seat: e.seat, kind: 'no_moves' });
    } else if (e.type === 'moved') {
      for (const m of e.moves as Move[]) {
        board = applySteps(board, variant, e.seat, [m]);
        used = [...used, m.die];
        out.push({ board, game, scores, dice: diceView(), seat: e.seat, kind: 'moved', move: m });
      }
    } else if (e.type === 'game_won' && e.result) {
      const r = e.result as GameResult;
      scores = [...scores] as [number, number];
      scores[r.winner] += r.points;
      out.push({ board, game, scores, dice: [], seat: r.winner, kind: 'won', result: r });
    }
  }
  return out;
}

const SPEEDS = [1400, 800, 400];

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const me = useRequireAuth();
  const { data, error } = useSWR<any>(me ? `/matches/${id}/replay` : null);
  const variant: Variant = data?.rules?.variant === 'long' ? 'long' : 'short';
  const frames = useMemo(() => (data ? framesOf(variant, data.events) : []), [data, variant]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const vertical = usePortraitPhone();

  useEffect(() => {
    if (!playing) return;
    if (i >= frames.length - 1) { setPlaying(false); return; }
    const id = setTimeout(() => {
      setI((x) => x + 1);
      const next = frames[i + 1];
      if (next?.kind === 'moved') sound()?.checker();
      if (next?.kind === 'rolled') sound()?.dice();
    }, SPEEDS[speed] * (frames[i + 1]?.kind === 'rolled' ? 0.8 : 1));
    return () => clearTimeout(id);
  }, [playing, i, frames, speed]);

  if (error) return <ErrorText error={error} />;
  if (!data || !me) return <Loading />;
  if (!frames.length) return <ErrorText error={new Error(t('replay.empty'))} />;

  const viewer: Seat = (data.players.find((p: any) => p.userId === me.id)?.seat ?? 0) as Seat;
  const f = frames[Math.min(i, frames.length - 1)];
  const nameOf = (s: number) => data.players[s]?.nickname ?? `#${s}`;
  const gameStarts = frames.map((x, k) => (x.kind === 'start' ? k : -1)).filter((k) => k >= 0);
  const jumpGame = (dir: 1 | -1) => {
    const cur = [...gameStarts].reverse().find((k) => k <= i) ?? 0;
    const target = dir === 1 ? gameStarts.find((k) => k > i) : i > cur ? cur : [...gameStarts].reverse().find((k) => k < cur);
    if (target !== undefined) { setPlaying(false); setI(target); }
  };
  const step = (d: number) => { setPlaying(false); setI((x) => Math.max(0, Math.min(frames.length - 1, x + d))); };
  const pt = (w: number | 'bar' | 'off') => (w === 'bar' ? t('replay.bar') : w === 'off' ? t('replay.off') : '');

  const caption = (() => {
    const who = f.seat === null ? '' : nameOf(f.seat);
    switch (f.kind) {
      case 'start': return t('replay.gameStart', { n: f.game, name: who });
      case 'rolled': return t('replay.rolled', { name: who, dice: f.dice.length === 4 ? `${f.dice[0].value}-${f.dice[0].value}` : f.dice.map((d) => d.value).join('-') });
      case 'no_moves': return t('game.oppNoMoves', { name: who });
      case 'moved': return t('replay.moved', { name: who, die: f.move!.die }) + (f.move!.hit || pt(f.move!.to) ? ` · ${f.move!.to === 'off' ? pt('off') : t('replay.hit')}` : '');
      case 'won': return `${t('game.gameWonBy', { name: who })} · +${f.result!.points}${f.result!.mars ? ` (${t('game.mars')})` : ''}`;
    }
  })();

  return (
    <div className="space-y-3">
      <PageTitle sub={`${t(`variant.${variant}`)} · ${t('game.gameN', { n: f.game })}`} action={<Link href={`/matches/${id}`}><Button size="sm">← {t('game.details')}</Button></Link>}>
        {t('replay.title')}
      </PageTitle>
      <div className="flex items-center justify-between gap-2 text-sm">
        {[viewer, (1 - viewer) as Seat].map((s) => (
          <div key={s} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 ring-1 ${f.seat === s && f.kind !== 'start' ? 'bg-gold-400/10 ring-gold-400/40' : 'bg-white/5 ring-white/10'}`}>
            <Avatar name={data.players[s]?.avatar} size={28} />
            <span className="max-w-[110px] truncate font-semibold">{nameOf(s)}</span>
            <span className="font-display text-lg font-extrabold tabular-nums">{f.scores[s]}</span>
          </div>
        ))}
      </div>
      <div className={`mx-auto w-full ${vertical ? 'aspect-[720/1000] max-w-[min(100%,62vh)]' : 'aspect-[1000/720] max-w-[min(900px,calc(62vh*1000/720))]'}`}>
        <NardiBoard vertical={vertical} board={f.board} variant={variant} viewer={viewer} sources={[]} selected={null} targets={[]} lastMoves={f.move ? [f.move] : []} dice={f.dice} rollKey={playing ? f.rollKey ?? null : null} onPick={() => undefined} />
      </div>
      <div className="min-h-[1.5rem] text-center text-sm text-white/80">{caption}</div>
      <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} className="w-full accent-[#eabd55]" aria-label="position" />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={() => jumpGame(-1)} title={t('replay.prevGame')}>⏮</Button>
        <Button size="sm" onClick={() => step(-1)} title={t('replay.back')}>◀</Button>
        <Button variant="gold" onClick={() => { if (i >= frames.length - 1) setI(0); setPlaying((p) => !p); }}>{playing ? `⏸ ${t('replay.pause')}` : `▶ ${t('replay.play')}`}</Button>
        <Button size="sm" onClick={() => step(1)} title={t('replay.forward')}>▶</Button>
        <Button size="sm" onClick={() => jumpGame(1)} title={t('replay.nextGame')}>⏭</Button>
        <Button size="sm" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)}>{['1×', '2×', '4×'][speed]}</Button>
      </div>
      <div className="text-center text-xs text-white/35">{i + 1} / {frames.length}</div>
    </div>
  );
}
