# Disposable PostgreSQL backup and recovery evidence

**2026-11-27 — PASS (exit 0), synthetic workflow only.** Release base `dd02ef34b862b89b0a755cf568ca9e18f2efa674`. Two disposable, network-disabled Docker clusters using Unix sockets and ephemeral database files. PostgreSQL/clients 17.12, Python 3.10.12, GnuPG 2.2.27; a disposable encryption key. No live connections, credentials, production data, deployment or migration execution were used.

## Reproduce

From the repository root:

```bash
bash -n scripts/db/test-recovery.sh
bash -n scripts/db/test-pg-client.sh
python3 -W error -c 'from pathlib import Path; p = Path("scripts/db/recovery.py"); compile(p.read_text(), str(p), "exec")'
time POSTGRES_IMAGE=postgres@sha256:97fb53376be3e4fb1a8a61421daa69dcc3bf2fa39bda3259f5245f9a455af1a9 \
  bash scripts/db/test-recovery.sh
```

Source: `tests/devin/fixtures/live-nxfh-payment-schema.sql` (repo schema only, no live rows), plus repo migrations `20261104230000_durable_analyzer_queue.sql`, `20261109192000_restore_payment_checkout_service_role_access.sql`, `20261109202000_navigator_payment_summary.sql` and a synthetic RLS policy/identity sequence probe. The archive covers `public`, including synthetic payments and an existing entitlement. Scratch bootstraps Supabase-like non-login roles; the archive supplies the schema, ACLs and data.

Pending entry used: **G**, under test-only version `20990101000000` (not an operational version):

| File in `supabase/migrations_pending_approval/` | SHA-256 |
| --- | --- |
| `payments_service_role_review_update.sql` | `6dd5117a4972ca63fe7feca0008ec2791a1dd09b9618e4f5d2fd430c88b684ce` |
| `payments_service_role_review_update.preflight.sql` | `8d065f0cec27dfa2b16093c34ac07add3af58faa53704e81140fdd170a01ab59` |
| `payments_service_role_review_update.rollback.sql` | `b3250e83c40d96b56b2477b0c37345c2bf045ea12038c81c27d35bbc1e9f2d0a` |

## Recorded output (selected lines)

The refusals and SQL errors below were expected and explicitly asserted by the harness.

```text
Recovery stopped: Default requires an explicit local Unix socket directory.
Recovery stopped: Require the verified direct Supabase endpoint and TLS verify-full.
Backup ciphertext SHA-256: b97c3387112420b40142bf830dded71ee16cf18320436bd3df36efcb3b0fca2c
PASS: encrypted backup taken while an older-timestamp payment was uncommitted
ERROR:  division by zero
PASS: G re-applied; committed approval survived interrupted SQL; timestamp-only delta missed the late commit
Recovery stopped: Require a disposable recovery_source_* or recovery_scratch_* database.
Recovery stopped: Remote restore is prohibited.
Recovery stopped: Encrypted artifact SHA-256 mismatch.
Scratch restore verified: schema SQL, per-table counts and SHA-256, sequence states.
ERROR:  database "recovery_scratch_release" already exists
ERROR:  permission denied for table payments
ERROR:  duplicate key value violates unique constraint "payments_firebase_uid_request_key_uidx"
ERROR:  new row for relation "payments" violates check constraint "payments_status_check"
PASS: scratch refusal gates, RLS and policy visibility, ACLs, unique index, check constraint and existing entitlement
PASS: stable-key reconciliation replayed twice; G rollback removed privilege, not committed approval
PASS: disposable PostgreSQL backup/recovery drill

real	0m6.803s
```

The committed approval belonged to a row whose transaction started before the snapshot and committed after it, with `submitted_at` older than the captured watermark. The timestamp filter returned zero; stable-key reconciliation found that row, imported the approved state into scratch, and was a no-op on replay. This was an insert-only reconciliation cohort, not a general CDC replay. Earlier rehearsal attempts identified a client Python SHA-256 API mismatch and the need to preserve PostgreSQL's initialized `public` schema ACL; the final run above includes those fixes.

**Not verified:** live deployment bindings, operational credentials/permissions, live data, Supabase managed Auth/Storage/backup/PITR, representative production capacity, owner authorization, or individual qualification for any migration. The drill's elapsed time is not an operational recovery objective. The archive and key were destroyed after the synthetic run; re-running creates a different ciphertext hash. See the [runbook](DATABASE_BACKUP_RESTORE.md) for go/no-go gates.
