import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { TournamentsService } from './tournaments.service';

class CreateTournamentDto {
  @IsString() @Length(2, 60) name: string;
  @IsIn(['short', 'long', 'checkers', 'chess']) variant: 'short' | 'long' | 'checkers' | 'chess';
  @IsIn([1, 3, 5, 7]) targetScore: number;
  @IsIn([4, 8, 16, 32]) maxPlayers: number;
  @IsArray() @ArrayMaxSize(3) @IsInt({ each: true }) @Min(0, { each: true }) @Max(1_000_000, { each: true }) prizes: number[];
  @IsDateString() startsAt: string;
  @IsOptional() @IsInt() @Min(2) @Max(32) minPlayers?: number;
}

@Controller()
export class TournamentsController {
  constructor(private tournaments: TournamentsService, private audit: AuditService, private prisma: PrismaService) {}

  @Get('tournaments')
  list(@CurrentUser() u: AuthUser) {
    return this.tournaments.list(u.id);
  }

  @Get('tournaments/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.get(id, u.id);
  }

  @Post('tournaments/:id/join') @HttpCode(200)
  join(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.join(id, u.id);
  }

  @Post('tournaments/:id/leave') @HttpCode(200)
  leave(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.leave(id, u.id);
  }

  // ---------------------------------------------------------------- admin
  @Post('admin/tournaments') @Roles('ADMIN') @HttpCode(200)
  async create(@Body() d: CreateTournamentDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    const t = await this.tournaments.create({ ...d, startsAt: new Date(d.startsAt) });
    await this.audit.log(this.prisma, { actorId: u.id, action: 'admin.tournament_created', targetType: 'tournament', targetId: t.id, ip, after: d as any });
    return { id: t.id };
  }

  @Post('admin/tournaments/:id/cancel') @Roles('ADMIN') @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    await this.audit.log(this.prisma, { actorId: u.id, action: 'admin.tournament_cancelled', targetType: 'tournament', targetId: id, ip });
    return this.tournaments.cancel(id);
  }
}
