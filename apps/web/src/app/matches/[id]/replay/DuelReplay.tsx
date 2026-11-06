'use client';
import { CMove, CMoveC, Position, applyCheckersMove, checkersStartBoard, chessMake, chessStartPosition } from '@nardi/engine';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { DuelBoard } from '@/components/game/DuelBoard';
import { Button, PageTitle } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { sound } from '@/lib/sound';

interface Frame { board: number[]; last: number[] | null; text: string; ply: number }

/** Chess and checkers replay: one frame per move, from the stored events. */
export function DuelReplay({ data, meId }: { data: any; meId: string }) {
  const { t } = useI18n();
  const game: 'chess' | 'checkers' = data.rules.game;
  const nameOf = (s: number) => data.players[s]?.nickname ?? `#${s}`;
  const frames = useMemo(() => {
    const out: Frame[] = [];
    if (game === 'chess') {
      let pos: Position = chessStartPosition();
      out.push({ board: pos.board, last: null, text: t('replay.start'), ply: 0 });
      for (const e of data.events) {
        if (e.type !== 'moved') continue;
        const m = e.move as CMoveC;
        pos = chessMake(pos, m);
        out.push({ board: pos.board, last: [m.from, m.to], text: `${Math.ceil(out.length / 2)}. ${nameOf(e.seat)}: ${e.san ?? ''}`, ply: out.length });
      }
    } else {
      let board = checkersStartBoard();
      out.push({ board, last: null, text: t('replay.start'), ply: 0 });
      for (const e of data.events) {
        if (e.type !== 'moved') continue;
        const m = e.move as CMove;
        board = applyCheckersMove(board, m, e.seat);
        out.push({ board, last: m.path, text: `${nameOf(e.seat)}${m.captures.length ? ` · ✕${m.captures.length}` : ''}`, ply: out.length });
      }
    }
    const over = data.events.find((e: any) => e.type === 'game_over');
    if (over) out.push({ ...out[out.length - 1], text: `${t(`duel.reason.${over.reason}`)}${over.winner !== null ? ` · 🏆 ${nameOf(over.winner)}` : ''}` });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, game]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (i >= frames.length - 1) { setPlaying(false); return; }
    const id = setTimeout(() => { setI((x) => x + 1); sound()?.checker(); }, 900);
    return () => clearTimeout(id);
  }, [playing, i, frames.length]);
  const f = frames[Math.min(i, frames.length - 1)];
  const mySeat = data.players.find((p: any) => p.userId === meId)?.seat ?? 0;
  const step = (d: number) => { setPlaying(false); setI((x) => Math.max(0, Math.min(frames.length - 1, x + d))); };
  return (
    <div className="space-y-3">
      <PageTitle sub={t(`variant.${game}`)} action={<Link href={`/matches/${data.id}`}><Button size="sm">← {t('game.details')}</Button></Link>}>{t('replay.title')}</PageTitle>
      <div className="flex items-center justify-between gap-2 text-sm">
        {[0, 1].map((s) => (
          <div key={s} className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10">
            <Avatar name={data.players[s]?.avatar} size={28} />
            <span className="max-w-[120px] truncate font-semibold">{s === 0 ? '⚪' : '⚫'} {nameOf(s)}</span>
          </div>
        ))}
      </div>
      <div className="mx-auto aspect-square w-full max-w-[min(100%,62vh)]">
        <DuelBoard game={game} board={f.board} flipped={mySeat === 1} highlights={(f.last ?? []).map((sq) => ({ sq, kind: 'last' as const }))} lastPath={f.last} onSquare={() => undefined} clickable={new Set()} />
      </div>
      <div className="min-h-[1.5rem] text-center text-sm text-white/80">{f.text}</div>
      <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} className="w-full accent-[#eabd55]" aria-label="position" />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={() => { setPlaying(false); setI(0); }}>⏮</Button>
        <Button size="sm" onClick={() => step(-1)}>◀</Button>
        <Button variant="gold" onClick={() => { if (i >= frames.length - 1) setI(0); setPlaying((p) => !p); }}>{playing ? `⏸ ${t('replay.pause')}` : `▶ ${t('replay.play')}`}</Button>
        <Button size="sm" onClick={() => step(1)}>▶</Button>
        <Button size="sm" onClick={() => { setPlaying(false); setI(frames.length - 1); }}>⏭</Button>
      </div>
      <div className="text-center text-xs text-white/35">{i + 1} / {frames.length}</div>
    </div>
  );
}
