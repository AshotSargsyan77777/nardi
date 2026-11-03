// Production start without relying on the `next` CLI being on PATH: runs the self-contained
// standalone server produced by `next build` (output: 'standalone').
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(app, '.next/standalone/apps/web');
const server = join(standalone, 'server.js');
if (!existsSync(server)) {
  console.error('Standalone build not found — run `npm run build` first.');
  process.exit(1);
}
// the standalone bundle does not include static assets; copy them next to the server once
for (const [from, to] of [[join(app, '.next/static'), join(standalone, '.next/static')], [join(app, 'public'), join(standalone, 'public')]]) {
  if (existsSync(from) && !existsSync(to)) cpSync(from, to, { recursive: true });
}
process.env.HOSTNAME = '0.0.0.0';
process.env.PORT ||= '3000';
await import(pathToFileURL(server).href);
