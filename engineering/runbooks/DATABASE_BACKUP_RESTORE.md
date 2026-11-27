# Database backup and recovery runbook

**Authority and limits.** The [migration release register](../MIGRATION_RELEASE_REGISTER.md) owns migration state, dependencies and qualification. This runbook is not authorization, does not qualify individual migrations, and cannot replace the missing **pre-A/B** snapshot with a backup taken today. Do not execute a live migration without written owner authorization for the exact target, SQL bytes, sequence and window. Do not restore over, delete from, change bindings for, or write customer data to either operational Supabase project as part of this procedure. Restore only to an isolated scratch PostgreSQL instance, with no application traffic or external integrations.

## 1. Verify the target and packet (read-only)

1. In Cloudflare, trace the production custom domain to the **active deployment**, and record the Pages project, environment, deployment ID and commit. Inspect the deployed Pages environment's `STAGING_SUPABASE_URL` (record only the URL origin), then follow Queue producers, consumers, DLQ, service bindings/executor and any scheduled jobs to their **active Worker versions** and resolved database URL origins. Confirm the relevant payment/analyzer routes' actual configuration at that commit: e.g. `functions/api/_durable-analysis-jobs.ts`, `functions/api/_supabase-paid-session.ts`, and the deployed counterparts of `wrangler.pages-queue-staging.jsonc` and `wrangler.production-analyzer-queue-consumer.jsonc`. Repo Wrangler vars, project names, Preview settings and a health endpoint that only reports readiness do not prove the production binding. Never reveal, copy or query the values of service keys.
2. Match every relevant URL's project ref to the Supabase dashboard's project ref, region, database name, direct SQL endpoint, and server major version. The register records `nxfhvebzzobegubefcda` as live-bound despite its name; `qboidsfpjuxeqtfotryj` is **not** an interchangeable target. Record dated, non-secret evidence for each binding and an independent reviewer. If an origin is unknown, cannot be read safely, or disagrees with the approved ref, stop. This repo rehearsal made **no** Cloudflare or Supabase live checks.
3. Use a designated secured operator host and the dashboard's **direct** SQL endpoint (not a transaction pooler or an unverified proxy); TLS must verify server identity (`PGSSLMODE=verify-full` plus an approved root via `PGSSLROOTCERT`). Set explicit `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`; the owner provisions credentials locally from the approved secret store via a private mode-0600 `PGPASSFILE` or approved session environment. Do not embed credentials in URIs, commands, shell history, chat, GitHub, or evidence. Prefer a time-bound read/backup role sufficient to see all rows in scope; if RLS or ownership prevents complete reads, stop and have the owner arrange the appropriate provider-authorized backup role, not a policy change.
4. Pin the release commit, exact migration file and numeric history version, and SHA-256 of the **exact SQL bytes** (and separate preflight, down/repair, and verification files). A pending filename is not a history version: allocate one in the approved packet; do not use the drill version. Freeze the packet after review. Payload, expected pre/post catalog state, dependencies and previous RPC definitions/fingerprints must be independently checked on disposable PostgreSQL; ticket/register status is not proof of the deployed schema.

```bash
git rev-parse HEAD
sha256sum -- "$MIGRATION" "$MIGRATION_PREFLIGHT" "$REPAIR_OR_DOWN"
python3 scripts/db/recovery.py preflight --project-ref "$VERIFIED_REF" \
  --version "$MIGRATION_VERSION" --migration "$MIGRATION"
```

Check that the server, role, major, recovery state and expected endpoint are correct. Save full evidence in the restricted operations record, not in Git. Run aggregate checks inside a read-only transaction (apply an agreed query/lock budget). The following are common release checks; compare to the pinned packet, do not accept any particular output blindly:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(),
       current_setting('server_version_num'), current_setting('transaction_read_only'),
       pg_is_in_recovery();
SELECT max(version) FROM supabase_migrations.schema_migrations;
-- Bind the packet's exact version as a psql variable (-v migration_version=...).
SELECT version FROM supabase_migrations.schema_migrations WHERE version = :'migration_version';
SELECT to_regclass('public.payments'), to_regclass('public.navigator_paid_sessions'),
       to_regprocedure('public.redeem_access_code_atomic(text,text,text)');
