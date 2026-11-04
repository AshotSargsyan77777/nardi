import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { CLUB_EMBLEMS, ClubsService } from './clubs.service';

class CreateClubDto {
  @IsString() @Length(3, 30) name: string;
  @IsOptional() @IsString() @MaxLength(8) emblem?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
class UpdateClubDto {
  @IsOptional() @IsString() @Length(3, 30) name?: string;
  @IsOptional() @IsString() @MaxLength(8) emblem?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsBoolean() newCode?: boolean;
}

@Controller('clubs')
export class ClubsController {
  constructor(private clubs: ClubsService) {}

  @Get() mine(@CurrentUser() u: AuthUser) {
    return this.clubs.mine(u.id).then((items) => ({ items, emblems: CLUB_EMBLEMS }));
  }
  @Post() @HttpCode(200) create(@CurrentUser() u: AuthUser, @Body() d: CreateClubDto) {
    return this.clubs.create(u.id, d);
  }
  @Get('invite/:code') preview(@Param('code') code: string) {
    return this.clubs.preview(String(code).slice(0, 12));
  }
  @Post('invite/:code/join') @HttpCode(200) join(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.clubs.join(u.id, String(code).slice(0, 12));
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clubs.get(id, u.id);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateClubDto) {
    return this.clubs.update(id, u.id, d);
  }
  @Post(':id/leave') @HttpCode(200) leave(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clubs.leave(id, u.id);
  }
  @Delete(':id/members/:userId') kick(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.clubs.kick(id, u.id, userId);
  }
}
