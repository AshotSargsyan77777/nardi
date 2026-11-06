import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RoomSettings } from '@nardi/engine';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { deckCommitment, rollsCommitment } from './fairness';
import { MatchService } from './match.service';
import { baseRules, editableKeys } from './rooms.service';
import { gameOf, seatCount } from '@nardi/engine';
import { MatchmakingService } from './matchmaking.service';
import { RoomsService } from './rooms.service';

class RoomSettingsDto {
  @IsOptional() @IsObject() rules?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) stake?: number;
  @IsOptional() @IsIn(['FUN']) currency?: 'FUN';
  @IsOptional() @IsBoolean() chatEnabled?: boolean;
  @IsOptional() @IsBoolean() allowBots?: boolean;
}
class JoinDto {
  @IsOptional() @IsInt() @Min(0) @Max(3) seat?: number;
}
class SeatDto {
  @IsInt() @Min(0) @Max(3) seat: number;
}
class ReadyDto {
  @IsBoolean() ready: boolean;
}
class PracticeDto {
  @IsOptional() @IsObject() rules?: Record<string, unknown>;
}

@Controller()
export class GameController {
  constructor(
    private rooms: RoomsService,
    private matches: MatchService,
    private mm: MatchmakingService,
    private settings: SettingsService,
    private prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------- rooms
  @Post('rooms')
  create(@CurrentUser() u: AuthUser, @Body() dto: RoomSettingsDto) {
    return this.rooms.create(u.id, dto as Partial<RoomSettings>);
  }
  @Get('rooms/mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.rooms.myOpenRooms(u.id);
  }
  @Get('rooms/:code')
  get(@Param('code') code: string) {
    return this.rooms.get(code);
  }
  @Post('rooms/:code/join') @HttpCode(200)
  join(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: JoinDto) {
    return this.rooms.join(u.id, code, dto.seat);
  }
  @Post('rooms/:code/leave') @HttpCode(200)
  leave(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.rooms.leave(u.id, code);
  }
  @Post('rooms/:code/seat') @HttpCode(200)
  seat(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: SeatDto) {
    return this.rooms.moveSeat(u.id, code, dto.seat);
  }
  @Post('rooms/:code/ready') @HttpCode(200)
  ready(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: ReadyDto) {
    return this.rooms.setReady(u.id, code, dto.ready);
  }
  @Post('rooms/:code/bots') @HttpCode(200)
  bot(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: SeatDto) {
    return this.rooms.addBot(u.id, code, dto.seat);
  }
  @Delete('rooms/:code/seats/:seat')
  kick(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('seat', ParseIntPipe) seat: number) {
    return this.rooms.removeSeat(u.id, code, seat);
  }
  @Patch('rooms/:code/settings')
  settingsUpdate(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() dto: RoomSettingsDto) {
    return this.rooms.updateSettings(u.id, code, dto as Partial<RoomSettings>);
  }
  @Post('rooms/:code/start') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.rooms.start(u.id, code);
  }
  @Post('rooms/:code/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.rooms.cancel(u.id, code);
  }

  // ---------------------------------------------------------------- matches
  /** Free practice against clearly labelled bots (practice chips, no stake, unranked). */
  @Post('matches/practice')
  async practice(@CurrentUser() u: AuthUser, @Body() dto: PracticeDto) {
    const f = await this.settings.effectiveFeatures();
    if (!f.practiceBotsEnabled) throw new AppError('PRACTICE_DISABLED', 'Practice mode is disabled', 403);
    const existing = this.matches.activeMatchOf(u.id);
    if (existing) return { matchId: existing, resumed: true };
    const game = await this.settings.get('game');
    const kind = gameOf(dto.rules ?? {});
    const rules: any = { ...baseRules(kind, game.defaultRules), game: kind };
    for (const k of editableKeys(kind, game.hostEditableRules)) if (dto.rules && k in dto.rules) rules[k] = dto.rules[k];
    const matchId = await this.matches.create({
      mode: 'PRACTICE', rules, stake: 0, currency: 'FUN', ranked: false, chatEnabled: false,
      // the player and bots for the other seats (blot: three bots, the partner opposite)
      seats: [{ userId: u.id }, ...Array.from({ length: seatCount(kind) - 1 }, (_, i) => ({ botName: MatchService.botName(Math.floor(Math.random() * 8) + i) }))],
    });
    return { matchId, resumed: false };
  }