SELECT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid = to_regclass('public.access_codes') AND attname = 'redeemed_session_id'
    AND attnum > 0 AND NOT attisdropped
) AS has_redeemed_session_id;
SELECT md5(prosrc) AS redeem_body_fingerprint FROM pg_proc
WHERE oid = to_regprocedure('public.redeem_access_code_atomic(text,text,text)');
ROLLBACK;
```

Also run the entry's reviewed, read-only preflight in its own read-only transaction (enforce `ON_ERROR_STOP`), even if the tooling already returned a connection receipt. Inspect expected relation/column types, function identity and owners, indexes (valid/ready), constraints (validated), ACLs/RLS, ledger or queue invariants, blocking lock holders, replication/CDC lag, backup privilege coverage and storage space. Capture only counts/digests or catalog metadata in shared evidence; preserve prior definitions and instance details in the restricted packet. Missing schema, contradictory fingerprints, unrecognized history or a timeout means stop and escalate; don't substitute a different query or skip the gate.

## 2. Make and prove a restore point before every migration

- Choose a new artifact per target/version/attempt. Record the authorized coverage: app schemas, tables, sequences, RPCs, grants and dependencies, the migration history if needed, Auth, Storage/objects, and any data not covered. Scope must be an explicit, reviewed list. The script backs up only named PostgreSQL schemas. It **does not** capture foreign-table contents, PostgreSQL large objects, cluster roles/memberships/passwords, Supabase control-plane settings, Storage bucket bytes, or Firebase identities. Check extension configuration data, publications, subscriptions, tablespaces, materialized views and cross-schema references explicitly; if the object cannot be recreated safely/verified, block.
- Confirm any **existing** Supabase backup/PITR entitlement, oldest/latest **restorable** points, retention expiry, recoverable timeline and safe provider-supported isolated restore/export path. Don't enable paid services or select the provider's in-place restore action. A WAL location sampled by preflight is not an exported snapshot's commit boundary or proof of PITR. Provider PITR plus an independent verified logical artifact is preferred where already available. If uncovered dependencies or lag prevent proving required coverage or the promised recovery point, stop before execution.
- Quiesce mutation paths in the approved maintenance window: payments/approvals/refunds, activation/renewal, reservations, worker/Queue/DLQ/cron consumers and outbox senders, external callbacks and direct DB writers. Drain or account for in-flight work, verify no relevant writers remain, and hold a DDL/sequence freeze during backup. An exported repeatable-read snapshot ties logical data and fingerprints together; **sequences are not MVCC**, hence the freeze. External systems can keep accepting events; preserve their durable receipts/offsets. If a release cannot freeze writes, use a tested durable delta/CDC plan started **before** the backup and accurately linked to its snapshot, and obtain explicit owner acceptance of residual risk.
- Use compatible patched PostgreSQL clients (same major as the source, same `pg_dump` build on restore, with `--restrict-key` support), Python 3 and GnuPG. Use a private, owner-controlled mode-0700 staging directory **on an encrypted volume**; permissions alone do not verify encryption. Allow space for multiple plaintext copies plus ciphertext, and configure encrypted swap or no swap for recovery. Check the approved GPG recipient fingerprint out of band and confirm a separate authorized custodian can decrypt. Never execute or share the diagnostic schema SQL.

```bash
export CYFSA_RECOVERY_BACKUP_DIR="$RESTRICTED_BACKUPS"
python3 scripts/db/recovery.py backup --project-ref "$VERIFIED_REF" \
  --version "$MIGRATION_VERSION" --migration "$MIGRATION" \
  --schema public --schema supabase_migrations \
  --recipient "$RECOVERY_GPG_FINGERPRINT" --work-dir "$ENCRYPTED_PRIVATE_DIR" \
  --artifact "$RESTRICTED_BACKUPS/$ARTIFACT_NAME.gpg"
