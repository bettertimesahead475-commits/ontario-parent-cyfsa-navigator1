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

## 8. Release readiness (phase 4)

### 8.1 Staging status

- `cyfsa-navigator-staging` (`nxfhvebzzobegubefcda`): **INACTIVE (paused)**, read via the Supabase project list.
- Restoration cost: not available to this session. No restore was started. **Blocker:** staging must be restored before the six-scenario test can run. Restoring needs your explicit authorization and cost confirmation.
- The service key for staging is not available in this session and must be supplied locally.
- Production `cyfsa-navigator live` (`qboidsfpjuxeqtfotryj`): ACTIVE_HEALTHY. Not touched.

### 8.2 Staging run (when staging is restored and authorized)

```
STAGING_SUPABASE_URL=https://nxfhvebzzobegubefcda.supabase.co \
STAGING_SUPABASE_SERVICE_ROLE_KEY=<staging service-role key, from a local env file or secret manager> \
npx vitest run api/services/creditStaging.test.ts
```

Order:

1. Restore staging (authorized). Confirm the project is ACTIVE_HEALTHY and that its ref is `nxfhvebzzobegubefcda`.
2. Apply `supabase/migrations_pending_approval/paid_credit_reservation_functions.sql` to **staging only**. Then confirm the grants: `service_role` can execute, `anon` and `authenticated` cannot (the local test covers this; the staging check repeats it on the real project).
3. Run the command above. Expected: 6 scenarios pass. The scenarios use only synthetic `uuid` session IDs and `vfy_` request IDs, insert and delete only their own rows, and refuse to run against the production ref.
4. Record the output in the PR and stop the staging project again if it is not needed (owner decision).

Staging has no customer data to protect in these scenarios, but the test must still never be pointed at production.

### 8.3 Fail-safe behaviour

- If the functions are not installed, PostgREST reports `PGRST202`. The application returns **503 `USAGE_SERVICE_TEMPORARILY_UNAVAILABLE` before any model call**. There is a test for this.
- A missing `issued_at` on a monthly plan returns 503. No period is guessed.
- A write whose outcome is unknown returns 503 and is never retried by the application.

### 8.4 Environment and flags (production, names only)

