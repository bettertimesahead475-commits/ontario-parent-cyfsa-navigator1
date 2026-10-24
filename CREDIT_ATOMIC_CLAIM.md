# Credit accounting: atomic claims without a new table

Status: implemented on branch `fix/credit-atomic-claim`. Tested in the repo (mocked and real-PostgreSQL). Not yet run against staging. No database migration. Nothing applied to production.

## 1. What was wrong (audit, verified)

Production has no `analysis_credit_reservations` or `credit_audit_ledger` table (read-only check). So every paid analysis runs the fallback in `creditAccounting.ts`, which had these defects:

| # | Defect | Evidence |
|---|---|---|
| F1 | **A reservation writes nothing durable.** It lives in per-process memory. Two instances can both take the last credit. | Reproduced with `creditAtomicClaim.test.ts`: two instances, one credit left, both reserved. |
| F2 | The table insert fails with "relation does not exist", which the client returns as an error object, not an exception. The code checks only for `23505`, so the fallback slot claim never runs. | Code path in `creditAccounting.ts` before this change. |
| F3 | Retry de-duplication for the per-type counters (`usage.ts`) is an in-process `Set`. A retry on another instance is counted again. | `usage.ts` before this change. |
| F4 | Counter updates are read-then-write. Concurrent increments lose updates. | Negative control on real PostgreSQL: 20 concurrent increments produced **3**. |
| F5 | Suspension and revocation are not enforced in the fallback. Revocation is ignored, and the `suspended_<id>` row written by `suspendSession` is never read. | Fallback code before this change. |
| F6 | With no database client, the fallback returned an allowance-only balance (fail open). | `getCreditBalance` before this change. |
| F7 | The server finalized a reservation only when the per-type counter write succeeded. If that write failed, the reservation expired and the analysis was free. | `_server.ts` Quick and Deep Scan paths before this change. |

Also checked: production has **0 rows** in `navigator_paid_sessions` and **0** `paid_*` usage rows (read-only counts). No live customer's balance changes with this fix. The defects matter at the first paid sale.

## 2. Design

One authoritative counter per paid session, plus one marker row per request. Only the existing `free_usage` table is used.

- **Counter** `paid_session_<sessionId>_total` (unchanged key). Reserving increments it with a compare-and-set (`update ... set analyses_used = n+1 where analyses_used = n`). Two instances cannot both win the same value. The loser re-reads and retries with jitter, or refuses if the allowance is full.
- **Marker** `paid_res_<sessionId>_<sha256(requestId)[0:32]>`, with `email` holding the state (`reservation:reserved | consumed | released`) and `analyses_used` holding the claimed slot (0 when no unit is claimed). Insert is the one-winner claim, so a retry of the same request finds the existing marker.
- **Finalize:** marker reserved to consumed. The counter was already taken, so nothing else changes. Duplicates are no-ops.
- **Release:** marker reserved to released, then counter minus one, but only for the caller whose conditional transition succeeds. Double release gives back one unit.
- **Abandoned reservations:** a reservation with no finish after 15 minutes (longer than the 300 s function limit) is released, but only when the allowance is full. A reservation whose claim never completed gives back nothing.
- **Fail closed:** if any write or read fails, the analysis is refused with a retryable 503 before any AI call.
- **Retries:** the same request ID on any instance returns the existing reservation. A consumed request returns `alreadyFinalized`, and nothing is charged again.
- **Per-analysis counters (`usage.ts`):** `recordPaidUse` claims a marker per analysis (hash of counter key and idempotency key) before incrementing. Another instance's retry finds the marker and adds nothing. `checkPaidUsage` also consults the marker, so a retry of an analysis that used the last slot is still allowed.
- **Why not the pending reservations table:** it would be a second source of truth, and the code above does not need it. See section 4.

Trade-offs, stated plainly:

1. **Crash between claim and slot write.** The unit stays taken until the abandoned-reservation sweep reclaims it. That is an under-serve (customer loses one unit), never a double charge.
2. **Crash between marker claim and counter increment in `recordPaidUse`.** One per-type count is missed (under-count). The total counter is unaffected.
3. **Availability.** A `free_usage` outage now refuses paid analyses with a 503. Before, they proceeded without a durable record. This is intended, and it is the main production behaviour change.
4. **Row growth.** Each paid request adds one `paid_res_` row and one `paid_use_` row. Retention is not yet defined. Suggested: purge `consumed` and `released` markers older than 90 days in a later maintenance task.

## 3. What changed in the repository

- `api/services/freeUsageStore.ts` (new): the atomic primitives (claim, compare-and-set, conditional marker transition, prefix list), each with one retry layer and `.retry(false)` on the client.
- `api/services/creditAccounting.ts`: reserve, finalize and release rewritten on the counter and markers. Suspension and revocation read from the session row and the `suspended_<id>` row. Administrative suspend and restore unchanged.
- `api/services/usage.ts`: atomic increments, durable per-analysis markers, durable check.
- `api/_server.ts`: finalize runs whether or not the per-type counter write succeeded (Quick Review and Deep Scan).
- Tests: `creditAtomicClaim.test.ts` (23 cross-instance tests), `creditAccounting.test.ts` (9 original behaviour tests ported to the production-shaped fake), `_server.test.ts` and two analyzer suites given the production-shaped database, `freeUsageStore.pg.test.ts` (real PostgreSQL, gated), `creditStaging.test.ts` (real Supabase, gated, refuses the production ref).
- Test support: `api/testSupport/productionLikeCreditDb.ts` models production: missing tables return an error object, `credits_*` columns fail with 42703, `free_usage` has its primary key, and writes can be made to fail.

