import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { ENV, Env } from '../config/env';
import { SettingsService } from './settings.service';

/** Configuration the web client needs to render only the features that are actually enabled. */
@Controller()
export class PublicConfigController {
  constructor(private settings: SettingsService, private prisma: PrismaService, @Inject(ENV) private env: Env) {}

  @Public() @Get('config')
  async config() {
    const [features, s, currencies] = await Promise.all([this.settings.effectiveFeatures(), this.settings.all(), this.prisma.currency.findMany()]);
    return {
      features,
      // only the free practice chips are shown; there is nothing to buy
      currencies: currencies.filter((c) => c.code === 'FUN').map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
      game: {
        defaultRules: s.game.defaultRules,
        allowedTargetScores: s.game.allowedTargetScores,
        allowedTurnTimeouts: s.game.allowedTurnTimeouts,
        stakeOptions: {
          FUN: features.funStakesEnabled ? s.game.stakeOptions.FUN : [0],
          BLOT: features.blotStakesEnabled ? s.game.stakeOptions.BLOT : [],
        },
        hostEditableRules: s.game.hostEditableRules,
        emotes: s.game.emotes,
      },
      economy: { dailyBonus: s.economy.dailyBonus, fees: s.economy.fees, limits: s.economy.limits, referral: s.economy.referral },
      legal: s.legal,
    };
  }

}
