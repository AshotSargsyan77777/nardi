# Secure deployment guide

## 1. Prerequisites

- A Linux host or Kubernetes cluster, a domain (e.g. `play.example.am`) and TLS certificates.
- Managed PostgreSQL 16 (automated backups + PITR recommended) and Redis 7 — or the bundled containers.
- Decide the **legal model** first ([LEGAL_MODEL.md](LEGAL_MODEL.md)). Default is Mode A (no money).

## 2. Configure

```bash
git clone <repo> bazar-blot && cd bazar-blot
cp .env.example .env
```

Set at least:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | `https://play.example.am` |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | strong password / managed DB URL with `sslmode=require` |
| `JWT_ACCESS_SECRET`, `WS_TICKET_SECRET` | `openssl rand -base64 48` each (different) |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true` (behind Nginx/LB) |
| `PAYMENTS_PROVIDER` | `none` until a licensed provider adapter is integrated (`test` is refused in production) |
| `LEGAL_MONEY_MODE_APPROVED` | `false` unless legal sign-off exists |

The API refuses to start in production with weak/default secrets, insecure cookies or the sandbox
payment provider.

## 3. Build & start

```bash
docker compose up -d --build        # postgres, redis, migrate (+seed), api, web, nginx
docker compose ps                   # migrate should have exited 0, others healthy
curl -s http://localhost:8080/api/health
```

Without Docker: `npm ci && npm run build`, then `npx prisma migrate deploy` + `npm run seed` in
`apps/api`, run `node apps/api/dist/main.js` and `node apps/web/.next/standalone/apps/web/server.js`
(copy `.next/static` and `public` next to it, as in `apps/web/Dockerfile`) behind `infra/nginx.conf`.

## 4. TLS

Terminate TLS at your load balancer or extend `infra/nginx.conf` with a `listen 443 ssl` server
(certbot/ACME), redirect HTTP→HTTPS and uncomment the HSTS header. Only port 443 should be public;
PostgreSQL and Redis must not be reachable from the internet.

## 5. Create the first administrator

```bash
docker compose run --rm -e ADMIN_PASSWORD='a-very-long-unique-password' api \
  npm run create-admin -- --email owner@example.am --nickname Owner --role SUPERADMIN
```

(Locally: `cd apps/api && ADMIN_PASSWORD=… npm run create-admin -- --email … --nickname …`.)
The password is read from `ADMIN_PASSWORD` or prompted — never passed as an argument. Running the
command for an existing email promotes that account (and invalidates its sessions). The action is
written to the audit log. Create separate `ADMIN`/`SUPPORT` accounts for staff; keep SUPERADMIN
for the owner.

## 6. First-run configuration (admin panel → `/admin`)

1. **Economy → Currencies:** name/symbol of BLOT and FUN.
2. **Economy → Bonuses & limits:** signup bonus, daily practice bonus, limits, fees.
3. **Games → Game settings:** default rule variant, allowed target scores/timers, stake options,
   host-editable rules (see [GAME_RULES.md](GAME_RULES.md)).
4. **Platform:** feature flags (practice bots, registration, stakes). Purchases stay off until a
   payment provider is connected; set a rate and activate packages only after legal review.
5. **Platform → Legal settings:** minimum age, terms version, support e-mail.

## 7. Operations

- **Backups:** `docker compose --profile backup up -d backup` (daily, 14 days) **plus** off-site copies
  or managed-DB snapshots. Test restores (see [DATABASE.md](DATABASE.md)).
- **Monitoring:** `/api/health` for liveness; container logs (JSON-friendly) to your log stack;
  Admin → Monitoring for flags, server errors and audit-chain verification; Admin → Economy for the
  ledger consistency check.
- **Updates:** `git pull && docker compose up -d --build` — the `migrate` service applies new
  migrations before the API starts. Never run `prisma migrate reset` against real data.
- **Scaling:** see "Scaling notes" in [ARCHITECTURE.md](ARCHITECTURE.md).

## 8. Pre-launch checklist

- [ ] Legal model decided and documented; terms & privacy texts reviewed by a lawyer
- [ ] Secrets generated and stored in a secret manager; `.env` not in git
- [ ] TLS + HSTS, only 443 exposed, DB/Redis private
- [ ] Backups automated and a restore tested
- [ ] SUPERADMIN created; staff accounts with least privilege
- [ ] Rule variant confirmed by the owner (Games → Game settings)
- [ ] `npm test` green on the release commit (CI)
