# Refund and settlement accounting ledger

**Pending approval and unapplied.** This records Interac refund and settlement decisions. It does not move money or reserve currency. Migration E's credit receipts and the separate G/P/D payment and entitlement prerequisites are unchanged. Resolve their applicable release gates before using the ledger with customer traffic.

## What changes

- With `PAYMENT_ACCOUNTING_LEDGER_ENABLED` unset or `false`, the Pages app records and reads finance events in the existing private Storage audit trail. Only the exact value `true` selects PostgreSQL. With it on, **only PostgreSQL writes refund and settlement events**; any database error fails closed. Other admin audit events still use Storage. The audit display merges both sources without re-listing imported financial events.
- PostgreSQL serializes the check and append per payment. A settlement request carries an idempotency key; a retry must reuse it. A later deliberate settlement operation uses a new key. There can be only one refund record and one completion per payment, even with different keys. A recorded refund is final in reporting and subsequent settlement attempts are refused.
- A committed refund record reserves the right to process the entitlement once. The app records completion after processing. If the process stops between the two, a repeat receives `409 REFUND_REQUIRES_REVIEW`; it neither reapplies the operation nor silently marks it complete. The underlying entitlement updates, email and external Interac refund are **not** part of that transaction. Completion records whether a shortening still needs review. Administrative suspension restores are conservatively blocked while any refund is incomplete because its affected sessions are not yet known.

## Cutover and downtime

1. Verify the actual Pages API and any scheduled consumers against the approved operational Supabase binding; do not infer the database from a project name. On the approved target run the read-only preflight and require each row to be true. Compare checksums. Take a verified recovery point including payments, entitlements and the Storage audit and create-once objects. Save a consistent recovery watermark and rehearse restoration in isolation. No live binding or recovery capability is attested by the disposable tests.
2. Keep the flag **off**. Before taking the definitive export, pause refund and settlement writes, including overlapping old deployments and direct admin entry points. Also pause dependent approve/reissue/claim/activate, suspension restore and payment-email processing while draining in-flight operations and switching their readers. An old binary does not know about the flag and must not receive those requests after activation. Do not rely on a UI-only pause.
3. Export the complete private `analysis_jobs/admin-audit` listing and bodies at the pause watermark with a read-only credential. Preserve the raw export, its object count/checksum and legacy one-time locks. Do not export only the newest page. Export `id,reference_number` from `public.payments` to a consistent JSON snapshot. Use only a restricted local directory for exports and generated SQL: they may contain financial data, staff addresses and reasons. See the offline commands below.
4. Review the plan. Stop on missing or ambiguous payments, invalid audit metadata, conflicting duplicate refunds, or unresolved/incomplete refunds. Identical legacy duplicate refund records can be coalesced by event type; the raw audit stays in the recovery archive. Check any reported coalescing, especially against external refund and entitlement evidence. A late settlement cannot hide an imported refund.
5. Apply the reviewed pending SQL after authorization. While writes are still paused, separately authorize the generated import SQL and execute it using the migration owner with stop-on-error. It verifies that payment IDs still match their unique references; it refuses a different ledger. Export the ledger, rerun reconciliation, and require zero missing rows and zero incomplete refunds. Compare state counts, the refund and settlement totals and representative audit timelines against the paused system. Verify ACLs and PostgREST cache on the intended deployment.
6. Set the flag to `true` on the new deployment and all affected readers. Verify only that build is routed and the ledger is healthy before resuming traffic. Watch for ledger errors, unknown reports, and incomplete refunds. Keep the legacy storage history read-only; never revert to Storage writers after ledger rows exist.

The write pause lasts from the final export through reconciliation and routing verification. Measure it with a full-size isolated rehearsal; no production-duration estimate was measured here. The import holds a SHARE lock on payments and an ACCESS EXCLUSIVE lock on the ledger; payment inserts and updates and ledger reads may wait. Use an approved lock and statement timeout and stop on contention instead of running both writers. Other database and frontend traffic need not be paused unless it depends on those writes.

## Offline plan and reconciliation

The script reads local JSON only. It has no database, HTTP client, or credentials. Planning emits reviewable SQL to stdout; it does **not** execute it.

| File | Shape |
|---|---|
| `audit.json` | Array of `{name, body}`, where `name` is the filename relative to `admin-audit/` and `body` is the parsed JSON stored in the object. |
| `payments.json` | Array of `{id, reference_number}` from the paused read-only snapshot. |
| `ledger.json` | Array of `payment_id,event,idempotency_key,occurred_at,actor,reason,details` rows from the post-import read-only snapshot. |

```sh
node scripts/reconcile-payment-accounting.mjs --plan audit.json payments.json > reviewed-import.sql
node scripts/reconcile-payment-accounting.mjs --reconcile audit.json payments.json ledger.json
```

The plan uses a stable `storage:<object name>` key. Reapplying the same import during the pause preserves existing rows. The reconcile command exits nonzero on mismatch, missing rows or incomplete refunds. Do not replay it as an import after activation: new events correctly make the import plan differ from the ledger.

## Rollback and forward repair

The down script takes an exclusive lock and **refuses if any ledger row exists**, including imported rows. An empty rollback is permitted only before activation with writers paused. If rows exist, leave the flag and ledger in place, pause affected operations, and obtain a current recovery point. Repair functions, views or grants by reapplying the checksum-pinned migration on an isolated clone and verifying the original event keys, rows and projections. Restore backups to a separate instance and reconcile the post-backup delta; do not roll back the ledger over activity.

For an incomplete refund, stop retries. Compare the original ledger entry and any credit receipt, access state, audit and external bank records. Complete or repair the specific missing entitlement step only after establishing what actually happened. When verified, append the completion through the service RPC with the audited evidence, including the actual revoked session IDs and any review requirement. Never update/delete an event, repeat an Interac transfer based on a retry response, or synthesize a completion merely to clear a warning.

## Disposable qualification

| Result | Evidence |
|---|---|
| PASS | Real concurrent PostgreSQL transactions waited on the per-payment lock, then deduped the same settlement key. Concurrent refund and completion attempts appended exactly once; a later settlement was refused. |
| PASS | Backend termination rolled back an uncommitted append. A committed but incomplete refund returned `REFUND_REQUIRES_REVIEW` on retry. |
| PASS | The read-only preflight passed. Empty rollback removed the ledger; nonempty rollback refused. Reapplying the migration preserved events. PostgreSQL refused direct ledger mutations by the service role and refused ledger reads/RPC calls by `anon` and `authenticated`. |
| PASS | With the flag off, unmodified `82dfe65` wrote only to the Storage double with the schema present. The offline plan from those events imported twice without changing rows. Activated handlers read the imported refund through real PostgREST. A synthetic ledger outage did not write to Storage. |
| PASS | `Test Files  6 passed (6)`; `Tests  150 passed (150)`; `TypeScript exited 0`. |
| NOT TESTED | Hosted Storage export, operational routing/pause, hosted backup recovery, and browser visuals. |

Apply only after preflight; rollback is a separately gated artifact.

| File (under `supabase/migrations_pending_approval/`) | SHA-256 |
|---|---|
| `payment_accounting_ledger.preflight.sql` | `218423f032c6c9d8ec2e52fcd59e0d721e81462b2fe052144d89e15e4585bc03` |
| `payment_accounting_ledger.sql` | `8082633b424b818d1e50ce15704b2274eea98ad20d086b211a9e534130905e42` |
| `payment_accounting_ledger.rollback.sql` | `5fc3ff956d2fb6f9ae8e092babde1dfd5b58c2fa44e6aa321bd66c3d8d01446a` |
