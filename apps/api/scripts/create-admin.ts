/**
 * Create (or promote) an administrator.
 *   npm run create-admin -w @nardi/api -- --email owner@example.com --nickname Owner --role SUPERADMIN
 * The password is read from the ADMIN_PASSWORD env var or prompted (never passed as an argument).
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient, Role } from '@prisma/client';
import { createHash } from 'crypto';
import * as readline from 'readline';

const prisma = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function promptHidden(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as any)._writeToOutput = (s: string) => { if (s.includes(q)) (rl as any).output.write(s); };
  return new Promise((res) => rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); }));
}

async function main() {
  const email = arg('email')?.toLowerCase();
  let nickname = arg('nickname') ?? 'Admin';
  const role = (arg('role') ?? 'SUPERADMIN') as Role;
  if (!email) throw new Error('--email is required');
  if (!['ADMIN', 'SUPERADMIN', 'SUPPORT'].includes(role)) throw new Error('--role must be SUPPORT, ADMIN or SUPERADMIN');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role === role) {
    console.log(`${role} ${email} already exists — nothing to do`);
    return;
  }
  // pick a free nickname if the requested one is taken by another account
  if (!existing) {
    const base = nickname;
    for (let i = 2; await prisma.user.findUnique({ where: { nicknameLower: nickname.toLowerCase() } }); i++) nickname = `${base}${i}`;
  }
  const password = existing ? undefined : process.env.ADMIN_PASSWORD || (await promptHidden('Password (min 12 chars): '));
  if (!existing && (!password || password.length < 12)) throw new Error('Admin password must be at least 12 characters');

  await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { role, tokenVersion: { increment: 1 } } })
      : await tx.user.create({
          data: {
            email, nickname, nicknameLower: nickname.toLowerCase(), role,
            passwordHash: await hash(password!, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
            settings: { notifications: { matchInvites: true, payments: true, news: false }, privacy: { showProfile: false, showHistory: false, showOnLeaderboard: false }, chatEnabled: true },
          },
        });
    for (const c of ['BLOT', 'FUN']) {
      await tx.$executeRaw`INSERT INTO "LedgerAccount" (id, type, currency, "userId", "matchId", "allowNegative", balance, "createdAt")
        VALUES (gen_random_uuid(), 'USER_WALLET'::"AccountType", ${c}, ${user.id}::uuid, NULL, false, 0, now())
        ON CONFLICT ("type", "currency", "userId", "matchId") DO NOTHING`;
    }
    // audit entry (hash-chained like the application does)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727274)`;
    const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' } });
    const prevHash = last?.hash ?? '0'.repeat(64);
    const createdAt = new Date();
    const canon = (v: any): string => v === null || typeof v !== 'object' ? JSON.stringify(v ?? null) : Array.isArray(v) ? `[${v.map(canon).join(',')}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    const after = { role, email };
    const hashHex = createHash('sha256').update(prevHash).update(canon([null, existing ? 'admin.promote' : 'admin.create', 'user', user.id, null, after, createdAt.toISOString()])).digest('hex');
    await tx.auditLog.create({ data: { actorId: null, actorRole: 'cli', action: existing ? 'admin.promote' : 'admin.create', targetType: 'user', targetId: user.id, after, prevHash, hash: hashHex, createdAt } });
    console.log(`${existing ? 'Promoted' : 'Created'} ${role}: ${email} (${user.id})`);
  });
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
