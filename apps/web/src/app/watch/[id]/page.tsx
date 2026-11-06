'use client';
import { MatchDTO, PlayerView } from '@nardi/engine';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BlotTable } from '@/components/game/BlotTable';
import { DuelTable } from '@/components/game/DuelTable';
import { GameTable } from '@/components/game/GameTable';
import { ErrorText, Loading } from '@/components/ui';
import { useApp, useRequireAuth, useSocketEvent } from '@/lib/app-state';

/** Watch a friend's match: the public view only (nobody's cards). */
export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const me = useRequireAuth();
  const { socket } = useApp();
  const router = useRouter();
  const [dto, setDto] = useState<MatchDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const accept = useCallback((d: MatchDTO) => {
    if (d.matchId !== id || d.view.version < latest.current) return;
    latest.current = d.view.version;
    setDto(d);
  }, [id]);
  useEffect(() => {
    if (!socket || !me) return;
    const watch = () => socket.emit('match:watch', { matchId: id }, (r: any) => (r?.error ? setError(r.error.message ?? r.error.code) : r?.state && accept(r.state)));
    socket.on('connect', watch);
    if (socket.connected) watch();
    return () => {
      socket.off('connect', watch);
      socket.emit('match:unwatch', { matchId: id });
    };
  }, [socket, me, id, accept]);
  useSocketEvent<MatchDTO>('match:state', accept);
  if (error) return <ErrorText error={new Error(error)} />;
  if (!dto) return <Loading />;
  if (dto.view.game === 'blot') return <BlotTable key={dto.matchId} dto={dto as MatchDTO<any>} onAction={() => undefined} onLeave={() => router.push('/friends')} busy={false} actionError={null} spectator />;
  if (dto.view.game === 'chess' || dto.view.game === 'checkers') return <DuelTable key={dto.matchId} dto={dto as MatchDTO<any>} onAction={() => undefined} onLeave={() => router.push('/friends')} busy={false} actionError={null} spectator />;
  return <GameTable key={dto.matchId} dto={dto as MatchDTO<PlayerView>} onAction={() => undefined} onLeave={() => router.push('/friends')} busy={false} actionError={null} spectator />;
}
