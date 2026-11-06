'use client';
import { Action, MatchDTO, PlayerView } from '@nardi/engine';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DuelTable } from '@/components/game/DuelTable';
import { GameTable } from '@/components/game/GameTable';
import { Loading } from '@/components/ui';
import { api, newId } from '@/lib/api';
import { useApp, useRequireAuth, useSocketEvent } from '@/lib/app-state';

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const me = useRequireAuth();
  const { socket, refreshMe } = useApp();
  const router = useRouter();
  const [dto, setDto] = useState<MatchDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const latest = useRef<MatchDTO | null>(null);
  // a new match (e.g. «Մի հատ էլ խաղանք») starts from scratch
  useEffect(() => {
    latest.current = null;
    setDto(null);
  }, [id]);

  const accept = useCallback((d: MatchDTO) => {
    if (d.matchId !== id) return;
    // ignore out-of-order deliveries
    if (latest.current && d.view.version < latest.current.view.version) return;
    latest.current = d;
    setDto(d);
    setBusy(false);
    if (d.view.status === 'finished') refreshMe();
  }, [id, refreshMe]);

  useEffect(() => {
    if (!me) return;
    api<MatchDTO>(`/matches/${id}/state`).then(accept).catch(() => router.replace(`/matches/${id}`));
  }, [me, id, accept, router]);
  useEffect(() => {
    if (!socket) return;
    const sync = () => socket.emit('match:sync', { matchId: id }, (r: any) => r?.state && accept(r.state));
    socket.on('connect', sync);
    if (socket.connected) sync();
    return () => {
      socket.off('connect', sync);
    };
  }, [socket, id, accept]);
  useSocketEvent<MatchDTO>('match:state', accept);
  useSocketEvent<{ matchId: string }>('match:cancelled', (d) => d.matchId === id && router.replace(`/matches/${id}`));

  const onAction = (action: Action) => {
    const cur = latest.current;
    if (!socket || !cur) return;
    setBusy(true);
    setActionError(null);
    socket.emit('match:action', { matchId: id, version: cur.view.version, actionId: newId(), action }, (r: any) => {
      if (r?.error) {
        setBusy(false);
        if (r.error.code !== 'STALE_STATE') setActionError(r.error.message);
      }
    });
    setTimeout(() => setBusy(false), 4000);
  };
  const onLeave = () => socket?.emit('match:leave', { matchId: id });

  if (!me || !dto) return <Loading />;
  if (dto.view.game === 'chess' || dto.view.game === 'checkers') return <DuelTable key={dto.matchId} dto={dto as MatchDTO<any>} onAction={onAction as any} onLeave={onLeave} busy={busy} actionError={actionError} />;
  return <GameTable key={dto.matchId} dto={dto as MatchDTO<PlayerView>} onAction={onAction} onLeave={onLeave} busy={busy} actionError={actionError} />;
}
