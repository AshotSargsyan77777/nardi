/** Typed, validated environment. The process refuses to start with an unsafe production config. */
function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}
const bool = (name: string, fallback = false) => {
  const v = process.env[name];
  return v === undefined ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase());
};

export function loadEnv() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const env = {
    nodeEnv,
    isProd,
    isTest: nodeEnv === 'test',
    port: Number(process.env.PORT ?? 4000),
    databaseUrl: str('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL || '',
    jwtAccessSecret: str('JWT_ACCESS_SECRET', isProd ? undefined : 'dev-access-secret-change-me-0123456789'),
    wsTicketSecret: str('WS_TICKET_SECRET', isProd ? undefined : 'dev-ws-secret-change-me-0123456789'),
    webOrigin: str('WEB_ORIGIN', 'http://localhost:3000'),
    cookieSecure: bool('COOKIE_SECURE', isProd),
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    /** false | true | number of trusted proxy hops (Railway: 2 — edge proxy + Next.js rewrite). */
    trustProxy: ((v) => (v === undefined || v === '' || v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : true))(process.env.TRUST_PROXY) as boolean | number,
    paymentsProvider: (process.env.PAYMENTS_PROVIDER || 'none') as 'none' | 'test',
    paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    /** Second key of the two-key gate for real-money features. Never enable without legal sign-off. */
    legalMoneyModeApproved: bool('LEGAL_MONEY_MODE_APPROVED', false),
    accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 90),
    botDelayMs: Number(process.env.BOT_DELAY_MS ?? 900),
    /** Outgoing mail (password reset) through Resend; empty = mails are only logged. */
    resendApiKey: process.env.RESEND_API_KEY || '',
    mailFrom: process.env.MAIL_FROM || 'NARDI <no-reply@example.com>',
    internalBaseUrl: process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT ?? 4000}`,
  };

  if (isProd) {
    for (const k of ['jwtAccessSecret', 'wsTicketSecret'] as const) {
      if (env[k].length < 32 || env[k].includes('change-me')) throw new Error(`${k} must be a strong secret (>= 32 chars) in production`);
    }
    if (env.paymentsProvider === 'test') throw new Error('The test payment provider cannot be used in production');
    if (!env.cookieSecure) throw new Error('COOKIE_SECURE must be true in production');
  }
  if (env.paymentsProvider !== 'none' && env.paymentWebhookSecret.length < 16) {
    throw new Error('PAYMENT_WEBHOOK_SECRET (>= 16 chars) is required when a payment provider is enabled');
  }
  return env;
}

export type Env = ReturnType<typeof loadEnv>;
export const ENV = Symbol('ENV');
