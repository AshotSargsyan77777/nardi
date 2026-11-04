import { PushService } from './common/push.service';
import { QuestsService } from './users/quests.service';
import { ReferralsService } from './users/referrals.service';
import { FriendsController } from './game/friends.controller';
import { FriendsService } from './game/friends.service';
import { BlocksService } from './users/blocks.service';
import { ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { MailService } from './common/mail.service';
import { AuditService } from './common/audit.service';
import { AllExceptionsFilter } from './common/errors';
import { AuthGuard, CsrfGuard } from './common/guards';
import { PrismaService } from './common/prisma.service';
import { RedisService } from './common/redis.service';
import { ENV, Env, loadEnv } from './config/env';
import { GameController } from './game/game.controller';
import { GameGateway } from './game/game.gateway';
import { MatchService } from './game/match.service';
import { MatchmakingService } from './game/matchmaking.service';
import { RealtimeService } from './game/realtime.service';
import { RoomsService } from './game/rooms.service';
import { StakePolicy } from './game/stake-policy.service';
import { LedgerService } from './ledger/ledger.service';
import { WalletService } from './ledger/wallet.service';
import { PublicConfigController } from './settings/public.controller';
import { SettingsService } from './settings/settings.service';
import { SupportController } from './support/support.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Injectable()
class HttpThrottlerGuard extends ThrottlerGuard {
  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true; // sockets have their own token bucket
    return super.canActivate(ctx);
  }
}

@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 240) }] }),
  ],
  controllers: [
    AuthController, UsersController, PublicConfigController, GameController, AdminController, SupportController, FriendsController,
  ],
  providers: [
    { provide: ENV, useFactory: loadEnv },
    PrismaService, RedisService, AuditService, MailService, SettingsService, BlocksService, FriendsService, QuestsService, ReferralsService, PushService, LedgerService, WalletService, AuthService, UsersService,
    RealtimeService, StakePolicy, MatchService, RoomsService, MatchmakingService, GameGateway, AdminService,
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
