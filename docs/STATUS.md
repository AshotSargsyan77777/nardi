# Project status

_Last verified: 2026-10-27 on Node 22.22, PostgreSQL 16.15, Redis 7._

## Automated tests — all passing (53)

`npm test` → engine (vitest) **32/32**, API (jest) **21/21**.

**Engine (`packages/engine/test/engine.test.ts`)**
- deck composition and point totals (152 for every trump), trump/plain ranking
- combinations: terz/50/100, four J (200), four 9 (150), 7s/8s ignored, no card reuse, comparison and ties
- legal moves: follow suit, overtrump on trump lead, must trump when void, partner-winning option, free discard
- bazar: min bid, raise rules, contra only by opponents, recontra only by bidders, closing after three passes, redeal on four passes, 5+3 deal variant
- dealing: rejects invalid decks, 8 distinct cards each
- scoring: made (16 split), failed (defenders take all), contra ×2 / recontra ×4, kapot 25, failed kapot bid, combinations counted toward the bid, blot kept by holder
- **randomised simulation: 300 complete bot matches** (≈1,000+ hands) asserting 162 raw points per hand, 8 tricks, non-negative awards, score bookkeeping, legal-only moves, privacy of views, and termination
- illegal / out-of-turn / malformed actions, privacy of `playerView`, forfeit, rule-config validation

**API (`apps/api/test/*.spec.ts`, real PostgreSQL, HTTP + Socket.IO)**
- ledger: signup bonus via ledger, idempotency, **25 concurrent debits → exactly 10 succeed, never negative**, unbalanced transactions rejected, DB blocks UPDATE/DELETE and direct balance edits, global zero-sum check
- auth: CSRF enforcement, wrong password, unknown fields rejected (mass-assignment), refresh rotation **and reuse detection revoking the token family**, role protection of admin endpoints
- private room with 2 humans + 2 bots: lobby states, double-start protection, **full match played over WebSockets**, no hidden cards ever sent, decks revealed only for finished hands and verified, history, room → FINISHED, finished match frozen in DB
- 4 humans with a stake: escrow 400, stale-version rejection, winners +100 / losers −100, escrow back to 0, ledger consistent
- random matchmaking: 4 players → proposal → all accept → one RANDOM match; leaving forfeits
- payments (sandbox): order idempotency, **forged and stale signatures rejected (no credit)**, valid webhook credits once, replay ignored, receipt, suspicious-flag on invalid signature, order keeps original price after a rate change, rate history with previous value and admin, refund through ledger, no double refund
- legal gate: withdrawals disabled and Mode B refused without `LEGAL_MONEY_MODE_APPROVED`; with the gate simulated: KYC/age, hold, idempotent requests, insufficient-balance refusal, enforced status order, payout reference required, completion, ledger consistent
- admin: block/unblock (blocked user loses access immediately), audit-chain verification, append-only audit log, reason required for adjustments, no negative balances via admin, analytics

## Manual verification performed

- Production builds: engine (`tsc`), API (`nest build`), web (`next build`, 32 routes).
- Real browser (Playwright/Chromium) at 1366×900 and iPhone-size touch viewport: registration, dashboard,
  practice match (bidding panel, two-tap card play on touch, trick animation, combination announcement,
  hand result), room creation and invite panel, wallet, profile, rules (hy/ru), admin dashboard,
  economy, platform, monitoring. Issues found and fixed: mobile hand overflow, admin chart height,
  hard-coded Armenian bot names, untranslated admin labels.
- `create-admin` CLI (writes a valid hash-chained audit entry).
- Backup (`scripts/backup.sh`) → restore into a fresh DB: identical row counts, zero-sum ledger, all 14 integrity triggers present.
- Next.js standalone output run exactly as in the web Dockerfile (pages, static assets, API proxy OK).
- `docker compose config` validates. **Docker images were not built here**: the sandbox blocks network
  access from build containers and Docker Hub rate-limited pulls. Build them in CI or on the target host.

## Unfinished integrations (require external providers or owner decisions)

| Item | State | What is needed |
| --- | --- | --- |
| Real payment provider | Provider interface + sandbox only | Choose a licensed acquirer that accepts this business type (e.g. local AMD acquirers or an international PSP), sign the contract, implement `PaymentProvider` (checkout, webhook verification, refunds). |
| Payout provider | Manual payout reference | Licensed payout/bank API adapter — only after Mode B approval. |
| KYC / AML | Admin-set `kycStatus` | KYC/AML vendor integration (documents, liveness, sanctions/PEP). |
| E-mail / push | In-app notifications only | Mail provider for verification, password reset, receipts; push service if desired. Notification preferences are already stored. |
| Password reset by e-mail, e-mail verification, admin 2FA | Not implemented | Depends on the mail provider; 2FA (TOTP) recommended for staff. |
| Tournaments | Schema (`Tournament`, `TournamentEntry`) + feature flag | Brackets, scheduling, prize policy (legal review). |
| Multi-instance game servers | DB optimistic lock prevents conflicting writes; Redis adapter for broadcasts | Match-ownership leasing / sticky routing, Redis-backed HTTP rate-limit storage, leader election for the matchmaker. |
| Rule variant sign-off | Default variant + 12 parameters | Owner confirms the club rules (see GAME_RULES.md); no-trump/all-trump and 2-/3-player variants are not implemented. |
| Observability | stdout logs + `ErrorLog` + health endpoint | Sentry/OpenTelemetry/Prometheus if required. |

## Known limitations

- Bots use a simple heuristic (intended for practice only).
- Chat moderation is basic (length/rate limits, control-character stripping, small profanity list, per-user mute, host can disable chat, admins can ban chat); no report button yet.
- Leaderboard is all-time only.
- Admin JSON editors (economy/game/legal settings) are raw JSON validated by the server; a few admin table headers are English.
- Currency display names are single-language (owner-editable).
