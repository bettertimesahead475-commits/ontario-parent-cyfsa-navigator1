# Migration E qualification — 2026-11-27

**Decision: FAIL; do not apply E or enable early one-off re-purchase.** The local tests
reproduce two application races and data loss in the supplied down script. Passing
reproduction tests verify the defects, not release readiness. The authoritative register
was not edited.

Base: `release/rc-20261127` at `dd02ef34b862b89b0a755cf568ca9e18f2efa674`.
Tests used disposable PostgreSQL 16.16 with synthetic data and the captured payment
schema (including its grants), supplemented by a `free_usage` fixture. The payment
handler tests use PostgREST 12.2.3 and local service-role JWTs; Firebase identity and
Supabase Storage (audit and create-once locks) are test doubles. No production service,
customer data, payments, credentials, migration execution or deployment were used.

## Evidence

| Result | Check and observation |
|---|---|
| PASS | Existing paid sessions and `free_usage` rows were unchanged by E. Premium renewed on the same ID, stacked 5 + 5, and added 30 days. Refund through the real handlers took 10 → 5 and 60 → 30 days; retry was `ALREADY_REFUNDED` with one SQL receipt. Basic and monthly behavior, D's duplicate redemption guard, and separate-connection top-ups/refunds were also exercised. |
| PASS | Separate service-role transactions contended for the final unit; `pg_blocking_pids` identified the specific blocker. Results: `reserved` / `limit`, counter 5; first release `released`, duplicate `noop`, counter 4; finalize `consumed`, attempted release `noop`, counter 5. B still protected an aged reservation while its analyzer job was running and reconciled it after failure. |
| PASS | PG terminated a backend after it wrote an uncommitted reservation; neither the marker nor counter survived, and retry reserved exactly one unit. Rolling back a refund removed both the receipt and the session change; retry applied once. |
| PASS | As actual `anon` and `authenticated` roles, reads of refunds and usage and calls to the privileged RPCs failed with SQLSTATE `42501`. Refund ledger RLS is enabled; as `service_role`, refund and reserve worked, but receipt UPDATE was denied. Duplicate refund key and unknown session FK failed with `23505` and `23503`. The redemption definer has `search_path=public, pg_temp`; the other E functions are invokers. |
| PASS | E reapplied over post-E traffic without changing any receipt, payment code, paid session or usage row. Custom-format backup/restore preserved pre-E entitlement and usage and, from the later snapshot, the used code and its `already_applied` receipt. The earlier snapshot did not contain these later transactions. |
| FAIL | **Approval/refund race.** The real `approvePayment` commits its pending→approved PATCH before issuing a code. With approval held before the insert, `refundPayment` returns 200 with zero expired codes or revoked sessions. Released approval returns 200 and leaves a live code. `claim-purchase` correctly returns `ORDER_CLOSED`; `activate-code` nevertheless returns 200 and the DB has one active entitlement. This crosses app / G/P/D ownership, not a failure of D's uniqueness constraint; hand off to the payment owner. |
| FAIL | **Manual credit restore race.** The real `restoreCredits` sees no pending marker; a separate reserve commits before it reads the counter. The counter compare-and-set then succeeds on the new value, returning the in-flight unit. Finalize reports `consumed` while the used counter is 0. The atomic release path above does not have this failure. Move the check and update into one service-only operation serialized with paid reservation/finalize/release, then rerun the race with the desired outcome. |
| FAIL | **Data rollback after traffic.** After all top-ups expire, the unmodified down script runs without the override and drops the populated receipt table. Reapplying E leaves receipts at 0. The original guard protects unexpired top-ups, and the clean rollback restores the D and reservation fingerprints, but the down script is not a recovery plan once accounting records exist. Do not use the credit-reduction override operationally. |
| PASS / FAIL | Old-style reserve and finalize calls (tier defaults, unchanged RPC signatures) work against E, and both pre-E and post-E payment schema paths were exercised. **Display compatibility fails for stacked allowances**: `analyzer-usage.ts` and admin `creditCounter` still use the tier default, not the granted total. The pricing restriction must remain until the display and accounting are corrected. This was identified in source; no visual or old production binary validation was performed. |
| BLOCKED | No registered, executable currency-denominated spending reservation or provider-usage ledger exists in this release. E has the pack-refund receipt table; `free_usage` holds paid-unit reservations and counters. Admin revenue aggregates payments and Storage refund/settlement history; it is not a spending reservation. `create_paid_access_credit_ledger_and_enforcement.sql` is explicitly superseded and must not be run. |
| BLOCKED | Independent fresh deployed binding and live paid-credit prerequisite/grant verification were not performed in this local-only handoff. No production readiness, PITR or restore permissions are attested here. |