```

The schema list is an example, **not** adequate coverage without the per-entry scope decision. The GPG-encrypted bundle carries a custom archive, separate schema-only SQL, snapshot counts and SHA-256 fingerprints per ordinary table/partition (hashed rows sorted, preserving multiplicity), sequence state, and a SHA-256 manifest with source identity, scope and migration identity. Set `CYFSA_RECOVERY_BACKUP_DIR` in the trusted operator environment to the existing approved backup directory owned by the invoking account and not writable by others. Backup and restore only accept a direct, non-symlink `.gpg` file under that directory; the migration path must resolve within the repository's Supabase migration directories. Store ciphertext in access-audited storage with retention/immutability protection, not Git, tickets, chat, CI artifacts or ad hoc cloud storage. Record the emitted ciphertext SHA-256 in a separate trusted restricted release record; public-key encryption does not authenticate the sender and a hash supplied with an untrusted archive is not evidence. Capture backup/restore elapsed times and evidence; after abnormal termination inspect and clean up residual plaintext on the encrypted volume under owner policy.

### Scratch restoration and verification

1. Prepare a separate, disposable same-major PostgreSQL cluster with a **private Unix socket** and no published port or external egress. No production-linked services, FDWs, cron jobs, queue/mail senders, logical subscribers, or customer integration credentials are allowed; restoring SQL from a trusted dump can execute code. Provision required non-login roles and attributes (not real passwords), memberships, compatible extensions, encoding/locale and dependencies in the disposable cluster before restoring; do not use `--no-owner` or `--no-acl` to silence failures. Do not precreate the scratch database itself. Only the authorized operator/custodian may decrypt and run a real-data scratch restore on an approved encrypted host; the engineering rehearsal uses synthetic records only. Supabase-managed `auth`, `storage`, extensions and service roles may differ from vanilla PostgreSQL or be non-restorable with a customer role; agree the provider-supported restore route and prove dependencies, Auth/Storage metadata/object pairing and private access separately. A PostgreSQL SQL dump cannot restore Firebase accounts or the private Storage objects referenced by analyzer jobs.
2. Replace connection variables with the scratch socket, port, restore role and a **new** `recovery_scratch_*` name. Supply the exact packet SQL and trusted separately recorded hash:

```bash
python3 scripts/db/recovery.py restore --local \
  --version "$MIGRATION_VERSION" --migration "$MIGRATION" \
  --artifact "$RESTRICTED_BACKUPS/$ARTIFACT_NAME.gpg" \
  --artifact-sha256 "$RECORDED_CIPHERTEXT_SHA256" --work-dir "$ENCRYPTED_PRIVATE_DIR"
