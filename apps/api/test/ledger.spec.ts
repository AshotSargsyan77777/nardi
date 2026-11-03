import { INestApplication } from '@nestjs/common';
import { LedgerService } from '../src/ledger/ledger.service';
import { bootApp, prismaOf, registerUser } from './helpers';

describe('Ledger (double-entry, atomic, idempotent, append-only)', () => {
  let app: INestApplication;
  let ledger: LedgerService;

  beforeAll(async () => {
    app = await bootApp();
    ledger = app.get(LedgerService);
  });
  afterAll(async () => app.close());

  const credit = (userId: string, amount: bigint, key: string) =>
    ledger.post({ type: 'ADMIN_CREDIT', currency: 'BLOT', idempotencyKey: key, entries: [{ account: { type: 'SYSTEM_MINT' }, amount: -amount }, { account: { type: 'USER_WALLET', userId }, amount }] });
  const debit = (userId: string, amount: bigint, key: string) =>
    ledger.post({ type: 'ADMIN_DEBIT', currency: 'BLOT', idempotencyKey: key, entries: [{ account: { type: 'USER_WALLET', userId }, amount: -amount }, { account: { type: 'SYSTEM_MINT' }, amount }] });

  it('gives the configured signup bonus through the ledger', async () => {
    const u = await registerUser(app);
    expect(await ledger.balances(u.id)).toEqual({ BLOT: 0, FUN: 10000 });
    const tx = await prismaOf(app).ledgerTransaction.findUnique({ where: { idempotencyKey: `signup:${u.id}:FUN` } });
    expect(tx?.type).toBe('SIGNUP_BONUS');
  });

  it('is idempotent: the same key never applies twice', async () => {
    const u = await registerUser(app);
    const a = await credit(u.id, 500n, `t:${u.id}:1`);
    const b = await credit(u.id, 500n, `t:${u.id}:1`);
    expect(b.replayed).toBe(true);
    expect(b.transaction.id).toBe(a.transaction.id);
    expect(await ledger.balance(u.id, 'BLOT')).toBe(500n);
  });

  it('serialises concurrent debits and never goes negative', async () => {
    const u = await registerUser(app);
    await credit(u.id, 1000n, `t:${u.id}:seed`);
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => debit(u.id, 100n, `t:${u.id}:d${i}`)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(10);
    expect(results.filter((r) => r.status === 'rejected').every((r: any) => r.reason.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(await ledger.balance(u.id, 'BLOT')).toBe(0n);
  });

  it('rejects unbalanced transactions', async () => {
    const u = await registerUser(app);
    await expect(ledger.post({ type: 'ADMIN_CREDIT', currency: 'BLOT', idempotencyKey: `t:${u.id}:bad`, entries: [{ account: { type: 'USER_WALLET', userId: u.id }, amount: 5n }] })).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
  });

  it('blocks UPDATE/DELETE of ledger rows and direct balance edits at the database level', async () => {
    const prisma = prismaOf(app);
    const u = await registerUser(app);
    await credit(u.id, 50n, `t:${u.id}:imm`);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { account: { userId: u.id, currency: 'BLOT' } } });
    await expect(prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amount: 999n } })).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    const acc = await prisma.ledgerAccount.findFirstOrThrow({ where: { userId: u.id, currency: 'BLOT', type: 'USER_WALLET' } });
    await expect(prisma.ledgerAccount.update({ where: { id: acc.id }, data: { balance: 1_000_000n } })).rejects.toThrow(/does not match its ledger/);
    expect(await ledger.balance(u.id, 'BLOT')).toBe(50n);
  });

  it('keeps the whole ledger consistent (sum of all accounts per currency is zero)', async () => {
    const v = await ledger.verify();
    expect(v.ok).toBe(true);
  });
});
