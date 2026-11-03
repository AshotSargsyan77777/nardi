# Security & fair play

| Requirement | Implementation |
| --- | --- |
| Password hashing | argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1 — OWASP baseline); constant-ish time for unknown accounts |
| Sessions | 15-min access JWT (audience `access`, embeds `tokenVersion`) in httpOnly `SameSite=Lax` cookie; opaque 48-byte refresh tokens stored as SHA-256, rotated on every use, reuse revokes the whole family and raises a `REFRESH_TOKEN_REUSE` flag. Blocking a user or changing password/role bumps `tokenVersion` → all access tokens die immediately |
| CSRF | double-submit cookie (`bb_csrf` + `X-CSRF-Token`, constant-time compare) on every cookie-authenticated non-GET request; webhooks exempt (HMAC-authenticated) |
| XSS | React escaping everywhere; chat is plain text (control/bidi characters stripped, length-limited, basic profanity filter); no `dangerouslySetInnerHTML`; security headers (nosniff, frame DENY, referrer policy) from Next, Helmet and Nginx |
| SQL injection | Prisma query builder; raw SQL only via tagged templates (parameterised) |
| Input validation | `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`; DTOs with class-validator; engine re-validates every game action; JSON body limit 64 KB; WS payload limit 16 KB |
| Rate limiting | global 240 req/min/IP, register 5/min, login 10/min + 15-min lockout after 10 failures, refresh 30/min, password 5/min, tickets 5/h; per-socket token bucket (20 burst, 10/s); chat 1 msg/s; Nginx edge limits |
| Authorisation | global `AuthGuard` (deny by default, `@Public()` opt-out) + hierarchical `@Roles()`; super-admin-only role changes and money-mode switches; membership checks for rooms/matches/chat |
| Game integrity | server-authoritative engine; per-match mutex; `version` check (stale/duplicate rejected); `actionId` idempotency; optimistic DB lock on `Match.version`; per-player projections never include other hands or the deck; CSPRNG shuffle + commit–reveal; append-only `MatchEvent` log; frozen finished matches; `resultHash` |
| Financial integrity | double-entry ledger, unique idempotency keys, row locks in fixed order, DB triggers for balance/zero-sum/chain/immutability, no direct balance edits possible, admin adjustments require a reason and are audited, order price snapshots immutable, webhook HMAC + timestamp tolerance + event dedupe, coins credited only from verified webhooks, refunds/withdrawals through the ledger with holds (no double spend / double withdrawal) |
| Audit | hash-chained `AuditLog` (append-only; verify in Admin → Monitoring) for settings, rates, packages, currencies, balances, roles, blocks, KYC, refunds, withdrawals, match cancellations |
| Monitoring | `SuspiciousFlag` (brute force, token reuse, invalid webhook signatures, amount mismatch, shared IPs in stake matches, large withdrawals); `ErrorLog` for 5xx; admin analytics |
| Secrets | env only; production boot refuses weak/default secrets, the sandbox payment provider and non-secure cookies |
| Card data | never touches our servers (hosted checkout + webhooks) |
| Backups | `scripts/backup.sh` / compose `backup` profile; see DEPLOYMENT.md |

## What the platform deliberately does **not** contain

No hidden win-rate adjustment, no card substitution, no house-favouring dealing, no ability for admins
to edit finished matches or ledger history (blocked in the database, not only in code). Bots never
play for stakes and never see hidden information.

## Recommended before production

- TLS everywhere (HSTS), WAF/CDN in front of Nginx, provider IP allow-listing for webhooks.
- Ship logs to a central store (stdout JSON from the API is ready for Loki/ELK/CloudWatch).
- Penetration test and dependency scanning in CI (`npm audit`, Dependabot).
- Email verification / 2FA for admins (not yet implemented — see STATUS.md).
