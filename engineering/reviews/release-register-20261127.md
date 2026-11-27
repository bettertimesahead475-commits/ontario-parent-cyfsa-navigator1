# Release qualification register, 2026-11-27 (partial, read-only)

Scope of this pass: payment integrity (PR #171 at `282789b`, S-34 test from PR #172), database deployment identity,
analyzer readiness (preview `067446a`). PR #168, financial exposure, browser, PDF, SEO and full-suite gates are NOT assessed in
this pass. No live write, migration, deployment, paid inference or expenditure was performed. No customer data was read.
"Verified" means reproduced here. "Static" means read from code and schema only.

## Requirements

| ID | Requirement | Status | Basis |
|---|---|---|---|
| P0-1 | Renewal stacking preserves unused entitlements | **FAIL on deployed DB** / PASS on candidate SQL | Verified (PGlite sim, see below) |
| P0-2 | Reissue vs activation cannot create two working entitlements | PASS (static) | Static; needs PostgreSQL concurrency test |
| P0-3 | Adversarial concurrency tests on disposable PostgreSQL | **BLOCKED** | No PostgreSQL server here (no docker, no local install). S-34 test is a JS double, not the SQL |
| P0-4 | Interrupted activation at each boundary | PASS (static) with one minor gap | Static reading of claim-purchase.ts |
| P0-5 | Refund vs activation concurrency | PASS (static) | Static; needs PostgreSQL test |
| P0-6 | Cross-account and cross-device entitlement | PASS (static) / BLOCKED for live proof | Restore is scoped to verified uid; no live test run |
| P0-7 | Legitimate repeat purchase not mistaken for duplicate | PASS (static) | request-access reuses only a pending order of the same plan and amount |
| P0-8 | Permanent database-level payment protection | **BLOCKED** | Not present in PR #171 head or in staging schema. Awaiting Devin |
| P0-9 | Current live Cloudflare app database identified | PASS (verified) | Staging `nxfhvebzzobegubefcda`, see DB section |
| P0-10 | Consistent database bindings across app, queue, executor, payments, admin | PASS (static) | All read `STAGING_SUPABASE_URL`; live project is not referenced |
| P0-11 | Analyzer readiness on preview | **BLOCKED** (owner check needed) | Public probes narrow it to two secrets, see analyzer section |
| P0-12 | PR #164 migrations: authorization and effect | PASS (recorded) | Applied 2026-11-27 under owner D2 authorization, see DB section |
| P0-13 | Commercial launch ledger recommendation | **BLOCKED** on owner D1 | Recommendation given, not decided |
| P1-14 | PR #168 rate-limit qualification | NOT ASSESSED | |
| P1-15 | Financial exposure audit | NOT ASSESSED | |

## Confirmed defects (for Devin, PR #171 head `282789b`)

### D-1 (P0) `claim-purchase` cannot run on the deployed staging schema
- Location: `functions/api/_customer-payments.ts`, `codesOf` (select list includes `redeemed_session_id`); called on every
  path of `functions/api/claim-purchase.ts` before any state change.
- Evidence: `information_schema.columns` on staging `nxfhvebzzobegubefcda` shows `access_codes` without
  `redeemed_session_id`. The column is added only by `supabase/migrations/20261110004740_preserve_monthly_renewal.sql`,
  which is marked "Candidate only" and is not in staging's applied list.
- Expected: an approved order can be activated.
- Actual (expected from the schema; live reproduction needs owner approval): the PostgREST read fails, `rest()` throws, and
  the handler returns `503 ACTIVATION_UNAVAILABLE`. Every activation fails.
- Repair: make the migration a dependency of the release (apply it after owner review), or remove the column from the
  select until it exists.
- Acceptance: on a disposable copy of staging schema with the candidate migration applied, `POST /api/claim-purchase` for an
  approved order returns 200 and `restore` returns the same session on a second call.

### D-2 (P0) Deployed `redeem_access_code_atomic` does not stack renewals
- Evidence (verified, PGlite with both function bodies, single session): after two Pro codes for one account,
  the candidate body yields **1** session, extended 30 days (`expires_at` 2026-12-27 → 2027-01-26). The deployed staging
  body yields **2** concurrent sessions. Premium behaviour is the same in both.
- Staging `redeem_access_code_atomic`: md5 `3ee15a26c5e5075a80d1d59d66160ad1`, 2985 characters, no renewal lock, no
  `redeemed_session_id`.
- Impact: a monthly Pro renewal creates an overlapping 30-day entitlement; monthly credit scope can reset early.
- Repair: apply `20261110004740_preserve_monthly_renewal.sql` after owner review (it is a database change; not applied here).
- Acceptance: two Pro codes for one account produce one session with `expires_at` extended by 30 days; a replayed used code
  for the same account returns `reused`; a used code for another account returns `CODE_ALREADY_USED`.

### D-3 (P1) S-34 regression test does not exercise the database
- Location: `tests/security/etransfer-claim-race.test.ts`. It simulates `redeem_access_code_atomic` in JavaScript and ignores the
  advisory lock and the `redeemed_session_id` column.
- Impact: the test passes while D-1 and D-2 exist. CI reports green for a flow that fails on the current schema.
- Acceptance: at least one test runs the candidate SQL in PostgreSQL 16 with two connections, for one approved order and
  two concurrent claims across a minute boundary. Exactly one entitlement results.

### D-4 (P2) Minor: signing failure after a successful redemption
- Location: `functions/api/claim-purchase.ts`, after `redeem_access_code_atomic` returns `activated`.
- If `signSessionToken` throws, the code is used and the session exists, but the claim lock stays and the response is 503. A
  retry then returns `restore` (only if `redeemed_session_id` exists, see D-1). Acceptance: a test forces the sign failure and
  checks that a retry returns the same session.

## Database deployment identity (read-only aggregates, no customer rows)

| Object | Staging `nxfhvebzzobegubefcda` (used by the live Pages app) | Live `qboidsfpjuxeqtfotryj` (not referenced by Pages) |
|---|---|---|
| Public tables | 46 | 34 |
| `payments` | 2 (both pending) | 2 |
| `access_codes` | 0 | 1 |
| `navigator_paid_sessions` | 5 (0 active) | 0 |
| `free_usage` rows / reservation markers | 23 / 16 | 2 / 0 |
| `analyzer_jobs` | 7 | table absent |
| `accounts` | 0 | table present (row count not read) |
| `redeem_access_code_atomic` | present, pre-renewal body | **absent** |
| `redeemed_session_id` column | absent | absent |

- Pages code path: every function reads `STAGING_SUPABASE_URL`. `/api/_supabase-reachability` on the live domain and on the
  preview reports the staging host. The live project is referenced only by the legacy Express server.
- Applied migrations: staging has the PR #164 pair (`20261127163256`, `20261127163309`) applied under owner D2 authorization
  on 2026-11-27. Live lacks everything after `free_scan_helpers_revoke_public` (20261028), including `durable_analyzer_queue`,
  `payment_summary` and `redeem_access_code_atomic`.
- Recommendation (evidence, not names): **staging `nxfhvebzzobegubefcda` is the ledger the live app actually uses and holds the
  operational data.** It is not yet the reviewed schema (D-1, D-2 and the unapplied payment-reference uniqueness index). The live
  project holds a separate, unlinked set of 2 payments and 1 access code. Do not switch. Owner decision D1 remains open. Before
  launch, reconcile the 2 live payments and 1 access code against the staging ledger, read-only.
- Note: `CREDIT_ATOMIC_CLAIM.md` says the staging project was paused. It responds now. Its status note needs correcting.

## PR #164 migrations (authorization and effect)
- `free_scan_reservation_functions_pr164` and `reconcile_skip_live_analyzer_jobs_pr164`: applied 2026-11-27 to staging under
  the owner's "Yes, both" (D1 and D2). Recorded in `pr164-final-qualification-067446a-20261127.md` section 9.
- Effect: prefix fix and live-job skip are present; EXECUTE is limited to `service_role`; marker counts unchanged at the time of
  the apply (reserved 8, consumed 2, released 6, counters 7). The 8 reserved markers are now reclaimable at runtime.

## Analyzer readiness on the preview (`067446a`)
- `functions/api/_status.ts` reports `analyzerReady = ANALYZER_ENABLED && FIREBASE_PROJECT_ID && STAGING_SUPABASE_URL &&
  usable STAGING_SUPABASE_SERVICE_ROLE_KEY && usable ANTHROPIC_API_KEY`.
- Public probes on the preview (no spend; the body is rejected before any provider call):
  - `POST /api/analyze {}` returned `400 INVALID_REQUEST` (passes the `ANALYZER_ENABLED` and FIREBASE/ANTHROPIC presence gates).
  - `POST /api/analyze` with a bearer token returned `401 SIGN_IN_REQUIRED`.
  - `/api/_supabase-reachability` returned the staging host (`STAGING_SUPABASE_URL` is set and correct).
- Therefore the failing condition is one of: `STAGING_SUPABASE_SERVICE_ROLE_KEY` is missing or fails the format check, or
  `ANTHROPIC_API_KEY` is present but fails the `sk-ant-` format check.
- Owner check (no values needed): in Cloudflare, Pages project `cyfsa-navigator-git-staging`, Settings, Environment variables,
  **Preview** tab, confirm these names exist: `STAGING_SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`. The Worker log line
  `[CONFIG_SECRET_UNUSABLE]` names any key that is present but unusable (names only).
- The preview also has no `forensicQueueReady`, which depends on `analyzerReady`. The queue binding itself is not confirmed.

## Not done in this pass
- PostgreSQL concurrency tests (P0-3), PR #168 (P1-14), financial exposure (P1-15), browser, PDF, SEO, full suite and
  Vercel-retirement checks.
- GitHub comments: `gh` is not installed and no token was supplied. The comment text for PR #171 is in the chat transcript.

## Update: analyzer readiness root cause (preview `067446a` and `3a1ef4c8`)
- Cause: in the **Preview** environment of Pages project `cyfsa-navigator-git-staging`, the secrets
  `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` each hold a **single non-visible character**
  (length 1, non-ASCII or control, no other shape). `_status.ts` correctly reports them `unusable`, so `analyzerReady` is false.
- Evidence (Worker tail, read-only, shape facts only, no values): production `0cc59589` logs only `GEMINI_API_KEY` as
  unusable and reports `analyzerReady: true`. Preview logs the three keys above. The same code runs in both.
- Diagnostic build `a5b0ac88` (preview alias `diag-status-067446a`) logged shape facts, then was reverted from source. It was not released.
- Engineering access cannot correct this: Pages secret values are write-only, and copying production values into Preview
  would route preview traffic to the live ledger. Setting real preview values is a configuration decision for the owner.
- Classification: fail-closed working as designed. Not a code defect.

## Update: financial protection, migration A/B, Gemini, preview housekeeping (2026-11-27)
| Requirement | Status | Basis |
|---|---|---|
| Transcription entitlement and quota (F-1) | FAIL (P0) | `functions/api/transcribe.ts` 41–50: identity and per-isolate limit only |
| OCR page quota (F-2) | FAIL (P0) | `functions/api/extract-text.ts` 5–6: no reservation by design; 30 pages per request |
| Final Case Assessment quota (F-3) | PASS | `functions/api/final-case-assessment.ts` 70–72 (Pro session), 162 (credit reservation) |
| Quick Review and Forensic quota | PASS (retry budget not verified) | `functions/api/analyze.ts` reservation RPC |
| Aggregate platform spending ceiling (F-5) | FAIL (P1) | none in the codebase |
| Per-isolate limits fail open on expensive buckets (F-4) | FAIL (P1) | PR #174 `RATE_LIMIT_STORE_FAILURE_MODE`; persistent limiter not wired |
| Financial protection overall | BLOCKED | Spec: `engineering/reviews/financial-exposure-audit-20261127.md` (allowances pending owner approval) |
| Migration A/B pre-migration snapshot | NOT MET | Owner's "Yes, both" was conditional on a snapshot; none was taken. Backup status not readable with the available tools; check the Supabase dashboard for both projects |
| Production `GEMINI_API_KEY` flagged unusable | OPEN | Production logs `[CONFIG_SECRET_UNUSABLE]` for GEMINI_API_KEY only; `analyzerReady` stays true because Gemini is not in its gate. OCR and transcription may be affected. Not determined: would need the shape diagnostic on production, which is excluded |
| Preview diagnostic `a5b0ac88` / alias `diag-status-067446a` | LIVE, removal pending authorization | Preview only; not referenced by production or by the RC |
| Diagnostic logging in release candidate | PASS | `CONFIG_SECRET_SHAPE` not present in `engineering/integration` or `release/rc-20261127` (grep) |

## Update: PR #191 at dd9993b (approval racing refund), 2026-11-27
| Requirement | Status | Evidence |
|---|---|---|
| Typecheck at dd9993b | PASS | `tsc --noEmit -p .` exit 0 (worktree `pr191-audit`) |
| Admin and unit tests | PASS (56), 32 skipped | `api/cloudflare-admin-api.test.ts`; `tests/devin/payment-schema-qualification.pg.test.ts` skipped: no `CREDIT_PG_URL` / PostgREST binary here |
| Approve-then-refund race (code) | PASS by reading | refund writes its audit record before expiring codes; approve checks after insert and cancels the code by hash |
| Refund-then-approve race (code) | PASS by reading | the post-insert check sees `refunded` and retires the code |
| Database-backed proof of the race | BLOCKED | needs Devin's PostgreSQL 16 + PostgREST harness |
| Minor (non-blocking) | NOTE | `settlementOf` returns `undefined` when there is no settlement, and the new guard relies on `undefined !== null`. Recommend an explicit `=== undefined` branch |
