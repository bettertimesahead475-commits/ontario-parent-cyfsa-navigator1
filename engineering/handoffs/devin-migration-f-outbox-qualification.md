# Migration F — transactional email outbox qualification

**Verdict: BLOCKED for live enablement.** The additive DDL passed on disposable PostgreSQL; the application does not guarantee that a committed payment action has a corresponding outbox row. The checked-in down migration is destructive once any email is recorded. Keep transactional email off until the backend owner resolves the enqueue gap or the owner explicitly accepts best-effort delivery with a reconciliation plan. This does not block unrelated migrations.

## Scope and target

- Release baseline: `dd02ef34b862b89b0a755cf568ca9e18f2efa674` (`release/rc-20261127`). F was introduced by `87f1d43f146b26a43fd632ec46f4152765864016` ([#182](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/182)). F resides in `supabase/migrations_pending_approval/` with **no assigned live migration version**. Record the actual deployment version and this checksum in the register if execution is authorized.
- The release register identifies Cloudflare Pages project `cyfsa-navigator-git-staging`, deployment `0cc59589` (commit `82dfe65`), bound through `STAGING_SUPABASE_URL` to `nxfhvebzzobegubefcda`. The outbox REST client `functions/api/_admin-store.ts` uses that binding; it does not select a project by name. This is recorded deployment evidence, not a fresh control-plane or live database check. The lead must confirm the **active Pages deployment's** binding and destination in a fresh read-only check; do not target `qboidsfpjuxeqtfotryj` on the basis of its name or intended purpose.
- F creates only a table, constraints, index and grants. No migration A–E, G or P dependency; current request, admin and processing paths rely on the pre-existing payments, access codes and paid sessions schemas. The register places F after C; keep that sequence unless the lead explicitly reorders.
- Processing in this RC is manual, through authenticated `POST /api/admin/email-outbox/process`. The route also queues renewal reminders. No Cloudflare cron or Worker drain was found. The flag `TRANSACTIONAL_EMAIL_ENABLED` must equal `true`; do not turn it on just to test production schema readiness.

| File (`create_transactional_email_outbox…`) | SHA-256 |
| --- | --- |
| `.sql` | `8dda8b08d429741fd2f94bf9b3a330ace009fad346fcafc8d5e08c9fa91e3d8c` |
| `.preflight.sql` | `ff78d5317256ce0bca5255b3d150b27acc0dd6cb25feae976c317e0ae00fb340` |
| `.down.sql` (disposable only) | `56c1ec2034b8129ac4c49117542653cc21f2df9c79e66cad388888ea25b6e9f9` |

## Disposable evidence

PostgreSQL 17.12 and PostgREST 12.2.3; loopback only. `tests/devin/fixtures/live-nxfh-payment-schema.sql` supplied the recorded pre-P schema, service role with `BYPASSRLS` and browser roles. The added Vitest suite uses synthetic records and the real Pages outbox functions, REST requests, commits and role checks. Gmail is a stub; Firebase verification is stubbed only for synthetic checkout requests. Audit Storage is an in-memory double. No live connection, data access, Gmail send, restoration or deployment was made.

| Check | Result |
| --- | --- |
| Checked-in SQL runner | `PASS: preflight (read-only) before apply`; `PASS: migration + assertions`; `PASS: migration is re-runnable`; `PASS: rollback drops only the outbox`; `PASS: re-apply after rollback`. The rollback result describes *scope*, not safety. |
| New PG suite + existing transactional email/admin suites | `Test Files  3 passed (3)`; `Tests  98 passed (98)` (8 new). A duplicate INSERT blocked behind the original uncommitted key; two simultaneous worker UPDATEs were observed waiting in `pg_stat_activity` before lock release. Only one worker invoked the sender, with one recorded attempt. |
| Permissions and data | Unique kind/key, allowed kinds/statuses, terminal payload clearing, due index and RLS asserted. Direct browser-role PostgREST reads exposed no rows; writes were not permitted. Admin summary denied a tokenless request; its masking is covered by the existing unit suite. Current checkout with flag off preserved the pre-F contract and the seeded payment and paid entitlement survived apply. |
| Fault and retry | Disconnected uncommitted claim rolled back; a confirmed pre-send failure retried with backoff and reached `failed` on attempt 5. A failed final database write after simulated provider acceptance left a committed claim in `sending`; later drain moved it to `unknown` without another send. A stale sealed access payload was cleared. This is not proof of exactly-once external delivery. |
| Old build | An isolated worktree at production commit `82dfe65` ran the real old `request-access` handler against PostgREST with F applied: new and keyed-reused checkout returned 200, one payment and no unexpected outbox row. `Test Files  1 passed (1)`; `Tests  1 passed (1)`. This is checkout coverage, not full old-build regression. |
| Reapply, down and backup | Reapplying F repaired an intentionally removed due index without changing any rows. Down then empty reapply erased all delivery evidence, while payments and entitlements survived. `pg_dump -Fc` before F and `pg_restore --exit-on-error` into a separate database gave `1|0|t` (entitlements, new payments, outbox absent). A fresh post-F dump restored separately gave `1|1|pending,sent,unknown`, matching the untouched source. |
| Typecheck and focused security checks | `npx tsc --noEmit -p .`: exit 0. `vitest run tests/security api/services/quotationAdversarial.test.ts`: `Test Files  6 passed (6)`; `Tests  250 passed (250)`. `npm audit`: `found 0 vulnerabilities`. No changes to auth, grants, CSP, live settings or UI. |

Re-run the main evidence using a dedicated disposable PostgreSQL cluster and pinned real PostgREST binary:

```sh
CREDIT_PG_URL=postgresql://postgres@127.0.0.1:<port>/postgres \
POSTGREST_BIN=/path/to/local/postgrest NODE_OPTIONS=--no-experimental-webstorage \
npx vitest run tests/devin/transactional-email-outbox.pg.test.ts \
  api/cloudflare-transactional-email.test.ts api/cloudflare-admin-api.test.ts
```

Use the harness against a throwaway cluster only; it creates and drops its own database and the captured fixture creates cluster-wide roles.

## Confirmed release gaps

1. **Committed payment, permanently missing notification after ordinary retry.** The test cut only the outbox POST, after the real checkout payment wrote and committed through PostgREST. The handler returned HTTP 200. With the fault removed, the same request key returned the original reference with `reused: true`; the pending payment still had no outbox row. The keyed reuse return is before `enqueueTransactionalEmail` in `functions/api/request-access.ts`. Approve/refund hooks also enqueue separately from the payment action; their equivalent interruptions were not reproduced here. This is the documented best-effort design, not a missing DB constraint. Claude (owner of the Pages handlers and migrations) should review a transactional write or durable, idempotent reconciliation with tested interruption recovery; do not try to fix it by retrying the payment itself.
2. **Down is not a live recovery procedure.** It drops every pending row and every sent/unknown dedupe record. A pre-F snapshot does not include subsequent payments or outbox history. Restoring it over the active database would lose later writes; re-enqueueing from it can lose or repeat messages. Preserve the table after any enabled use. The checked-in scripts were not edited because their paths are backend-owned.

## Owner-authorized runbook

1. Keep email off; ensure no manual drain or scheduled caller can start. Verify active deployment binding and DB identity using authorized read-only access, confirm version history and the expected absent outbox, and verify the chosen migration and checksum. Run F's `.preflight.sql`; expect `outbox_exists=false`, all prerequisite booleans true and three roles. Also verify `service_role` has `BYPASSRLS`, and current service grants and columns for `payments(reference_number,status)`, `access_codes(reference_number,code_hash,used_at,expires_at)` and `navigator_paid_sessions(id,email,tier,expires_at,revoked_at)`. Unexpected shapes or an existing outbox require review, not a blind reapply. This is a read-only gate; do not query customer row values.
2. Verify a current backup or PITR point for the active database. Record the source project, timestamp, actual version and checksum; validate restoration in a separate authorized isolated environment per the backup team's procedure, never over the source. Preserve newer transactions and outbox history during recovery: use the current source or a separately restored current snapshot for comparison and reconcile changes selectively; do not replay payment transactions or email sends from a pre-F snapshot. Restrict backup access because it contains recipient metadata and can contain sealed payloads.
3. After written owner approval and Claude's review, apply only the F forward SQL, once, within its existing transaction. Do not enable the flag during apply. The schema change is additive; no customer downtime is expected, but lock waits and PostgREST schema-cache delay can affect readiness. If the table is not visible to REST after database commit, review cache reload and actual permissions before proceeding. No cache or lock timing was measured on hosted Supabase.
4. With the flag still off, verify the checks below (read-only), migration history, and PostgREST schema visibility with a non-PII, no-row probe (`select=id&limit=0`). Confirm the browser roles cannot see outbox data and that the ordinary checkout path still works. Any email canary, credential configuration, scheduling or flag change is a separate, explicitly authorized action; start with an approved synthetic allowlist and sender check before considering real sends.

```sql
BEGIN READ ONLY;
SELECT relrowsecurity
FROM pg_class WHERE oid = 'public.transactional_email_outbox'::regclass;
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.transactional_email_outbox'::regclass;
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'transactional_email_outbox';
SELECT r.rolname, p.privilege,
       has_table_privilege(r.rolname, 'public.transactional_email_outbox', p.privilege)
FROM pg_roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(privilege)
WHERE r.rolname IN ('anon','authenticated','service_role');
SELECT status, count(*) FROM public.transactional_email_outbox GROUP BY status;
COMMIT;
```

Expect RLS enabled, the unique kind/key constraint and partial due index present, no browser privileges, and SELECT/INSERT/UPDATE only for the service role. No rows are expected before first enablement. For recovery, disable enqueue and stop starting drains; an already-started request may still run. Preserve pending, sending and terminal records. Allow genuinely stale `sending` rows to become `unknown` through the existing processor only after verifying restart conditions; reconcile unknown outcomes against the sender's Sent folder, not by resetting them to pending. If the only drift is a missing due index, an authorized, schema-checked reapply is the tested data-preserving repair; it does not repair arbitrary table or ACL drift. Older code can continue with the unused table in place. Do not use `.down.sql` on an operational database.
