# Database (PostgreSQL)

Source of truth: `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/*`.
Coins are `BIGINT`; fiat prices are integer **minor units**; rates are `NUMERIC(18,6)`.

## Tables

| Group | Table | Purpose |
| --- | --- | --- |
| Identity | `User` | account, role (`USER`/`SUPPORT`/`ADMIN`/`SUPERADMIN`), status, rating/xp/level, stats, settings, restrictions, KYC status, `tokenVersion` |
| | `Session` | hashed refresh tokens, rotation family, revocation |
| Config | `PlatformSetting` | current owner settings (`features`, `economy`, `game`, `legal`) |
| | `SettingChange` | **append-only** history (key, old, new, admin, time) |
| | `Currency` | `BLOT` (purchasable when enabled) and `FUN` (practice, never redeemable); name/symbol editable |
| | `CoinRate` | **append-only** rate history with `previousValue` and admin |
| | `CoinPackage` | packages (coins, bonus, optional fixed price, fiat currency, active) |
| Ledger | `LedgerAccount` | wallets & system accounts with cached `balance` |
| | `LedgerTransaction` | **append-only**; unique `idempotencyKey`, type, reference, admin |
| | `LedgerEntry` | **append-only**; signed `amount`, `balanceAfter` |
| Payments | `PaymentOrder` | immutable price/coin/rate snapshot, status, receipt number, ledger link |
| | `PaymentEvent` | every webhook (valid or not); unique `(provider, eventId)` for replay protection |
| | `Refund` | refunds with ledger link |
| Redemption | `WithdrawalRequest`, `WithdrawalStatusChange` | requests + **append-only** status history |
| Game | `Room`, `RoomMember` | private rooms and seats |
| | `Match` | authoritative engine state (private), version, scores, result hash |
| | `MatchPlayer` | seats, team, rating before/after, result, XP |
| | `MatchEvent` | **append-only**, ordered (`matchId, seq`) game log incl. dealt decks |
| | `Tournament`, `TournamentEntry` | prepared for future tournaments |
| Engagement | `UserAchievement`, `Notification`, `SupportTicket` | |
| Monitoring | `AuditLog` | **append-only**, SHA-256 hash chain (`prevHash` → `hash`) |
| | `SuspiciousFlag` | brute force, refresh reuse, invalid webhook signatures, amount mismatch, shared IPs in stake matches, large withdrawals |
| | `ErrorLog` | server errors (5xx) for the admin panel |

## Ledger account types

`USER_WALLET`, `WITHDRAWAL_HOLD` (per user); `MATCH_ESCROW` (per match); `SYSTEM_MINT` (bonuses,
admin adjustments — may go negative), `SYSTEM_PURCHASES` (sold coins — may go negative),
`SYSTEM_FEES`, `SYSTEM_REDEEMED`, `SYSTEM_BURN`. `(type, currency, userId, matchId)` is unique with
`NULLS NOT DISTINCT`.

## Integrity enforced by the database (migration SQL)

1. **Append-only** tables reject `UPDATE`/`DELETE`: `LedgerEntry`, `LedgerTransaction`, `AuditLog`,
   `MatchEvent`, `SettingChange`, `CoinRate`, `WithdrawalStatusChange`; `LedgerAccount` cannot be deleted.
2. **Balanced transactions**: deferred constraint trigger — the entries of every ledger transaction
   must sum to 0 at commit.
3. **Running balance chain**: each new entry must satisfy `balanceAfter = previous balanceAfter + amount`.
4. **Cached balance = ledger**: at commit, every changed `LedgerAccount.balance` must equal the
   `balanceAfter` of its latest entry — a balance cannot be edited without a ledger entry.
5. **No negative balances**: `CHECK (allowNegative OR balance >= 0)`.
6. **Frozen results**: `FINISHED`/`CANCELLED` matches and their players cannot be modified; matches
   cannot be deleted.
7. **Order snapshots**: coins, bonus, amount, currency, rate and user of a `PaymentOrder` are immutable;
   the ledger link can be set once.

## ER overview

```
User 1─* Session            User 1─* LedgerAccount *─1 (Match)      LedgerTransaction 1─* LedgerEntry *─1 LedgerAccount
User 1─* PaymentOrder 1─* Refund        PaymentOrder *─1 CoinPackage        PaymentEvent ─(orderId)→ PaymentOrder
User 1─* WithdrawalRequest 1─* WithdrawalStatusChange
Room 1─* RoomMember *─1 User            Room ─(matchId)→ Match 1─* MatchPlayer *─1 User,  Match 1─* MatchEvent
User 1─* UserAchievement / Notification / SupportTicket          Tournament 1─* TournamentEntry
```

## Migrations & backups

- Apply: `npx prisma migrate deploy` (never `migrate reset` on real data).
- Backups: `apps/api/scripts/backup.sh` (custom-format `pg_dump`, checksum, rotation) or the
  `backup` compose profile. Restore into an empty database as a superuser with
  `pg_restore --clean --if-exists --no-owner --disable-triggers -d <db> <file>` (the integrity
  triggers re-validate rows on insert, so they are disabled during the bulk load), then open
  *Admin → Economy* (or `GET /api/admin/economy/emission`) to confirm the ledger check is green and
  *Admin → Monitoring → Verify chain* for the audit log. Test restores regularly.