Evidence locations:

- `tests/devin/early-renewal-credits-migration.pg.test.ts`: real transactions, locks,
  roles, A/B coexistence, preflight, interruption, reapplication and unsafe-down reproduction.
- `tests/devin/payment-schema-qualification.pg.test.ts`: G/P/D baseline and the E
  PostgREST tests, including approval/refund and manual restore/reserve reproductions.
- `bash tests/devin/migration-e-backup-rehearsal.sh`: creates a network-isolated
  disposable PG 16 cluster, restores two separate scratch databases, and emits:
  `PASS: pre-E backup restored with existing Premium entitlement and 2 used units`;
  `PASS: post-E backup restored separately; the pre-E backup does not contain the intervening payment or refund`;
  `PASS: reapplying E after the post-E restore preserves the used payment, original usage, and refund idempotency`.

For the database tests, start a **disposable** PG 16 server on loopback and use
`CREDIT_PG_URL=postgres://postgres@127.0.0.1:<port>/postgres` and
`POSTGREST_BIN=<local PostgREST 12.2.3 binary>` with
`NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/devin/early-renewal-credits-migration.pg.test.ts tests/devin/payment-schema-qualification.pg.test.ts`.
Other tests consuming the same environment may modify the scratch server's default
database; never point the suite at an operational host or proxy.

Final focused run: `Test Files  2 passed (2)`, `Tests  59 passed (59)`;
`npx tsc --noEmit -p .` exited 0. The full Vitest run before the final test-only
additions reported `Test Files  356 passed | 11 skipped (367)` and
`Tests  5357 passed | 461 skipped (5818)`. Local Vite and Pages Functions
builds completed, and npm audit reported 0 vulnerabilities. No UI or deployment
was changed or checked.

## Migration artifacts and order

E is pending and has **no assigned operational migration version**. Identify it by its
exact file checksum below; the lead must record the assigned version before any
authorized execution. Do not infer a timestamp from the filename or reuse A/B's versions.
Paths below prefixed `pending/` mean `supabase/migrations_pending_approval/`;
`migrations/` means `supabase/migrations/`.

| File | SHA-256 |
|---|---|
| `migrations/20261104230000_durable_analyzer_queue.sql` | `d4e8f3b360608f4699ec317a314112568faa957e7d5d6ee0747445613eafea66` |
| `pending/paid_credit_reservation_functions.sql` | `594c42a8e6e640744c27d467da13ecd1b70512a245298c18cc68353ab11d6e69` |
| `pending/free_scan_reservation_functions.sql` (A) | `95cdcb773313036b7aad972dc321480b2234c934bd507566d2739894f9d43b2c` |
| `pending/reconcile_skip_live_analyzer_jobs.sql` (B) | `6a97b17a03fa56f09c79a897383fcbfbf9f0cfcfaa4d6cd7cd57468e34dca3d5` |
| `pending/payments_service_role_review_update.sql` (G) | `6dd5117a4972ca63fe7feca0008ec2791a1dd09b9618e4f5d2fd430c88b684ce` |
| `migrations/20261110004740_preserve_monthly_renewal.sql` (P) | `6916521f08840cad96ee69632c3b01b16728ae669b7d0e05cb001f17f375f1f9` |
| `pending/access_codes_one_redemption_per_reference.sql` (D) | `f7087176c3f6cfba9343bd02019500e8825befffd1d2992b670b423507b680ae` |
| `pending/paid_sessions_early_renewal_keeps_credits.preflight.sql` | `a6e7a78af6d8d1c06d9a7407d4b9633df041a79ae1f2f076fac624e7cfaf90ac` |
| `pending/paid_sessions_early_renewal_keeps_credits.sql` (E) | `81d972ccf7347a9f48af17f2a434b622fb159c82603621321df725b6f516fe12` |
| `pending/paid_sessions_early_renewal_keeps_credits.rollback.sql` | `a676a05ef986edb6a349434f38a74e267ad0f6c30748d400eeb6e2f5930b0433` |

