# Phase 2A Migration — Read-Only Pre-Approval Audit

> **Phase 2 reconstruction status — 2026-09-11.** This document preserves reviewed historical planning/audit evidence from `37db0b03a54970f3b7ddc8089a85dabc4b1948b6`. Current local branch `split/phase-2-foundations` inherits verified security branch `split/phase-1-security` at `6dbcbfd1ef020d333adb59063f4d407b8d5b271e` and restores only the reviewed case/matter foundations and reset-button removal. Phase 1 document scope notices describe the parent security branch; case/matter APIs are present on this dependent branch. Historical 139-test evidence is not a fresh verification of this reconstruction. Account/client provisioning remains incomplete; matter-specific and isolated transaction coverage remain outstanding. All SQL artifacts are provenance only: preserve the obsolete case-migration warning and never execute or replay any migration in this split. No Phase 2B or Phase 3 implementation, push, merge, production change or deployment is authorized. PR #21 and original refs remain unchanged.


> **Historical snapshot — superseded for current status.** See [current closeout status](PHASE_1_SECURITY_VERIFICATION.md#current-closeout-status--2026-09-10) for the verified 139-test suite, applied migrations, actual PR scope and remaining blockers. Older counts, pending-approval claims, stateless-session descriptions and next-phase instructions below are historical, not current authorization. PR #21 remains draft. The obsolete eslint/Firebase configuration references in older handoff material do not describe the current tree.


**Scope**: a read-only audit of one unapplied file, `supabase/migrations_pending_approval/create_case_ownership_foundation.sql`. No database was modified. No table, policy, or function was created. No migration was applied. No application code, test, or package file was changed. `main` was not touched. This audit was performed on branch `phase-1.5-security-remediation` (HEAD `227d2dd1e1d2bbf565465b0f6b38f6ef75bce15a`), where the pending migration and the Phase 2A application code already live.

**What was actually done to produce this report**: a direct read of the migration file in full; a direct, independent re-read of `api/services/cases.ts`, the `POST /api/cases` route in `api/_server.ts`, and both test files (`api/services/cases.test.ts`, the `POST /api/cases` block in `api/_server.test.ts`); fresh, read-only SQL queries against the live Supabase project (`qboidsfpjuxeqtfotryj`) — `information_schema.tables`, `information_schema.routines`, `information_schema.role_table_grants`, `information_schema.role_routine_grants`, and `list_tables` (verbose) — to check for naming collisions and grant behavior empirically rather than by assumption; and a fresh `git` state check. No `CREATE`/`ALTER`/`DROP`/`INSERT`/`GRANT`/`REVOKE` statement was executed against the live database during this pass.

---

## 1. Executive Summary

**This migration cannot be applied as written.** Two of its four `CREATE TABLE` statements — `public.cases` and `public.documents` — will fail immediately with a Postgres "relation already exists" error, because tables with those exact names **already exist in this project's `public` schema right now**, confirmed by a live, read-only query in this pass. These are the pre-existing "dead schema" tables extensively documented in `AUDIT.md` and `PHASE_1_FINAL_SECURITY_GATE.md` (14 unused tables from an earlier architecture, retained rather than deleted per explicit prior instruction) — and while both this migration's own header comment and `PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md` §22 correctly warned that those old tables' `auth.uid()`-based RLS model must not be reused, **neither document identified that the old tables' names themselves are already occupied**, which is a hard SQL-level blocker independent of any RLS or ownership-model consideration.

`case_members` and `document_versions` do not collide with anything and, considered in isolation, are well-constructed: RLS-correct (deny-by-default, matching the already-applied `free_usage` pattern), appropriately constrained, appropriately indexed, and the atomicity strategy for `create_case_with_owner()` is sound Postgres design. Beyond the naming collision, this audit found one further concrete hardening gap worth fixing before reapplication (the function's default `EXECUTE`-to-`PUBLIC` grant is not explicitly revoked — see §11/§12) and several smaller, non-blocking observations (see §19).

**Recommendation: `DO NOT APPLY`** — not a hardening preference, a functional impossibility as currently written. See §15/§20 for the exact blocking issue and what a corrected migration would need to address (not fixed here, per this audit's read-only scope).

---

## 2. Exact Migration Reviewed

File: `supabase/migrations_pending_approval/create_case_ownership_foundation.sql`, reproduced in full, verbatim, exactly as it exists on disk at commit `227d2dd`:

```sql
-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- Phase 2A: the persistent case-ownership foundation that all later CYFSA
-- evidence-intelligence work (Phase 2B onward, see
-- PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md) depends on.
--
-- This migration is NOT applied. It is prepared and reviewed, ready to run,
-- but withheld pending explicit human approval before touching production —
-- the same gate this repository has used for every prior schema change
-- (see enable_rls_free_usage_gmail_stale.sql in this same directory). This
-- environment also has no local/test Supabase database to apply it against
-- first: the automated test suite for this phase mocks Supabase entirely
-- (see api/services/cases.test.ts and api/_server.test.ts), so applying this
-- migration is not required for `npm test` to pass, and was not done here.
--
-- WHAT THIS CREATES:
--   public.cases            — one row per CYFSA case/matter.
--   public.case_members     — who may access a case, and in what role.
--   public.documents        — persistent identity for one logical document
--                              within a case (metadata only in this phase —
--                              no raw file, no OCR output, no AI analysis).
--   public.document_versions — one uploaded/re-uploaded instance of a
--                              document (metadata only — content_hash,
--                              mime_type, size, extraction_status).
--   public.create_case_with_owner(text, text) — a Postgres function that
--                              atomically creates a case AND its OWNER
--                              membership row in one transaction, so a
--                              partial failure can never leave a case
--                              without an owner. See the note below on why
--                              this, rather than two separate INSERTs from
--                              application code, is the correct atomicity
--                              strategy given this app's existing
--                              PostgREST/Supabase-JS-client architecture.
--
-- OWNERSHIP MODEL (deliberately NOT auth.uid()-based):
--   This application authenticates users exclusively via Firebase
--   Authentication, verified server-side with firebase-admin
--   (api/services/firebaseAdmin.ts). It has never used Supabase Auth, so
--   auth.uid() is always NULL for any request this application's own code
--   could ever issue. AUDIT.md and PHASE_1_FINAL_SECURITY_GATE.md both
--   document this at length, and specifically flag the 14 dead, unused
--   tables in this schema (cases/documents/etc. included, by unfortunate
--   name collision) as a cautionary example of exactly this mistake: they
--   were built with real, well-designed auth.uid()-based RLS policies for
--   an identity model this app has never actually produced tokens for.
--
--   These NEW tables below are named the same as some of those dead ones
--   but are NOT the same tables and are NOT built the same way. The
--   ownership model here is identical to the one already proven correct
--   for free_usage/gmail_processed_messages/stale_payment_alerts
--   (enable_rls_free_usage_gmail_stale.sql, applied and verified 2026-09-09,
--   see PHASE_1_SECURITY_VERIFICATION.md §3a):
--
--     Firebase ID token (client)
--       -> verifyFirebaseToken() (server, cryptographic verification)
--       -> verified Firebase uid (server-side only, never client-supplied)
--       -> server-side authorization check (case_members lookup, once
--          later phases add multi-member access; Phase 2A only ever
--          creates a case for the caller's own verified uid)
--       -> service_role database operation (RLS-bypassing, as designed)
--
--   RLS is enabled on all four tables below with ZERO policies. This means
--   anon/authenticated are denied every operation by Postgres's own
--   default-deny behavior; only service_role (which this application's
--   one Supabase client - api/services/access.ts's getSupabase() - always
--   uses) can ever read or write these tables. No new policy is added for
--   any future "reviewer" role either - if/when Phase 2H introduces
--   lawyer-reviewer access, that access still goes through this app's own
--   server-side case_members authorization check before reaching
--   service_role, never through a Supabase-level policy granting
--   anon/authenticated direct access.
--
-- WHY A POSTGRES FUNCTION FOR ATOMICITY, NOT TWO SEPARATE INSERTS:
--   The Supabase JS client used by this app (api/services/access.ts's
--   getSupabase()) talks to Postgres over PostgREST, which does not expose
--   a multi-statement client-side transaction primitive (no BEGIN/COMMIT
--   across two separate .from(...).insert(...) calls). Two independent
--   INSERTs from application code (create the case, then create its OWNER
--   membership) would leave a real window where a case could exist with no
--   owner if the process crashed, the connection dropped, or the second
--   call simply failed, between the two statements — exactly the failure
--   mode this phase's own instructions warn against.
--
--   create_case_with_owner() is a single Postgres function, called via one
--   .rpc() call, whose entire body (both INSERTs) executes as one atomic
--   Postgres transaction — this is a native, already-supported part of the
--   Supabase/PostgREST interface (RPC-backed Postgres functions), not new
--   infrastructure invented for this task. If the membership INSERT fails
--   for any reason, the case INSERT is rolled back too; nothing is ever
--   left half-created.
-- ============================================================================

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_owner_uid_idx on public.cases (owner_uid);

comment on table public.cases is
  'One CYFSA case/matter. owner_uid is a Firebase uid, verified server-side by verifyFirebaseToken() before every write - never a client-supplied value. No Supabase Auth / auth.uid() involvement anywhere in this table''s access model; see the header comment above.';

-- ----------------------------------------------------------------------------

create table public.case_members (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  firebase_uid text not null,
  -- CHECK constraint deliberately lists only the role(s) this phase actually
  -- needs. Extending it later (e.g. adding 'REVIEWER' for Phase 2H's lawyer
  -- workflow) is a one-line `ALTER TABLE ... DROP CONSTRAINT ... ADD
  -- CONSTRAINT ...` - not a schema redesign - so this is not treated as
  -- something to over-generalize now.
  role text not null check (role in ('OWNER')),
  created_at timestamptz not null default now(),
  -- Prevents the same Firebase user from accidentally becoming a duplicate
  -- member of the same case (e.g. a retried request after a network blip).
  unique (case_id, firebase_uid)
);

create index case_members_case_id_idx on public.case_members (case_id);
create index case_members_firebase_uid_idx on public.case_members (firebase_uid);

comment on table public.case_members is
  'Who may access a case, and in what role. firebase_uid is always the server-verified uid from verifyFirebaseToken() - never a client-supplied value. The case creator receives exactly one OWNER row here, created atomically with the case itself via create_case_with_owner().';

-- ----------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  -- Metadata-only in this phase, per explicit instruction: no raw file, no
  -- OCR output, no AI analysis output belongs on this table yet. This
  -- column exists so a document has a stable, human-readable identity
  -- across re-uploads/versions even before any content is attached to it.
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_case_id_idx on public.documents (case_id);

comment on table public.documents is
  'Persistent identity for one logical document within a case. Deliberately metadata-only in Phase 2A - no raw file storage, no OCR output, no AI analysis. See document_versions for per-upload metadata, and PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md §7/§22 for the planned page-anchored extraction storage in a later phase.';

-- ----------------------------------------------------------------------------

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  original_filename text,
  mime_type text,
  file_size_bytes bigint,
  -- Suitable for later exact-content deduplication (Phase 2B/2D, see
  -- PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md §16) - a sha256 hex digest
  -- of the extracted text, once extraction exists. Nullable now since
  -- nothing computes it yet in this metadata-only phase.
  content_hash text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  -- Prevents two versions of the same document from accidentally claiming
  -- the same version number.
  unique (document_id, version_number)
);

create index document_versions_document_id_idx on public.document_versions (document_id);
create index document_versions_content_hash_idx on public.document_versions (content_hash);

comment on table public.document_versions is
  'One uploaded/re-uploaded instance of a document. Metadata-only in Phase 2A (no raw file bytes, no extracted text/pages yet) - content_hash and extraction_status exist now so Phase 2B can populate them without another migration.';

-- ============================================================================
-- Row-Level Security: enabled, zero policies, on all four tables above.
-- anon/authenticated are denied every operation by default; only
-- service_role (this app's one and only Supabase access path) can read or
-- write. See the header comment for why this is correct and sufficient,
-- exactly mirroring the already-applied, already-verified pattern on
-- free_usage/gmail_processed_messages/stale_payment_alerts.
-- ============================================================================

alter table public.cases enable row level security;
alter table public.case_members enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;

-- ============================================================================
-- Atomic case + OWNER-membership creation.
-- See the "WHY A POSTGRES FUNCTION FOR ATOMICITY" note in the header comment.
-- Runs as SECURITY INVOKER (the default) - it is only ever called by this
-- app's service_role client, which already bypasses RLS regardless, so no
-- SECURITY DEFINER elevation is needed or used.
-- ============================================================================

create or replace function public.create_case_with_owner(p_owner_uid text, p_title text)
returns public.cases
language plpgsql
as $$
declare
  new_case public.cases;
begin
  insert into public.cases (owner_uid, title)
    values (p_owner_uid, p_title)
    returning * into new_case;

  insert into public.case_members (case_id, firebase_uid, role)
    values (new_case.id, p_owner_uid, 'OWNER');

  return new_case;
end;
$$;

comment on function public.create_case_with_owner(text, text) is
  'Atomically creates one cases row and its OWNER case_members row in a single Postgres transaction, so a case can never exist without an owner even if one of the two inserts fails. Called via db.rpc(''create_case_with_owner'', {...}) from api/services/cases.ts - see that file for the server-side authorization that runs before this is ever invoked.';

-- ============================================================================
-- POST-APPLY VERIFICATION (run these after applying, expect the results shown):
-- ============================================================================
-- select relrowsecurity from pg_class where relname in
--   ('cases','case_members','documents','document_versions');
--   -- EXPECTED: true for all four rows.
--
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename in ('cases','case_members','documents','document_versions');
--   -- EXPECTED: 0.
--
-- begin;
--   set local role anon;
--   select count(*) from public.cases;              -- EXPECTED: 0 rows (denied)
--   insert into public.cases (owner_uid, title) values ('x','x'); -- EXPECTED: ERROR (RLS)
-- rollback;
--
-- select create_case_with_owner('test-uid-verify', 'Verification Case');
--   -- EXPECTED (as service_role only): one row back, and a matching
--   -- case_members row with role='OWNER' for the same case id and uid.
--   -- Clean up manually after verifying: delete the row this created.
--
-- ROLLBACK IF NEEDED:
--   drop function if exists public.create_case_with_owner(text, text);
--   drop table if exists public.document_versions;
--   drop table if exists public.documents;
--   drop table if exists public.case_members;
--   drop table if exists public.cases;
```

---

## 3. Git State (independently re-verified in this pass)

| Check | Result |
|---|---|
| Branch | `phase-1.5-security-remediation` |
| HEAD | `227d2dd1e1d2bbf565465b0f6b38f6ef75bce15a` |
| Working tree | Clean (`git status --short` empty) |
| Local vs. `origin` | `git log --oneline -1 origin/phase-1.5-security-remediation` returns the identical `227d2dd` |
| `main` state | `origin/main` HEAD is `760a0cf`; `git merge-base origin/main HEAD` returns that exact same SHA — the remediation branch's 12 commits sit cleanly on top of `main` with zero divergence on `main`'s side |
| Unexpected changes | None found — no uncommitted, staged, or untracked files anywhere in the working tree |

No PR-state check was re-run in this pass beyond the branch/commit verification above (the task's read-only scope did not require it and no code/PR-affecting action depends on it here); the previously-reported PR #21 state (open, draft, unmerged) was not contradicted by anything found in this pass.

---

## 4. `cases` Audit

| Property | Value |
|---|---|
| Columns | `id` (uuid), `owner_uid` (text), `title` (text), `description` (text), `created_at` (timestamptz), `updated_at` (timestamptz) |
| Nullability | `id`, `owner_uid`, `title`, `created_at`, `updated_at` — `NOT NULL`. `description` — nullable (correctly optional). |
| Defaults | `id`: `gen_random_uuid()` (server-generated, never client-supplied). `created_at`/`updated_at`: `now()`. No default on `owner_uid`/`title`/`description` — correct, since these must always be explicitly supplied by the function that creates a row. |
| Primary key | `id` (uuid) — appropriate, server-generated, non-guessable. |
| Foreign keys | None outbound (this is the root entity). |
| Indexes | `cases_owner_uid_idx` on `owner_uid` — supports "list all cases owned by this uid." |
| Constraints | None beyond `NOT NULL`s and the implicit PK uniqueness. **No length constraint on `title`** — see §15 (Constraint Audit). |
| Ownership representation | `owner_uid` — a plain `text` column holding a Firebase uid. Verified in application code (`api/services/cases.ts`, `api/_server.ts`) to always originate from `verifyFirebaseToken()`'s cryptographically-verified output, never a request-body field. The migration itself performs no validation that `owner_uid` looks like a real Firebase uid (no format check) — acceptable, since this table's own DDL cannot know what a valid Firebase uid looks like, and the actual guarantee comes from the application layer, not the schema. |
| Timestamps | `created_at`/`updated_at` both present, both default to `now()`. **Note**: nothing in this migration or in `create_case_with_owner()` updates `updated_at` on a future `UPDATE` (no trigger) — harmless today (no update path exists yet), but worth remembering once a "rename case" or "edit description" feature is added in a later phase; `updated_at` would need to be set explicitly by that future code or by a trigger added at that time. |
| Unnecessary sensitive data | None found. No email, no document content, no free-text field beyond `title`/`description`, which are user-chosen labels, not case-file content. |

---

## 5. `case_members` Audit

| Property | Value |
|---|---|
| Columns | `id` (uuid), `case_id` (uuid), `firebase_uid` (text), `role` (text), `created_at` (timestamptz) |
| Nullability | All five columns `NOT NULL`. Appropriate — every field here is essential to what a membership row means. |
| Constraints | `role text not null check (role in ('OWNER'))` — a real, enforced enum-equivalent, extensible later via `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...`. `unique (case_id, firebase_uid)` — prevents duplicate membership rows for the same uid in the same case. |
| Uniqueness | Confirmed via the composite `unique(case_id, firebase_uid)` constraint — this is exactly the constraint needed to satisfy the task's "prevent duplicate membership" requirement, and it also, as a side effect, creates a btree index usable for "given a case_id and a firebase_uid, is this a member" lookups (the authorization check pattern later phases will need). |
| Role restrictions | Enforced at the database layer via the `CHECK` constraint — a row with any value other than `'OWNER'` is rejected by Postgres itself, not merely by application-layer discipline. |
| Foreign keys | `case_id references public.cases(id) on delete cascade` — see §8 for cascade-behavior analysis. |
| Indexes | `case_members_case_id_idx` (case_id) and `case_members_firebase_uid_idx` (firebase_uid), in addition to the implicit composite index from the `unique` constraint. Covers both "members of this case" and "cases this uid belongs to" access patterns. |
| Ownership relationship | `firebase_uid` is, like `cases.owner_uid`, always the server-verified uid — confirmed by tracing `create_case_with_owner()`'s single call site in `api/services/cases.ts`, which passes only `identity.uid` (from `verifyFirebaseToken()`) as `p_owner_uid`, which the function then uses for both the `cases.owner_uid` value and the `case_members.firebase_uid` value. |

---

## 6. `documents` Audit

| Property | Value |
|---|---|
| Columns | `id` (uuid), `case_id` (uuid), `display_name` (text), `created_at` (timestamptz), `updated_at` (timestamptz) |
| Foreign keys | `case_id references public.cases(id) on delete cascade`. |
| Ownership path | Indirect, via `case_id -> cases.owner_uid` / `cases -> case_members`. This table itself carries no `owner_uid`/`firebase_uid` column of its own — correct design, since a document's access should always be governed by its parent case's membership, not a separately-tracked owner that could drift out of sync. |
| Indexes | `documents_case_id_idx` on `case_id` — supports "list all documents in this case." |
| Constraints | `case_id NOT NULL` (a document must always belong to a case — correct; an orphaned, caseless document is never a valid state). No constraint on `display_name` (nullable, free text) — acceptable for a display label. |
| Raw files stored? | **No** — confirmed both by the migration's own explicit comment ("Metadata-only in this phase... no raw file, no OCR output, no AI analysis") and by the actual column list, which contains nothing resembling a file-content or file-reference column. This matches the task's explicit instruction not to introduce file storage in this phase. |
| Metadata appropriateness | Minimal and appropriate for a phase whose only job is establishing identity — `display_name` plus timestamps. No premature fields. |

---

## 7. `document_versions` Audit

| Property | Value |
|---|---|
| Columns | `id` (uuid), `document_id` (uuid), `version_number` (integer), `original_filename` (text), `mime_type` (text), `file_size_bytes` (bigint), `content_hash` (text), `extraction_status` (text), `created_at` (timestamptz) |
| Versioning | `version_number integer not null check (version_number > 0)` — a plain integer, not auto-incremented by any sequence or identity clause. **This means the application layer (Phase 2B, not yet built) will be responsible for computing the next version number itself** (e.g., `select coalesce(max(version_number),0)+1 from document_versions where document_id = ...`), which has an inherent TOCTOU race if two uploads for the same document happen concurrently. Not a Phase 2A defect (no code populates this table yet), but a concrete design note worth carrying into Phase 2B — see §17 (Future-Proofing). |
| Content hash | `content_hash text`, nullable, indexed (`document_versions_content_hash_idx`) — appropriately typed and indexed for a future sha256-hex-digest equality lookup, exactly as the migration's own comment states. |
| Foreign key | `document_id references public.documents(id) on delete cascade`. |
| Uniqueness | `unique(document_id, version_number)` — correctly prevents two versions of the same document from claiming the same version number. |
| Indexes | `document_versions_document_id_idx` (document_id) and `document_versions_content_hash_idx` (content_hash) — both are the access paths the task asked to confirm ("version by document," "content hash lookup"). |
| Extraction status | `extraction_status text not null default 'pending' check (extraction_status in ('pending','processing','completed','failed'))` — a real, enforced state enum, sensibly defaulted, with the exact four values Phase 2B's OCR pipeline would need. |
| Metadata | `original_filename`, `mime_type`, `file_size_bytes` — all nullable, all appropriate, all metadata-only (no content). |

---

## 8. Foreign-Key / Cascade Audit

| Relationship | On delete of parent | Assessment |
|---|---|---|
| `case_members.case_id -> cases.id` | `CASCADE` — deleting a case deletes all its membership rows | **Appropriate.** A `case_members` row has no independent meaning once its case is gone; nothing else references `case_members` as a foreign-key target, so this cascade cannot ripple further. |
| `documents.case_id -> cases.id` | `CASCADE` — deleting a case deletes all its documents | **Appropriate for Phase 2A's metadata-only scope** (nothing of evidentiary value exists yet — a `documents` row today holds only a `display_name`). **Worth flagging for later phases**: once `document_versions`, and in Phase 2C+ real evidence items, hang off a document, a hard `CASCADE` delete of a case would silently destroy everything under it with no recovery path. `PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md` §21 already recommends a `cases.deleted_at` soft-delete for exactly this reason — this migration does not implement that (correctly out of scope for Phase 2A, since no case-deletion feature or route exists yet), but the cascade behavior chosen here is the thing that will need to be revisited (or deliberately kept, with a soft-delete gate in front of it) before any real case-deletion feature is built. Not a Phase 2A blocker. |
| `document_versions.document_id -> documents.id` | `CASCADE` — deleting a document deletes all its versions | **Appropriate**, same reasoning as `case_members`: a version has no meaning without its document, and nothing references `document_versions` further downstream in this migration. |

**Orphaned records possible?** No — every child table's foreign key is `NOT NULL` with `ON DELETE CASCADE` to its parent, so no row in `case_members`, `documents`, or `document_versions` can ever exist without a valid, live parent.

**Missing or excessive cascade behavior?** None found for Phase 2A's actual scope. The one forward-looking concern (cascade-deleting real evidentiary content in a later phase) is noted above as a design point for Phase 2I/whenever case deletion is actually built, not a defect in this migration.

---

## 9. Ownership Model

Traced end-to-end, independently, against the actual current code (not assumed from the migration's own comments):

- **Where is the Firebase uid stored?** `cases.owner_uid` and `case_members.firebase_uid` — both plain `text` columns, both populated exclusively via `create_case_with_owner(p_owner_uid, ...)`'s single parameter, which in turn is populated exclusively by `api/services/cases.ts`'s `createCase(ownerUid, title)`, whose only caller (`api/_server.ts`'s `POST /api/cases` handler) passes `identity.uid` — the return value of `await verifyFirebaseToken(req.header("authorization"))`. Confirmed by direct code read, not inferred.
- **How is case ownership represented?** `cases.owner_uid` — a single, denormalized field naming the creator. (See §17 for a note on this field's relationship to `case_members` if ownership transfer is ever built.)
- **How is case membership represented?** `case_members` rows, one per `(case_id, firebase_uid)` pair, each with a `role`. Phase 2A only ever produces exactly one such row (the creator's `OWNER` row), created atomically with the case.
- **Can ownership be spoofed?** No client-supplied field can influence `owner_uid`/`firebase_uid` — confirmed by re-reading the route handler: it destructures only `{ title }` from `req.body`, and the route's own tests (`api/_server.test.ts`, `"uses the server-verified uid as owner, never a client-supplied one"`) send a body containing `ownerUid`, `uid`, `userId`, `role`, and `id` spoof fields and assert none of them reach `createCase()` or the response.
- **Can client-provided ownership affect database state?** No — the only value that reaches the database as an owner/member identity is `identity.uid`, which is the output of a cryptographic token verification the client cannot forge (Firebase ID tokens are signed by Google and verified server-side via `firebase-admin`'s public-key verification, unchanged from the mechanism already audited and confirmed correct in `AUDIT.md` §3 and re-confirmed in `PHASE_1_FINAL_SECURITY_GATE.md` §9).
- **Does the service layer receive only server-verified identity?** Yes — `api/services/cases.ts`'s `createCase()` takes `ownerUid: string` as a plain parameter and does no verification of its own, by design, matching the same trust pattern every other service function in this codebase already uses (`usage.ts`'s `getFreeUsage(uid)`, `access.ts`'s `checkAndConsumeFreeToolUse(email, tool)`) — verification is the route handler's job, consistently, everywhere in this app, not re-implemented per-service-function.

**Conclusion**: the ownership model as designed and as actually implemented in application code is sound and consistent with the already-proven-correct `free_usage` pattern. This part of the audit found no issue.

---

## 10. RLS Audit

Verified by direct reading of the migration's DDL (the tables do not yet exist live, so this is a static review of the SQL, not a live query against created objects — see §15 for what remains to be confirmed post-apply):

| Table | RLS enabled? | Policy count | `USING(true)`? | `WITH CHECK(true)`? | Accidental public policy? |
|---|---|---|---|---|---|
| `cases` | Yes (`alter table ... enable row level security`) | 0 (no `create policy` statement anywhere in the file for this table) | No | No | No |
| `case_members` | Yes | 0 | No | No | No |
| `documents` | Yes | 0 | No | No | No |
| `document_versions` | Yes | 0 | No | No | No |

**Does `service_role` access remain possible?** Yes — `service_role` carries Postgres's `BYPASSRLS` attribute at the role level (a Supabase-managed, project-wide setting, not something this or any migration controls), so RLS being enabled with zero policies has no effect on `service_role`'s access at all, regardless of policy count. This was independently confirmed in Phase 1 (see `PHASE_1_SECURITY_VERIFICATION.md` §3a's live `SET LOCAL ROLE service_role` test) and is architecturally identical here.

**Why this is appropriate for the Firebase-only identity architecture**: since this application never issues a Supabase-Auth session, `anon` and `authenticated` are never legitimately used as the identity of a real request against these tables — every legitimate access path is `service_role`, gated by the application's own server-side authorization (§9). RLS enabled with zero policies produces exactly the correct outcome (deny `anon`/`authenticated` entirely, allow `service_role` entirely) without needing a single policy expression that could itself be gotten wrong — this is, if anything, a *lower*-risk pattern than the already-approved Phase 1 fix, because that fix had to reason about three tables that had briefly had grants without RLS; here, RLS is enabled in the same migration that creates the tables, so (assuming the migration applies as a single unit — see §11's transactional note) there is no window during which the tables exist without RLS.

**Comparison to the Phase 1 pattern**: identical in spirit and construction to `enable_rls_free_usage_gmail_stale.sql` (RLS enabled, zero policies, `service_role`-only access) — this migration does not deviate from, weaken, or reinterpret that already-approved and already-verified pattern in any way.

---

## 11. Function Security Audit

`public.create_case_with_owner(p_owner_uid text, p_title text) returns public.cases`:

- **`SECURITY INVOKER` vs. `SECURITY DEFINER`**: **`SECURITY INVOKER`** (Postgres's default when neither keyword is specified — confirmed by the absence of a `SECURITY DEFINER` clause in the `CREATE FUNCTION` statement). The function executes with the privileges of whatever role calls it, not the privileges of the function's owner/creator.
- **Execution privileges / function owner**: the function's owner will be whatever role applies this migration (typically the Supabase project's `postgres`/administrative role, via the Supabase MCP `apply_migration` tool or the SQL editor) — this only matters for a `SECURITY DEFINER` function (it would then run with the *owner's* privileges); since this is `SECURITY INVOKER`, the owner's identity is not a live security factor here.
- **`search_path`**: **not explicitly set** (no `SET search_path = ...` clause on the function). This is a real, generally-recommended hardening gap (Supabase's own security advisor/linter flags "function search path mutable" as a standing warning for exactly this pattern) — **however, its actual exploitability here is mitigated by a separate fact this audit specifically checked**: every table reference inside the function body is fully schema-qualified (`public.cases`, `public.case_members`, and the `declare new_case public.cases;` type reference) — there is no unqualified identifier anywhere in the function body that a malicious `search_path` reordering could redirect to an attacker-created shadow object in a different schema. The classic search-path-hijack attack (create a same-named object earlier in the search path, then get a vulnerable function to resolve to it) requires the vulnerable function to use unqualified names; this one never does. **Recommend adding `SET search_path = public, pg_temp` anyway**, as defense-in-depth and to satisfy Supabase's own linter, but this is not, on the evidence here, a live exploitable path given the full qualification already present.
- **Can `public` schema resolution be manipulated to redirect this function's behavior?** No, per the qualification point above.
- **Are caller-controlled values (`p_owner_uid`, `p_title`) safely handled?** Yes — both are used exclusively as bound `plpgsql` parameters inside parameterized `INSERT ... VALUES (...)` statements, never concatenated into dynamic SQL (no `EXECUTE format(...)` or string-building of any kind anywhere in the function). **No SQL injection surface exists in this function.**
- **Can the function be invoked directly by `anon`/`authenticated`?** **This is the one concrete gap this audit identifies at the function-privilege layer.** Postgres grants `EXECUTE` on a newly created function to `PUBLIC` by default unless explicitly revoked, and this migration contains no `REVOKE EXECUTE ... FROM PUBLIC` / `GRANT EXECUTE ... TO service_role` statement for `create_case_with_owner()`. Supabase exposes every function in the `public` schema via PostgREST's `/rest/v1/rpc/<function_name>` endpoint by default, meaning **`anon` and `authenticated` would very likely be able to call this function directly**, bypassing this application's own server (its own auth check, its own title validation, its own rate limiter) entirely.
- **Is it intended to be server-only?** Yes, per the migration's own comments and per `api/services/cases.ts`'s exclusive use of it via the `service_role` client — but that *intent* is not currently backed by an explicit `REVOKE`/`GRANT` pair enforcing it at the database layer.
- **Can it create unauthorized cases, or memberships for arbitrary Firebase UIDs, if called directly?** **No — this is the important mitigating finding.** Because the function is `SECURITY INVOKER`, a direct call by `anon` or `authenticated` would execute the function's `INSERT` statements *as that calling role*, not as `service_role`. Since RLS is enabled on `cases`/`case_members` with **zero** policies (§10), and `anon`/`authenticated` do not have `BYPASSRLS`, **both INSERT statements inside the function would themselves be denied by RLS**, exactly as a raw, direct INSERT attempt by those roles already would be. A direct RPC call by `anon`/`authenticated` would fail with a row-level-security violation error, not succeed in creating unauthorized data.
- **Is privilege escalation possible?** No — `SECURITY INVOKER` means no privilege elevation occurs at all; the caller never executes with more privilege than it already had.

**Net assessment**: the function cannot currently be abused to write unauthorized data, because RLS is the actual, effective backstop regardless of the function's own `EXECUTE` grant. But relying solely on RLS here, with no redundant privilege control, is fragile defense-in-depth — if a permissive policy were ever mistakenly added to `cases`/`case_members` in a future migration (for a legitimate, unrelated reason), this function would immediately become a live, directly-callable, unauthenticated case-creation vector with no additional gate in front of it. **This is the audit's one concrete "condition" recommendation** (see §15/§20) — not a blocker on its own (see §15's overall verdict, which is driven by the naming collision in §1, not by this item alone), but a real, specific, fixable gap worth closing in the same pass that fixes the naming collision.

---

## 12. Grant / Privilege Audit

- **Can `anon` execute `create_case_with_owner()`?** Very likely yes, by Postgres's default `EXECUTE`-to-`PUBLIC` behavior on function creation, since this migration issues no `REVOKE`. Not independently verifiable against the live project (the function does not exist yet), but confirmed as the correct general Postgres/PostgREST default behavior, and consistent with this audit's finding in §11.
- **Can `authenticated` execute it?** Same as above.
- **Can `service_role` execute it?** Yes — `service_role` is unrestricted by ordinary grants (it also has `BYPASSRLS`, and typically superuser-adjacent privilege in a Supabase project's role configuration) and would be unaffected either way.
- **Can `PUBLIC` execute it?** Yes, by default, absent an explicit revoke (see above) — `PUBLIC` execute is exactly what makes `anon`/`authenticated` able to call it in the first place, since both roles inherit `PUBLIC`'s grants.
- **Can ordinary roles (`anon`/`authenticated`) insert directly into the tables (bypassing the function entirely)?** This audit checked this **empirically**, against the live project's actual current default-privilege behavior, using the three most comparable existing tables (`free_usage`, and the pre-existing, still-live `cases`/`documents` tables discussed in §1/§13): all three currently grant full `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` to **both** `anon` and `authenticated` at the plain table-privilege level (confirmed via a live `information_schema.role_table_grants` query in this pass). This project's default privileges clearly grant broad table access to `anon`/`authenticated` on new tables as a matter of project-wide configuration — **the four new tables in this migration should be expected to inherit the same default grants the moment they're created**, exactly as `free_usage` originally did before its RLS fix (`AUDIT.md` Finding C-1).
- **Does this undermine the intended RLS design?** **No** — this is precisely why RLS, not table-level grants, is this application's actual security boundary for every table it uses (§10). A table-level `INSERT` grant to `anon` is inert as long as RLS is enabled with no permitting policy, exactly as already proven correct for `free_usage` in the Phase 1 remediation. This audit surfaces the (expected, harmless) table-grant behavior for completeness and so a human reviewer isn't surprised by it post-apply, not because it constitutes a live risk on its own.
- **Recommendation carried into §15's conditions**: the migration's own "POST-APPLY VERIFICATION" block (checking `relrowsecurity` and policy count) should be extended, if this migration is revised and reapplied, to also confirm `create_case_with_owner()`'s `EXECUTE` privilege is restricted to `service_role` — see §11.

---

## 13. API Route Audit

`POST /api/cases` (`api/_server.ts`), traced fresh against the current file, not assumed from a prior pass:

1. **Firebase token verified?** Yes — `const identity = await verifyFirebaseToken(req.header("authorization"));`, the first line of the handler; a `null` result short-circuits with `401`/`SIGN_IN_REQUIRED` before anything else runs.
2. **UID comes from the verified token?** Yes — `identity.uid`, never any other source.
3. **Request body only supplies permitted fields?** Yes — `const { title } = body as { title?: unknown };` is the only destructuring of `req.body` anywhere in the handler; every other field is simply never read (not filtered by a denylist, which would be weaker — it's an allowlist-by-construction, since nothing else is ever named).
4. **Client-supplied UID cannot affect ownership?** Confirmed — no code path in the handler reads any UID-shaped field from the body at all.
5. **Case creation uses the trusted UID?** Yes — `await createCase(identity.uid, trimmedTitle)`.
6. **OWNER membership uses the trusted UID?** Yes, transitively — `createCase()` passes the same `ownerUid` through to `create_case_with_owner(p_owner_uid, ...)`, which uses that single value for both the `cases.owner_uid` write and the `case_members.firebase_uid` write (§4/§5).
7. **Can the database function be abused to bypass ownership?** Answered in full in §11: not via the application's own code path (which never lets a client influence the uid passed in), and not via a direct RPC call either, because RLS blocks the writes regardless of caller identity — the one caveat being the missing `EXECUTE` restriction, which is a hardening gap, not a currently-exploitable bypass.
8. **Do errors expose sensitive database internals?** No — the `catch` block logs the real error server-side (`console.error("[/api/cases]", err)`) and returns a fixed, generic message to the client (`"Failed to create case. Please try again."`), regardless of what the underlying Supabase/RPC error actually said. Confirmed by the dedicated test (`"does not leak a raw database/RPC error message if case creation fails"`), which asserts the response body does not match `/relation|does not exist|public\.cases/` even when the mocked service throws an error containing exactly that text.
9. **Is rate limiting applied?** Yes — the route is registered after `app.use('/api', apiLimiter)` (the global 100-requests/15-minutes-per-IP limiter, unchanged from Phase 1), so it inherits that limit automatically. No dedicated tighter limiter was added, which is consistent with how this app already treats other non-AI-cost, authenticated, low-cost routes (e.g. `POST /api/request-access`) — appropriate, since this route makes no external AI-provider call and has no meaningful cost-abuse shape beyond ordinary database writes.
10. **Is request-size protection in place?** The route is subject to the same global `express.json({ limit: "100mb" })` body-size cap as every other route in this app (unchanged, not specific to this route) — generically loose for a route that only reads a short string, but not a regression introduced by this route; identical exposure already exists on `/api/request-access` and others.
11. **Is input validation enforced?** Yes, at the application layer: non-object-body rejection, missing/non-string/blank-title rejection, and a 200-character title cap, all returning `400` before `createCase()` is ever called (confirmed by the dedicated validation tests). **Not additionally enforced at the database layer** — see §15's note that `cases.title` carries no `CHECK` constraint mirroring the route's 200-character cap. This means the guarantee currently rests entirely on the one call site continuing to validate correctly, with no schema-level backstop if a future code path ever calls `createCase()` directly without going through this route's validation.
12. **Do service-role credentials ever reach the client?** No — `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY` are read only from `process.env` inside `api/services/access.ts`'s `getSupabase()`, never included in any response body, and not referenced anywhere in `cases.ts` or the new route at all (the new code reuses the existing singleton, introducing no new credential-handling surface whatsoever).

**Conclusion**: the API route itself is correctly built and matches this application's existing security conventions in every dimension the task asked about. No issue was found at the route layer.

---

## 14. Atomicity Audit

**Can the operation end up with a case and no OWNER membership, or a membership with no case, or a partial/duplicate result?**

Traced from actual Postgres/PL-pgSQL semantics, not merely from the test suite (see the caveat below):

- The function body contains exactly two `INSERT` statements and no `EXCEPTION` block. In `plpgsql`, an unhandled error raised by any statement inside a function **aborts the entire function invocation** and rolls back every write the function had made up to that point, as standard, well-established Postgres transactional behavior — there is no code path in this function that could catch an error from the second `INSERT` and silently return a case anyway, because no exception handler exists to catch anything.
- Independently, PostgREST (the layer through which `.rpc()` calls reach Postgres) executes each HTTP request — RPC calls included — inside its own single transaction. This means even without `plpgsql`'s own function-level atomicity, the entire request is already wrapped in one transaction at the PostgREST layer.
- **Both layers agree**: a failure in the `case_members` INSERT rolls back the `cases` INSERT too. A failure in the `cases` INSERT never reaches the second INSERT at all (the `case_id` value it needs, `new_case.id`, would not exist). There is no sequence of events that produces an orphaned case, an orphaned membership, or a partially-created record.
- **Duplicate memberships**: not reachable through this function at all in Phase 2A, since the function always creates exactly one `case_members` row per invocation, for a brand-new case with a server-generated `id` — there is no scenario where this function's own logic could attempt to insert two membership rows for the same `(case_id, firebase_uid)` pair. (The `unique(case_id, firebase_uid)` constraint exists for future phases, once code other than this function can insert into `case_members` — e.g. an "invite a lawyer" feature.)

**Honest caveat about the test suite** (this audit independently re-read `api/services/cases.test.ts` rather than trusting the implementation description): the test named `"never leaves an orphaned case if the underlying transaction fails"` verifies that **the test double's own scripted behavior** (return neither row when a simulated failure flag is set) is correctly surfaced by `createCase()`'s error handling — it is a valid, useful test of the *service function's* error propagation, but it does **not** and **cannot** independently prove that real Postgres will actually roll back both statements together, because the test never touches a real database. That guarantee rests on the well-established, standard behavior of Postgres/plpgsql transactions described above, which this audit is relying on as documented, predictable database behavior — not on the mocked test, and not on an empirical test against a live database (none exists in this environment, and this migration is not applied). This distinction is worth stating explicitly rather than letting the test's name imply more than it actually proves.

---

## 15. Constraint Audit

- **UUID generation**: `gen_random_uuid()` on all four tables' primary keys — server-generated, cryptographically random, never client-suppliable, consistent with this project's existing convention (`stale_payment_alerts.id`, `access_codes.id`, etc. already use the same function).
- **Required fields cannot be NULL**: verified column-by-column in §4-§7 — every field that must always have a value is `NOT NULL`; every nullable field is genuinely optional metadata.
- **Title length/validation**: enforced at the **application layer only** (`POST /api/cases`'s 200-character cap) — **not mirrored at the database layer**. `cases.title` has no `CHECK (char_length(title) <= 200)` or similar. This is a real, if minor, defense-in-depth gap: the guarantee currently depends entirely on every future write to this table going through the one validated route. **Recommended condition**: add a length constraint to `cases.title` (and consider one for `documents.display_name` when that column starts being populated in Phase 2B) before/when this migration is reapplied.
- **Membership uniqueness**: works as designed — `unique(case_id, firebase_uid)`, verified in §5.
- **Role constraint**: works as designed — `check (role in ('OWNER'))`, verified in §5.
- **Version uniqueness**: works as designed — `unique(document_id, version_number)`, verified in §7.
- **Content hash indexing**: appropriate — a plain btree index on a nullable `text` column, correct for future exact-match lookups, verified in §7.
- **Foreign keys cannot produce invalid references**: confirmed — every FK in this migration targets a primary key column (`cases.id`, `documents.id`) with standard Postgres FK enforcement; no FK is left unconstrained or pointing at a non-unique column.
- **Missing constraint relevant to Phase 2 architecture**: the `version_number` race-condition risk noted in §7/§17 is a Phase 2B *application-logic* concern, not something this migration's DDL could fully solve on its own (a `unique` constraint already prevents two versions from *successfully* claiming the same number; it just means a naive "compute max+1" approach in Phase 2B will need a retry-on-conflict, not a schema change here).

---

## 16. Index Audit

| Access path (from the task's checklist) | Index present? |
|---|---|
| Case by owner | Yes — `cases_owner_uid_idx` |
| Member by case | Yes — `case_members_case_id_idx` |
| Member by Firebase UID | Yes — `case_members_firebase_uid_idx` |
| Document by case | Yes — `documents_case_id_idx` |
| Version by document | Yes — `document_versions_document_id_idx` |
| Content hash lookup | Yes — `document_versions_content_hash_idx` |

No unnecessary index was found (each index maps to a real, named access pattern from the task's own list or from the ownership-check pattern in §5). No materially important missing index was identified for Phase 2A's actual scope. One observation, not a gap: the composite unique constraint on `case_members(case_id, firebase_uid)` already provides an efficient index for the single most important authorization check ("is this uid a member of this case") — no additional composite index is needed on top of it.

---

## 17. Data Model Future-Proofing

| Future addition (from the task's list) | Does Phase 2A's foundation support it without a structural trap? |
|---|---|
| Lawyers / additional case members | Yes — `case_members.role` is a `CHECK`-constrained text column, not a hardcoded boolean or a separate table; adding `'REVIEWER'` is a one-line constraint change, and the table already supports multiple rows per case. |
| Multiple case members | Yes — `case_members` is already a proper join table, not a single `owner_uid` column bolted onto `cases` alone (which would have been the trap to avoid). |
| Documents | Yes — already modeled as a distinct table with its own identity, separate from any specific version's content. |
| Document versions | Yes — already modeled as a distinct table; the version-number-assignment concern (§7/§15) is an application-logic detail for Phase 2B to handle carefully, not a schema redesign. |
| Evidence items, timeline events, contradictions, legal issue mappings, evidence gaps, review actions | Not created in this phase (correctly, per explicit instruction) — but nothing in this migration's design forecloses them. Each of those (per `PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md` §22) would reference `document_versions.id` and/or `cases.id`, both of which are stable, indexed, server-generated UUIDs already in place. No architectural trap was found. |

**One design note, not a trap**: `cases.owner_uid` is a denormalized convenience field that duplicates what `case_members` (with `role = 'OWNER'`) already records. This is harmless today (nothing yet supports transferring ownership), but if a future phase ever implements "transfer case ownership to someone else," both `cases.owner_uid` and the corresponding `case_members` row would need to be updated together (ideally inside another dedicated Postgres function, following the same atomicity pattern as `create_case_with_owner()`) — worth flagging now so it isn't discovered as a live inconsistency later.

---

## 18. Phase 1 Security Regression Check

Verified by re-confirming that this migration and its associated application code touch nothing outside their own new surface:

- **Deny-by-default RLS** (`free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions`): not referenced anywhere in this migration; unaffected.
- **Firebase authentication**: `POST /api/cases` uses the existing `verifyFirebaseToken()` function, unmodified — no new authentication mechanism was introduced.
- **Server-side authorization**: extended consistently with the existing pattern (§9); no existing authorization check was altered.
- **Payment security**: `api/services/access.ts`, `api/_server.ts`'s payment routes, and `api/services/gmailAgent.ts` are untouched by this migration or by `api/services/cases.ts` (confirmed: `cases.ts` only imports `getSupabase` from `access.ts`, nothing else).
- **OAuth security**: `verifyOAuthState`/`getGmailAuthUrl`/`exchangeGmailAuthCode` are untouched.
- **CORS**: the CORS configuration block in `api/_server.ts` is untouched by the `POST /api/cases` addition (confirmed by the git diff reviewed when Phase 2A was implemented — a single new import line and one new, self-contained route block, nothing else).
- **Rate limiting**: `apiLimiter`/`aiCostLimiter` definitions are untouched; the new route only consumes the existing global limiter, adding no new limiter and modifying no existing one.
- **Secret handling**: no new environment variable, credential, or secret was introduced by this migration or its application code.

**Conclusion**: no Phase 1 security control is weakened, bypassed, or altered by this migration or its accompanying code.

---

## 19. Risks

1. **BLOCKING — table name collision** (§1/§13 in the file, discussed at length above): `public.cases` and `public.documents` already exist in the live database with entirely different, incompatible schemas (confirmed live: the existing `cases` has `parent_id`, `case_stage`, `court_file_number`, `risk_score`, `shared_with_lawyer_ids`, etc.; the existing `documents` has `parent_id`, `file_name`, `file_url`, `extracted_text`, `analyzed`, etc. — neither resembles the new tables at all). Both existing tables are also referenced by foreign keys from five other dead tables (`reflection_conversations`, `analysis_results`, `timeline_events`, `lawyer_leads`, `case_exports` all FK to the old `cases`; `analysis_results` also FKs to the old `documents`). Applying this migration as written will fail outright.
2. **Function `EXECUTE` privilege not restricted** (§11/§12): `create_case_with_owner()` is left at Postgres's default `EXECUTE`-to-`PUBLIC` grant, making it directly callable by `anon`/`authenticated` via PostgREST's RPC endpoint. Currently non-exploitable in practice because RLS independently blocks the writes such a call would attempt, but this is a single point of failure away from becoming a live issue (e.g., if a future migration ever adds a permissive policy to `cases`/`case_members` for an unrelated reason).
3. **No database-layer title length constraint** (§15): the 200-character cap exists only in the API route, not in the schema — a defense-in-depth gap, not a currently-exploitable one, since the route is the only call site today.
4. **No explicit `search_path` pinning on the function** (§11): mitigated by full schema-qualification of every reference inside the function body, but still worth adding as standard hardening and to satisfy Supabase's own linter.
5. **`version_number` assignment race condition** (§7/§17): not a defect in this migration (nothing populates this table yet), but a concrete design point Phase 2B must handle deliberately (retry-on-unique-violation or an equivalent strategy), not a plain `max()+1` read-then-write.
6. **Cascade-delete of a case will, in future phases, destroy real evidentiary content with no recovery path** (§8/§17): correctly out of scope for Phase 2A (nothing of consequence exists yet to lose), but a decision (soft-delete vs. hard-delete) that must be made deliberately before any case-deletion feature is built on top of this foundation.
7. **The atomicity guarantee is verified by this audit against documented Postgres/PostgREST transactional behavior, not by an empirical test against a live database** (§14) — a reasonable, standard basis for confidence, but distinct from having actually observed the rollback behavior occur.

None of risks 2-7 individually justify a `DO NOT APPLY` verdict on their own — each is a reasonable, fixable condition. Risk 1 alone is sufficient and sole grounds for the verdict below, being a hard functional blocker rather than a hardening preference.

---

## 20. Approval Recommendation

# DO NOT APPLY

**Exact blocking issue**: `create table public.cases (...)` and `create table public.documents (...)` will fail with `ERROR: relation "cases" already exists` and `ERROR: relation "documents" already exists` respectively, because both table names are already occupied in the live `public` schema by the pre-existing, unused "dead schema" tables documented in `AUDIT.md`/`PHASE_1_FINAL_SECURITY_GATE.md` — confirmed by a live, read-only query against the production database in this pass (`information_schema.tables`, and a verbose `list_tables` call showing the existing tables' full, incompatible column sets and their five inbound foreign keys from other dead tables). This is not a stylistic concern or a hardening recommendation; it is a migration that cannot execute successfully as written, full stop.

**What a corrected migration would need to address (not fixed here — this audit's scope is read-only)**: choose table names that do not collide with the existing schema (e.g. a distinct prefix, or explicit coordination with a separate, deliberate decision about whether/how to finally retire the old dead `cases`/`documents`/`analysis_results`/etc. tables — itself a nontrivial decision given their existing FK web, and not one this audit is recommending be made as a side effect of Phase 2A). Once the naming collision is resolved, this audit's secondary finding (§11/§12 — explicitly restrict `create_case_with_owner()`'s `EXECUTE` privilege to `service_role`) should be folded into the same revision before re-submission for approval, along with, ideally, the smaller items in §19 (title length constraint, `search_path` pinning).

Everything else in this migration — the RLS model, the ownership architecture, the atomicity strategy, the constraints, and the indexing — was independently verified in this pass to be sound and consistent with this application's existing, already-approved security patterns. The blocking issue is narrow, specific, and does not reflect a defect in the overall design approach.

---

*This document was created fresh in this pass, as the only file created or modified. The migration itself was not applied, not modified, and no database, RLS policy, function, or grant was changed. No application code or test was modified. `main` was not touched. Nothing was merged. Phase 2B was not started.*
