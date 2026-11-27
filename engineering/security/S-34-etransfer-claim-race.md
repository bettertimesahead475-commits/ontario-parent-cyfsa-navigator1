# S-34: one e-Transfer payment can be activated twice by two claims across a minute boundary (PR #171)

- **Severity:** Medium (payment integrity). The customer must own an administrator-approved, paid order; funds-verification is not bypassed.
- **Affects:** PR #171 (`devin/1795800106-etransfer-payments`, reviewed at `8362d26`). Not in production: `/api/claim-purchase` does not exist there.
- **Repro:** `tests/security/etransfer-claim-race.test.ts`, first test (fails on `8362d26`: 2 codes redeemed, 2 × 200).

## Cause

`functions/api/claim-purchase.ts` serialises claims only with `acquireOnce('claim__<ref>__<YYYYMMDDHHmm>')`. Two claims whose lock
calls fall in different minutes (e.g. 12:00:59.99 and 12:01:00.01, two isolates) both get a lock. If both run
`PATCH access_codes … used_at=is.null` and the "already used?" re-check before either inserts its fresh code, each inserts an
unexpired code and redeems it. `redeem_access_code_atomic` (live version, `20261110004740_preserve_monthly_renewal.sql`)
treats the second same-tier code as a monthly renewal and extends the session by 30 days, so one payment yields 60 days.
Refund accounting then sees two used codes for one reference.

The same window exists between a customer claim and an administrator **Reissue code** (`reissue__…` lock, different name):
the reissued code can survive and later be redeemed as a renewal. That needs an admin action at the same moment (low).

## Checked and sound (tests in `api/cloudflare-customer-payments.test.ts` and this file)

- Pending (409 `PAYMENT_NOT_VERIFIED`), rejected and refunded (409 `ORDER_CLOSED`) orders never activate; an unreadable audit
  trail fails closed (503).
- Another account's reference, an unknown one and a duplicated reference (`limit=2`, must be exactly 1 row) all get the same 404;
  same uid with another verified email gets 404 (order email must match the token's verified email).
- Two claims inside the same minute: exactly one activation.
- Admin-shown code vs customer claim: the row lock in `redeem_access_code_atomic` plus the claim's PATCH + re-check leave
  exactly one redemption in every order (redeem-then-claim → 409 `ALREADY_ACTIVATED`; claim-then-redeem → `CODE_EXPIRED`).
- PostgREST filter injection: `reference` must match `^PS-[A-Z0-9]{4,12}$` after upper-casing before any query; `uid` is the
  verified token subject and is `encodeURIComponent`-ed (`URLSearchParams` in `request-access`).
- `/api/my-payments`: only the caller's uid rows; `notes` and `firebase_uid` are read but not returned; pay-to instructions only
  for pending orders; `no-store`.
- `request-access`: price comes only from `TIER_PRICES` (all 8 tiers present); open-order reuse is scoped to uid + plan +
  pending + 30 days + current price.

## Fix needed (not pushed: it changes recovery behaviour, lead/owner decision)

1. **Preferred, needs a migration (owner approval):** a partial unique index `access_codes (reference_number) where used_at is not null`
   (check existing data for duplicates first), or have `redeem_access_code_atomic` refuse a code whose `reference_number` already
   has a used code. This also closes the reissue window.
2. **App-only, small:** make the claim lock permanent per reference (`claim__<ref>`, no minute). A claim that fails after taking
   the lock can then only be recovered by the administrator's Reissue code (customer gets "contact support"), and the
   reissue/claim window in (1) remains.

## Resolution (lead, PR #171)

Code-only fix: `claim-purchase` takes the minute-scoped reissue lock, then a permanent `claim__<reference>` lock, so a
second claim of one order can never issue another code. A claim that fails after the permanent lock is recovered by an
administrator code reissue. The DB-level constraint (one used code per reference) remains a proposed migration
requiring owner approval. `tests/security/etransfer-claim-race.test.ts` now passes.