## 4. The pending migration

File: `supabase/migrations_pending_approval/create_paid_access_credit_ledger_and_enforcement.sql`.

**Recommendation: do not apply the reservations and ledger parts.** Parts 4 and 5 (`analysis_credit_reservations`, `credit_audit_ledger`) and the `credits_*` and `is_suspended` columns duplicate state that this design keeps in `free_usage`. The code does not read them.

- Parts 1 and 3 (tier constraints and payment columns) belong to the payments work, not to credit accounting. Review them separately.
- If an audit ledger is wanted later, it should be an append-only table written in the same transaction as the counter change. That needs an RPC, which is a larger change. Not needed to fix the defects above.

## 5. Production risks

**This change:** no DDL. Runtime only: section 2, trade-offs 1 to 4. Recommended rollout: keep it dormant behind the existing feature gates, until the staging checks in section 6 pass.

**The pending migration, if applied as written:**

- Two `ALTER TABLE ... DROP/ADD CONSTRAINT` statements take an `ACCESS EXCLUSIVE` lock on `access_codes` and `navigator_paid_sessions` while the check validates. Tables are small today (`navigator_paid_sessions` is empty), so the window is short, but run it in a quiet period.
- `payments` gets a `CHECK` on a new column with a default. The check validates every existing row under lock. Check `payments` size first.
- `analysis_credit_reservations.request_id` is globally unique. Two sessions that reuse a request ID would collide. Request IDs come from the client header, so this is a real edge case.
- RLS is enabled on the new tables with grants only to `service_role`. Any code path using the anon key would silently lose access.

**Owner decision needed (not changed here):** Pro and Community allowances are "5 forensic per month", but the counter that now gates reservations is not month-scoped. It is correct only if each billing cycle creates a new `navigator_paid_sessions` row (and therefore a new counter). Nothing in the repository confirms that. Confirm the renewal flow before the first monthly sale.

**Pre-existing, not changed:** free-tier `recordFreeUse` can count a retry twice, and `decrementFreeUse` is still read-then-write.

## 6. Staging setup and verification

Staging (`cyfsa-navigator-staging`, `nxfhvebzzobegubefcda`) is paused. Restoring it may cost money, so it is not restored without your approval. Nothing below runs against production.

**A. Real PostgreSQL semantics (no cloud cost):**

```
CREDIT_PG_URL=postgres://<user>:<password>@<host>:5432/<db> \
  npx vitest run api/services/freeUsageStore.pg.test.ts
```

Creates and drops its own `credit_verify_*` schema. Use a scratch database, never production.

**B. Real Supabase REST path (staging only):**

```
STAGING_SUPABASE_URL=https://nxfhvebzzobegubefcda.supabase.co \
STAGING_SUPABASE_SERVICE_ROLE_KEY=<staging service key, entered locally, never pasted in chat> \
  npx vitest run api/services/creditStaging.test.ts
```

Uses `vfy_` synthetic session IDs only and removes its own rows. Refuses to run if the URL contains the production ref.

**C. Expected results:** all tests pass; the 12-request test reserves exactly 3; the invalid-key test returns 503.

## 7. Test results (this branch)

Run in the repository on the final commit. See the pull request for the commit hash and CI.

- Credit suites (`creditAtomicClaim`, `creditAccounting`): 32 passed. Repeated 3 times, stable.
- Affected suites (`_server`, `analyzerEndToEnd`, `analyzerStreamingIntegration`, `supabaseTransport`): all passed.
- Full suite: 3294 passed, 0 failed, 452 skipped (the gated PostgreSQL and staging tests skip without credentials; the PostgreSQL tests were also run, below).
- `tsc --noEmit`: clean. `npm run build`: passes.
- Mutation checks: non-atomic counter write (3 tests fail), release without the conditional transition (concurrent release test fails), no abandoned-reservation sweep (1 test fails), finalize placed after the failing per-type write (server test fails).
- Real PostgreSQL (local, 16.x): 4 of 4 pass. Negative control: old read-then-write gives 3 after 20 increments.

**Not run:** `creditStaging.test.ts` (needs staging credentials and a restored project). The Vercel preview of this branch was not used for testing, since previews share production variables.

## 8. Approvals still needed

1. Restore staging (cost to confirm) and run section 6B, or accept the local PostgreSQL result plus the mocked tests.
2. Decide the pending migration: withdraw parts 4 and 5 (recommended), and review parts 1 and 3 with the payments work.
3. Confirm the Pro and Community renewal flow creates a new paid session per cycle (section 5).
4. Approve the rollout of this change to production. No production change has been made.
