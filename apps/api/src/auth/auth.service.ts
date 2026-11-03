import { nickScriptOk, nickSkeleton } from '../common/nickname';
import { hasProfanity } from '../common/profanity';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { User } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { randomToken } from '../common/util';
import { ENV, Env } from '../config/env';
import { CURRENCIES, LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { ReferralsService } from '../users/referrals.service';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // OWASP argon2id baseline
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const NICK_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

export interface IssuedTokens { accessToken: string; refreshToken: string; csrfToken: string; refreshExpires: Date }

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private ledger: LedgerService,
    private settings: SettingsService,
    private redis: RedisService,
    private audit: AuditService,
    private referrals: ReferralsService,
    @Inject(ENV) private env: Env,
  ) {}

  hashPassword(pw: string) {
    return hash(pw, ARGON);
  }

  async register(d: { email: string; nickname: string; password: string; birthDate?: string; locale?: string; ref?: string }, meta: { ip?: string; ua?: string }) {
    const features = await this.settings.get('features');
    if (!features.registrationOpen) throw new AppError('REGISTRATION_CLOSED', 'Registration is temporarily closed', 403);
    const email = d.email.trim().toLowerCase();
    const nickname = d.nickname.trim();
    if (!NICK_RE.test(nickname)) throw new AppError('BAD_NICKNAME', 'Nickname: 3-20 letters, digits, _ . -');
    if (!nickScriptOk(nickname)) throw new AppError('BAD_NICKNAME', 'Use letters of one alphabet only (Armenian, Latin or Cyrillic)');
    if (hasProfanity(nickname, (await this.settings.get('game')).chatFilter)) throw new AppError('BAD_NICKNAME', 'This nickname is not allowed');
    const skeleton = nickSkeleton(nickname);
    if (await this.prisma.user.findFirst({ where: { nicknameSkeleton: skeleton }, select: { id: true } })) throw new AppError('NICKNAME_TAKEN', 'This nickname (or one that looks the same) is taken', 409);
    if (d.birthDate) {
      const legal = await this.settings.get('legal');
      const age = (Date.now() - new Date(d.birthDate).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (!(age >= legal.minAge)) throw new AppError('UNDERAGE', `You must be at least ${legal.minAge} years old`, 403);
    }
    const exists = await this.prisma.user.findFirst({ where: { OR: [{ email }, { nicknameLower: nickname.toLowerCase() }] }, select: { email: true } });
    if (exists) throw new AppError(exists.email === email ? 'EMAIL_TAKEN' : 'NICKNAME_TAKEN', exists.email === email ? 'This e-mail is already registered' : 'This nickname is taken', 409);

    const passwordHash = await this.hashPassword(d.password);
    const bonus = (await this.settings.get('economy')).signupBonus;
    const inviter = await this.referrals.findInviter(d.ref);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email, nickname, nicknameLower: nickname.toLowerCase(), nicknameSkeleton: skeleton, passwordHash,
          locale: ['hy', 'ru', 'en'].includes(d.locale ?? '') ? d.locale! : 'hy',
          birthDate: d.birthDate ? new Date(d.birthDate) : null,
          settings: { notifications: { matchInvites: true, payments: true, news: false }, privacy: { showProfile: true, showHistory: true, showOnLeaderboard: true }, chatEnabled: true },
        },
      });
      for (const c of CURRENCIES) {
        await this.ledger.ensureAccount(tx, { type: 'USER_WALLET', userId: u.id }, c);
        const amount = BigInt(bonus[c] ?? 0);
        if (amount > 0n) {
          await this.ledger.post({
            type: 'SIGNUP_BONUS', currency: c, idempotencyKey: `signup:${u.id}:${c}`, description: 'Welcome bonus',
            refType: 'user', refId: u.id,
            entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId: u.id }, amount }],
          }, tx);
        }
      }
      if (inviter) await this.referrals.link(tx, u.id, inviter.id, meta.ip);
      return u;
    });
    return { user, tokens: await this.issue(user, meta) };
  }

  async login(emailOrNick: string, password: string, meta: { ip?: string; ua?: string }) {
    const key = `login:fail:${emailOrNick.toLowerCase()}`;
    const fails = Number((await this.redis.get(key)) ?? 0);
    if (fails >= 10) throw new AppError('LOCKED', 'Too many failed attempts. Try again in 15 minutes.', 429);
    const id = emailOrNick.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { OR: [{ email: id }, { nicknameLower: id }] } });
    const ok = user ? await verify(user.passwordHash, password).catch(() => false) : await verify(DUMMY_HASH, password).catch(() => false);
    if (!user || !ok) {
      await this.redis.set(key, String(fails + 1), 15 * 60);
      if (fails + 1 === 10) {
        await this.prisma.suspiciousFlag.create({ data: { userId: user?.id, type: 'BRUTE_FORCE_LOGIN', severity: 'medium', details: { login: id, ip: meta.ip } } });
      }
      throw new AppError('BAD_CREDENTIALS', 'Wrong login or password', 401);
    }
    if (user.status === 'BLOCKED') throw new AppError('ACCOUNT_BLOCKED', user.blockedReason ?? 'Account is blocked', 403);
    await this.redis.del(key);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { user, tokens: await this.issue(user, meta) };
  }

  async issue(user: Pick<User, 'id' | 'role' | 'tokenVersion'>, meta: { ip?: string; ua?: string }, family?: string): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, tv: user.tokenVersion },
      { secret: this.env.jwtAccessSecret, audience: 'access', expiresIn: this.env.accessTokenTtlSec },
    );
    const refreshToken = randomToken(48);
    const refreshExpires = new Date(Date.now() + this.env.refreshTokenTtlDays * 86400_000);
    await this.prisma.session.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), family: family ?? randomUUID(), expiresAt: refreshExpires, ip: meta.ip, userAgent: meta.ua?.slice(0, 300) },
    });
    return { accessToken, refreshToken, csrfToken: randomToken(24), refreshExpires };
  }

  /** Refresh-token rotation with reuse detection (a replayed token revokes its whole family). */
  async refresh(token: string, meta: { ip?: string; ua?: string }) {
    const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!s) throw new AppError('BAD_REFRESH', 'Session expired', 401);
    if (s.revokedAt) {
      await this.prisma.session.updateMany({ where: { family: s.family, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.prisma.suspiciousFlag.create({ data: { userId: s.userId, type: 'REFRESH_TOKEN_REUSE', severity: 'high', details: { ip: meta.ip, family: s.family } } });
      throw new AppError('BAD_REFRESH', 'Session expired', 401);
    }
    if (s.expiresAt < new Date() || s.user.status !== 'ACTIVE') throw new AppError('BAD_REFRESH', 'Session expired', 401);
    const tokens = await this.issue(s.user, meta, s.family);
    const next = await this.prisma.session.findUnique({ where: { tokenHash: sha256(tokens.refreshToken) }, select: { id: true } });
    const res = await this.prisma.session.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: new Date(), replacedBy: next!.id } });
    if (res.count === 0) throw new AppError('BAD_REFRESH', 'Session expired', 401); // concurrent refresh lost the race
    return { user: s.user, tokens };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(userId: string, current: string, next: string, meta: { ip?: string; ua?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(user.passwordHash, current).catch(() => false))) throw new AppError('BAD_CREDENTIALS', 'Current password is wrong', 400);
    if (current === next) throw new AppError('SAME_PASSWORD', 'New password must differ');
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(next), tokenVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { actorId: userId, action: 'user.password_changed', targetType: 'user', targetId: userId, ip: meta.ip });
      return u;
    });
    return this.issue(updated, meta);
  }

  async wsTicket(userId: string) {
    const ticket = randomToken(32);
    await this.redis.set(`ws:ticket:${ticket}`, userId, 60);
    return { ticket, expiresIn: 60 };
  }

  async consumeWsTicket(ticket: string): Promise<string | null> {
    if (!ticket || typeof ticket !== 'string' || ticket.length > 100) return null;
    return this.redis.take(`ws:ticket:${ticket}`);
  }
}

// Constant-time-ish behaviour for unknown accounts (avoid user enumeration by timing).
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$4jK3l6Ldl3yQGOG4G1g2Ixq6dB0F8Yx7VQ0eQf3m8hE';
