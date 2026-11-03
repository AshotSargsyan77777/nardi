import { PushService } from '../common/push.service';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { BlocksService } from '../users/blocks.service';
import { MatchService } from './match.service';
import { RealtimeService } from './realtime.service';
import { RoomsService } from './rooms.service';

const userSelect = { id: true, nickname: true, avatar: true, rating: true, level: true } as const;

/** Friend requests, the friends list (who is online / playing) and table invitations. */
@Injectable()
export class FriendsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private matches: MatchService,
    private rooms: RoomsService,
    private blocks: BlocksService,
    private push: PushService,
  ) {}

  private async other(me: string, nickname: string) {
    const u = await this.prisma.user.findUnique({ where: { nicknameLower: nickname.toLowerCase() }, select: { id: true, nickname: true, status: true } });
    if (!u || u.status !== 'ACTIVE') throw new AppError('NOT_FOUND', 'Player not found', 404);
    if (u.id === me) throw new AppError('SELF', 'That is you');
    return u;
  }

  private pair(a: string, b: string) {
    return this.prisma.friendship.findFirst({ where: { OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] } });
  }

  private changed(...userIds: string[]) {
    for (const id of userIds) this.realtime.toUser(id, 'friends:changed', {});
  }

  async list(me: string) {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: me }, { addresseeId: me }] },
      include: { requester: { select: userSelect }, addressee: { select: userSelect } },
      orderBy: { createdAt: 'desc' },
    });
    const view = (u: { id: string; nickname: string; avatar: string; rating: number; level: number }) => ({
      nickname: u.nickname, avatar: u.avatar, rating: u.rating, level: u.level,
      online: this.realtime.isOnline(u.id), playing: !!this.matches.activeMatchOf(u.id),
    });
    const withMatch = (u: Parameters<typeof view>[0]) => ({ ...view(u), matchId: this.matches.activeMatchOf(u.id) });
    const friends = rows.filter((r) => r.status === 'ACCEPTED').map((r) => withMatch(r.requesterId === me ? r.addressee : r.requester));
    friends.sort((a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname));
    return {
      friends,
      incoming: rows.filter((r) => r.status === 'PENDING' && r.addresseeId === me).map((r) => view(r.requester)),
      outgoing: rows.filter((r) => r.status === 'PENDING' && r.requesterId === me).map((r) => view(r.addressee)),
    };
  }

  /** Send a request; if they already asked me, this accepts it. */
  async request(me: string, nickname: string) {
    const u = await this.other(me, nickname);
    if (await this.blocks.isBlocked(me, u.id)) throw new AppError('BLOCKED', 'You cannot add this player', 403);
    const existing = await this.pair(me, u.id);
    if (existing?.status === 'ACCEPTED') return { status: 'friends' };
    if (existing && existing.requesterId === u.id) return this.accept(me, nickname);
    if (!existing) {
      const count = await this.prisma.friendship.count({ where: { OR: [{ requesterId: me }, { addresseeId: me }] } });
      if (count >= 300) throw new AppError('TOO_MANY_FRIENDS', 'Friends list is full');
      const myNick = (await this.prisma.user.findUniqueOrThrow({ where: { id: me }, select: { nickname: true } })).nickname;
      await this.prisma.$transaction([
        this.prisma.friendship.create({ data: { requesterId: me, addresseeId: u.id } }),
        this.prisma.notification.create({ data: { userId: u.id, type: 'friend', title: 'friend.request', body: myNick, data: { nickname: myNick } } }),
      ]);
      if (!this.realtime.isOnline(u.id)) this.push.send(u.id, 'friendRequest', myNick, '/friends', 0);
      this.changed(me, u.id);
    }
    return { status: 'requested' };
  }

  async accept(me: string, nickname: string) {
    const u = await this.other(me, nickname);
    const r = await this.prisma.friendship.updateMany({ where: { requesterId: u.id, addresseeId: me, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
    if (!r.count) throw new AppError('NO_REQUEST', 'No friend request from this player', 404);
    const myNick = (await this.prisma.user.findUniqueOrThrow({ where: { id: me }, select: { nickname: true } })).nickname;
    await this.prisma.notification.create({ data: { userId: u.id, type: 'friend', title: 'friend.accepted', body: myNick, data: { nickname: myNick } } });
    if (!this.realtime.isOnline(u.id)) this.push.send(u.id, 'friendAccepted', myNick, '/friends', 0);
    this.changed(me, u.id);
    return { status: 'friends' };
  }

  /** Remove a friend, cancel my request or decline theirs. */
  async remove(me: string, nickname: string) {
    const u = await this.other(me, nickname);
    await this.prisma.friendship.deleteMany({ where: { OR: [{ requesterId: me, addresseeId: u.id }, { requesterId: u.id, addresseeId: me }] } });
    this.changed(me, u.id);
    return { ok: true };
  }

  /** Invite a friend to a room I am in; they get a live pop-up and a notification. */
  async invite(me: string, nickname: string, roomCode: string) {
    const u = await this.other(me, nickname);
    const f = await this.pair(me, u.id);
    if (f?.status !== 'ACCEPTED') throw new AppError('NOT_FRIENDS', 'You can invite only friends', 403);
    const room = await this.rooms.get(roomCode);
    if (!this.rooms.isMember(room, me)) throw new AppError('NOT_IN_ROOM', 'Join the room first', 403);
    const from = await this.prisma.user.findUniqueOrThrow({ where: { id: me }, select: { nickname: true, avatar: true } });
    this.realtime.toUser(u.id, 'friend:invite', { from: from.nickname, avatar: from.avatar, roomCode: room.code });
    await this.prisma.notification.create({ data: { userId: u.id, type: 'friend', title: 'friend.invite', body: from.nickname, data: { roomCode: room.code } } });
    if (!this.realtime.isOnline(u.id)) this.push.send(u.id, 'invite', from.nickname, `/room/${room.code}`, 0);
    return { ok: true };
  }
}
