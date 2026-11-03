import { existsSync } from 'fs';
import { resolve } from 'path';

/** Load the first local .env found (apps/api/.env, else the monorepo root .env); real env vars win. */
if (process.env.NODE_ENV !== 'test') {
  for (const file of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../.env')]) {
    if (existsSync(file)) {
      try {
        (process as any).loadEnvFile(file);
        break;
      } catch {
        /* ignore malformed files */
      }
    }
  }
}