- **Clean disposable bootstrap:** captured payment schema and `free_usage`
  → durable analyzer jobs + paid reservation functions + A
  → B's separate concurrent index, then B
  → G for handlers → P → D → E. B replaces `paid_reconcile`; re-running the
  legacy paid functions after B would overwrite its live-job protection. E itself
  preserves B and directly requires D plus the paid reservation RPC baseline.
- **Operational sequence, only after clearance:** verify A/B and B's index already
  present; do not reapply them here. G is independent in SQL and required for real
  approval/refund; P must precede D, then run E preflight, then E. C (rate limiting)
  and F (outbox) are not E prerequisites.
- **Callers:** `activate-code.ts` and `claim-purchase.ts` call
  `redeem_access_code_atomic`. `_paid-credit-reservation.ts`,
  `_paid-credit-lifecycle.ts` and legacy `api/services/creditAccounting.ts` use
  paid reserve/finalize/release. Admin `refundPayment` calls
  `paid_refund_one_off_pack` for stacked one-off sessions; `restoreCredits`
  separately changes the usage counter and is not protected by E's advisory lock.

## Release gates, backup and recovery

1. **Target and read-only preflight:** the register captures production Pages
   deployment `0cc59589` (`82dfe65`) bound via `STAGING_SUPABASE_URL` to
   `nxfhvebzzobegubefcda`; relevant worker configs also point there.
   `qboidsfpjuxeqtfotryj` is not the registered target. The lead must recheck the
   actual current Pages and executor/consumer bindings in Cloudflare before use,
   comparing only project refs and recording no credentials. Check
   `max(version)` from migration history, the D unique index's validity and
   predicate, grants/RLS for the actual roles, the B reconciliation body/index,
   and run the E read-only preflight. Every blocking row must be true, not NULL;
   expected D and paid reserve body fingerprints are respectively
   `76dd0fe56ba742c3f50fbfef7dcfa536` and `b79c9a9d06a0375c8ab0036711e17c50`.
   Stop on drift; do not replay the legacy credit prerequisite over B.
2. **Secure backup:** record verified PITR coverage, time and recovery point or
   take an access-controlled, encrypted consistent backup with schema, data,
   role/grant metadata, migration history and file checksums. Separately capture
   Storage audit objects and create-once refund locks, and outbox/provider state
   if in use: SQL backup does not contain these. Record the common recovery
   watermark. Inventory and restore into a new isolated recovery environment,
   compare counts/checksums and signatures, rehearse refund/credit idempotency,
   and record measured recovery time and any loss window. The supplied script
   rehearses PostgreSQL custom-format dump and restore on synthetic data only,
   not hosted PITR, Storage recovery or a production timing SLA.
3. **Post-migration read-only checks:** confirm migration history/version and hash,
   exact E functions and unchanged grants, B and D indexes valid, positive credit
   constraint, ledger PK/FK/RLS and the expected zero row changes on apply.
   Compare captured aggregate counts and old balances at a consistent watermark
   and investigate mismatches before enabling new sales. Rehearse synthetic
   writes on the isolated clone, not live.
4. **Recovery:** keep E schema/data in place after transactions. Pause
   approval/redemption/refund, manual restores and conflicting analyzer writes;
   preserve the DB and Storage audit trail and take a current recovery snapshot.
   Reproduce against the isolated clone, then qualify a narrow forward repair
   that preserves receipt keys, codes, usage markers and session expiry.
   Reapplication was verified to preserve them; it does **not** repair the
   observed business races. If comparison to pre-E state is needed, restore the
   older image into another scratch database and reconcile/replay the post-backup
   delta by payment reference, used code, session, refund key and reservation
   state (including Storage events). Never restore over the operational database
   or delete operational records; a release rollback must not erase later
   payments, entitlements, usage or refunds. There is no qualified operational
   rollback or tested race repair on this revision.
5. **Downtime risk:** E takes an `ACCESS EXCLUSIVE` table lock for its schema
   changes/constraint validation; requests and existing transactions can block
   one another. The down script also takes the exclusive lock up front. Measure
   on a representative isolate, bound lock waits, and record a maintenance and
   recovery window before approval; no production duration is claimed.
