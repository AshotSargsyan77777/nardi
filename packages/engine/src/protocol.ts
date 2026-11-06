import { Seat } from './board';
import type { AnyAction, AnyEvent, AnyRules, AnyView } from './games';

/** Shared WebSocket contract between the API (Socket.IO server) and the web client. */

export type RoomStatus = 'WAITING' | 'READY' | 'PLAYING' | 'FINISHED' | 'CANCELLED';

export interface SeatInfo {
  seat: Seat;
  userId: string | null;
  nickname: string | null;
  avatar: string | null;
  rating: number | null;
  level: number | null;
  isBot: boolean;
  connected: boolean;
  ready?: boolean;
}

export interface RoomSettings {
  rules: Partial<AnyRules> & { game?: string };
  stake: number;
  currency: 'FUN';
  chatEnabled: boolean;
  allowBots: boolean;
}

export interface RoomDTO {
  id: string;
  code: string;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatInfo[];
  matchId: string | null;
  inviteUrl: string;
}

export interface MatchDTO<V = AnyView> {
  matchId: string;
  mode: 'PRIVATE' | 'RANDOM' | 'PRACTICE' | 'TOURNAMENT';
  stake: number;
  currency: 'FUN';
  chatEnabled: boolean;
  players: SeatInfo[];
  view: V;
  /** Unix ms deadline for the current turn, or null. */
  deadline: number | null;
  /** SHA-256 commitment of the current game's dice (revealed after the game). */
  diceCommitment: string | null;
  revealedDice: { game: number; rolls: [number, number][]; salt: string; commitment: string }[];
  events: AnyEvent[];
  /** The server's clock when this was sent (chess clocks run from it). */
  serverTime: number;
}

export interface MatchActionPayload {
  matchId: string;
  /** Must equal view.version; stale or duplicated actions are rejected. */
  version: number;
  /** Client generated unique id, used for idempotency of re-sent actions. */
  actionId: string;
  action: AnyAction;
}

export interface ChatMessageDTO {
  id: string;
  channel: string;
  userId: string;
  nickname: string;
  text: string;
  at: number;
}

/** `casual`, `ranked` or `fun:<stake>`, then `@short`, `@long`, `@checkers` or `@chess:<min>+<inc>`. */
export type QueueId = string;

export interface MatchmakingStatus {
  state: 'idle' | 'searching' | 'proposal' | 'matched';
  queue: QueueId | null;
  since: number | null;
  proposal: { id: string; expiresAt: number; accepted: number; total: number; youAccepted: boolean } | null;
  matchId: string | null;
  estimatedPlayers?: number;
}

export interface ServerErrorDTO { code: string; message: string }
