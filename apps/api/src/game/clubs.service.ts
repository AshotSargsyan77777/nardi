import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { AppError } from '../common/errors';
import { hasProfanity } from '../common/profanity';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../settings/settings.service';

const MAX_CLUBS_PER_USER = 3;
const MAX_MEMBERS = 50;
export const CLUB_EMBLEMS = ['🎲', '🏠', '🌳', '☕', '🍇', '🦅', '🦁', '⛰️', '🔥', '⭐', '🏆', '🍷'];
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join('');

/**
 * Clubs («բակ»): a group of friends with its own table. Anyone can start one and share the invite
 * link; the club table ranks members by this month's matches (3 for a win, 1 for a played match;
 * practice against bots and walk-outs do not count) and counts the matches members played together.
 */
@Injectable()
export class ClubsService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private async checkName(name: string) {
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 3 || n.length > 30) throw new AppError('BAD_CLUB_NAME', 'The name must be 3–30 characters');
    const words = (await this.settings.get('game')).chatFilter;
    if (hasProfanity(n, words)) throw new AppError('BAD_CLUB_NAME', 'This name is not allowed');
    return n;
  }

  private async roomForMore(userId: string) {
    const n = await this.prisma.clubMember.count({ where: { userId } });
    if (n >= MAX_CLUBS_PER_USER) throw new AppError('TOO_MANY_CLUBS', `You can be in up to ${MAX_CLUBS_PER_USER} clubs`, 409);
  }

  async create(userId: string, d: { name: string; emblem?: string; description?: string }) {
    const name = await this.checkName(d.name);
    await this.roomForMore(userId);
    if (await this.prisma.club.findUnique({ where: { nameLower: name.toLowerCase() } })) throw new AppError('CLUB_NAME_TAKEN', 'This name is taken', 409);
    const emblem = CLUB_EMBLEMS.includes(d.emblem ?? '') ? d.emblem! : CLUB_EMBLEMS[0];
    const description = (d.description ?? '').trim().slice(0, 200);
    if (description && hasProfanity(description, (await this.settings.get('game')).chatFilter)) throw new AppError('BAD_CLUB_TEXT', 'This text is not allowed');
    for (let i = 0; i < 5; i++) {
      try {
        const club = await this.prisma.club.create({
          data: { name, nameLower: name.toLowerCase(), emblem, description, ownerId: userId, inviteCode: newCode(), members: { create: { userId, role: 'OWNER' } } },
        });
        return { id: club.id };
      } catch (e) {
        // an invite code clash (very rare): try another one
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('inviteCode'))) throw e;
      }
    }
    throw new AppError('TRY_AGAIN', 'Please try again', 503);
  }

  async mine(userId: string) {
    const rows = await this.prisma.clubMember.findMany({ where: { userId }, include: { club: { include: { _count: { select: { members: true } } } } }, orderBy: { joinedAt: 'asc' } });
    return rows.map((r) => ({ id: r.club.id, name: r.club.name, emblem: r.club.emblem, members: r.club._count.members, role: r.role }));
  }

  /** What an invite link shows before joining. */
  async preview(code: string) {
    const club = await this.prisma.club.findUnique({ where: { inviteCode: code.toUpperCase() }, include: { _count: { select: { members: true } } } });
    if (!club) throw new AppError('NOT_FOUND', 'This invite is not valid', 404);
    return { id: club.id, name: club.name, emblem: club.emblem, description: club.description, members: club._count.members };
  }

  async join(userId: string, code: string) {
    const club = await this.prisma.club.findUnique({ where: { inviteCode: String(code).toUpperCase() }, include: { _count: { select: { members: true } } } });
    if (!club) throw new AppError('NOT_FOUND', 'This invite is not valid', 404);
    if (await this.prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId } } })) return { id: club.id };
    if (club._count.members >= MAX_MEMBERS) throw new AppError('CLUB_FULL', 'The club is full', 409);
    await this.roomForMore(userId);
    await this.prisma.clubMember.create({ data: { clubId: club.id, userId } });
    return { id: club.id };
  }

  private async membership(clubId: string, userId: string) {
    const m = await this.prisma.clubMember.findUnique({ where: { clubId_userId: { clubId, userId } } });
    if (!m) throw new AppError('NOT_A_MEMBER', 'You are not in this club', 403);
    return m;
  }

  async leave(clubId: string, userId: string) {
    const m = await this.membership(clubId, userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.clubMember.delete({ where: { id: m.id } });
      if (m.role !== 'OWNER') return;
      // the owner leaves: the longest-standing member takes over, or the club closes
      const next = await tx.clubMember.findFirst({ where: { clubId }, orderBy: { joinedAt: 'asc' } });
      if (next) {
        await tx.clubMember.update({ where: { id: next.id }, data: { role: 'OWNER' } });
        await tx.club.update({ where: { id: clubId }, data: { ownerId: next.userId } });
      } else await tx.club.delete({ where: { id: clubId } });
    });
    return { ok: true };
  }

  private async owner(clubId: string, userId: string) {
    const m = await this.membership(clubId, userId);
    if (m.role !== 'OWNER') throw new AppError('NOT_CLUB_OWNER', 'Only the club owner can do this', 403);
  }

  async kick(clubId: string, ownerId: string, userId: string) {
    await this.owner(clubId, ownerId);
    if (userId === ownerId) throw new AppError('BAD_REQUEST', 'Leave the club instead');
    await this.prisma.clubMember.deleteMany({ where: { clubId, userId } });
    return { ok: true };
  }

  async update(clubId: string, ownerId: string, d: { name?: string; emblem?: string; description?: string; newCode?: boolean }) {
    await this.owner(clubId, ownerId);
    const data: Prisma.ClubUpdateInput = {};
    if (d.name !== undefined) {
      const name = await this.checkName(d.name);
      const other = await this.prisma.club.findUnique({ where: { nameLower: name.toLowerCase() } });
      if (other && other.id !== clubId) throw new AppError('CLUB_NAME_TAKEN', 'This name is taken', 409);
      Object.assign(data, { name, nameLower: name.toLowerCase() });
    }
    if (d.emblem !== undefined && CLUB_EMBLEMS.includes(d.emblem)) data.emblem = d.emblem;
    if (d.description !== undefined) {
      const text = d.description.trim().slice(0, 200);
      if (text && hasProfanity(text, (await this.settings.get('game')).chatFilter)) throw new AppError('BAD_CLUB_TEXT', 'This text is not allowed');
      data.description = text;
    }
    if (d.newCode) data.inviteCode = newCode();
    await this.prisma.club.update({ where: { id: clubId }, data });
    return { ok: true };
  }

  /** The club page: members ranked by this month's points, plus matches played between members. */
  async get(clubId: string, userId: string) {
    const me = await this.membership(clubId, userId);
    const club = await this.prisma.club.findUniqueOrThrow({ where: { id: clubId }, include: { members: true } });
    const ids = club.members.map((m) => m.userId);
    const now = new Date(Date.now() + 4 * 3600_000);
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 4 * 3600_000);
    const [users, rows, together] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, avatar: true, rating: true, level: true, lastSeenAt: true } }),
      this.prisma.$queryRaw<{ userId: string; points: bigint; wins: bigint; games: bigint }[]>`
        SELECT mp."userId", SUM(CASE WHEN mp.result = 'WIN' THEN 3 ELSE 1 END) AS points,
               SUM(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) AS wins, COUNT(*) AS games
        FROM "MatchPlayer" mp JOIN "Match" m ON m.id = mp."matchId"
        WHERE mp."userId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND m.status = 'FINISHED' AND m.mode <> 'PRACTICE'
          AND m."finishedAt" >= ${since} AND NOT (COALESCE(m."finishReason", '') = 'forfeit' AND mp.result <> 'WIN')
        GROUP BY mp."userId"`,
      // finished matches this month where both players are members
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM "Match" m
        WHERE m.status = 'FINISHED' AND m."finishedAt" >= ${since}
          AND (SELECT COUNT(*) FROM "MatchPlayer" mp WHERE mp."matchId" = m.id AND mp."userId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})) = 2`,
    ]);
    const stat = new Map(rows.map((r) => [r.userId, r]));
    const byId = new Map(users.map((u) => [u.id, u]));
    const members = club.members
      .filter((m) => byId.has(m.userId))
      .map((m) => {
        const u = byId.get(m.userId)!;
        const s = stat.get(m.userId);
        return { userId: u.id, nickname: u.nickname, avatar: u.avatar, rating: u.rating, level: u.level, role: m.role, lastSeenAt: u.lastSeenAt, points: Number(s?.points ?? 0), wins: Number(s?.wins ?? 0), games: Number(s?.games ?? 0) };
      })
      .sort((a, b) => b.points - a.points || b.wins - a.wins || b.rating - a.rating)
      .map((m, i) => ({ rank: i + 1, ...m }));
    return {
      id: club.id, name: club.name, emblem: club.emblem, description: club.description, createdAt: club.createdAt,
      inviteCode: club.inviteCode, myRole: me.role, season: now.toISOString().slice(0, 7), matchesTogether: Number(together[0]?.n ?? 0),
      members,
    };
  }
}
