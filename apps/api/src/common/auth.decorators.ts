import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Role } from '@prisma/client';

export const IS_PUBLIC = 'isPublic';
export const SKIP_CSRF = 'skipCsrf';
export const ROLES = 'roles';

/** Route does not require authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route is called by third parties (webhooks) and cannot carry a CSRF token. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);
/** Minimum role required (hierarchical: USER < SUPPORT < ADMIN < SUPERADMIN). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  id: string;
  role: Role;
  nickname: string;
  restrictions: { noStakes?: boolean; chatBanned?: boolean; noPurchases?: boolean };
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
});

export const ROLE_RANK: Record<Role, number> = { USER: 0, SUPPORT: 1, ADMIN: 2, SUPERADMIN: 3 };
