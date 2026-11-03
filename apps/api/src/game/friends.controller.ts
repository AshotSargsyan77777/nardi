import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { FriendsService } from './friends.service';

class InviteDto {
  @IsString() @Length(6, 6) roomCode!: string;
}

@Controller('friends')
export class FriendsController {
  constructor(private friends: FriendsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.friends.list(u.id);
  }

  @Post(':nickname') @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  request(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string) {
    return this.friends.request(u.id, nickname);
  }

  @Post(':nickname/accept') @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string) {
    return this.friends.accept(u.id, nickname);
  }

  @Delete(':nickname')
  remove(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string) {
    return this.friends.remove(u.id, nickname);
  }

  @Post(':nickname/invite') @HttpCode(200) @Throttle({ default: { limit: 20, ttl: 60_000 } })
  invite(@CurrentUser() u: AuthUser, @Param('nickname') nickname: string, @Body() dto: InviteDto) {
    return this.friends.invite(u.id, nickname, dto.roomCode);
  }
}
