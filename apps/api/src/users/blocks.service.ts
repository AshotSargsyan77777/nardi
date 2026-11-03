import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { cleanText } from '../common/util';

const REPORT_REASONS = ['abuse', 'cheating', 'leaving', 'nickname', 'photo', 'other'] as const;

/** Players blocking and reporting other players. */
@Injectable()
export class BlocksService {
  constructor(private prisma: PrismaService) {}

  private async target(nickname: string, me: string) {
    const u = await this.prisma.user.findUnique({ where: { nicknameLower: nickname.toLowerCase() }, select: { id: true, nickname: true } });
    if (!u) throw new AppError('NOT_FOUND', 'Player not found', 404);
    if (u.id === me) throw new AppError('SELF', 'That is you');
    return u;
  }

  async block(me: string, nickname: string) {
    const u = await this.target(nickname, me);
    await this.prisma.userBlock.upsert({ where: { userId_blockedId: { userId: me, blockedId: u.id } }, create: { userId: me, blockedId: u.id }, update: {} });
    return { ok: true };
  }

  async unblock(me: string, nickname: string) {
    const u = await this.target(nickname, me);
    await this.prisma.userBlock.deleteMany({ where: { userId: me, blockedId: u.id } });
    return { ok: true };
  }

  async list(me: string) {
    const rows = await this.prisma.userBlock.findMany({ where: { userId: me }, include: { blocked: { select: { nickname: true, avatar: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ nickname: r.blocked.nickname, avatar: r.blocked.avatar, since: r.createdAt }));
  }

  /** Users who blocked `userId` (they should not see their messages). */
  async blockers(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.userBlock.findMany({ where: { blockedId: userId }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  async isBlocked(me: string, other: string) {
    return (await this.prisma.userBlock.count({ where: { OR: [{ userId: me, blockedId: other }, { userId: other, blockedId: me }] } })) > 0;
  }

  /** True if anyone in the group blocked anyone else in it. */
  async anyBlocked(userIds: string[]) {
    return (await this.prisma.userBlock.count({ where: { userId: { in: userIds }, blockedId: { in: userIds } } })) > 0;
  }

  /** A report goes to the support inbox, where staff review it. */
  async report(me: string, nickname: string, d: { reason: string; details?: string; matchId?: string }) {
    const u = await this.target(nickname, me);
    if (!REPORT_REASONS.includes(d.reason as any)) throw new AppError('BAD_REASON', 'Unknown reason');
    const recent = await this.prisma.supportTicket.count({ where: { userId: me, subject: { startsWith: 'REPORT' }, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
    if (recent >= 5) throw new AppError('RATE_LIMITED', 'Too many reports, try later', 429);
    const lines = [`Player: ${u.nickname} (${u.id})`, `Reason: ${d.reason}`, d.matchId ? `Match: ${d.matchId}` : null, d.details ? `\n${d.details.slice(0, 1000)}` : null];
    await this.prisma.supportTicket.create({ data: { userId: me, subject: cleanText(`REPORT ${d.reason}: ${u.nickname}`, 120), message: lines.filter(Boolean).join('\n') } });
    return { ok: true };
  }
}
