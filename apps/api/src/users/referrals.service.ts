import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../common/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';

/**
 * «Invite a friend». A new player who signs up through someone's link is linked to them; once the
 * friend has finished a few games, both get practice coins. Each inviter is paid for at most
 * `monthlyCap` friends a month, and a shared IP at sign-up is flagged for the admins.
 */
@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService, private ledger: LedgerService, private settings: SettingsService) {}

  /** The inviter for a «ref» code (their nickname), or null. */
  async findInviter(ref: string | undefined | null) {
    const code = String(ref ?? '').trim().toLowerCase();
    if (!code || code.length > 20) return null;
    return this.prisma.user.findFirst({ where: { nicknameLower: code, status: 'ACTIVE' }, select: { id: true } });
  }

  /** Called at sign-up, inside the registration transaction. */
  async link(tx: Tx, userId: string, inviterId: string, ip?: string) {
    await tx.user.update({ where: { id: userId }, data: { referredById: inviterId } });
    if (!ip) return;
    const shared = await tx.session.findFirst({ where: { userId: inviterId, ip, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, select: { id: true } });
    if (shared) await tx.suspiciousFlag.create({ data: { userId, type: 'REFERRAL_SAME_IP', severity: 'low', details: { inviterId, ip } } });
  }

  /** Called when a player finishes a game (inside the match-finish transaction). */
  async onGameFinished(tx: Tx, userId: string, gamesPlayed: number) {
    const cfg = (await this.settings.get('economy')).referral;
    if (gamesPlayed < cfg.games) return;
    const u = await tx.user.findUnique({ where: { id: userId }, select: { referredById: true, referralRewardedAt: true, nickname: true } });
    if (!u?.referredById || u.referralRewardedAt) return;
    const monthStart = new Date(new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z');
    const paidThisMonth = await tx.user.count({ where: { referredById: u.referredById, referralRewardedAt: { gte: monthStart } } });
    const inviterPaid = paidThisMonth < cfg.monthlyCap;
    await tx.user.update({ where: { id: userId }, data: { referralRewardedAt: new Date() } });
    const pay = async (to: string, amount: number, who: 'inviter' | 'friend') => {
      if (amount <= 0) return;
      const a = BigInt(amount);
      await this.ledger.post({
        type: 'REFERRAL_BONUS', currency: 'FUN', idempotencyKey: `referral:${userId}:${who}`, description: who === 'inviter' ? `Invited ${u.nickname}` : 'Invited by a friend',
        refType: 'user', refId: userId,
        entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -a }, { account: { type: 'USER_WALLET', userId: to }, amount: a }],
      }, tx);
      await tx.notification.create({ data: { userId: to, type: 'referral', title: 'referral.rewarded', body: `${amount}`, data: { amount, friend: who === 'inviter' ? u.nickname : null } } });
    };
    await pay(userId, cfg.friend, 'friend');
    if (inviterPaid) await pay(u.referredById, cfg.inviter, 'inviter');
  }

  /** What the player sees on the «Invite a friend» card. */
  async summary(userId: string) {
    const [me, cfg, friends] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { nickname: true } }),
      this.settings.get('economy').then((e) => e.referral),
      this.prisma.user.findMany({ where: { referredById: userId }, orderBy: { createdAt: 'desc' }, take: 50, select: { nickname: true, avatar: true, gamesPlayed: true, referralRewardedAt: true, createdAt: true } }),
    ]);
    const earned = await this.prisma.ledgerEntry.aggregate({
      where: { account: { userId, type: 'USER_WALLET' }, transaction: { type: 'REFERRAL_BONUS', idempotencyKey: { endsWith: ':inviter' } } },
      _sum: { amount: true },
    });
    return {
      code: me.nickname,
      reward: { inviter: cfg.inviter, friend: cfg.friend, games: cfg.games },
      earned: Number(earned._sum.amount ?? 0),
      friends: friends.map((f) => ({ nickname: f.nickname, avatar: f.avatar, games: Math.min(f.gamesPlayed, cfg.games), done: !!f.referralRewardedAt, joinedAt: f.createdAt })),
    };
  }
}
