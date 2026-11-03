import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { cleanText, limit } from '../common/util';
import { RedisService } from '../common/redis.service';

class TicketDto {
  @IsString() @Length(3, 120) subject: string;
  @IsString() @Length(10, 4000) message: string;
}

@Controller()
export class SupportController {
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  @Post('support/tickets') @Throttle({ default: { limit: limit(5), ttl: 3600_000 } })
  create(@CurrentUser() u: AuthUser, @Body() d: TicketDto) {
    return this.prisma.supportTicket.create({ data: { userId: u.id, subject: cleanText(d.subject, 120), message: d.message.slice(0, 4000) } });
  }

  @Get('support/tickets')
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.supportTicket.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
  }

  @Public() @Get('health')
  async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const db = Date.now() - started;
    let redis = 'not-configured';
    if (this.redis.client) redis = (await this.redis.client.ping().catch(() => 'down')) === 'PONG' ? 'ok' : 'down';
    return { status: 'ok', db: `${db}ms`, redis, time: new Date().toISOString() };
  }
}
