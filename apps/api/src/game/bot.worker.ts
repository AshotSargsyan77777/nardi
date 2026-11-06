import { parentPort } from 'worker_threads';
import { botAny } from '@nardi/engine';

/** Runs one bot decision per message: { id, state, seat } → { id, action } or { id, error }. */
parentPort?.on('message', (m: { id: number; state: any; seat: 0 | 1 }) => {
  try {
    parentPort!.postMessage({ id: m.id, action: botAny(m.state, m.seat) });
  } catch (e: any) {
    parentPort!.postMessage({ id: m.id, error: e?.message ?? String(e) });
  }
});
