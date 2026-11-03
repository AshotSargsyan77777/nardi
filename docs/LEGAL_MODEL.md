# Legal model: Mode A and Mode B

> This document describes how the software enforces the chosen model. It is **not legal advice**.
> Whether purchasable coins, stakes, prizes or redemption are lawful depends on the jurisdiction
> (Armenia and every target country) and must be confirmed by qualified lawyers before enabling.

## Mode A — free entertainment (default)

- Coins (`BLOT`) and practice chips (`FUN`) have **no monetary value**, cannot be exchanged for money
  and are never paid out. The UI states this on the wallet page and in the terms.
- `FUN` is a separate practice currency: signup bonus, daily refill, practice-chip stakes between
  players (optional flag). It can never be purchased or redeemed (enforced in code).
- Coin purchases (`purchasesEnabled`) and coin stakes (`blotStakesEnabled`) are **off by default**.
  Even in Mode A, selling virtual coins and letting them be won from other players may be regulated —
  obtain advice before switching these on.
- Withdrawals are impossible in Mode A (the setting is rejected and the UI hides the module).

## Mode B — money operations (locked)

Mode B requires **two independent keys**:

1. Infrastructure key: the server runs with `LEGAL_MONEY_MODE_APPROVED=true` (set by whoever controls
   the deployment, after legal sign-off).
2. Business key: a **SUPERADMIN** switches *Platform → Mode B* and, separately, enables withdrawals.

If either key is missing, the API reports Mode A, `/config` shows withdrawals disabled, the wallet hides
the redemption section, and every withdrawal endpoint returns `403 WITHDRAWALS_DISABLED`.

### What exists for Mode B

- Withdrawal requests with min/day limits, KYC status (`VERIFIED` required), minimum age (from birth
  date), rate snapshot, coins moved to a hold account at request time (no double withdrawal),
  statuses `PENDING_REVIEW → APPROVED → PROCESSING → COMPLETED` or `REJECTED` (coins returned),
  status history, notifications, audit log, large-withdrawal flags.
- Payout execution is **manual** (admin enters the transfer reference) because no payout provider is
  integrated.

### What must be added before Mode B is legitimate

- Licence(s) for the activity in each jurisdiction; geo-restrictions for others.
- A real KYC/AML provider integration (identity documents, sanctions/PEP screening, source of funds),
  instead of the admin-set `kycStatus`.
- Licensed payment and payout providers with adapters implementing `PaymentProvider`.
- Responsible-gaming tooling required by the regulator (deposit/loss limits, self-exclusion,
  cool-off, reality checks), age verification, data-protection compliance (DPIA, retention).
- Tax and accounting treatment of fees and prizes.
