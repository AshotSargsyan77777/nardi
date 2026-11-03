import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Equals, IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../common/guards';
import { AppError } from '../common/errors';
import { limit, randomToken } from '../common/util';
import { ENV, Env } from '../config/env';
import { UsersService } from '../users/users.service';
import { AuthService, IssuedTokens } from './auth.service';

class RegisterDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(3, 20) nickname: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsIn(['hy', 'ru', 'en']) locale?: string;
  /** «Invite a friend»: the inviter's nickname from the invite link */
  @IsOptional() @IsString() @MaxLength(40) ref?: string;
  @IsBoolean() @Equals(true, { message: 'You must accept the terms' }) acceptTerms: boolean;
  @IsBoolean() @Equals(true, { message: 'Age confirmation is required' }) ageConfirmed: boolean;
}
class LoginDto {
  @IsString() @Length(3, 254) login: string;
  @IsString() @Length(1, 128) password: string;
}
class PasswordDto {
  @IsString() @Length(1, 128) current: string;
  @IsString() @MinLength(8) @MaxLength(128) next: string;
}

const meta = (req: Request) => ({ ip: req.ip, ua: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService, @Inject(ENV) private env: Env) {}

  private setCookies(res: Response, t: IssuedTokens) {
    const base = { secure: this.env.cookieSecure, sameSite: 'lax' as const, domain: this.env.cookieDomain, path: '/' };
    res.cookie(ACCESS_COOKIE, t.accessToken, { ...base, httpOnly: true, maxAge: this.env.accessTokenTtlSec * 1000 });
    res.cookie(REFRESH_COOKIE, t.refreshToken, { ...base, httpOnly: true, path: '/api/auth', expires: t.refreshExpires });
    res.cookie(CSRF_COOKIE, t.csrfToken, { ...base, httpOnly: false, expires: t.refreshExpires });
  }
  private clearCookies(res: Response) {
    const base = { domain: this.env.cookieDomain };
    res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/auth' });
  }

  /** Issues the CSRF cookie for anonymous visitors (needed before login/register). */
  @Public() @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let token = req.cookies?.[CSRF_COOKIE];
    if (!token) {
      token = randomToken(24);
      res.cookie(CSRF_COOKIE, token, { secure: this.env.cookieSecure, sameSite: 'lax', httpOnly: false, path: '/', domain: this.env.cookieDomain });
    }
    return { csrfToken: token };
  }

  @Public() @Post('register') @Throttle({ default: { limit: limit(5), ttl: 60_000 } })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.register(dto, meta(req));
    this.setCookies(res, tokens);
    return { user: await this.users.me(user.id), accessToken: tokens.accessToken };
  }

  @Public() @Post('login') @HttpCode(200) @Throttle({ default: { limit: limit(10), ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(dto.login, dto.password, meta(req));
    this.setCookies(res, tokens);
    return { user: await this.users.me(user.id), accessToken: tokens.accessToken };
  }

  @Public() @Post('refresh') @HttpCode(200) @Throttle({ default: { limit: limit(30), ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError('BAD_REFRESH', 'Session expired', 401);
    try {
      const { user, tokens } = await this.auth.refresh(token, meta(req));
      this.setCookies(res, tokens);
      return { ok: true, userId: user.id };
    } catch (e) {
      this.clearCookies(res);
      throw e;
    }
  }

  @Public() @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.users.me(u.id);
  }

  @Post('password') @HttpCode(200) @Throttle({ default: { limit: limit(5), ttl: 60_000 } })
  async password(@CurrentUser() u: AuthUser, @Body() dto: PasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.changePassword(u.id, dto.current, dto.next, meta(req));
    this.setCookies(res, tokens);
    return { ok: true };
  }

  /** One-time, 60s ticket used to authenticate the WebSocket connection. */
  @Post('ws-ticket') @HttpCode(200)
  wsTicket(@CurrentUser() u: AuthUser) {
    return this.auth.wsTicket(u.id);
  }
}
