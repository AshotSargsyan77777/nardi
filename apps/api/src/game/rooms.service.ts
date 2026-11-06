import { Inject, Injectable } from '@nestjs/common';
import { GameId, RoomDTO, RoomSettings, Seat, SeatInfo, gameOf, normalizeAnyRules, seatCount } from '@nardi/engine';
import { Prisma, Room, RoomMember, RoomStatus, User } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { inviteCode } from '../common/util';
import { ENV, Env } from '../config/env';
import { SettingsService } from '../settings/settings.service';
import { MatchService } from './match.service';
import { RealtimeService } from './realtime.service';
import { StakePolicy } from './stake-policy.service';

type RoomFull = Room & { members: (RoomMember & { user: User | null })[] };

/**
 * Private rooms. Lifecycle: WAITING → READY (both seats taken, all humans ready) → PLAYING → FINISHED,
 * or CANCELLED by the host. A finished room can be reset for a rematch.
 */
@Injectable()
export class RoomsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private matches: MatchService,
    private realtime: RealtimeService,
    private stakes: StakePolicy,
    @Inject(ENV) private env: Env,
  ) {
    this.matches.onFinished.push(async (matchId, roomId) => {
      if (!roomId) return;
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (room && room.matchId === matchId && room.status === 'PLAYING') {
        await this.prisma.room.update({ where: { id: roomId }, data: { status: 'FINISHED' } });
        await this.prisma.roomMember.updateMany({ where: { roomId }, data: { ready: false } });
        await this.push(room.code);
      }
    });
  }

  private async load(code: string): Promise<RoomFull> {
    const room = await this.prisma.room.findUnique({ where: { code: code.toUpperCase() }, include: { members: { include: { user: true } } } });
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'Room not found', 404);
    return room;
  }

  toDto(room: RoomFull): RoomDTO {
    const seats: SeatInfo[] = range(seatsOf(room)).map((seat) => {
      const m = room.members.find((x) => x.seat === seat);
      if (!m) return { seat: seat as Seat, userId: null, nickname: null, avatar: null, rating: null, level: null, isBot: false, connected: false, ready: false };
      return {
        seat: seat as Seat, userId: m.userId, nickname: m.user?.nickname ?? m.botName, avatar: m.user?.avatar ?? 'bot', rating: m.user?.rating ?? null,
        level: m.user?.level ?? null, isBot: m.isBot, connected: m.isBot || (m.userId ? this.realtime.isOnline(m.userId) : false), ready: m.isBot || m.ready,
      };
    });
    return { id: room.id, code: room.code, hostId: room.hostId, status: room.status as RoomDTO['status'], settings: room.settings as unknown as RoomSettings, seats, matchId: room.matchId, inviteUrl: `${this.env.webOrigin}/room/${room.code}` };
  }

  async push(code: string) {
    const room = await this.load(code);
    this.realtime.toChannel(`room:${room.code}`, 'room:state', this.toDto(room));
    return room;
  }

  private async validateSettings(input: Partial<RoomSettings>, prev?: RoomSettings): Promise<RoomSettings> {
    const game = await this.settings.get('game');
    const f = await this.settings.effectiveFeatures();
    const base: RoomSettings = prev ?? { rules: {}, stake: 0, currency: 'FUN', chatEnabled: true, allowBots: true };
    // fields left out (undefined) keep their previous value
    const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<RoomSettings>;
    const s: RoomSettings = { ...base, ...given, rules: { ...base.rules, ...(input.rules ?? {}) } };
    // hosts may only change rule keys the owner allows; everything else comes from defaults
    const kind = gameOf(s.rules);
    const editable = editableKeys(kind, game.hostEditableRules);
    const rules: any = { ...baseRules(kind, game.defaultRules), game: kind };
    for (const k of editable) if (k in s.rules) rules[k] = (s.rules as any)[k];
    const normalized: any = normalizeAnyRules(rules);
    if (kind === 'nardi' && !game.allowedTargetScores.includes(normalized.targetScore)) throw new AppError('BAD_RULES', 'Target score is not allowed');
    if ((kind === 'nardi' || kind === 'checkers') && !game.allowedTurnTimeouts.includes(normalized.turnTimeoutSec)) throw new AppError('BAD_RULES', 'Turn timer is not allowed');
    if (kind === 'blot' && !BLOT_TIMEOUTS.includes(normalized.turnTimeoutSec)) throw new AppError('BAD_RULES', 'Turn timer is not allowed');
    if (s.currency !== 'FUN') throw new AppError('BAD_CURRENCY', 'Unknown currency');
    s.stake = Number(s.stake ?? 0);
    if (s.stake > 0) {
      if (s.currency === 'FUN' && !f.funStakesEnabled) throw new AppError('STAKES_DISABLED', 'Stakes are disabled', 403);
      if (!game.stakeOptions[s.currency].includes(s.stake)) throw new AppError('BAD_STAKE', 'This stake is not offered');
      s.allowBots = false;
    }
    if (!f.practiceBotsEnabled) s.allowBots = false;
    return { rules: { game: kind, ...Object.fromEntries(editable.map((k) => [k, normalized[k]])) }, stake: s.stake, currency: s.currency, chatEnabled: !!s.chatEnabled, allowBots: !!s.allowBots };
  }

  async create(userId: string, input: Partial<RoomSettings>) {
    const settings = await this.validateSettings(input);
    await this.assertFree(userId);
    if (settings.stake > 0) await this.stakes.assertAllowed(settings.currency, settings.stake, [userId]);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const room = await this.prisma.room.create({ data: { code: inviteCode(), hostId: userId, settings: settings as unknown as Prisma.InputJsonValue, members: { create: { userId, seat: 0 } } } });
        return this.toDto(await this.load(room.code));
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new AppError('CODE_GENERATION_FAILED', 'Try again', 500);
  }

  private async assertFree(userId: string) {
    if (this.matches.activeMatchOf(userId)) throw new AppError('ALREADY_IN_MATCH', 'Finish your current match first', 409);
  }

  async get(code: string) {
    return this.toDto(await this.load(code));
  }

  async myOpenRooms(userId: string) {
    const rooms = await this.prisma.room.findMany({ where: { members: { some: { userId } }, status: { in: ['WAITING', 'READY', 'PLAYING'] } }, include: { members: { include: { user: true } } }, orderBy: { createdAt: 'desc' }, take: 10 });
    return rooms.map((r) => this.toDto(r));
  }

  private recomputeStatus(room: RoomFull): RoomStatus {
    if (['PLAYING', 'CANCELLED'].includes(room.status)) return room.status;
    if (room.status === 'FINISHED') return 'FINISHED';
    const full = room.members.length === seatsOf(room);
    const ready = room.members.every((m) => m.isBot || m.ready);
    return full && ready ? 'READY' : 'WAITING';
  }

  private async mutate(code: string, fn: (room: RoomFull) => Promise<void>) {
    const room = await this.load(code);
    await fn(room);
    const fresh = await this.load(code);
    const status = this.recomputeStatus(fresh);
    if (status !== fresh.status) await this.prisma.room.update({ where: { id: fresh.id }, data: { status } });
    return this.toDto(await this.push(code));
  }

  private assertOpen(room: RoomFull) {
    if (!['WAITING', 'READY', 'FINISHED'].includes(room.status)) throw new AppError('ROOM_CLOSED', `Room is ${room.status}`, 409);
  }

  async join(userId: string, code: string, seat?: number) {
    return this.mutate(code, async (room) => {
      if (room.members.some((m) => m.userId === userId)) return; // already seated
      if (room.status !== 'WAITING') throw new AppError('ROOM_CLOSED', 'Room is not accepting players', 409);
      await this.assertFree(userId);
      const s = room.settings as unknown as RoomSettings;
      if (s.stake > 0) await this.stakes.assertAllowed(s.currency, s.stake, [userId]);
      const free = range(seatsOf(room)).filter((x) => !room.members.some((m) => m.seat === x));
      const target = seat !== undefined && free.includes(seat) ? seat : free[0];
      if (target === undefined) throw new AppError('ROOM_FULL', 'Room is full', 409);
      try {
        await this.prisma.roomMember.create({ data: { roomId: room.id, userId, seat: target } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('SEAT_TAKEN', 'Seat was just taken', 409);
        throw e;
      }
    });
  }

  async leave(userId: string, code: string) {
    return this.mutate(code, async (room) => {
      if (room.status === 'PLAYING') throw new AppError('ROOM_PLAYING', 'Use "leave match" during a game', 409);
      const me = room.members.find((m) => m.userId === userId);
      if (!me) return;
      await this.prisma.roomMember.delete({ where: { id: me.id } });
      if (room.hostId === userId) {
        const next = room.members.find((m) => m.userId && m.userId !== userId);
        if (next) await this.prisma.room.update({ where: { id: room.id }, data: { hostId: next.userId! } });
        else await this.prisma.room.update({ where: { id: room.id }, data: { status: 'CANCELLED' } });
      }
      await this.prisma.roomMember.updateMany({ where: { roomId: room.id }, data: { ready: false } });
    });
  }

  async moveSeat(userId: string, code: string, seat: number) {
    return this.mutate(code, async (room) => {
      this.assertOpen(room);
      const me = room.members.find((m) => m.userId === userId);
      if (!me) throw new AppError('NOT_IN_ROOM', 'Join the room first', 403);
      if (room.members.some((m) => m.seat === seat)) throw new AppError('SEAT_TAKEN', 'Seat is taken', 409);
      if (seat < 0 || seat >= seatsOf(room)) throw new AppError('BAD_SEAT', 'Bad seat');
      await this.prisma.roomMember.update({ where: { id: me.id }, data: { seat, ready: false } });
    });
  }

  async setReady(userId: string, code: string, ready: boolean) {
    return this.mutate(code, async (room) => {
      if (room.status === 'FINISHED') await this.prisma.room.update({ where: { id: room.id }, data: { status: 'WAITING' } });
      else this.assertOpen(room);
      const me = room.members.find((m) => m.userId === userId);
      if (!me) throw new AppError('NOT_IN_ROOM', 'Join the room first', 403);
      await this.prisma.roomMember.update({ where: { id: me.id }, data: { ready } });
    });
  }

  private assertHost(room: RoomFull, userId: string) {
    if (room.hostId !== userId) throw new AppError('NOT_HOST', 'Only the host can do this', 403);
  }

  async addBot(userId: string, code: string, seat: number) {
    return this.mutate(code, async (room) => {
      this.assertHost(room, userId);
      this.assertOpen(room);
      const s = room.settings as unknown as RoomSettings;
      if (!s.allowBots || s.stake > 0) throw new AppError('BOTS_NOT_ALLOWED', 'Bots are not allowed in this room', 403);
      if (seat < 0 || seat >= seatsOf(room) || room.members.some((m) => m.seat === seat)) throw new AppError('SEAT_TAKEN', 'Seat is taken', 409);
      const bots = room.members.filter((m) => m.isBot).length;
      await this.prisma.roomMember.create({ data: { roomId: room.id, isBot: true, botName: MatchService.botName(seat + bots), seat, ready: true } });
    });
  }

  async removeSeat(userId: string, code: string, seat: number) {
    return this.mutate(code, async (room) => {
      this.assertHost(room, userId);
      this.assertOpen(room);
      const m = room.members.find((x) => x.seat === seat);
      if (!m) return;
      if (m.userId === userId) throw new AppError('BAD_SEAT', 'Host cannot remove themselves');
      await this.prisma.roomMember.delete({ where: { id: m.id } });
      if (m.userId) this.realtime.toUser(m.userId, 'room:kicked', { code: room.code });
    });
  }

  async updateSettings(userId: string, code: string, input: Partial<RoomSettings>) {
    return this.mutate(code, async (room) => {
      this.assertHost(room, userId);
      if (!['WAITING', 'READY', 'FINISHED'].includes(room.status)) throw new AppError('ROOM_CLOSED', 'Settings are locked', 409);
      const next = await this.validateSettings(input, room.settings as unknown as RoomSettings);
      if (next.stake > 0 && room.members.some((m) => m.isBot)) throw new AppError('BOTS_NOT_ALLOWED', 'Remove bots before setting a stake', 409);
      await this.prisma.room.update({ where: { id: room.id }, data: { settings: next as unknown as Prisma.InputJsonValue, status: 'WAITING' } });
      // fewer seats now (blot → a two-player game): bots on the extra seats go, people move down if they can
      const n = seatCount(gameOf(next.rules));
      const taken = new Set(room.members.filter((m) => m.seat < n).map((m) => m.seat));
      for (const m of room.members.filter((x) => x.seat >= n).sort((a, b) => Number(a.isBot) - Number(b.isBot))) {
        const free = range(n).find((x) => !taken.has(x));
        if (m.isBot || free === undefined) await this.prisma.roomMember.delete({ where: { id: m.id } });
        else {
          await this.prisma.roomMember.update({ where: { id: m.id }, data: { seat: free } });
          taken.add(free);
        }
      }
      await this.prisma.roomMember.updateMany({ where: { roomId: room.id, isBot: false }, data: { ready: false } });
    });
  }

  async start(userId: string, code: string) {
    const room = await this.load(code);
    this.assertHost(room, userId);
    if (this.recomputeStatus(room) !== 'READY') throw new AppError('ROOM_NOT_READY', 'Both seats must be taken and every player ready', 409);
    // claim the room atomically so a double click cannot start two matches
    const claim = await this.prisma.room.updateMany({ where: { id: room.id, status: { in: ['WAITING', 'READY'] } }, data: { status: 'PLAYING' } });
    if (claim.count !== 1) throw new AppError('ROOM_CLOSED', 'Room already started', 409);
    const s = room.settings as unknown as RoomSettings;
    const ordered = [...room.members].sort((a, b) => a.seat - b.seat);
    const humans = ordered.filter((m) => m.userId).map((m) => m.userId!);
    try {
      if (s.stake > 0) await this.stakes.assertAllowed(s.currency, s.stake, humans);
      const game = await this.settings.get('game');
      const matchId = await this.matches.create({
        mode: 'PRIVATE', rules: { ...baseRules(gameOf(s.rules), game.defaultRules), ...s.rules }, stake: s.stake, currency: s.currency, ranked: false, chatEnabled: s.chatEnabled, roomId: room.id,
        seats: ordered.map((m) => (m.userId ? { userId: m.userId } : { botName: m.botName ?? 'Bot' })),
      });
      await this.prisma.room.update({ where: { id: room.id }, data: { matchId } });
      return this.toDto(await this.push(code));
    } catch (e) {
      await this.prisma.room.update({ where: { id: room.id }, data: { status: 'WAITING' } });
      await this.push(code);
      throw e;
    }
  }

  async cancel(userId: string, code: string) {
    return this.mutate(code, async (room) => {
      this.assertHost(room, userId);
      if (room.status === 'PLAYING') throw new AppError('ROOM_PLAYING', 'A match is in progress', 409);
      await this.prisma.room.update({ where: { id: room.id }, data: { status: 'CANCELLED' } });
    });
  }

  isMember(room: RoomDTO, userId: string) {
    return room.seats.some((s) => s.userId === userId);
  }
}

/** The rule keys a host may set for each game (nardi: as the owner allows). */
export function editableKeys(kind: GameId, nardiKeys: string[]): string[] {
  if (kind === 'checkers') return ['botLevel', 'turnTimeoutSec'];
  if (kind === 'blot') return ['targetScore', 'turnTimeoutSec', 'cardsBeforeBidding', 'dealStyle', 'botLevel', 'allowNoTrump', 'noTrumpDoubled', 'contraEnabled', 'recontraEnabled', 'allowKapotBid'];
  if (kind === 'chess') return ['botLevel', 'clockMin', 'clockInc'];
  return nardiKeys.filter((k) => k !== 'game');
}

export const BLOT_TIMEOUTS = [15, 30, 45, 60];
/** The owner's default rules apply to nardi; the other games start from their own defaults. */
export function baseRules(kind: GameId, nardiDefaults: object): Record<string, unknown> {
  return kind === 'nardi' ? { ...nardiDefaults } : {};
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** How many seats a room has: four for blot, two for the other games. */
const seatsOf = (room: { settings: unknown }) => seatCount(gameOf((room.settings as RoomSettings)?.rules ?? {}));
