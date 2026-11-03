# API reference

Base path: `/api`. JSON in/out. Errors: `{ statusCode, code, message }` with stable `code`s
(e.g. `INSUFFICIENT_FUNDS`, `STALE_STATE`, `NOT_YOUR_TURN`, `ILLEGAL_CARD`, `CSRF`, `LEGAL_GATE`).

**Auth:** httpOnly cookies `bb_at` (access JWT, 15 min) and `bb_rt` (refresh, path `/api/auth`);
non-GET requests from browsers must send `X-CSRF-Token` equal to the `bb_csrf` cookie. API clients
may use `Authorization: Bearer <accessToken>` (returned by login/register) without CSRF.
Roles: `USER < SUPPORT < ADMIN < SUPERADMIN`.

## Public

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | DB/Redis health |
| GET | `/config` | effective feature flags, currencies, allowed room options, legal info |
| GET | `/economy/packages` | active packages with prices (only when purchases are enabled) |
| GET | `/leaderboard?page&pageSize` | rating leaderboard (respects privacy) |
| GET | `/users/profile/:nickname` | public profile (respects privacy) |
| GET | `/users/catalog` | achievements and avatar keys |

## Auth

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | – | issues `bb_csrf` |
| POST | `/auth/register` | `email, nickname, password, birthDate?, locale?, acceptTerms: true, ageConfirmed: true` | 5/min/IP; grants signup bonus via ledger |
| POST | `/auth/login` | `login` (email or nickname), `password` | 10/min/IP; lockout after 10 failures (15 min) |
| POST | `/auth/refresh` | – | rotates refresh token; reuse revokes the family |
| POST | `/auth/logout` | – | |
| GET | `/auth/me` | – | current user (same as `/users/me`) |
| POST | `/auth/password` | `current, next` | revokes all sessions, re-issues tokens |
| POST | `/auth/ws-ticket` | – | one-time 60 s ticket for the WebSocket |

## User

| Method | Path | Description |
| --- | --- | --- |
| GET/PATCH | `/users/me` | profile (`nickname`, `avatar`, `locale`) |
| PATCH | `/users/me/settings` | `notifications{matchInvites,payments,news}`, `privacy{showProfile,showHistory,showOnLeaderboard}`, `chatEnabled` |
| GET | `/users/me/matches?page` | match history |
| GET | `/users/me/transactions?currency&page` | ledger entries of the user's wallets |
| GET | `/wallet` | balances, held coins, currency names, daily bonus status |
| POST | `/wallet/daily-bonus` | practice-chip refill (once per day, when low) |
| GET | `/notifications` · POST `/notifications/read` | notifications |
| POST/GET | `/support/tickets` | create / list own tickets |

## Rooms & matches

| Method | Path | Description |
| --- | --- | --- |
| POST | `/rooms` | create (`rules{…hostEditable}`, `stake`, `currency`, `chatEnabled`, `allowBots`) |
| GET | `/rooms/mine` · `/rooms/:code` | rooms |
| POST | `/rooms/:code/join` `{seat?}` · `/leave` · `/seat {seat}` · `/ready {ready}` | membership |
| POST | `/rooms/:code/bots {seat}` · DELETE `/rooms/:code/seats/:seat` | host: add bot / remove |
| PATCH | `/rooms/:code/settings` | host, before start |
| POST | `/rooms/:code/start` · `/cancel` | host; start is atomic (double-start → 409) |
| POST | `/matches/practice` `{rules?}` | practice vs bots (resumes active match) |
| GET | `/matches/active` · `/matches/:id/state` · `/matches/:id` | active id, live projection, finished summary with revealed decks |
| GET | `/matchmaking/status` · `/matchmaking/queues` | |

## Payments & withdrawals

| Method | Path | Description |
| --- | --- | --- |
| POST | `/payments/orders` `{packageId, clientRequestId}` | idempotent per `clientRequestId`; returns `checkoutUrl` |
| GET | `/payments/orders` · `/payments/orders/:id` · `/payments/orders/:id/receipt` | |
| POST | `/payments/orders/:id/simulate {outcome}` | **sandbox only** (`PAYMENTS_PROVIDER=test`, non-production) |
| POST | `/payments/webhook/:provider` | provider → server; header `x-bb-signature: t=<unix>,v1=<hmac_sha256(secret, "t.body")>`; 5-min tolerance; `(provider,eventId)` dedupe |
| GET | `/withdrawals/eligibility` · `/withdrawals` | |
| POST | `/withdrawals` `{coins, clientRequestId}` | only when legally enabled; KYC + age; coins move to hold |

