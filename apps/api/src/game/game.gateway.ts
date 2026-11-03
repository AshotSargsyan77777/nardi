import { BlocksService } from '../users/blocks.service';
import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import { ChatMessageDTO, MatchActionPayload } from '@nardi/engine';
import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { toErrorBody } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { cleanText } from '../common/util';
import { censor } from '../common/profanity';
import { ENV, Env } from '../config/env';
import { SettingsService } from '../settings/settings.service';
import { MatchService } from './match.service';
import { MatchmakingService } from './matchmaking.service';
import { RealtimeService } from './realtime.service';
import { RoomsService } from './rooms.service';


interface SocketData { userId: string; nickname: string; chatBanned: boolean; bucket: { tokens: number; at: number }; lastChat: number }

/**
 * Real-time channel. Authentication uses a one-time ticket from POST /api/auth/ws-ticket.
 * All game decisions are made by MatchService on the server; clients only send intents.
 */
@WebSocketGateway({ path: '/socket.io', cors: { origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true } })
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(GameGateway.name);
  private chatHistory = new Map<string, ChatMessageDTO[]>();

  constructor(
    private realtime: RealtimeService,
    private auth: AuthService,
    private prisma: PrismaService,
    private matches: MatchService,
    private rooms: RoomsService,
    private mm: MatchmakingService,
    private settings: SettingsService,
    private blocks: BlocksService,
    @Inject(ENV) private env: Env,
  ) {}

  afterInit(server: Server) {
    this.realtime.server = server;
  }

  async handleConnection(client: Socket) {
    const userId = await this.auth.consumeWsTicket(client.handshake.auth?.ticket);
    if (!userId) return this.reject(client, 'UNAUTHENTICATED');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') return this.reject(client, 'ACCOUNT_BLOCKED');
    client.data = { userId, nickname: user.nickname, chatBanned: !!(user.restrictions as any)?.chatBanned, bucket: { tokens: 20, at: Date.now() }, lastChat: 0 } satisfies SocketData;
    await client.join(`user:${userId}`);
    this.realtime.markOnline(userId, 1);
    await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    client.emit('session', { userId, nickname: user.nickname });
    // reconnection: push the active match (if any) and matchmaking status straight away
    const active = this.matches.activeMatchOf(userId);
    if (active) {
      client.emit('match:started', { matchId: active });
      this.matches.resync(active, userId);
    }
    client.emit('mm:status', await this.mm.status(userId));
  }

  handleDisconnect(client: Socket) {
    const d = client.data as SocketData | undefined;
    if (!d?.userId) return;
    const stillOnline = this.realtime.markOnline(d.userId, -1);
    if (!stillOnline) {
      const active = this.matches.activeMatchOf(d.userId);
      if (active) this.matches.resync(active, d.userId);
      // never match a player who is no longer connected
      this.mm.leave(d.userId).catch(() => undefined);
    }
  }

  private reject(client: Socket, code: string) {
    client.emit('error:auth', { code });
    client.disconnect(true);
  }

  /** Per-connection token bucket: 20 messages burst, 10/s sustained. */
  private allow(client: Socket) {
    const b = (client.data as SocketData).bucket;
    const now = Date.now();
    b.tokens = Math.min(20, b.tokens + ((now - b.at) / 1000) * 10);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private async guarded<T>(client: Socket, fn: (userId: string) => Promise<T>): Promise<T | { error: { code: string; message: string } }> {
    const d = client.data as SocketData | undefined;
    if (!d?.userId) return { error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } };
    if (!this.allow(client)) return { error: { code: 'RATE_LIMITED', message: 'Too many requests' } };
    try {
      return await fn(d.userId);
    } catch (e) {
      const b = toErrorBody(e);
      if (b.status >= 500) this.log.error(`ws error: ${(e as any)?.stack ?? e}`);
      return { error: { code: b.code, message: b.message } };
    }
  }

  // ------------------------------------------------------------- matches

  @SubscribeMessage('match:sync')
  sync(@ConnectedSocket() c: Socket, @MessageBody() body: { matchId: string }) {
    return this.guarded(c, async (uid) => ({ state: this.matches.dto(String(body?.matchId), uid) }));
  }

  @SubscribeMessage('match:action')
  action(@ConnectedSocket() c: Socket, @MessageBody() body: MatchActionPayload) {
    return this.guarded(c, async (uid) => {
      try {
        return await this.matches.handleAction(uid, body);
      } catch (e: any) {
        // on any rejected action, send the authoritative state so the client can resync
        if (body?.matchId && this.matches.isParticipant(body.matchId, uid)) c.emit('match:state', this.matches.dto(body.matchId, uid));
        throw e;
      }
    });
  }

  @SubscribeMessage('match:emote')
  emote(@ConnectedSocket() c: Socket, @MessageBody() body: { matchId: string; id: string }) {
    return this.guarded(c, (uid) => this.matches.emote(String(body?.matchId), uid, String(body?.id ?? '')));
  }

  @SubscribeMessage('match:rematch')
  rematch(@ConnectedSocket() c: Socket, @MessageBody() body: { matchId: string }) {
    return this.guarded(c, (uid) => this.matches.rematch(String(body?.matchId), uid));
  }

  /** Watch a friend's match: public view only, updates come on the «watch:<id>» channel. */
  @SubscribeMessage('match:watch')
  watch(@ConnectedSocket() c: Socket, @MessageBody() body: { matchId: string }) {
    return this.guarded(c, async (uid) => {
      const id = String(body?.matchId ?? '');
      const u = await this.prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
      const state = await this.matches.watchDto(id, uid, u?.role);
      await c.join(`watch:${id}`);
      return { state };
    });
  }

  @SubscribeMessage('match:unwatch')
  async unwatch(@ConnectedSocket() c: Socket, @MessageBody() body: { matchId: string }) {
    await c.leave(`watch:${String(body?.matchId ?? '')}`);
    return { ok: true };
  }

  @SubscribeMessage('match:leave')
  leaveMatch(@ConnectedSocket() c: Socket, @MessageBody() body: { matchId: string }) {
    return this.guarded(c, async (uid) => {
      await this.matches.leave(uid, String(body?.matchId));
      return { ok: true };
    });
  }

  // ------------------------------------------------------------- rooms

  @SubscribeMessage('room:subscribe')
  subscribeRoom(@ConnectedSocket() c: Socket, @MessageBody() body: { code: string }) {
    return this.guarded(c, async (uid) => {
      const room = await this.rooms.get(String(body?.code ?? ''));
      if (!this.rooms.isMember(room, uid) && room.status !== 'WAITING') return { error: { code: 'NOT_IN_ROOM', message: 'Not a member' } };
      await c.join(`room:${room.code}`);
      c.emit('chat:history', { channel: `room:${room.code}`, items: this.chatHistory.get(`room:${room.code}`) ?? [] });
      return { room };
    });
  }

  @SubscribeMessage('room:unsubscribe')
  async unsubscribeRoom(@ConnectedSocket() c: Socket, @MessageBody() body: { code: string }) {
    await c.leave(`room:${String(body?.code ?? '').toUpperCase()}`);
    return { ok: true };
  }

  // ------------------------------------------------------------- matchmaking

  @SubscribeMessage('mm:join')
  mmJoin(@ConnectedSocket() c: Socket, @MessageBody() body: { queue: string }) {
    return this.guarded(c, (uid) => this.mm.join(uid, String(body?.queue)));
  }

  @SubscribeMessage('mm:leave')
  mmLeave(@ConnectedSocket() c: Socket) {
    return this.guarded(c, (uid) => this.mm.leave(uid));
  }

  @SubscribeMessage('mm:respond')
  mmRespond(@ConnectedSocket() c: Socket, @MessageBody() body: { proposalId: string; accept: boolean }) {
    return this.guarded(c, async (uid) => {
      await this.mm.respond(uid, String(body?.proposalId), body?.accept === true);
      return this.mm.status(uid);
    });
  }

  // ------------------------------------------------------------- chat

  @SubscribeMessage('chat:send')
  chat(@ConnectedSocket() c: Socket, @MessageBody() body: { channel: string; text: string }) {
    return this.guarded(c, async (uid) => {
      const d = c.data as SocketData;
      if (d.chatBanned) return { error: { code: 'CHAT_BANNED', message: 'Chat is disabled for your account' } };
      if (Date.now() - d.lastChat < 1000) return { error: { code: 'RATE_LIMITED', message: 'Slow down' } };
      const channel = String(body?.channel ?? '');
      const text = censor(cleanText(String(body?.text ?? ''), 200), (await this.settings.get('game')).chatFilter);
      if (!text) return { error: { code: 'EMPTY', message: 'Empty message' } };
      const [kind, id] = channel.split(':');
      if (kind === 'match') {
        if (!this.matches.isParticipant(id, uid)) return { error: { code: 'NOT_IN_MATCH', message: 'Not a player' } };
        if (!this.matches.chatEnabled(id)) return { error: { code: 'CHAT_DISABLED', message: 'Chat is disabled at this table' } };
      } else if (kind === 'room') {
        const room = await this.rooms.get(id);
        if (!this.rooms.isMember(room, uid)) return { error: { code: 'NOT_IN_ROOM', message: 'Not a member' } };
        if (!room.settings.chatEnabled) return { error: { code: 'CHAT_DISABLED', message: 'Chat is disabled in this room' } };
      } else return { error: { code: 'BAD_CHANNEL', message: 'Unknown channel' } };
      d.lastChat = Date.now();
      const msg: ChatMessageDTO = { id: randomUUID(), channel, userId: uid, nickname: d.nickname, text, at: Date.now() };
      const hist = this.chatHistory.get(channel) ?? [];
      hist.push(msg);
      this.chatHistory.set(channel, hist.slice(-50));
      if (kind === 'match') {
        const hidden = await this.blocks.blockers(uid);
        for (const p of this.matches.dto(id, uid).players) if (p.userId && !hidden.has(p.userId)) this.realtime.toUser(p.userId, 'chat:message', msg);
      } else this.realtime.toChannel(`room:${id.toUpperCase()}`, 'chat:message', msg);
      return { ok: true };
    });
  }

  @SubscribeMessage('chat:history')
  history(@ConnectedSocket() c: Socket, @MessageBody() body: { channel: string }) {
    return this.guarded(c, async (uid) => {
      const channel = String(body?.channel ?? '');
      const [kind, id] = channel.split(':');
      if (kind === 'match' && !this.matches.isParticipant(id, uid)) return { items: [] };
      return { items: this.chatHistory.get(channel) ?? [] };
    });
  }
}
