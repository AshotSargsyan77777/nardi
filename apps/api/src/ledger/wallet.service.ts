import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LedgerService } from './ledger.service';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService, private ledger: LedgerService, private settings: SettingsService) {}

  async summary(userId: string) {
    const [balances, currencies, features] = await Promise.all([
      this.ledger.balances(userId),
      this.prisma.currency.findMany(),
      this.settings.effectiveFeatures(),
    ]);
    const held = await this.prisma.ledgerAccount.findFirst({ where: { userId, type: 'WITHDRAWAL_HOLD', currency: 'BLOT' } });
    return {
      balances,
      heldForWithdrawal: Number(held?.balance ?? 0n),
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, purchasable: c.purchasable, redeemable: c.redeemable && features.withdrawalsEnabled })),
      dailyBonus: await this.dailyBonusStatus(userId),
    };
  }

  private dayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  async dailyBonusStatus(userId: string) {
    const cfg = (await this.settings.get('economy')).dailyBonus;
    const claimed = await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: `daily:${userId}:${this.dayKey()}` }, select: { id: true } });
    const bal = await this.ledger.balance(userId, 'FUN');
    return { amount: cfg.FUN, available: !claimed && cfg.FUN > 0 && bal < BigInt(cfg.belowBalance), claimedToday: !!claimed, belowBalance: cfg.belowBalance };
  }

  /** Practice currency (FUN) refill, at most once per UTC day and only when running low. */
  async claimDailyBonus(userId: string) {
    const st = await this.dailyBonusStatus(userId);
    if (!st.available) throw new AppError('BONUS_UNAVAILABLE', st.claimedToday ? 'Already claimed today' : 'Bonus is available when your practice balance is low', 409);
    const amount = BigInt(st.amount);
    await this.ledger.post({
      type: 'DAILY_BONUS', currency: 'FUN', idempotencyKey: `daily:${userId}:${this.dayKey()}`, description: 'Daily practice chips',
      refType: 'user', refId: userId,
      entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId }, amount }],
    });
    return this.summary(userId);
  }
}
