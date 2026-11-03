import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { ENV, Env } from '../config/env';
import { IS_PUBLIC, ROLES, ROLE_RANK, SKIP_CSRF } from './auth.decorators';
import { PrismaService } from './prisma.service';

export const ACCESS_COOKIE = 'bb_at';
export const REFRESH_COOKIE = 'bb_rt';
export const CSRF_COOKIE = 'bb_csrf';

export interface AccessPayload { sub: string; role: Role; tv: number }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
    private prisma: PrismaService,
    @Inject(ENV) private env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.[ACCESS_COOKIE];

    if (token) {
      try {
        const p = await this.jwt.verifyAsync<AccessPayload>(token, { secret: this.env.jwtAccessSecret, audience: 'access' });
        const user = await this.prisma.user.findUnique({
          where: { id: p.sub },
          select: { id: true, role: true, nickname: true, status: true, tokenVersion: true, restrictions: true },
        });
        if (user && user.status === 'ACTIVE' && user.tokenVersion === p.tv) {
          req.user = { id: user.id, role: user.role, nickname: user.nickname, restrictions: user.restrictions ?? {} };
        } else if (user?.status === 'BLOCKED' && !isPublic) {
          throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'Account is blocked' });
        }
      } catch (e) {
        if (e instanceof ForbiddenException) throw e;
        // invalid / expired token -> treated as anonymous
      }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required' });

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length) {
      const min = Math.min(...roles.map((r) => ROLE_RANK[r]));
      if (ROLE_RANK[req.user.role as Role] < min) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    return true;
  }
}

/**
 * Double-submit cookie CSRF protection for cookie-authenticated, state-changing requests.
 * Bearer-token clients (no cookies) are not exposed to CSRF and are skipped.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()])) return true;
    const usesCookies = !!(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
    if (!usesCookies && req.headers.authorization) return true;
    const cookie: string | undefined = req.cookies?.[CSRF_COOKIE];
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || cookie.length !== header.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
      throw new ForbiddenException({ code: 'CSRF', message: 'Invalid CSRF token' });
    }
    return true;
  }
}