```

The script refuses remote restore, non-scratch names, wrong hashes, or existing databases. It creates a fresh DB with `template0`, retains the initialized `public` schema (PostgreSQL dumps its ACL relative to that initial state), and restores the remaining archive entries, including role grants, in one transaction. A nonstandard `public` owner or default ACL that cannot be recreated will fail the fresh schema comparison. It also compares table counts/hashes and sequence states. A failed restore can leave a scratch database; preserve evidence, then follow the disposable cluster's cleanup policy or retry with a new name, never overwrite. Before approving the restore point, check representative positive **and negative** role behavior, effective RLS policies, privileges and function ownership, foreign keys/indexes, extension versions/role memberships and transaction invariants. Schema/data fingerprints are not an external-system reconciliation or proof that the covered schemas alone can operate.

## 3. Execute and verify in the approved order

1. Start from the register and independently confirm the current state. A/B are recorded as already applied; don't rerun or roll them back because of this runbook. The register's order at this writing is **G → P → D (run D's preflight after P) → E → C (flag off) → F**. C/F are independent as documented in the register; changing order requires updating the reviewed packet, not inferring an order from filenames.
2. For **each** entry: record known-good deployment IDs, target identity and exact packet checksums; quiesce/drain, take and prove the new restore point or the explicitly approved equivalent with equivalent coverage, and record the reconciliation boundary. Re-run that entry's preflight and confirm no drift, lock budget and owner authorization. Use the approved execution channel with fail-fast SQL and the migration's designed transaction boundaries (don't blindly wrap scripts with their own transaction controls). Stop at the first failure rather than retry or record a history row by hand. No migration execution command is provided by the tooling.
3. Verify exact history version/checksum recorded in the release packet and compare expected schema/RPC fingerprints, index validity, grants/RLS and constraints. Compare aggregates for existing entitlements, jobs, ledger totals, payment duplication, outbox state and other entry-specific invariants before reopening. Prove compatible old/new app paths and rollback/repair semantics in scratch, including interrupted writes, and use approved non-mutating operational verification only. Enable traffic/flags and resume external dispatch only after sign-off; monitor errors, queue age/duplicates, stuck reservations, balance drift and outbox delivery. If verification fails, keep affected writers stopped and proceed to recovery based on actual commit state.

## 4. Preserve newer transactions and choose rollback or repair

- **Not committed:** verify transaction rollback and SQL history/catalog invariants read-only. If commits are ambiguous, investigate both DB state and external receipts first. No replay of a payment, entitlement, credit or email merely because a client request timed out.
- **Committed, no dependent activity:** only the reviewed inverse tested on the exact baseline may be considered, with owner authorization and fresh backup. Prove it keeps required customer state, complete dependencies and application compatibility. A SQL inverse is not a data recovery plan. If a role-only rollback removes an application capability (G), coordinate keeping that path closed.
- **Committed with newer transactions, dependencies or uncertain state:** never rewind the operational database. Take a new secured incident backup, keep the affected writers fenced, restore the pre-change state to a scratch side DB, compare with the incident state and author an **idempotent forward repair**. Rehearse it twice against a copy with the newer events and obtain owner approval for any operational action. Only restore affected service after reconciled state, intended permissions, balances and retry/outbox behavior are verified.
- **Delta capture:** before backup record a durable change stream position/watermark tied to the snapshot or a proven write fence and stable per-ledger high-water IDs. After failure, capture a bounded, encrypted read-only delta from the quiesced source/change stream, plus external provider/payment receipts and dispatch IDs. Include inserts, updates, deletes/tombstones, transactions that started before the snapshot but committed later, and foreign-key-linked rows. Date/ID watermarks are useful for candidate ranges on approved append-only ledgers, **not** proof of completeness: timestamps can be backdated and sequences allocate before commit. Use an overlap window plus idempotent keys and exact key/state differences, or a complete commit-ordered change feed; don't drop events outside a naïve `created_at > backup_time` range. If evidence cannot close the gap, stop for owner decision.
- Dry-run joins by stable payment/redemption/reservation/outbox IDs and provider idempotency keys; reconcile totals, statuses, activation/renewal/refund, balances and external sends. Apply in dependency order within tested transaction and lock semantics; a duplicate identical payload is a no-op, a conflicting payload is an escalation. Don't replay side effects from scratch. For previous missing restore points (including A/B), provider evidence, existing snapshots and ledgers are the inputs to incident-specific forward repair; no retroactive backup claim.

## Downtime and recovery risks

Do not promise a production RPO/RTO from the synthetic drill. Set approved per-entry recovery objectives and write-freeze/abort deadlines from measured backup, restore, validation and delta-replay times at representative size. Write downtime begins when mutation paths are fenced and ends after verification and controlled resumption; if reads are blocked by DDL, plan that outage separately. Restore duration depends on volume, index rebuilds, encryption, transfer and scratch capacity; verification rescans and sorts hashes and can extend the freeze. Long snapshots hold back vacuum; DDL/restore locks, unavailable keys, roster/extension mismatches, missing Storage/Auth coverage, failed queues/webhooks and PITR retention gaps can extend downtime or prevent complete recovery. Abort rather than lift safety gates if the window, space, lock or RPO/RTO budget is exceeded. Re-evaluate newer writes before any retry. See [disposable PostgreSQL evidence](DATABASE_BACKUP_RESTORE_EVIDENCE.md) for tested scope.
