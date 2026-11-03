# NARDI

Online nardi for two players: **short nardi** (backgammon style, with hitting) and **long nardi**
(no hitting, everyone starts from the head). Private tables with friends, rating-based random
matchmaking, free practice against labelled bots, matches to 1/3/5/7 points with **mars** (×2),
free game coins with a double-entry ledger, daily quests, invites, push notifications and a full admin
panel. Interface: Armenian (primary), Russian, English.

The platform is free entertainment: coins have no monetary value and cannot be bought or cashed out.

## What is in the box

| Area | Status |
| --- | --- |
| Game engine: short and long nardi, legal-move generation (max dice, bigger die, bar entry, head rule, six-block rule, bearing off), mars, match scoring, bots in three levels | ✅ pure TypeScript, vitest + randomized simulations |
| Fair dice: every game's dice are fixed and SHA-256-committed before it starts, revealed after | ✅ |
| Real-time play (Socket.IO): private rooms, invite links/codes, ready states, chat, quick phrases, reconnection, turn timers, abandon handling, rematch, spectators | ✅ |
| Random matchmaking by rating + level, per game (short / long), with ready-check | ✅ |
| Auth, profiles, photos, stats, levels, achievements, leaderboard, friends, block/report | ✅ |
| Game coins + double-entry ledger, daily bonus, quests, level rewards, invite-a-friend bonus | ✅ |
| Admin panel: users, roles, restrictions, balance adjustments, bonuses, limits, matches, suspicious activity, errors, audit log, analytics | ✅ |
| Docker, Nginx, migrations, backups, CI, Railway | ✅ |

## Repository layout

```
nardi/
├── packages/engine/          # @nardi/engine — rules, move generation, bots, view projection, shared WS protocol types
│   ├── src/{board,rules,game,view,bot,protocol}.ts
│   └── test/engine.test.ts
├── apps/api/                 # @nardi/api — NestJS 11 + Prisma 6 + Socket.IO
│   ├── prisma/               # PostgreSQL schema, migrations, seed
│   ├── src/game/             # match runtime, dice fairness, rooms, matchmaking, gateway
│   └── test/                 # jest: ledger + end-to-end (HTTP + WebSocket)
├── apps/web/                 # @nardi/web — Next.js 15 + React 19 + Tailwind (SVG board)
├── infra/nginx.conf
├── docker-compose.yml
└── docs/
```

## Quick start (local development)

Requirements: Node.js ≥ 20 (22 recommended), PostgreSQL ≥ 15, Redis ≥ 6 (optional for one instance).

```bash
npm install
cp .env.example apps/api/.env          # then edit DATABASE_URL etc.
# create the database (example)
createdb nardi

npm run build:engine                   # shared engine must be built first
cd apps/api
npx prisma migrate deploy              # schema + triggers
npm run seed                           # currencies BLOT/FUN, inactive example packages
ADMIN_PASSWORD='a-long-admin-password' npm run create-admin -- --email you@example.com --nickname Owner
npm run start:dev                      # API on http://localhost:4000

# second terminal
cd apps/web
npm run dev                            # web on http://localhost:3000 (proxies /api to :4000)
```

To try purchases locally, set `PAYMENTS_PROVIDER=test` and `PAYMENT_WEBHOOK_SECRET=<16+ chars>` in
`apps/api/.env`, then in the admin panel: set an AMD rate (Economy → Rate), activate a package, mark
BLOT as purchasable and enable *Coin purchases* (Platform). The sandbox checkout page appears only
with the test provider and never in production.

## Docker

```bash
cp .env.example .env    # set NODE_ENV=production, POSTGRES_PASSWORD, JWT_ACCESS_SECRET, WS_TICKET_SECRET, WEB_ORIGIN
docker compose up -d --build
docker compose run --rm -e ADMIN_PASSWORD='a-long-admin-password' api npm run create-admin -- --email you@example.com --nickname Owner
open http://localhost:8080
```

Backups: `docker compose --profile backup up -d backup` (daily `pg_dump`, 14-day rotation into `./backups`).

## Railway

Ready-made configs: `apps/api/railway.toml`, `apps/web/railway.toml`. Step-by-step guide (Armenian):
[docs/RAILWAY.md](docs/RAILWAY.md).

## Tests

```bash
npm test                                # engine (vitest) + api (jest, needs PostgreSQL)
npm test -w @nardi/engine
npm test -w @nardi/api                  # uses TEST_DATABASE_URL (default: postgres://bazar:bazar@localhost:5432/nardi_test)
```

Latest results and what they cover: [docs/STATUS.md](docs/STATUS.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, data flows, concurrency, scaling
- [docs/GAME_RULES.md](docs/GAME_RULES.md) — implemented rule variant and configurable options
- [docs/DATABASE.md](docs/DATABASE.md) — schema and integrity guarantees
- [docs/API.md](docs/API.md) — REST endpoints and WebSocket events
- [docs/SECURITY.md](docs/SECURITY.md) — security and fair-play measures
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — step-by-step secure deployment, admin creation, backups
- [docs/LEGAL_MODEL.md](docs/LEGAL_MODEL.md) — Mode A / Mode B and the legal gate
- [docs/STATUS.md](docs/STATUS.md) — test results, unfinished integrations, known limitations
