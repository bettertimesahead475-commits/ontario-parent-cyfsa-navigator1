# Migration E qualification — 2026-11-27

**Decision: combined #200 + #202 passes disposable qualification, including rejection
of legacy stacked refunds. E remains deferred from production activation.** The
guard is not mixed-version refund support. Do not enable one-off top-ups or
refund writes until all affected traffic uses the combined app. The authoritative
register was not edited.

Base: PR #181 at `6f8d876a87029c66ff4195aef6e20920e171baee`. The E apply SQL
differs from `release/rc-20261127` at `dd02ef34b862b89b0a755cf568ca9e18f2efa674`,
so this branch stacks on #181.
Tests used disposable PostgreSQL 16.16 with synthetic data and the captured payment
schema (including its grants), supplemented by a `free_usage` fixture. The payment
handler tests use PostgREST 12.2.3, local service-role JWTs and the exact two-column
G grant in the scratch fixture (the standalone G file is not on #181); Firebase identity and
Supabase Storage (audit and create-once locks) are test doubles. No production service,
customer data, payments, credentials, migration execution or deployment were used.

## Evidence

The final combined run used local merge `96b38fda747eceba9ff9f5212c7e2e0843eca677`
(#200 `29f0594fd7d0d6d0456d3f0377c7a14d48e01a1d`, #202 `caa23687640f0f86b4cb15de80fa41e0bfc2afbe`)
plus this guard and the combined qualification harness. No combined branch was pushed.

| Result | Combined evidence |
|---|---|
| PASS | `Test Files  19 passed (19)`; `Tests  432 passed (432)`. Approval/refund (including 12 simultaneous pairs), credit reservation and restore races, duplicate restore, interruption, reapplication, entitlement preservation, RLS, and rollback/repair passed. |
| PASS | The trigger rejects direct expiry reductions and grant reductions/clears on stacked rows. The refund RPC can still update the entitlement and issue its receipt. Its setting is function-scoped; it did not authorize a following update in the same transaction. With the setting explicitly enabled, both `anon` and `authenticated` still received `42501` on direct UPDATE. Monthly renewal, top-ups and ordinary legacy refunds after P still work. |
| PASS (rejection only) | On G/P/D/E with `82dfe65`, the first stacked refund returned HTTP 502, code `ADMIN_STORE_REJECTED`, error `The database rejected the request.` The refund audit and one-time lock were already written, but no `refund-applied` or E receipt was written. The session retained 10 credits and 60 days. Retrying returned HTTP 200 with `resumed: true`, `sessionsShortened: 0`, and `shorteningsForReview: 1`; it leaves the reduction to manual review, not an automatic repair. The combined handler still records 10 → 5 and 60 → 30 days as one refund. |
| PASS | `TypeScript exited 0`. Backup rehearsal: `PASS: pre-E backup restored with existing Premium entitlement and 2 used units`; `PASS: post-E backup restored separately; the pre-E backup does not contain the intervening payment or refund`; `PASS: forward repair restores the missing RPC and preserves the used payment, original usage, and refund idempotency`. |
| BLOCKED | Operational cutover, current production bindings and hosted recovery were not exercised. |

G ships with P: the unchanged legacy handler still records but returns
`501 ADMIN_SCHEMA_UNAVAILABLE` on an activated refund before P and leaves access intact.
Combined run logs: `~/.cache/migration-e-guard-{vitest,tsc,backup}.log`.

| Result | Check and observation |
|---|---|
| PASS | Existing paid sessions and `free_usage` rows were unchanged by E. Premium renewed on the same ID, stacked 5 + 5, and added 30 days. Refund through the real handlers took 10 → 5 and 60 → 30 days; retry was `ALREADY_REFUNDED` with one SQL receipt. Basic and monthly behavior, D's duplicate redemption guard, and separate-connection top-ups/refunds were also exercised. |
| PASS | Separate service-role transactions contended for the final unit; `pg_blocking_pids` identified the specific blocker. Results: `reserved` / `limit`, counter 5; first release `released`, duplicate `noop`, counter 4; finalize `consumed`, attempted release `noop`, counter 5. B still protected an aged reservation while its analyzer job was running and reconciled it after failure. |
| PASS | PG terminated a backend after it wrote an uncommitted reservation; neither the marker nor counter survived, and retry reserved exactly one unit. Rolling back a refund removed both the receipt and the session change; retry applied once. |
| PASS | As actual `anon` and `authenticated` roles, reads of refunds and usage and calls to the privileged RPCs failed with SQLSTATE `42501`. Refund ledger RLS is enabled; as `service_role`, refund and reserve worked, but receipt UPDATE was denied. Duplicate refund key and unknown session FK failed with `23505` and `23503`. The redemption definer has `search_path=public, pg_temp`; the other E functions are invokers. |
| PASS | E reapplied over post-E traffic without changing any receipt, payment code, paid session or usage row. Custom-format backup/restore preserved pre-E entitlement and usage and, from the later snapshot, the used code and its `already_applied` receipt. The earlier snapshot did not contain these later transactions. |
| OUT OF SCOPE | **Approval/refund race.** Prior qualification on #197 reproduced that approval can issue a redeemable code after a refund. The G/P/D session owns this fix; no change or retest here. |
| PASS | **Manual credit restore.** The service-only RPC waited on the specific backend holding the session reservation lock, refused with `409 RESERVATION_PENDING` after the reservation committed, and left the finalized analysis charged. Subsequent deliberate restore deducted only the unit available. Through PostgREST, two requests using the same displayed count returned 200 then `409 CONCURRENT_UPDATE`, deducting one unit in only the selected monthly period. Before E, manual restore fails closed with `503 CREDIT_RESTORE_UNAVAILABLE`; deploy E before enabling that action on the new app. |
| PASS | **Receipt-preserving recovery.** With grants expired, rollback refused on the receipt ledger even with the credit-reduction override, preserving receipts and other accounting rows. Clean rollback without receipts still restores the D and original reservation fingerprints. Reapplying E to a post-E restore reinstated a missing restore RPC while retaining the used payment and refund idempotency. |
| PASS | **Stacked allowance.** Customer Quick and Forensic and admin balances reflect the one-off granted total; the tier default is used on null or on the pre-E projection, with no fallback on a permissions error. Monthly allowance behavior is unchanged. Old reserve and finalize RPC signatures still work. No UI or old production binary validation was performed. |
| BLOCKED | No registered, executable currency-denominated spending reservation or provider-usage ledger exists in this release. E has the pack-refund receipt table; `free_usage` holds paid-unit reservations and counters. Admin revenue aggregates payments and Storage refund/settlement history; it is not a spending reservation. `create_paid_access_credit_ledger_and_enforcement.sql` is explicitly superseded and must not be run. |
| BLOCKED | Independent fresh deployed binding and live paid-credit prerequisite/grant verification were not performed in this local-only handoff. No production readiness, PITR or restore permissions are attested here. |

Evidence locations:

- `tests/devin/early-renewal-credits-migration.pg.test.ts`: real transactions, locks,
  roles, A/B coexistence, preflight, interruption, reapplication and rollback guard.
- `tests/devin/early-renewal-credits-postgrest.pg.test.ts`: real service-role renewal,
  refund and monthly restore through the application handlers.
- `bash tests/devin/migration-e-backup-rehearsal.sh`: creates a network-isolated
  disposable PG 16 cluster, restores two separate scratch databases, and emits:
  `PASS: pre-E backup restored with existing Premium entitlement and 2 used units`;
  `PASS: post-E backup restored separately; the pre-E backup does not contain the intervening payment or refund`;
  `PASS: forward repair restores the missing RPC and preserves the used payment, original usage, and refund idempotency`.

For the database tests, start a **disposable** PG 16 server on loopback and use
`CREDIT_PG_URL=postgres://postgres@127.0.0.1:<port>/postgres` and
`POSTGREST_BIN=<local PostgREST 12.2.3 binary>` with
`NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/devin/early-renewal-credits-{migration,postgrest}.pg.test.ts`.
Other tests consuming the same environment may modify the scratch server's default
database; never point the suite at an operational host or proxy.

The duplicate restore regression on `1a66c4a` failed with
`AssertionError: expected 200 to be 409`. After the compare-and-set fix, the
focused PostgreSQL/PostgREST/API/console run reported `Test Files  12 passed (12)`,
`Tests  301 passed (301)`. `npx tsc --noEmit -p .` exited 0. The broad
Vitest run, without database opt-in and before the final focused integration
test was added, reported `Test Files  344 passed | 18 skipped (362)`,
`Tests  5165 passed | 561 skipped (5726)`.

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
| `pending/paid_sessions_early_renewal_keeps_credits.sql` (E) | `57f6fea9c42ddaa5677c7315e9deea8b210779cf93a25c3e95ec9b82b7319f73` |
| `pending/paid_sessions_early_renewal_keeps_credits.rollback.sql` | `74aa1be7562f44d3ac7cc89d25b4acc7004ac55832ee0ce4916bf8d7d4732908` |

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
  calls `paid_restore_credits`, which compares the console's displayed usage
  against the current counter under the paid-session advisory lock before updating.

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
   writes on the isolated clone, not live. Keep manual restores paused until
   the new app is serving all admin traffic; old app versions can still call
   the legacy, non-serialized restore path.
4. **Recovery:** keep E schema/data in place after transactions. Pause
   approval/redemption/refund, manual restores and conflicting analyzer writes;
   preserve the DB and Storage audit trail and take a current recovery snapshot.
   Reproduce on the isolated clone. For missing or incorrect E function
   definitions, verify the unchanged prerequisite objects and compare the
   replaced functions to the E definitions (initial preflight expects pre-E
   functions). Apply the checksum-pinned E file to the clone, not the down script. Compare receipt
   keys and amounts, used codes, usage markers/counters, entitlements and
   session expiry before and after; confirm function grants and repeat the
   interrupted/retried action in the clone. Reapplication was verified to
   restore a missing function and preserve accounting rows; it does not itself
   correct already-wrong balances or the separate G/P/D race. Obtain owner
   authorization for any operational repair. If comparison to pre-E state is needed, restore the
   older image into another scratch database and reconcile/replay the post-backup
   delta by payment reference, used code, session, refund key and reservation
   state (including Storage events). Never restore over the operational database
   or delete operational records; a release rollback must not erase later
   payments, entitlements, usage or refunds. Use the guarded down script only
   for a verified clean rollback before refund traffic; do not bypass the
   credit-reduction guard operationally.
5. **Downtime risk:** E takes an `ACCESS EXCLUSIVE` table lock for its schema
   changes/constraint validation; requests and existing transactions can block
   one another. The down script locks the refund ledger and paid sessions
   exclusively up front. Measure
   on a representative isolate, bound lock waits, and record a maintenance and
   recovery window before approval; no production duration is claimed.