- Required by this change: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Both exist in production (secret values not read).
- No new environment variables are introduced.
- `PARENT_ANALYSIS_ENABLED` and `VITE_PARENT_ANALYSIS_UI` (PR #102 feature flags): **not set** in production. Both default to off: the server checks for exactly `"true"`, and the client checks for exactly `"true"`.

### 8.5 Final production order (nothing has been applied)

1. Approve and complete the staging run (8.2).
2. Apply `paid_credit_reservation_functions.sql` to production, with explicit approval. It adds functions only.
3. Confirm the functions exist and the grants are as tested.
4. Merge PR #103 to `main`. **Confirm in the Vercel project settings that production deploys from `main`** (the project's production domains suggest it, but the production-branch setting was not read). If it does, the functions must already exist (step 2) before this merge. Do not merge before step 2.
5. Verify: the production deployment is READY, the paid-analysis path returns the expected responses for a synthetic check (no paid sessions exist today), and the feature flags remain unset.
6. Leave both feature flags off. Enabling paid sales is a separate, explicit approval.

Merging PR #103 before step 2 is not safe: the deployed application would return 503 for every paid analysis until the functions exist. No paid session exists in production today, but the order must still be followed.

### 8.6 Rollback and recovery

- **Application:** revert the merge commit on `main`. Vercel redeploys the previous version automatically.
- **Database:** leave the functions in place. Nothing calls them after a revert of the application, and they hold no data. Dropping them is `paid_credit_reservation_functions.down.sql`, and it is needed only if the owner decides the functions must go.
- **Data:** the only rows the functions write are `free_usage` counter rows and `paid_res_` marker rows. Stranded reservations are returned by the 15-minute reconciliation, or by a manual release of `reservation:reserved` markers older than 15 minutes if an operator must clear them sooner.

### 8.7 Merge status

- PR #103 (`7f45596b`) merges cleanly into `main` (`7cd63b4f`). GitHub reports it mergeable.
- CI on `7f45596b`: `test` passed.

### 8.8 PR #102 rebase plan (after #103 is on `main`)

PR #102 (`68a07775`) is unchanged, with both parent-analysis flags off. It merges cleanly into `main` today, but conflicts with #103 in three files:

| File | Conflict | Resolution |
|---|---|---|
| `api/_server.ts` | Both sides changed the credit reservation and finalize sections in the Quick Review path | Keep #103's reservation, ownership refusal and charge-before-delivery. Keep #102's parent-view and parent-attribution code. |
| `api/analyzerEndToEnd.test.ts` | Both sides changed the database fake | Use #103's production-shaped fake and seeded sessions. Keep #102's assertions. |
| `api/services/creditAccounting.test.ts` | #103 replaced the inline fake with the production-shaped fake | Take #103's version. |

Steps: merge `main` into #102's branch (a merge commit, no history rewrite), resolve the three files, run the full suite, `tsc` and build, and push. Keep #102 a draft, and do not merge it.

## 9. Final staging gate (checklist)

Status as of `79a65262`:

| Item | Status |
|---|---|
| CI `test` on `79a65262` | Passed |
| Staging project `nxfhvebzzobegubefcda` | INACTIVE (paused) |
| Supabase organization plan | Free (`tier_free`) |
| Restore charge | **Unverified.** The available tools do not expose a restore price. Public third-party guides say free projects restore without charge, but none is Supabase's own documentation. Needs owner confirmation from the Supabase dashboard before restoring. |
| Six staging scenarios | Written and ready (`api/services/creditStaging.test.ts`). Synthetic UUID sessions and `vfy_` request IDs only. Refuses production. Not run. |
| RPC permissions | Tested on a real PostgreSQL server (only `service_role` executes). Not yet tested on Supabase. |
| Production deployment branch | `main` (verified: current production deployment built from `main` at `7cd63b4f`). Merging PR #103 deploys automatically. |
| Function duration | `vercel.json` sets `maxDuration: 300` for `api/index.ts`. The deployment record does not show the applied value, and the plan tier cannot be read with the tools. Needs owner confirmation of the plan. |
| PR #102 | Unchanged at `68a07775`, draft. Both feature flags off (not set in production; default off). |

### 9.1 Single next action

**Owner: confirm in the Supabase dashboard that restoring `cyfsa-navigator-staging` (`nxfhvebzzobegubefcda`, free plan) carries no charge, and authorize the restore.** Nothing else can proceed until staging is running.

### 9.2 Production checklist (do not start until 9.1 is complete and the staging run passes)

Pre-deploy:

1. Owner approves applying `paid_credit_reservation_functions.sql` to production.
2. Confirm production is ACTIVE_HEALTHY and that the target is `qboidsfpjuxeqtfotryj`.
3. Take a read-only snapshot of the function list and the `free_usage` row count (counts only).

Migration:

4. Apply `paid_credit_reservation_functions.sql` to production (one transaction; adds functions only).
5. Verify: all eight functions exist; `service_role` can execute the three public ones; `anon` and `authenticated` cannot.

Deploy:

6. Merge PR #103 to `main`. Production deploys from `main` automatically; the functions from step 4 must already exist.
7. Wait for the deployment to reach READY. Verify it is built from the PR #103 merge commit.
8. Verify the paid-analysis path fails safely or succeeds as expected for a synthetic check. Do not use a real customer session.
9. Confirm the feature flags remain unset (`PARENT_ANALYSIS_ENABLED`, `VITE_PARENT_ANALYSIS_UI`).

Rollback:

- **Application:** revert the merge commit on `main` (Vercel redeploys the previous READY deployment, `dpl_9DgyuPFqjoyDw9B6XJjGXsZEdbyh` is the current one to return to if needed).
- **Database:** leave the functions. They hold no data and nothing calls them after the application revert. Drop them with `paid_credit_reservation_functions.down.sql` only if the owner decides they must go.
- **Stranded reservations:** returned by the 15-minute reconciliation on the next reservation for that session.

### 9.3 PR #102 (after #103 is deployed and verified)

Merge `main` into PR #102's branch, resolve the three conflicts listed in section 8.8, run the full suite, `tsc` and build, and push. Keep it a draft.
