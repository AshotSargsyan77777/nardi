import { ArgumentsHost, BadRequestException, Catch, ConflictException, ExceptionFilter, ForbiddenException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EngineError, RuleConfigError } from '@nardi/engine';
import { PrismaService } from './prisma.service';

export const badRequest = (code: string, message = code) => new BadRequestException({ code, message });
export const forbidden = (code: string, message = code) => new ForbiddenException({ code, message });
export const notFound = (code = 'NOT_FOUND', message = 'Not found') => new NotFoundException({ code, message });
export const conflict = (code: string, message = code) => new ConflictException({ code, message });

/** Domain error that carries a stable code (used by services shared by HTTP and WebSocket). */
export class AppError extends Error {
  constructor(public code: string, message?: string, public status = 400) {
    super(message ?? code);
  }
}

export function toErrorBody(e: any): { status: number; code: string; message: string } {
  if (e instanceof AppError) return { status: e.status, code: e.code, message: e.message };
  if (e instanceof EngineError) return { status: 400, code: e.code, message: e.detail ?? e.code };
  if (e instanceof RuleConfigError) return { status: 400, code: 'BAD_RULES', message: e.message };
  if (e instanceof HttpException) {
    const r: any = e.getResponse();
    const message = typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join('; ') : r?.message ?? e.message;
    return { status: e.getStatus(), code: r?.code ?? (e.getStatus() === 400 ? 'VALIDATION' : HttpStatus[e.getStatus()] ?? 'ERROR'), message };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { status: 409, code: 'CONFLICT', message: 'Already exists' };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Not found' };
  return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
}

/** Central error handler: consistent JSON errors + persistence of server errors for the admin panel. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');
  constructor(private prisma: PrismaService) {}

  catch(e: any, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const body = toErrorBody(e);
    if (body.status >= 500) {
      this.log.error(JSON.stringify({ msg: e?.message, path: req.url, stack: e?.stack?.split('\n').slice(0, 5) }));
      this.prisma.errorLog
        .create({ data: { level: 'error', message: String(e?.message ?? e).slice(0, 2000), stack: e?.stack?.slice(0, 8000), path: req.url, userId: req.user?.id, context: 'http' } })
        .catch(() => undefined);
    }
    res.status(body.status).json({ statusCode: body.status, code: body.code, message: body.message });
  }
}
