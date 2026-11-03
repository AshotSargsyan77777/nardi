import { Injectable } from '@nestjs/common';
import { KycStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { cleanText, jsonSafe } from '../common/util';
export interface Admin { id: string; role: string; ip?: string }
import { Currency, LedgerService } from '../ledger/ledger.service';
import { RealtimeService } from '../game/realtime.service';
import { MatchService } from '../game/match.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private realtime: RealtimeService,
    private matches: MatchService,
  ) {}

  // ---------------------------------------------------------------- analytics
  async overview() {
    const now = Date.now();
    const d1 = new Date(now - 86400_000);
    const d7 = new Date(now - 7 * 86400_000);
    const d30 = new Date(now - 30 * 86400_000);
    const [users, newUsers7, active1, active7, matchesTotal, matches7, finished, errors1, flagsOpen, statusCounts] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: d1 } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: d7 } } }),
      this.prisma.match.count(),
      this.prisma.match.count({ where: { startedAt: { gte: d7 } } }),
      this.prisma.match.aggregate({ where: { status: 'FINISHED', finishedAt: { gte: d30 } }, _avg: { durationSec: true }, _count: { _all: true } }),
      this.prisma.errorLog.count({ where: { createdAt: { gte: d1 } } }),
      this.prisma.suspiciousFlag.count({ where: { resolvedAt: null } }),
      this.prisma.match.groupBy({ by: ['mode'], _count: { _all: true } }),
    ]);
    const daily = await this.prisma.$queryRaw<{ day: Date; matches: bigint; users: bigint }[]>`
      SELECT d::date AS day,
        (SELECT COUNT(*) FROM "Match" m WHERE m."startedAt"::date = d::date) AS matches,
        (SELECT COUNT(*) FROM "User" u WHERE u."createdAt"::date = d::date) AS users
      FROM generate_series(now()::date - interval '13 days', now()::date, interval '1 day') d ORDER BY d`;
    return {
      users: { total: users, new7d: newUsers7, active24h: active1, active7d: active7, onlineNow: this.realtime.onlineCount() },
      matches: { total: matchesTotal, last7d: matches7, active: this.matches.activeSummaries().length, finished30d: finished._count._all, avgDurationSec: Math.round(finished._avg.durationSec ?? 0), byMode: statusCounts.map((s) => ({ mode: s.mode, count: s._count._all })) },
      errors24h: errors1,
      openFlags: flagsOpen,
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), matches: Number(d.matches), users: Number(d.users) })),
      emission: await this.ledger.emission(),
    };
  }

  // ---------------------------------------------------------------- users
  async users(q: string | undefined, skip: number, take: number) {
    const where: Prisma.UserWhereInput = q
      ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { nicknameLower: { contains: q.toLowerCase() } }, ...(isUuid(q) ? [{ id: q }] : [])] }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, nickname: true, role: true, status: true, rating: true, level: true, gamesPlayed: true, createdAt: true, lastSeenAt: true, kycStatus: true } }),
      this.prisma.user.count({ where }),
    ]);
    return { total, items };
  }

  async user(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { achievements: true } });
    if (!u) throw new AppError('NOT_FOUND', 'User not found', 404);
    const { passwordHash, ...safe } = u;
    const [balances, sessions, flags, ledger] = await Promise.all([
      this.ledger.balances(id),
      this.prisma.session.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, ip: true, userAgent: true, createdAt: true, revokedAt: true, expiresAt: true } }),
      this.prisma.suspiciousFlag.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.ledger.history(id, { skip: 0, take: 30 }),
    ]);
    const matches = await this.prisma.matchPlayer.findMany({ where: { userId: id }, include: { match: true }, orderBy: { match: { startedAt: 'desc' } }, take: 20 });
    return jsonSafe({ user: safe, balances, sessions, flags, ledger, matches: matches.map((m) => ({ ...m.match, state: undefined, seat: m.seat, result: m.result })) });
  }

  async setStatus(id: string, status: 'ACTIVE' | 'BLOCKED', reason: string, admin: Admin) {
    if (id === admin.id) throw new AppError('SELF', 'You cannot block yourself');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id } });
      if (before.role === 'SUPERADMIN' && admin.role !== 'SUPERADMIN') throw new AppError('FORBIDDEN', 'Cannot modify a super admin', 403);
      const u = await tx.user.update({ where: { id }, data: { status, blockedReason: status === 'BLOCKED' ? cleanText(reason, 300) : null, tokenVersion: { increment: status === 'BLOCKED' ? 1 : 0 } } });
      if (status === 'BLOCKED') await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: status === 'BLOCKED' ? 'user.block' : 'user.unblock', targetType: 'user', targetId: id, before: { status: before.status }, after: { status, reason }, ip: admin.ip });
      return { id: u.id, status: u.status };
    });
  }

  async setRole(id: string, role: Role, admin: Admin) {
    if (admin.role !== 'SUPERADMIN') throw new AppError('FORBIDDEN', 'Only a super admin can change roles', 403);
    if (id === admin.id) throw new AppError('SELF', 'You cannot change your own role');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id } });
      const u = await tx.user.update({ where: { id }, data: { role, tokenVersion: { increment: 1 } } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'user.role', targetType: 'user', targetId: id, before: { role: before.role }, after: { role }, ip: admin.ip });
      return { id: u.id, role: u.role };
    });
  }

  /** Moderation: drop an inappropriate profile photo (support staff and up). */
  async removePhoto(id: string, admin: Admin) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id } });
      await tx.avatarPhoto.deleteMany({ where: { userId: id } });
      if (before.avatar.startsWith('photo:')) await tx.user.update({ where: { id }, data: { avatar: 'pomegranate' } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'user.photo.remove', targetType: 'user', targetId: id, before: { avatar: before.avatar }, after: { avatar: 'pomegranate' }, ip: admin.ip });
      return { ok: true };
    });
  }

  async setRestrictions(id: string, r: { noStakes?: boolean; chatBanned?: boolean; noPurchases?: boolean }, admin: Admin) {
    const clean = Object.fromEntries(Object.entries(r).filter(([k, v]) => ['noStakes', 'chatBanned', 'noPurchases'].includes(k) && typeof v === 'boolean'));
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id } });
      const next = { ...(before.restrictions as any), ...clean };
      await tx.user.update({ where: { id }, data: { restrictions: next } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'user.restrictions', targetType: 'user', targetId: id, before: before.restrictions, after: next, ip: admin.ip });
      return next;
    });
  }

  async setKyc(id: string, status: KycStatus, admin: Admin) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id } });
      await tx.user.update({ where: { id }, data: { kycStatus: status } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'user.kyc', targetType: 'user', targetId: id, before: { kycStatus: before.kycStatus }, after: { kycStatus: status }, ip: admin.ip });
      return { kycStatus: status };
    });
  }

  /** Manual balance correction — always a ledger transaction against SYSTEM_MINT, never a direct edit. */
  async adjustBalance(id: string, d: { currency: Currency; amount: number; reason: string; idempotencyKey: string }, admin: Admin) {
    if (!['BLOT', 'FUN'].includes(d.currency)) throw new AppError('BAD_CURRENCY', 'Unknown currency');
    if (!Number.isInteger(d.amount) || d.amount === 0) throw new AppError('BAD_AMOUNT', 'Amount must be a non-zero integer');
    const reason = cleanText(d.reason ?? '', 300);
    if (reason.length < 5) throw new AppError('REASON_REQUIRED', 'A reason (min 5 characters) is required');
    const amount = BigInt(d.amount);
    return this.prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id } });
      const before = await this.ledger.balance(id, d.currency, tx);
      const { transaction, replayed } = await this.ledger.post({
        type: amount > 0n ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT', currency: d.currency, idempotencyKey: `admin-adjust:${d.idempotencyKey}`,
        description: reason, refType: 'user', refId: id, createdById: admin.id,
        entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId: id }, amount }],
      }, tx);
      if (!replayed) {
        await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'balance.adjust', targetType: 'user', targetId: id, before: { balance: before, currency: d.currency }, after: { balance: before + amount, amount: d.amount, reason, tx: transaction.id }, ip: admin.ip });
      }
      return { transactionId: transaction.id, replayed };
    });
  }

  // ---------------------------------------------------------------- games
  async matchesList(status: string | undefined, skip: number, take: number) {
    const where: Prisma.MatchWhereInput = status && ['ACTIVE', 'FINISHED', 'CANCELLED'].includes(status) ? { status: status as any } : {};
    const [items, total] = await Promise.all([
      this.prisma.match.findMany({ where, skip, take, orderBy: { startedAt: 'desc' }, select: { id: true, mode: true, status: true, stake: true, currency: true, scoreTeam0: true, scoreTeam1: true, winnerTeam: true, startedAt: true, finishedAt: true, durationSec: true, finishReason: true, players: { select: { seat: true, isBot: true, botName: true, result: true, user: { select: { nickname: true } } } } } }),
      this.prisma.match.count({ where }),
    ]);
    return jsonSafe({ total, items, live: this.matches.activeSummaries() });
  }

  async matchDetail(id: string) {
    const m = await this.prisma.match.findUnique({ where: { id }, include: { players: { include: { user: { select: { nickname: true } } } }, events: { orderBy: { seq: 'asc' } } } });
    if (!m) throw new AppError('NOT_FOUND', 'Match not found', 404);
    return jsonSafe(m);
  }

  // ---------------------------------------------------------------- monitoring
  async flags(open: boolean, skip: number, take: number) {
    const where = open ? { resolvedAt: null } : {};
    const [items, total] = await Promise.all([this.prisma.suspiciousFlag.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }), this.prisma.suspiciousFlag.count({ where })]);
    return { total, items };
  }

  async resolveFlag(id: string, resolution: string, admin: Admin) {
    return this.prisma.$transaction(async (tx) => {
      const f = await tx.suspiciousFlag.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: admin.id, resolution: cleanText(resolution, 500) } });
      await this.audit.log(tx, { actorId: admin.id, actorRole: admin.role, action: 'flag.resolve', targetType: 'flag', targetId: id, after: { resolution }, ip: admin.ip });
      return f;
    });
  }

  async errors(skip: number, take: number) {
    const [items, total] = await Promise.all([this.prisma.errorLog.findMany({ skip, take, orderBy: { id: 'desc' } }), this.prisma.errorLog.count()]);
    return jsonSafe({ total, items });
  }

  async auditLog(q: { action?: string; targetId?: string }, skip: number, take: number) {
    const where: Prisma.AuditLogWhereInput = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.targetId ? { targetId: q.targetId } : {}) };
    const [items, total] = await Promise.all([this.prisma.auditLog.findMany({ where, skip, take, orderBy: { id: 'desc' } }), this.prisma.auditLog.count({ where })]);
    return jsonSafe({ total, items });
  }

  async ledgerTransactions(q: { userId?: string; type?: string }, skip: number, take: number) {
    const where: Prisma.LedgerTransactionWhereInput = {
      ...(q.type ? { type: q.type as any } : {}),
      ...(q.userId ? { entries: { some: { account: { userId: q.userId } } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.ledgerTransaction.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { entries: { include: { account: { select: { type: true, userId: true, matchId: true } } } } } }),
      this.prisma.ledgerTransaction.count({ where }),
    ]);
    return jsonSafe({ total, items });
  }
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
