import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, Env } from '../config/env';

/**
 * Thin key/value + sorted-set facade. Uses Redis when REDIS_URL is set, otherwise an
 * in-process fallback (fine for a single instance / tests; production should set REDIS_URL).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  readonly client: Redis | null;
  private mem = new Map<string, { v: string; exp: number | null }>();
  private zsets = new Map<string, Map<string, number>>();

  constructor(@Inject(ENV) env: Env) {
    this.client = env.redisUrl ? new Redis(env.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false, family: 0 }) : null;
    if (!this.client) this.log.warn('REDIS_URL not set — using in-memory store (single instance only)');
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }

  async set(key: string, value: string, ttlSec?: number) {
    if (this.client) {
      if (ttlSec) await this.client.set(key, value, 'EX', ttlSec);
      else await this.client.set(key, value);
      return;
    }
    this.mem.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : null });
  }

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    const e = this.mem.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return e.v;
  }

  /** Atomically read and delete (one-time tokens). */
  async take(key: string): Promise<string | null> {
    if (this.client) return (await this.client.call('GETDEL', key)) as string | null;
    const v = await this.get(key);
    this.mem.delete(key);
    return v;
  }

  async del(key: string) {
    if (this.client) await this.client.del(key);
    else {
      this.mem.delete(key);
      this.zsets.delete(key);
    }
  }

  async zadd(key: string, score: number, member: string) {
    if (this.client) return void (await this.client.zadd(key, score, member));
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    this.zsets.get(key)!.set(member, score);
  }

  async zrem(key: string, member: string) {
    if (this.client) return void (await this.client.zrem(key, member));
    this.zsets.get(key)?.delete(member);
  }

  async zrangeWithScores(key: string): Promise<{ member: string; score: number }[]> {
    if (this.client) {
      const raw = await this.client.zrange(key, 0, -1, 'WITHSCORES');
      const out: { member: string; score: number }[] = [];
      for (let i = 0; i < raw.length; i += 2) out.push({ member: raw[i], score: Number(raw[i + 1]) });
      return out;
    }
    return [...(this.zsets.get(key) ?? new Map()).entries()].map(([member, score]) => ({ member, score })).sort((a, b) => a.score - b.score);
  }

  async keys(prefix: string): Promise<string[]> {
    if (this.client) {
      const out: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;
        out.push(...batch);
      } while (cursor !== '0');
      return out;
    }
    return [...this.zsets.keys(), ...this.mem.keys()].filter((k) => k.startsWith(prefix));
  }
}
