import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, Tx } from './prisma.service';
import { canonicalJson, jsonSafe } from './util';

export interface AuditInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

const GENESIS = '0'.repeat(64);

/**
 * Append-only, hash-chained audit trail. Each row stores the hash of the previous row, so any
 * modification or deletion (also blocked by DB triggers) is detectable with verify().
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  private digest(prevHash: string, d: AuditInput, createdAt: Date) {
    const payload = canonicalJson([d.actorId ?? null, d.action, d.targetType ?? null, d.targetId ?? null, jsonSafe(d.before) ?? null, jsonSafe(d.after) ?? null, createdAt.toISOString()]);
    return createHash('sha256').update(prevHash).update(payload).digest('hex');
  }

  /** Must be called inside the same DB transaction as the change it describes. */
  async log(tx: Tx, d: AuditInput) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727274)`;
    const last = await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = new Date();
    const hash = this.digest(prevHash, d, createdAt);
    return tx.auditLog.create({
      data: {
        actorId: d.actorId ?? null, actorRole: d.actorRole ?? null, action: d.action, targetType: d.targetType, targetId: d.targetId,
        before: (jsonSafe(d.before) ?? undefined) as any, after: (jsonSafe(d.after) ?? undefined) as any, ip: d.ip, prevHash, hash, createdAt,
      },
    });
  }

  async verify(): Promise<{ ok: boolean; checked: number; brokenAt: string | null }> {
    let prev = GENESIS;
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({ orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) break;
      for (const r of rows) {
        const h = this.digest(prev, { actorId: r.actorId, action: r.action, targetType: r.targetType ?? undefined, targetId: r.targetId ?? undefined, before: r.before, after: r.after }, r.createdAt);
        if (r.prevHash !== prev || r.hash !== h) return { ok: false, checked, brokenAt: r.id.toString() };
        prev = r.hash;
        checked++;
      }
      cursor = rows[rows.length - 1].id;
    }
    return { ok: true, checked, brokenAt: null };
  }
}
