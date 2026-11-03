import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { Currency, LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';

/** Central place that decides whether a stake is allowed for a set of players. */
@Injectable()
export class StakePolicy {
  constructor(private settings: SettingsService, private ledger: LedgerService, private prisma: PrismaService) {}

  async assertAllowed(currency: Currency, stake: number, userIds: string[]) {
    if (!Number.isInteger(stake) || stake < 0) throw new AppError('BAD_STAKE', 'Invalid stake');
    if (stake === 0) return;
    const [f, game, economy] = await Promise.all([this.settings.effectiveFeatures(), this.settings.get('game'), this.settings.get('economy')]);
    if (currency === 'FUN' && !f.funStakesEnabled) throw new AppError('STAKES_DISABLED', 'Practice-chip stakes are disabled', 403);
    if (currency === 'BLOT' && !f.blotStakesEnabled) throw new AppError('STAKES_DISABLED', 'Coin stakes are disabled', 403);
    if (!game.stakeOptions[currency].includes(stake)) throw new AppError('BAD_STAKE', 'This stake is not offered');
    if (stake < economy.limits.stakeMin || stake > economy.limits.stakeMax) throw new AppError('BAD_STAKE', 'Stake is outside the allowed limits');
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nickname: true, restrictions: true } });
    for (const u of users) {
      if ((u.restrictions as any)?.noStakes) throw new AppError('RESTRICTED', `${u.nickname} cannot play for stakes`, 403);
      if ((await this.ledger.balance(u.id, currency)) < BigInt(stake)) throw new AppError('INSUFFICIENT_FUNDS', `${u.nickname} has insufficient balance`, 409);
    }
  }
}
