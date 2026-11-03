import { Injectable } from '@nestjs/common';
import { AccountType, LedgerTransaction, LedgerTxType, Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';

export type Currency = 'BLOT' | 'FUN';
export const CURRENCIES: Currency[] = ['BLOT', 'FUN'];

export type AccountRef =
  | { type: 'USER_WALLET' | 'WITHDRAWAL_HOLD'; userId: string }
  | { type: 'MATCH_ESCROW'; matchId: string }
  | { type: 'SYSTEM_MINT' | 'SYSTEM_PURCHASES' | 'SYSTEM_FEES' | 'SYSTEM_REDEEMED' | 'SYSTEM_BURN' };

export interface PostInput {
  type: LedgerTxType;
  currency: Currency;
  idempotencyKey: string;
  description?: string;
  refType?: string;
  refId?: string;
  createdById?: string | null;
  metadata?: Record<string, unknown>;
  entries: { account: AccountRef; amount: bigint }[];
}

/** System accounts that represent coin issuance and are therefore allowed to go negative. */
const NEGATIVE_OK: AccountType[] = ['SYSTEM_MINT', 'SYSTEM_PURCHASES'];

/**
 * Double-entry ledger. Every coin movement is a balanced transaction (sum of entries = 0) with a
 * unique idempotency key. Cached balances are updated in the same DB transaction under row locks;
 * DB triggers additionally reject unbalanced transactions, broken running balances, negative
 * balances and any UPDATE/DELETE of ledger rows.
 */
@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  async post(input: PostInput, tx?: Tx): Promise<{ transaction: LedgerTransaction; replayed: boolean }> {
    if (tx) return this.postIn(tx, input);
    return this.prisma.$transaction((t) => this.postIn(t, input), { timeout: 15000 });
  }

  private async postIn(tx: Tx, input: PostInput) {
    if (!input.entries.length) throw new AppError('LEDGER_EMPTY', 'Transaction has no entries');
    const sum = input.entries.reduce((s, e) => s + e.amount, 0n);
    if (sum !== 0n) throw new AppError('LEDGER_UNBALANCED', 'Ledger transaction must balance to zero', 500);
    if (input.entries.some((e) => e.amount === 0n)) throw new AppError('LEDGER_ZERO', 'Zero-amount entry', 500);

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.type !== input.type || existing.currency !== input.currency) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused for a different operation', 409);
      }
      return { transaction: existing, replayed: true };
    }

    const accountIds: string[] = [];
    for (const e of input.entries) accountIds.push(await this.ensureAccount(tx, e.account, input.currency));
    const unique = [...new Set(accountIds)].sort();
    const locked = await tx.$queryRaw<{ id: string; balance: bigint; allowNegative: boolean }[]>`
      SELECT id::text, balance, "allowNegative" FROM "LedgerAccount"
      WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE`;
    const balances = new Map(locked.map((r) => [r.id, { balance: BigInt(r.balance), allowNegative: r.allowNegative }]));

    const delta = new Map<string, bigint>();
    accountIds.forEach((id, i) => delta.set(id, (delta.get(id) ?? 0n) + input.entries[i].amount));
    for (const [id, d] of delta) {
      const acc = balances.get(id)!;
      if (!acc.allowNegative && acc.balance + d < 0n) {
        throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance', 409);
      }
    }

    const transaction = await tx.ledgerTransaction.create({
      data: {
        type: input.type, currency: input.currency, idempotencyKey: input.idempotencyKey, description: input.description,
        refType: input.refType, refId: input.refId, createdById: input.createdById ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    const running = new Map([...balances].map(([id, v]) => [id, v.balance]));
    for (let i = 0; i < input.entries.length; i++) {
      const id = accountIds[i];
      const after = running.get(id)! + input.entries[i].amount;
      running.set(id, after);
      await tx.ledgerEntry.create({ data: { transactionId: transaction.id, accountId: id, amount: input.entries[i].amount, balanceAfter: after } });
    }
    for (const id of delta.keys()) await tx.ledgerAccount.update({ where: { id }, data: { balance: running.get(id)! } });
    return { transaction, replayed: false };
  }

  async ensureAccount(tx: Tx, ref: AccountRef, currency: Currency): Promise<string> {
    const userId = 'userId' in ref ? ref.userId : null;
    const matchId = 'matchId' in ref ? ref.matchId : null;
    const allowNegative = NEGATIVE_OK.includes(ref.type);
    const where = { type: ref.type, currency, userId, matchId };
    const found = await tx.ledgerAccount.findFirst({ where, select: { id: true } });
    if (found) return found.id;
    await tx.$executeRaw`
      INSERT INTO "LedgerAccount" (id, type, currency, "userId", "matchId", "allowNegative", balance, "createdAt")
      VALUES (gen_random_uuid(), ${ref.type}::"AccountType", ${currency}, ${userId}::uuid, ${matchId}::uuid, ${allowNegative}, 0, now())
      ON CONFLICT ("type", "currency", "userId", "matchId") DO NOTHING`;
    return (await tx.ledgerAccount.findFirstOrThrow({ where, select: { id: true } })).id;
  }

  async balance(userId: string, currency: Currency, tx?: Tx): Promise<bigint> {
    const acc = await (tx ?? this.prisma).ledgerAccount.findFirst({ where: { type: 'USER_WALLET', userId, currency, matchId: null } });
    return acc?.balance ?? 0n;
  }

  async balances(userId: string): Promise<Record<Currency, number>> {
    const accs = await this.prisma.ledgerAccount.findMany({ where: { userId, type: 'USER_WALLET' } });
    const out: Record<Currency, number> = { BLOT: 0, FUN: 0 };
    for (const a of accs) out[a.currency as Currency] = Number(a.balance);
    return out;
  }

  /** Wallet movements of a user, newest first. */
  async history(userId: string, opts: { currency?: Currency; skip: number; take: number }) {
    const where: Prisma.LedgerEntryWhereInput = { account: { userId, type: { in: ['USER_WALLET', 'WITHDRAWAL_HOLD'] }, ...(opts.currency ? { currency: opts.currency } : {}) } };
    const [items, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where, orderBy: { id: 'desc' }, skip: opts.skip, take: opts.take,
        include: { transaction: { select: { id: true, type: true, description: true, refType: true, refId: true, createdAt: true } }, account: { select: { currency: true, type: true } } },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return {
      total,
      items: items.map((e) => ({
        id: e.id.toString(), transactionId: e.transactionId, type: e.transaction.type, description: e.transaction.description,
        refType: e.transaction.refType, refId: e.transaction.refId, currency: e.account.currency, account: e.account.type,
        amount: Number(e.amount), balanceAfter: Number(e.balanceAfter), createdAt: e.createdAt,
      })),
    };
  }

  /** Total coins in circulation per currency and account type (admin "emission" view). */
  async emission() {
    const rows = await this.prisma.ledgerAccount.groupBy({ by: ['currency', 'type'], _sum: { balance: true }, _count: { _all: true } });
    return rows.map((r) => ({ currency: r.currency, type: r.type, accounts: r._count._all, balance: Number(r._sum.balance ?? 0n) }));
  }

  /** Full consistency check: every cached balance equals the sum of its entries; all tx balanced. */
  async verify() {
    const mismatched = await this.prisma.$queryRaw<{ id: string; balance: bigint; sum: bigint }[]>`
      SELECT a.id::text, a.balance, COALESCE(SUM(e.amount), 0)::bigint AS sum
      FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
      GROUP BY a.id HAVING a.balance <> COALESCE(SUM(e.amount), 0)`;
    const unbalanced = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "transactionId"::text AS id FROM "LedgerEntry" GROUP BY "transactionId" HAVING SUM(amount) <> 0`;
    const total = await this.prisma.$queryRaw<{ currency: string; sum: bigint }[]>`
      SELECT currency, SUM(balance)::bigint AS sum FROM "LedgerAccount" GROUP BY currency`;
    return {
      ok: mismatched.length === 0 && unbalanced.length === 0 && total.every((t) => BigInt(t.sum) === 0n),
      mismatchedAccounts: mismatched.map((m) => m.id),
      unbalancedTransactions: unbalanced.map((u) => u.id),
      totals: total.map((t) => ({ currency: t.currency, sum: Number(t.sum) })),
    };
  }
}
