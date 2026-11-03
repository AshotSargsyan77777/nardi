import { Prisma } from '@prisma/client';
import { randomBytes, randomInt } from 'crypto';

/** Convert BigInt / Decimal / Date values to JSON-safe primitives. */
export function jsonSafe(v: any): any {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Prisma.Decimal.isDecimal(v)) return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (typeof v === 'object') {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) o[k] = jsonSafe(val);
    return o;
  }
  return v;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function inviteCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function page(q: { page?: any; pageSize?: any }, maxSize = 100) {
  const pageNum = Math.max(1, Number(q.page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(q.pageSize) || 20));
  return { skip: (pageNum - 1) * size, take: size, page: pageNum, pageSize: size };
}

/** Strip control characters and collapse whitespace in user supplied text. */
export function cleanText(s: string, max: number) {
  return s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Deterministic JSON (sorted keys) — jsonb reorders keys, so hashes must not depend on key order. */
export function canonicalJson(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

/** Per-route rate limit; RATE_LIMIT_MULTIPLIER lets automated test suites raise it. */
export const limit = (n: number) => () => n * Number(process.env.RATE_LIMIT_MULTIPLIER ?? 1);
