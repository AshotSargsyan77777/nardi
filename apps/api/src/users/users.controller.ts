import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { AppError } from '../common/errors';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { page } from '../common/util';
import { Currency, LedgerService } from '../ledger/ledger.service';
import { WalletService } from '../ledger/wallet.service';
import { BlocksService } from './blocks.service';
import { ReferralsService } from './referrals.service';
import { QuestsService } from './quests.service';
import { PushService } from '../common/push.service';
import { ACHIEVEMENTS, AVATARS, UsersService } from './users.service';

class ProfileDto {
  @IsOptional() @IsString() @Length(3, 20) nickname?: string;
  @IsOptional() @IsString() avatar?: string;
  @IsOptional() @IsIn(['hy', 'ru', 'en']) locale?: string;
}
class ReportDto {
  @IsString() @Length(2, 20) reason!: string;
  @IsOptional() @IsString() @MaxLength(1000) details?: string;
  @IsOptional() @IsString() @MaxLength(40) matchId?: string;
}
class PushKeysDto {
  @IsString() @MaxLength(200) p256dh!: string;
  @IsString() @MaxLength(100) auth!: string;
}
class PushSubDto {
  @IsString() @MaxLength(1000) endpoint!: string;
  @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}
class PushUnsubDto {
  @IsString() @MaxLength(1000) endpoint!: string;
}
class PhotoDto {
  @IsString() @MaxLength(360_000) image!: string;
}
class SettingsDto {
  @IsOptional() @IsObject() notifications?: Record<string, boolean>;
  @IsOptional() @IsObject() privacy?: Record<string, boolean>;
  @IsOptional() @IsBoolean() chatEnabled?: boolean;
}

@Controller()
export class UsersController {
  constructor(private users: UsersService, private ledger: LedgerService, private wallet: WalletService, private prisma: PrismaService, private blocks: BlocksService, private quests: QuestsService, private referrals: ReferralsService, private push: PushService) {}

  @Get('users/me')
  me(@CurrentUser() u: AuthUser) {
    return this.users.me(u.id);
  }

  @Patch('users/me')
  update(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) {
    return this.users.updateProfile(u.id, dto);
  }

  @Post('users/me/photo') @HttpCode(200)
  setPhoto(@CurrentUser() u: AuthUser, @Body() dto: PhotoDto) {
    return this.users.setPhoto(u.id, dto.image);
  }

  @Delete('users/me/photo')
  removePhoto(@CurrentUser() u: AuthUser) {
    return this.users.removePhoto(u.id);
  }

  /** Profile photos are public (like nicknames); each upload has a new id, so they cache forever. */
  @Public() @Get('avatars/:id')
  async avatar(@Param('id') id: string, @Res() res: Response) {
    const p = await this.users.photo(id);
    if (!p) throw new NotFoundException();
    res.set({ 'content-type': p.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
    res.send(Buffer.from(p.data));
  }

  @Patch('users/me/settings')
  settings(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    return this.users.updateSettings(u.id, dto);
  }

  @Get('users/me/blocks')
  myBlocks(@CurrentUser() u: AuthUser) {
    return this.blocks.list(u.id);
  }

  @Post('users/profile/:nickname/block') @HttpCode(200)
  block(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string) {
    return this.blocks.block(u.id, nickname);
  }

  @Delete('users/profile/:nickname/block')
  unblock(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string) {
    return this.blocks.unblock(u.id, nickname);
  }

  @Post('users/profile/:nickname/report') @HttpCode(200)
  report(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string, @Body() dto: ReportDto) {
    return this.blocks.report(u.id, nickname, dto);
  }

  @Public() @Get('push/key')
  pushKey() {
    return { publicKey: this.push.vapidPublicKey() };
  }

  @Post('push/subscribe') @HttpCode(200)
  pushSubscribe(@CurrentUser() u: AuthUser, @Body() dto: PushSubDto) {
    if (!/^https:\/\//.test(dto.endpoint)) throw new AppError('BAD_ENDPOINT', 'Bad push endpoint');
    return this.push.subscribe(u.id, dto);
  }

  @Post('push/unsubscribe') @HttpCode(200)
  pushUnsubscribe(@CurrentUser() u: AuthUser, @Body() dto: PushUnsubDto) {
    return this.push.unsubscribe(u.id, dto.endpoint);
  }

  /** «Invite a friend»: my link code, the reward and the friends who joined. */
  @Get('referrals')
  referralSummary(@CurrentUser() u: AuthUser) {
    return this.referrals.summary(u.id);
  }

  @Get('quests')
  questList(@CurrentUser() u: AuthUser) {
    return this.quests.list(u.id);
  }

  @Post('quests/:id/claim') @HttpCode(200)
  questClaim(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.quests.claim(u.id, id);
  }

  @Get('users/me/stats')
  stats(@CurrentUser() u: AuthUser) {
    return this.users.stats(u.id);
  }

  @Get('users/me/matches')
  matches(@CurrentUser() u: AuthUser, @Query() q: any) {
    const p = page(q, 50);
    return this.users.matchHistory(u.id, p.skip, p.take);
  }

  @Get('users/me/transactions')
  transactions(@CurrentUser() u: AuthUser, @Query() q: any) {
    const p = page(q, 100);
    const currency = ['BLOT', 'FUN'].includes(q.currency) ? (q.currency as Currency) : undefined;
    return this.ledger.history(u.id, { currency, skip: p.skip, take: p.take });
  }

  @Public() @Get('users/catalog')
  catalog() {
    return { achievements: ACHIEVEMENTS, avatars: AVATARS };
  }

  @Public() @Get('users/profile/:nickname')
  profile(@Param('nickname') nickname: string, @CurrentUser() u?: AuthUser) {
    return this.users.publicProfile(nickname, u?.id);
  }

  @Public() @Get('leaderboard')
  leaderboard(@Query() q: any) {
    const p = page(q, 100);
    const variant = q.variant === 'short' || q.variant === 'long' ? q.variant : undefined;
    if (variant) return this.users.seasonLeaderboard(p.skip, p.take, { month: q.season === 'month', variant });
    return q.season === 'month' ? this.users.seasonLeaderboard(p.skip, p.take, { month: true }) : this.users.leaderboard(p.skip, p.take);
  }

  @Get('wallet')
  balances(@CurrentUser() u: AuthUser) {
    return this.wallet.summary(u.id);
  }

  @Post('wallet/daily-bonus') @HttpCode(200)
  daily(@CurrentUser() u: AuthUser) {
    return this.wallet.claimDailyBonus(u.id);
  }

  @Get('notifications')
  async notifications(@CurrentUser() u: AuthUser) {
    const items = await this.prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { unread: items.filter((n) => !n.readAt).length, items };
  }

  @Post('notifications/read') @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
