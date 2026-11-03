import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { KycStatus, Role } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth.decorators';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { jsonSafe, page } from '../common/util';
import { MatchService } from '../game/match.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { AdminService } from './admin.service';

class ReasonDto { @IsString() @Length(3, 500) reason: string }
class RoleDto { @IsIn(['USER', 'SUPPORT', 'ADMIN', 'SUPERADMIN']) role: Role }
class KycDto { @IsIn(['NONE', 'PENDING', 'VERIFIED', 'REJECTED']) status: KycStatus }
class RestrictionsDto {
  @IsOptional() @IsBoolean() noStakes?: boolean;
  @IsOptional() @IsBoolean() chatBanned?: boolean;
  @IsOptional() @IsBoolean() noPurchases?: boolean;
}
class AdjustDto {
  @IsIn(['BLOT', 'FUN']) currency: 'BLOT' | 'FUN';
  @IsInt() amount: number;
  @IsString() @Length(5, 300) reason: string;
  @IsString() @Length(8, 64) idempotencyKey: string;
}
class ReplyDto { @IsString() @Length(1, 4000) reply: string }

const admin = (u: AuthUser, ip: string) => ({ id: u.id, role: u.role, ip });

@Controller('admin')
@Roles('SUPPORT')
export class AdminController {
  constructor(
    private admin: AdminService,
    private settings: SettingsService,
    private matches: MatchService,
    private ledger: LedgerService,
    private audit: AuditService,
    private prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------- analytics
  @Get('analytics/overview') overview() { return this.admin.overview(); }

  // -------------------------------------------------------------- users
  @Get('users') users(@Query() q: any) { const p = page(q); return this.admin.users(q.q, p.skip, p.take); }
  @Get('users/:id') user(@Param('id', ParseUUIDPipe) id: string) { return this.admin.user(id); }

  @Post('users/:id/block') @Roles('ADMIN') @HttpCode(200)
  block(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.setStatus(id, 'BLOCKED', d.reason, admin(u, ip)); }
  @Post('users/:id/unblock') @Roles('ADMIN') @HttpCode(200)
  unblock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.setStatus(id, 'ACTIVE', '', admin(u, ip)); }
  @Post('users/:id/remove-photo') @HttpCode(200)
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.removePhoto(id, admin(u, ip)); }
  @Patch('users/:id/role') @Roles('SUPERADMIN')
  role(@Param('id', ParseUUIDPipe) id: string, @Body() d: RoleDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.setRole(id, d.role, admin(u, ip)); }
  @Patch('users/:id/restrictions') @Roles('ADMIN')
  restrictions(@Param('id', ParseUUIDPipe) id: string, @Body() d: RestrictionsDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.setRestrictions(id, d, admin(u, ip)); }
  @Patch('users/:id/kyc') @Roles('ADMIN')
  kyc(@Param('id', ParseUUIDPipe) id: string, @Body() d: KycDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.setKyc(id, d.status, admin(u, ip)); }
  @Post('users/:id/adjust') @Roles('ADMIN') @HttpCode(200)
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body() d: AdjustDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.adjustBalance(id, d, admin(u, ip)); }

  // -------------------------------------------------------------- economy
  @Get('settings') async allSettings() {
    const history = await this.prisma.settingChange.findMany({ orderBy: { id: 'desc' }, take: 100 });
    return { settings: await this.settings.all(), effective: await this.settings.effectiveFeatures(), history: jsonSafe(history) };
  }
  @Put('settings/:key') @Roles('ADMIN')
  setSetting(@Param('key') key: string, @Body() body: any, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    if (!['features', 'economy', 'game', 'legal'].includes(key)) throw new AppError('BAD_SETTING', 'Unknown setting');
    return this.settings.update(key as any, body, { id: u.id, role: u.role }, ip);
  }
  @Get('economy/emission') async emission() { return { accounts: await this.ledger.emission(), check: await this.ledger.verify() }; }
  @Get('ledger/transactions') ledgerTx(@Query() q: any) { const p = page(q); return this.admin.ledgerTransactions(q, p.skip, p.take); }

  // -------------------------------------------------------------- games
  @Get('matches') matchesList(@Query() q: any) { const p = page(q); return this.admin.matchesList(q.status, p.skip, p.take); }
  @Get('matches/:id') match(@Param('id', ParseUUIDPipe) id: string) { return this.admin.matchDetail(id); }
  @Post('matches/:id/cancel') @Roles('ADMIN') @HttpCode(200)
  cancelMatch(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.matches.cancel(id, d.reason, admin(u, ip)); }
  @Get('rooms') async rooms() {
    return jsonSafe(await this.prisma.room.findMany({ where: { status: { in: ['WAITING', 'READY', 'PLAYING'] } }, include: { members: { include: { user: { select: { nickname: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 }));
  }

  // -------------------------------------------------------------- monitoring
  @Get('flags') flags(@Query() q: any) { const p = page(q); return this.admin.flags(q.open !== 'false', p.skip, p.take); }
  @Post('flags/:id/resolve') @Roles('ADMIN') @HttpCode(200)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.admin.resolveFlag(id, d.reason, admin(u, ip)); }
  @Get('errors') errors(@Query() q: any) { const p = page(q); return this.admin.errors(p.skip, p.take); }
  @Get('audit') auditLog(@Query() q: any) { const p = page(q); return this.admin.auditLog(q, p.skip, p.take); }
  @Get('audit/verify') verifyAudit() { return this.audit.verify(); }

  // -------------------------------------------------------------- support
  @Get('tickets') async tickets(@Query('status') status?: string) {
    return this.prisma.supportTicket.findMany({ where: status ? { status: status as any } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { nickname: true, email: true } } } });
  }
  @Post('tickets/:id/reply') @HttpCode(200)
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReplyDto, @CurrentUser() u: AuthUser) {
    const t = await this.prisma.supportTicket.update({ where: { id }, data: { reply: d.reply, repliedBy: u.id, status: 'ANSWERED' } });
    await this.prisma.notification.create({ data: { userId: t.userId, type: 'support', title: 'support.answered', body: t.subject, data: { ticketId: t.id } } });
    return t;
  }
}
