# Architecture

## Stack

| Layer | Technology | Why |
| --- | --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3, Framer Motion, SWR, socket.io-client | SSR shell, fast client navigation, mobile-first UI with animations |
| API | Node.js 22, NestJS 11, TypeScript, Socket.IO 4 | Structured modules, DI, guards/pipes; WebSocket for game events, REST for everything else |
| Rules | `@bazar/engine` — pure TypeScript, no I/O, no randomness | Same code validates on the server and type-checks the client; exhaustively testable |
| Data | PostgreSQL 16 via Prisma 6 | Transactions, row locks, triggers for immutability and ledger invariants |
| Coordination | Redis 7 (ioredis) | One-time WS tickets, matchmaking queues, Socket.IO adapter for multi-instance broadcast |
| Edge | Nginx | Single origin for web, `/api`, `/socket.io`; edge rate limits; TLS termination point |

## Components

```
Browser ──HTTPS──► Nginx ──► Next.js (pages)            (static + SSR shell)
   │                   └──► NestJS REST  /api/*          (auth, profile, wallet, rooms, admin, payments)
   └──WebSocket────────────► NestJS Socket.IO /socket.io (match actions, rooms, matchmaking, chat)
                                   │
                    ┌──────────────┼───────────────┐
              PostgreSQL         Redis       Payment provider (webhooks → /api/payments/webhook/:provider)
```

### API modules (`apps/api/src`)

- `auth` — registration, login, refresh rotation, logout, password change, WS tickets.
- `users` — profile, settings, history, leaderboard, achievements.
- `settings` — owner-editable configuration (`PlatformSetting`) with change history and the legal gate.
- `economy` — currencies, coin packages, purchase rates (append-only history), price calculation.
- `ledger` — double-entry ledger (`LedgerService.post`) and wallets/daily bonus.
- `payments` — provider abstraction, sandbox provider, orders, receipts, signed webhooks, refunds.
- `withdrawals` — redemption workflow (disabled unless legally enabled).
- `game` — `MatchService` (authoritative runtime), `RoomsService`, `MatchmakingService`, `GameGateway`, fairness (CSPRNG shuffle + commit/reveal), stake policy.
- `admin` — admin API (role-guarded) and analytics.
- `common` — Prisma/Redis services, guards (auth, roles, CSRF), error filter, hash-chained audit log.

## Match lifecycle (server-authoritative)

1. A match is created from a room start, a matchmaking launch, or a practice request.
   In **one DB transaction**: `Match` row, `MatchPlayer` rows, stake escrow ledger transactions
   (if any), and the first `MatchEvent`s (including the dealt deck, salt and commitment — private).
2. The deck is shuffled with `crypto.randomInt` (Fisher–Yates) on the server. The SHA-256 commitment
   `sha256(salt:deck)` is sent to players before play; the deck + salt are revealed after the hand.
3. Clients send intents: `match:action { matchId, version, actionId, action }`.
   - Per-match async mutex serialises processing inside one process.
   - `version` must equal the current engine version (stale/duplicate → `STALE_STATE`, state resent).
   - `actionId` makes retries idempotent.
   - The engine validates turn order and legality (`EngineError` codes).
   - Persistence uses optimistic concurrency: `UPDATE Match … WHERE version = prev AND status = 'ACTIVE'`.
     If another process changed the match, nothing is applied (`CONCURRENT_UPDATE`).
   - Events are appended to `MatchEvent` (append-only) in the same transaction.
4. Each player receives a **personal projection** (`playerView`) — never other hands or the deck.
5. Timers: bots act after a short delay; humans have `turnTimeoutSec`. On timeout the server plays the
   simplest legal move; repeated timeouts while disconnected (3) or overall (6) forfeit the team.
6. Finish: payouts from escrow, ratings (Elo, ranked only), stats, XP, achievements, `resultHash` and
   status `FINISHED` — all in the same transaction as the final move. DB triggers then freeze the
   match and its players.
7. Recovery: on boot `MatchService.recover()` reloads every `ACTIVE` match from `Match.state`.

## Matchmaking

Queues: `casual`, `ranked`, `fun:<stake>`, `blot:<stake>` (only stakes the owner offers).
Entries live in Redis sorted sets keyed by rating. A 1-second loop takes windows of 4 players sorted by
rating whose rating spread ≤ `150 + 25·⌊wait/5s⌋` (max 1500) and level spread ≤ `3 + ⌊wait/10s⌋`.
A proposal requires all four to accept within 15 s; non-acceptors are dropped, others re-queued with
their original wait time. Teams are balanced (strongest + weakest vs. middle two). Disconnected users
are removed from queues.

## Money flows (ledger)

All coin movements are `LedgerService.post()` calls with balanced entries and a unique
`idempotencyKey`. Examples:

| Operation | Entries | Key |
| --- | --- | --- |
| Signup bonus | MINT −N, wallet +N | `signup:<user>:<cur>` |
| Purchase (after verified webhook) | PURCHASES −N, wallet +N | `purchase:<order>` |
| Refund | wallet −N, PURCHASES +N | `refund:<order>` |
| Stake | wallet −S, MATCH_ESCROW +S | `stake:<match>:<user>` |
| Payout | ESCROW −pot, winners +share, FEES +fee | `payout:<match>` |
| Withdrawal hold / release / complete | wallet ↔ WITHDRAWAL_HOLD → REDEEMED | `withdrawal:<id>:…` |
| Admin adjustment | MINT ∓N, wallet ±N (reason required, audited) | `admin-adjust:<uuid>` |

Accounts are locked with `SELECT … FOR UPDATE` in id order (no deadlocks); balances can never go
negative except the two issuance accounts. The sum of all accounts per currency is always zero
(`GET /api/admin/economy/emission` verifies it).

## Scaling notes

- Single API instance: everything works with or without Redis.
- Multiple instances: set `REDIS_URL` (Socket.IO Redis adapter, shared queues/tickets), run the
  matchmaker on exactly one instance (`MATCHMAKER_ENABLED=false` elsewhere), and route each match's
  sockets to the instance that owns it (sticky sessions by user). The DB-level optimistic lock already
  prevents two instances from applying conflicting moves; full match-ownership leasing is listed under
  unfinished work in [STATUS.md](STATUS.md).
