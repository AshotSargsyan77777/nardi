import { INestApplication } from '@nestjs/common';
import { AnyView, MatchDTO, PlayerView, viewMoveOptions } from '@nardi/engine';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/common/prisma.service';

let migrated = false;
export async function resetDb() {
  if (!migrated) {
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'pipe' });
    migrated = true;
  }
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  const tables = await p.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await p.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await p.currency.createMany({ data: [{ code: 'BLOT', name: 'BLOT COINS', symbol: 'BC' }, { code: 'FUN', name: 'Practice chips', symbol: 'FC' }] });
  await p.$disconnect();
}

export async function bootApp() {
  await resetDb();
  const app = await createApp();
  await app.listen(Number(process.env.PORT), '127.0.0.1');
  return app;
}

export interface TestUser { id: string; nickname: string; agent: ReturnType<typeof request.agent>; csrf: string }

export async function registerUser(app: INestApplication, nickname = `p_${randomUUID().slice(0, 8)}`): Promise<TestUser> {
  const agent = request.agent(app.getHttpServer());
  const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
  const res = await agent.post('/api/auth/register').set('x-csrf-token', csrf).send({ email: `${nickname}@example.com`, nickname, password: 'correct-horse-battery', acceptTerms: true, ageConfirmed: true });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  // the CSRF cookie is rotated at login
  const cookies: string[] = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const newCsrf = cookies.map((c) => /bb_csrf=([^;]+)/.exec(c)?.[1]).find(Boolean) ?? csrf;
  return { id: res.body.user.id, nickname, agent, csrf: newCsrf };
}

export const post = (u: TestUser, url: string, body: any = {}) => u.agent.post(url).set('x-csrf-token', u.csrf).send(body);

export async function connect(u: TestUser): Promise<Socket> {
  const { ticket } = (await post(u, '/api/auth/ws-ticket')).body;
  const s = io(`http://127.0.0.1:${process.env.PORT}`, { path: '/socket.io', auth: { ticket }, transports: ['websocket'], forceNew: true });
  await new Promise<void>((res, rej) => {
    s.once('session', () => res());
    s.once('connect_error', rej);
    s.once('error:auth', (e) => rej(new Error(e.code)));
  });
  return s;
}

/** A legal action for whoever is on move in this view, or null when it is not `view.seat`'s turn. */
export function autoActionFor(view: AnyView): any {
  const v = view as any;
  if (v.status !== 'playing' || v.seat === null || v.turn !== v.seat) return null;
  if (v.game === 'checkers') return { type: 'move', move: v.legal[0].path };
  if (v.game === 'chess') return { type: 'move', move: v.legal[Math.floor(Math.random() * v.legal.length)] };
  if (v.phase === 'roll') return { type: 'roll' };
  const moves: any[] = [];
  while (moves.length < v.movesRequired) moves.push(viewMoveOptions(v as PlayerView, moves)[0]);
  return { type: 'move', moves };
}

/** A naive but legal auto-player for any game. */
export function autoPlay(s: Socket, onState?: (d: MatchDTO) => void) {
  const done = new Promise<MatchDTO>((resolve) => {
    s.on('match:state', (d: MatchDTO) => {
      onState?.(d);
      if (d.view.status === 'finished') return resolve(d);
      const action = autoActionFor(d.view);
      if (action) s.emit('match:action', { matchId: d.matchId, version: d.view.version, actionId: randomUUID(), action });
    });
  });
  return done;
}

export const prismaOf = (app: INestApplication) => app.get(PrismaService);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
