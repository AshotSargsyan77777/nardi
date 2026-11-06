import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AnyAction, AnyState, Seat, botAny } from '@nardi/engine';
import { existsSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { ENV, Env } from '../config/env';

/**
 * Chess and checkers bots search for up to a second or two. That runs in a worker thread so the
 * API keeps answering everyone else meanwhile. Without the compiled worker (tests) it runs inline.
 */
@Injectable()
export class BotRunner implements OnApplicationShutdown {
  private log = new Logger('BotRunner');
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (a: AnyAction) => void; reject: (e: Error) => void }>();

  constructor(@Inject(ENV) private env: Env) {}

  private start(): Worker | null {
    if (this.worker) return this.worker;
    const file = join(__dirname, 'bot.worker.js');
    if (this.env.isTest || !existsSync(file)) return null;
    const w = new Worker(file);
    w.on('message', (m: { id: number; action?: AnyAction; error?: string }) => {
      const p = this.waiting.get(m.id);
      if (!p) return;
      this.waiting.delete(m.id);
      if (m.action) p.resolve(m.action);
      else p.reject(new Error(m.error ?? 'bot failed'));
    });
    w.on('error', (e) => this.log.error(`bot worker: ${e.message}`));
    w.on('exit', () => {
      this.worker = null;
      for (const p of this.waiting.values()) p.reject(new Error('bot worker stopped'));
      this.waiting.clear();
    });
    w.unref();
    this.worker = w;
    return w;
  }

  think(state: AnyState, seat: Seat): Promise<AnyAction> {
    const w = this.start();
    if (!w) return Promise.resolve(botAny(state, seat));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      w.postMessage({ id, state, seat });
    });
  }

  async onApplicationShutdown() {
    await this.worker?.terminate();
  }
}