## Admin (`/admin/*`, SUPPORT read, ADMIN write, SUPERADMIN roles/money mode)

| Method | Path |
| --- | --- |
| GET | `/admin/analytics/overview` |
| GET | `/admin/users?q&page` · `/admin/users/:id` |
| POST | `/admin/users/:id/block {reason}` · `/admin/users/:id/unblock` |
| PATCH | `/admin/users/:id/role {role}` (SUPERADMIN) · `/restrictions {noStakes,chatBanned,noPurchases}` · `/kyc {status}` |
| POST | `/admin/users/:id/adjust {currency, amount, reason, idempotencyKey}` |
| GET/PUT | `/admin/settings` · `/admin/settings/:key` (`features`, `economy`, `game`, `legal`) |
| GET/PATCH | `/admin/currencies` · `/admin/currencies/:code` |
| GET/POST/PATCH | `/admin/packages` · `/admin/packages/:id` |
| GET/POST | `/admin/rates?fiatCurrency` · `/admin/rates {fiatCurrency, coinsPerUnit, reason}` |
| GET | `/admin/economy/emission` (incl. full ledger verification) · `/admin/ledger/transactions?userId&type` |
| GET | `/admin/matches?status` · `/admin/matches/:id` (with event log) · `/admin/rooms` |
| POST | `/admin/matches/:id/cancel {reason}` (refunds stakes) |
| GET | `/admin/payments/orders?status` · `/admin/payments/events` · `/admin/payments/refunds` |
| POST | `/admin/payments/orders/:id/refund {reason}` |
| GET | `/admin/withdrawals?status` · POST `/admin/withdrawals/:id/{approve|reject|process|complete}` `{note?, payoutRef?}` |
| GET | `/admin/flags?open` · POST `/admin/flags/:id/resolve {reason}` |
| GET | `/admin/errors` · `/admin/audit?action&targetId` · `/admin/audit/verify` |
| GET | `/admin/tickets` · POST `/admin/tickets/:id/reply {reply}` |

## WebSocket (Socket.IO, path `/socket.io`)

Connect with `auth: { ticket }` (from `POST /api/auth/ws-ticket`; a new ticket per connection).
Every client→server event takes an ack callback returning a result or `{ error: { code, message } }`.
Per-connection rate limit: 20 burst, 10/s.

| Direction | Event | Payload |
| --- | --- | --- |
| S→C | `session` | `{ userId, nickname }` |
| C→S | `match:sync` | `{ matchId }` → `{ state: MatchDTO }` |
| C→S | `match:action` | `{ matchId, version, actionId, action }`, `action` ∈ `{type:'bid',value:8..16\|'kapot',suit}`, `{type:'pass'\|'contra'\|'recontra'}`, `{type:'play',card:'JH',declare?}` |
| C→S | `match:leave` | `{ matchId }` — forfeits the team |
| S→C | `match:started` | `{ matchId }` |
| S→C | `match:state` | `MatchDTO` — personal view, players, deadline, deck commitment, revealed decks, last events |
| S→C | `match:cancelled` | `{ matchId, reason }` |
| C→S | `room:subscribe` / `room:unsubscribe` | `{ code }` |
| S→C | `room:state` · `room:kicked` | `RoomDTO` · `{ code }` |
| C→S | `mm:join {queue}` · `mm:leave` · `mm:respond {proposalId, accept}` | queues: `casual`, `ranked`, `fun:<n>`, each with `@short` or `@long` |
| S→C | `mm:status` · `mm:declined` · `mm:error` | `MatchmakingStatus` |
| C→S | `chat:send {channel, text}` · `chat:history {channel}` | `channel` = `match:<id>` or `room:<code>`; 200 chars, 1 msg/s |
| S→C | `chat:message` · `chat:history` | `ChatMessageDTO` |

Types: `packages/engine/src/protocol.ts`, `packages/engine/src/view.ts`.
