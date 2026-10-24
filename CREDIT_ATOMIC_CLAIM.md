# Paid-analysis credit accounting

Status: branch `fix/credit-atomic-claim` (PR #103, draft). **Not applied to any database.** Production requires an explicit approval and a migration (section 6). Staging verification has not run.

## 1. What the system guarantees

- **Atomic reservation.** Each reservation, release and finalization is one PostgreSQL function call. The function runs in one transaction under a per-session advisory lock. A crash, a lost connection or a concurrent request cannot leave a counter moved without its marker, or the reverse. Verified against a real PostgreSQL server (11 tests, including an injected failure that rolls back a half-finished reservation).
- **Allowances.**
  - Basic: 3 analyses in total.
  - Premium: 5 analyses in total (quick and forensic together).
  - Pro and Community: 5 **forensic** analyses per billing period. Quick reviews are not limited, and do not draw on the forensic allowance.
- **Renewal.** A monthly plan's billing period starts on the paid session's `issued_at` (the redemption date, which is the renewal date for each new session) and renews on the same day of each following month (UTC). A day a month does not have is that month's last day: a period started on 31 January renews on 28 February, then 31 March. Clamping is applied from the original issue date, so the day does not drift.
- **One owner.** Only the attempt that claimed a reservation receives a reservation id, so only it may release the unit. A retry that joins a live or finished reservation receives no id, and the route does not run the model for it (409 `ANALYSIS_IN_PROGRESS` or `ANALYSIS_ALREADY_COMPLETED`).
- **Charge before delivery.** A result is withheld if its charge cannot be recorded (503 or 409), and the reservation is released.
- **Reconciliation.** A reservation with a recorded unit that is not touched for 15 minutes (longer than the 300-second function limit) is returned on the next reservation for that session. Live reservations are never reconciled by another request.

## 2. Failure behaviour

| Event | Outcome |
|---|---|
| Crash before the function commits | Nothing changed. |
| Crash after commit, before the result is returned | The unit stays reserved and is returned after 15 minutes, or on the next reservation for that session. Nothing is charged for the undelivered result. |
| Lost response to the reserve call | Applied once. The retry with the same request id is refused as in progress for up to 15 minutes; the customer can start a new analysis, which is charged normally. |
| Lost response to a release or finalize | Applied at most once. A repeat call changes nothing. |
| Database unavailable | Fails closed: 503 before any model call. |
| Monthly plan with no issue date | Fails closed (503). No period is guessed. |

Writes are never retried by the application. Every write is idempotent by request id, so a retry at the user's level is safe.

## 3. Components

- `supabase/migrations_pending_approval/paid_credit_reservation_functions.sql` (new): `paid_reserve_credit`, `paid_release_credit`, `paid_finalize_credit`, and their helpers. Creates no tables and changes no rows.
- `supabase/migrations_pending_approval/paid_credit_reservation_functions.down.sql` (new): drops the functions.
- `supabase/migrations_pending_approval/paid_payments_columns_minimal.sql` (new): the four payment columns still absent in production. Belongs to the payments work.
- `supabase/migrations_pending_approval/create_paid_access_credit_ledger_and_enforcement.sql`: superseded for credit accounting; not applied.
- `api/services/creditAccounting.ts`: reserve, finalize, release, balance, billing periods.
- `api/services/usage.ts`: per-analysis counters (keyed by billing period for monthly forensic analyses), status.
- `api/services/freeUsageStore.ts`: reads and the per-analysis counters only.
- `api/_server.ts`: refuses replays and joined attempts before the model runs; charge before delivery; passes the reservation's period to the per-analysis counter.

## 4. Verification

- **Real PostgreSQL** (`api/services/paidCreditFunctions.pg.test.ts`, local-only): 11 of 11 pass. Covers 20 concurrent requests against 3 units (exactly 3 reserved); concurrent retries (one owner); foreign release ignored; concurrent release gives one unit back; finalize then retry; reconciliation of a crashed reservation; live reservations untouched; an injected mid-function failure rolls back fully; period scopes; quick reviews uncounted.
- **Application tests** (mocked database that emulates the functions): 56 credit tests, plus route-level tests. Covers renewal boundaries (anniversary time of day, the 31st, leap years, year boundaries), period release across a boundary, lost responses, concurrency across instances, owner-only release, replay refusal, fail-closed on missing anchor.
- **Mutation checks:** reverting to a calendar month fails three renewal tests; removing the replay refusal fails the Deep Scan tests; removing reconciliation fails the reconciliation test.
- **Full suite:** 3320 passed, 0 failed, 465 skipped (the gated PostgreSQL and staging tests skip without credentials). `tsc --noEmit` clean. `npm run build` passes.
- **Staging** (`api/services/creditStaging.test.ts`, gated): 6 scenarios against real Supabase through PostgREST. **Not run.**

Limits of the application tests: the emulation mirrors the SQL, but only the PostgreSQL run executes the SQL. Keep the two in step when either changes.

## 5. Assumptions to confirm

1. **A monthly renewal creates a new paid session.** The codebase has no recurring-billing logic and no path that extends a session: sessions last 30 days and are created when an access code is redeemed. If a renewal instead extended an existing session, the anniversary logic still holds, because it is anchored on `issued_at`, but the renewal date would then be the original purchase date and the allowance would not reset at each renewal. Confirm how renewals are issued.
2. **Vercel plan.** The team's plan tier cannot be read with the available tools. `maxDuration: 300` needs a paid plan under the older published limits. Confirm in the dashboard before deploy.

## 6. Deployment order (nothing has been applied)

1. Approve the release. Staging verification is required: restore staging (cost to confirm), apply `paid_credit_reservation_functions.sql` there, and run the staging test with a service-role key entered locally. Do not use a Vercel preview.
2. Apply `paid_credit_reservation_functions.sql` to production, with explicit approval. It only adds functions, so it is safe to run before the application that calls them. The application fails closed (503) until the functions exist, so the migration must come first.
3. Deploy the application. Keep both feature flags off until the first paid sale is approved.
4. Rollback: revert the application first, then run `paid_credit_reservation_functions.down.sql` if the functions must go.
5. Do not apply `paid_payments_columns_minimal.sql` in this release; it belongs to the payments work.

Production facts (read-only checks): `payments` has 2 rows; `navigator_paid_sessions` has `issued_at` and `revoked_at`, and no credit columns; `free_usage` has its primary key on `uid`; no credit-related function exists yet.

## 7. Remaining operational approvals

- Staging restore and the staging test run (cost to confirm).
- Production migration of the functions (section 6, step 2).
- Confirmation of renewal behaviour (section 5, item 1) and the Vercel plan (item 2).
- Payment columns migration, owned by the payments work.
