# Isolated Staging Test Plan

**Status:** plan only. **No migration applied, no staging configuration changed, no staging data written.** Each step below needs explicit owner approval before it runs.

## 0. Environment

| Item | Value | Status |
|---|---|---|
| Staging project | `cyfsa-navigator-staging` (`nxfhvebzzobegubefcda`) exists | Visible in project list. **Not authorized for writes or tests in this session.** |
| Preferred target | A **Supabase branch** created from staging, so it can be discarded | Not created. Requires approval. |
| Production | `cyfsa-navigator live` (`qboidsfpjuxeqtfotryj`) | **Off limits** for this plan, except the read-only checks already done. |
| Local harness | Disposable PostgreSQL 16 (UTF-8), Supabase roles simulated | Available. Used for everything in section 1–3 that does not need JWTs. |

## 1. Ordered migrations

**Test:** apply the chain from `MIGRATION_SEQUENCE_CORRECTED.md` in order to an empty database. Record each step's result.

**Local status:** 21 of 21 steps OK on PostgreSQL 16 (remediation patched).

**Staging additions:**

- Apply each step's expected file hash, recorded before the run, to show no file changed.
- Confirm `create_navigator_page_evidence_foundation.sql` is **not** applied. Check that `navigator_source_operation` is created only by the v2 proposal.
- Confirm the production-only tables (`access_codes`, `payments`) are provided by the staging baseline and not by this repository.

**Pass:** all steps OK; `pg_catalog` shows the expected functions and triggers; no duplicate functions.

## 2. Evidence schema v1 and pipeline v2

| Test | Expected | Local result |
|---|---|---|
| `evidence_schema_additive_v1.test.sql` | 12 PASS | **12 of 12 PASS** |
| `evidence_pipeline_additive_v2.test.sql` | 8 PASS | **8 of 8 PASS** |
| `evidence_schema_additive_v1.sql` on a populated evidence table | Refused with `NOT_EMPTY` | **Verified** |
| `evidence_pipeline_additive_v2.sql` applied twice | Refused with `ALREADY_APPLIED` | Not yet tested. Add to the suite. |

**Staging additions:** run both test files against the staging branch, using a service-role connection and only the disposable branch. Do not run them against the main staging database.

## 3. Ownership and cross-matter isolation

Covered locally by v2 tests 2 and 3 and v1 tests 5 and 6. Staging must additionally verify with **real Firebase-linked accounts**:

| Case | Expected |
|---|---|
| Owner creates an upload on own matter | Succeeds |
| Non-owner, same matter ID | Rejected: `Source not found` |
| Owner, another account's matter ID | Rejected: `Source not found` |
| Reviewer (non-OWNER member) | Rejected (the RPC requires OWNER) |
| Suspended account | Rejected (`status <> 'active'`) |
| Enumeration: sequential matter IDs | No information leak beyond "not found" |

## 4. Firebase-to-server authorization

The app authenticates users with Firebase. The server verifies the Firebase token and maps it to an account. Supabase is accessed **only** with the service-role key, so Supabase RLS does not authenticate end users.

| Case | Expected |
|---|---|
| Request with no token | 401 on every protected route |
| Expired or forged token | 401 |
| Valid token, account not in `accounts` | Account created or rejected per existing rules (test both paths) |
| Valid token, wrong matter | Rejected at the RPC layer |
| Client attempts a direct Supabase REST call with the anon key | **Permission denied** after the revoke (see `PROD_PERMISSION_HARDENING.md`) |

**Owner input needed:** test Firebase accounts for at least two parents, one reviewer, one suspended account, and one admin.

## 5. RLS and JWT behaviour

RLS is not the end-user security boundary (see section 4), but it must still hold for any role that reaches the database directly.

| Test | Method | Expected |
|---|---|---|
| `anon` row access on the 19 revoked tables | `set local role anon`, then select | Permission denied |
| `anon` SELECT on `document_walkthroughs` | Same | Returns rows (intended) |
| `authenticated` JWT with a valid `sub` against each table | Supabase JWT in the staging branch | Only rows matching `auth.uid()` where a policy exists. Expected to return none, since no Supabase Auth users exist. |
| `TRUNCATE` by `anon` | Attempt in a transaction, roll back | Permission denied |
| Service-role connection | Same operations | Succeeds (server path) |

**Local status:** the role semantics are tested on PostgreSQL 16. JWT claims and PostgREST behaviour are **not** tested locally and need the staging branch.

## 6. Paid access and credit accounting

Tests in the repository: `creditAccounting.test.ts` (9 tests), `paymentActivation.test.ts`, `analyzerErrors.providerFailure.test.ts`, and the ledger migration `create_paid_access_credit_ledger_and_enforcement.sql`.

| Case | Staging check | Live AI? |
|---|---|---|
| Free-tool use decremented once per run | Run a stub analysis; verify one decrement | No |
| Paid session with credits: one reservation, one settlement | Ledger rows balance | No |
| Provider failure after reservation | Reservation released, not charged | No (use the provider failure mock) |
| Duplicate request (idempotency) | Second request does not double-charge | No |
| Credit exhaustion | Request refused before model call | No |

These can run on the staging branch with a stub provider. No paid model call is needed.

## 7. Migration rollback and failure recovery

| Scenario | Test | Expected |
|---|---|---|
| Failure mid-chain (simulated) | Stop after step N on a branch | Steps 1..N-1 remain; later steps absent; no partial objects |
| Re-run after failure | Re-apply from step N | Succeeds or refuses cleanly (`ALREADY_APPLIED`/`NOT_EMPTY`) |
| Revoke rollback | Apply rollback script; verify | Matches the pre-change snapshot exactly |
| Branch discard | Delete the staging branch | Staging unchanged |

**Local status:** the revoke rollback is tested. Chain failure and re-run behaviour is partly covered: v1 and v2 refuse re-runs. The remediation replay defect was reproduced and fixed by the patch.

**Not yet written:** a down script per migration. Required before any production apply.

## 8. Exit criteria

Staging is ready for a preview build when all of these hold:

1. Sections 1–2 pass on the disposable branch.
2. Section 3 and 4 pass with real Firebase accounts.
3. Section 5 passes for `anon` and `authenticated`.
4. Section 6 passes with stub providers.
5. Section 7 rollback has been run and verified once.

Live AI testing is a separate gate (`ANALYZER_VALIDATION_MATRIX.md`).

## 9. Approvals needed before running

1. Authorize creating an isolated Supabase **branch** from the staging project.
2. Authorize applying the ordered chain and the v1 and v2 proposals to that branch.
3. Authorize the revoke proposal on that branch, so section 5 can run.
4. Provide Firebase test accounts (section 4).
5. Authorize a stub-provider configuration for section 6 (no paid calls).
