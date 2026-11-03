import './load-env';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { ENV, Env } from './config/env';

/** Socket.IO adapter that fans events out through Redis when REDIS_URL is configured (multi-instance). */
class RedisIoAdapter extends IoAdapter {
  private adapterCtor: ReturnType<typeof createAdapter> | null = null;
  connect(url: string) {
    const pub = new Redis(url, { family: 0 });
    const sub = pub.duplicate();
    this.adapterCtor = createAdapter(pub, sub);
  }
  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, maxHttpBufferSize: 16_000, pingInterval: 20_000, pingTimeout: 20_000 });
    if (this.adapterCtor) server.adapter(this.adapterCtor);
    return server;
  }
}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: process.env.NODE_ENV === 'test' ? ['error', 'warn'] : ['log', 'error', 'warn'] });
  const env = app.get<Env>(ENV);
  if (env.trustProxy !== false) app.set('trust proxy', env.trustProxy === true ? 1 : env.trustProxy);
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  // profile photos arrive as a base64 data URL (≤ 256 KB image); everything else stays small
  app.use('/api/users/me/photo', json({ limit: '400kb' }));
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors({ origin: env.webOrigin.split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const adapter = new RedisIoAdapter(app);
  if (env.redisUrl) adapter.connect(env.redisUrl);
  app.useWebSocketAdapter(adapter);
  app.enableShutdownHooks();
  return app;
}

// BigInt values (coins) are serialised as numbers in JSON responses.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

if (require.main === module) {
  createApp()
    .then(async (app) => {
      const env = app.get<Env>(ENV);
      // no host => dual-stack (IPv6 + IPv4) where available; needed for Railway private networking
      await app.listen(env.port);
      Logger.log(`NARDI API listening on :${env.port} (${env.nodeEnv}, payments=${env.paymentsProvider}, moneyMode=${env.legalMoneyModeApproved ? 'APPROVED' : 'off'})`, 'Bootstrap');
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}