  @Get('matches/active')
  active(@CurrentUser() u: AuthUser) {
    return { matchId: this.matches.activeMatchOf(u.id) };
  }

  @Get('matches/:id/state')
  state(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.matches.dto(id, u.id);
  }

  /** Finished-match summary for participants, including the revealed dice for fairness verification. */
  @Get('matches/:id')
  async summary(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const m = await this.prisma.match.findUnique({ where: { id }, include: { players: { include: { user: { select: { nickname: true, avatar: true } } } } } });
    if (!m || !m.players.some((p) => p.userId === u.id)) throw new AppError('NOT_FOUND', 'Match not found', 404);
    const st: any = m.state;
    const done = m.status !== 'ACTIVE';
    const currentGame = done ? null : st.engine?.handNumber ?? null;
    return {
      id: m.id, mode: m.mode, status: m.status, stake: Number(m.stake), currency: m.currency, ranked: m.ranked, startedAt: m.startedAt, finishedAt: m.finishedAt,
      durationSec: m.durationSec, scores: [m.scoreTeam0, m.scoreTeam1], winnerTeam: m.winnerTeam, finishReason: m.finishReason, resultHash: m.resultHash,
      rules: m.rules, hands: st.engine?.history ?? [],
      players: m.players.sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, team: p.team, nickname: p.user?.nickname ?? p.botName, avatar: p.user?.avatar ?? 'bot', isBot: p.isBot, result: p.result, ratingBefore: p.ratingBefore, ratingAfter: p.ratingAfter, xpGained: p.xpGained })),
      // nardi dice (per game) or blot decks (per hand); the one in play stays hidden
      fairness: (st.fairness ?? []).filter((f: any) => (f.deck ? f.hand : f.game) !== currentGame).map((f: any) => ({ ...f, verified: (f.deck ? deckCommitment(f.salt, f.deck) : rollsCommitment(f.salt, f.rolls)) === f.commitment })),
    };
  }

  /** Everything needed to replay a finished match move by move (participants only). */
  @Get('matches/:id/replay')
  async replay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const m = await this.prisma.match.findUnique({ where: { id }, include: { players: { include: { user: { select: { nickname: true, avatar: true } } } } } });
    if (!m || !m.players.some((p) => p.userId === u.id)) throw new AppError('NOT_FOUND', 'Match not found', 404);
    if (m.status === 'ACTIVE') throw new AppError('MATCH_ACTIVE', 'The match is still being played', 409);
    const events = await this.prisma.matchEvent.findMany({
      where: { matchId: id, type: { in: ['game_started', 'rolled', 'no_moves', 'moved', 'game_won', 'match_finished'] } },
      orderBy: { seq: 'asc' },
      select: { type: true, payload: true },
    });
    return {
      id: m.id, rules: m.rules, scores: [m.scoreTeam0, m.scoreTeam1], winnerTeam: m.winnerTeam, finishReason: m.finishReason,
      players: m.players.sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, userId: p.userId, nickname: p.user?.nickname ?? p.botName, avatar: p.user?.avatar ?? 'bot', isBot: p.isBot })),
      events: events.map((e) => ({ type: e.type, ...(e.payload as object) })),
    };
  }

  // ---------------------------------------------------------------- matchmaking (REST fallbacks; realtime goes through the socket)
  @Get('matchmaking/status')
  mmStatus(@CurrentUser() u: AuthUser) {
    return this.mm.status(u.id);
  }
  @Get('matchmaking/queues')
  async queues() {
    return { sizes: await this.mm.queueSizes() };
  }
}
