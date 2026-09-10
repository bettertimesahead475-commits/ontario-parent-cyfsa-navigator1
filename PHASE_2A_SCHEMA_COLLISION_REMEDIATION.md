# Phase 2A Schema Collision — Remediation Design

> **Historical snapshot — superseded for current status.** See [current closeout status](PHASE_1_SECURITY_VERIFICATION.md#current-closeout-status--2026-09-10) for the verified 139-test suite, applied migrations, actual PR scope and remaining blockers. Older counts, pending-approval claims, stateless-session descriptions and next-phase instructions below are historical, not current authorization. PR #21 remains draft. The obsolete eslint/Firebase configuration references in older handoff material do not describe the current tree.


**Type**: READ-ONLY REMEDIATION DESIGN AUDIT. No database migration was applied, no production data was modified, no existing table was dropped/renamed/altered, and no application code was changed to produce this document. This is the only file created.

**Audited state**: branch `phase-1.5-security-remediation` @ commit `b48c56081fa3f0832fdaae625f953f1ffbe9a859` (working tree clean, remote synchronized — see Git State at the end of this document).

**Builds directly on**: `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md`, which found that `supabase/migrations_pending_approval/create_case_ownership_foundation.sql` cannot apply because `public.cases`/`public.documents` already exist in production. This document designs the replacement — it does not re-litigate that finding, and adds fresh, live evidence (exact legacy column lists, inbound foreign keys, existing RLS policies, and actual table-level grants, all queried read-only in this pass) to ground the replacement design in what is really in the database today, not in what was assumed.

---

## 1. Executive Summary

The legacy `public.cases` and `public.documents` tables are real, live, RLS-enabled objects with their own columns, their own (dormant but real) `auth.uid()`-based policies, and — critically — **six and one inbound foreign keys respectively** from other legacy tables (`documents`, `analysis_results`, `timeline_events`, `reflection_conversations`, `lawyer_leads`, `case_exports` all reference `cases`; `analysis_results` also references `documents`). They hold zero rows, but they are not isolated, orphaned objects — they are the hub of an entire dormant relational sub-schema. Altering or renaming them is achievable in Postgres without breaking those foreign keys (Postgres FK constraints follow the table by OID, not by name), but doing so is a decision this task's own instructions correctly refuse to make as a side effect of Phase 2A ("never rename existing legacy tables unless separately approved").

**Recommended strategy: create the Phase 2A tables under new, non-colliding names in the existing `public` schema** (`navigator_cases`, `navigator_case_members`, `navigator_documents`, `navigator_document_versions`), leaving every legacy object completely untouched. This achieves full isolation from the legacy schema with the least new complexity — no schema-level PostgREST exposure configuration to verify or change (as a dedicated new Postgres schema would require), no risk to the legacy foreign-key web, and no negotiation over whether/when to retire 14 tables that are explicitly out of scope for this task.

Beyond the renaming fix, this design also closes the one secondary gap the pre-approval audit flagged (the case-creation function's default `EXECUTE`-to-`PUBLIC` grant) with explicit `REVOKE`/`GRANT` statements at both the table and function level — going beyond RLS-only defense, per this task's explicit instruction not to rely solely on RLS where explicit privilege restriction is practical (it is, and costs nothing).

**Final recommendation: `SAFE WITH CONDITIONS`** — see §15 for the exact conditions, none of which block the design itself, all of which are procedural (a separate, explicit approval step to actually apply the SQL in §7, exactly as this task's own framing requires).

---

## 2. Production Schema Findings

Queried live, read-only, in this pass (`information_schema`, `pg_indexes`, `pg_policies`, `pg_constraint`) against project `qboidsfpjuxeqtfotryj`.

### `public.cases` (legacy, dormant)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO (PK) | `extensions.uuid_generate_v4()` |
| `parent_id` | uuid | YES | — |
| `title` | text | NO | `'My Case'::text` |
| `case_stage` | text | YES | `'pre_investigation'::text`, `CHECK (case_stage = ANY (ARRAY['pre_investigation',...,'closed']))` (13 values) |
| `cas_office` | text | YES | — |
| `cas_file_number` | text | YES | — |
| `court_file_number` | text | YES | — |
| `assigned_judge` | text | YES | — |
| `next_court_date` | timestamptz | YES | — |
| `risk_score` | integer | YES | `0`, `CHECK (risk_score >= 0 AND risk_score <= 100)` |
| `notes` | text | YES | — |
| `shared_with_lawyer_ids` | uuid[] | YES | `'{}'::uuid[]` |
| `created_at` | timestamptz | YES | `now()` |
| `updated_at` | timestamptz | YES | `now()` |

- **Primary key**: `id`.
- **Foreign keys (outbound)**: `cases_parent_id_fkey`: `parent_id -> public.users(id)`.
- **Indexes**: `cases_pkey` (unique, `id`), `idx_cases_parent` (`parent_id`).
- **RLS**: enabled (`relrowsecurity = true`).
- **Policies** (live, verbatim):
  - `cases_parent_own` — `ALL`, roles `{public}`, `USING (auth.uid() = parent_id)`.
  - `cases_lawyer_shared` — `SELECT`, roles `{public}`, `USING (auth.uid() = ANY (shared_with_lawyer_ids))`.
- **Grants**: full `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` to **both** `anon` and `authenticated` (project default privileges — confirmed live, same behavior already documented for `free_usage` pre-fix), plus `service_role`.
- **Row count**: 0.
- **Inbound foreign keys** (every other table that references `public.cases`, confirmed live via `pg_constraint`):

| Source table | Constraint | On delete |
|---|---|---|
| `public.documents` | `documents_case_id_fkey` | `CASCADE` |
| `public.analysis_results` | `analysis_results_case_id_fkey` | `CASCADE` |
| `public.timeline_events` | `timeline_events_case_id_fkey` | `CASCADE` |
| `public.reflection_conversations` | `reflection_conversations_case_id_fkey` | `SET NULL` |
| `public.lawyer_leads` | `lawyer_leads_case_id_fkey` | `SET NULL` |
| `public.case_exports` | `case_exports_case_id_fkey` | `CASCADE` |

### `public.documents` (legacy, dormant)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO (PK) | `extensions.uuid_generate_v4()` |
| `case_id` | uuid | YES | — |
| `parent_id` | uuid | YES | — |
| `file_name` | text | NO | — |
| `file_url` | text | NO | — |
| `file_type` | text | YES | `CHECK (file_type = ANY (ARRAY['pdf','docx','txt','jpg','png','other']))` |
| `file_size_bytes` | bigint | YES | — |
| `document_category` | text | YES | `'other'::text`, `CHECK (... 13 category values ...)` |
| `extracted_text` | text | YES | — |
| `analyzed` | boolean | YES | `false` |
| `uploaded_at` | timestamptz | YES | `now()` |

- **Primary key**: `id`.
- **Foreign keys (outbound)**: `documents_case_id_fkey`: `case_id -> public.cases(id)` (`ON DELETE CASCADE`); `documents_parent_id_fkey`: `parent_id -> public.users(id)`.
- **Indexes**: `documents_pkey` (unique, `id`), `idx_documents_case` (`case_id`).
- **RLS**: enabled.
- **Policies** (live, verbatim):
  - `documents_parent_own` — `ALL`, roles `{public}`, `USING (auth.uid() = parent_id)`.
  - `documents_lawyer_shared_read` — `SELECT`, roles `{public}`, `USING (EXISTS (SELECT 1 FROM cases c WHERE c.id = documents.case_id AND auth.uid() = ANY (c.shared_with_lawyer_ids)))`.
- **Grants**: full CRUD to `anon`/`authenticated`/`service_role`, same pattern as `cases`.
- **Row count**: 0.
- **Inbound foreign keys**: `public.analysis_results` (`analysis_results_document_id_fkey`, `ON DELETE CASCADE`).

---

## 3. Legacy Dependency Findings

- **Referenced anywhere in current application source code?** No. A fresh, repo-wide grep of `api/` for `.from("cases")`, `.from('cases')`, `.from("documents")`, `.from('documents')`, and the bare strings `"cases"`/`"documents"` returned **zero matches**, in this pass, independent of any prior audit's claim. Combined with the already-established, repeatedly-verified fact that `src/` contains no Supabase client at all (`@supabase/supabase-js` is imported only by `api/services/access.ts` and its own test file — confirmed across every Phase 1 audit in this repository), this means **no code path in this application, frontend or backend, ever reads or writes `public.cases` or `public.documents` today.**
- **Are these tables "safe to drop" simply because they're unreferenced?** **No — this audit explicitly does not conclude that**, per the task's own instruction. They hold real, if currently empty, RLS policies and a live web of foreign-key relationships to five other tables that are themselves part of the same dormant, never-fully-removed architecture. Dropping or altering any of them is a distinct decision with its own blast-radius analysis (what happens to `analysis_results`, `timeline_events`, etc.), and is explicitly out of scope here.
- **Practical consequence for this task**: because nothing references these tables, and because their column shapes (`case_stage`, `risk_score`, `shared_with_lawyer_ids`, `file_url`, `extracted_text`, etc.) are fundamentally incompatible with the Firebase-uid-ownership model Phase 2A needs, **the only sound path is to leave them exactly as they are and build the new schema elsewhere** — which is exactly what §4's recommendation does.

---

## 4. Recommended Naming Strategy

Evaluated against the task's own five criteria:

| Option | Preserves legacy data/FKs? | Avoids destructive migration? | Avoids unknown-dependency breakage? | Avoids touching dead schema? | Lets Phase 2 evolve independently? | Practical in Supabase/Postgres? |
|---|---|---|---|---|---|---|
| A — Alter legacy tables in place | No — would require dropping/changing incompatible columns and the existing `auth.uid()` policies | No | No — any lawyer-sharing feature ever half-built against the old `shared_with_lawyer_ids` model is unknown from this codebase alone | No — directly modifies it | No — permanently entangled | Technically possible, substantively unsafe |
| B — Rename legacy tables, create new ones under the old names | Yes, data-wise (FKs survive a rename automatically) | Marginal — a rename is non-destructive but is still a schema change to a table this task explicitly says not to rename without separate approval | Yes, in principle (FK constraints follow by OID) — but the task explicitly forbids this without a dedicated approval step | No — directly modifies it | Yes, after the rename | Possible, but explicitly out of this task's authorized scope |
| **C — Create Phase 2A tables under new, distinct names in `public`** | **Yes — nothing legacy is touched at all** | **Yes — pure additive `CREATE`** | **Yes — zero interaction with the legacy FK web** | **Yes — zero DDL touches any existing object** | **Yes — fully independent objects from day one** | **Yes — no new Supabase project configuration required** | 
| D — Dedicated schema (e.g. `create schema cyfsa_navigator;`) | Yes | Yes | Yes | Yes | Yes, arguably more cleanly | **Adds a real practical cost**: Supabase's PostgREST layer only exposes schemas explicitly added to the project's "Exposed schemas" configuration (a dashboard/project-level setting, not something a SQL migration file can set) — using a new schema would require verifying and likely changing that project setting outside this migration, and would require every `@supabase/supabase-js` call in `api/services/cases.ts` to add `.schema('cyfsa_navigator')`. No safety benefit over Option C justifies this added moving part. |
| E — Other | — | — | — | — | — | No other option was found to score better than C on every criterion simultaneously. |

**Recommendation: Option C.** Use the exact naming convention the task itself suggested as an example — `navigator_cases`, `navigator_case_members`, `navigator_documents`, `navigator_document_versions` — confirmed live, in this pass, to collide with nothing currently in the schema (checked via `information_schema.tables`/`information_schema.routines`). This prefix is self-documenting (matches the product name, "CYFSA Navigator," and the repository name), immediately distinguishes these tables from the legacy set in any future `\dt`/dashboard listing, and requires zero additional Supabase project configuration beyond what this application already uses (the existing `public`-schema, `service_role`-only access pattern).

---

## 5. Replacement Phase 2A Schema

Logical entities and their required fields are unchanged from the original design (`PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` §4-§7) — only the table names change, plus two small hardening additions this audit recommends folding in now rather than as a second future migration: a `CHECK` constraint mirroring the API route's title-length cap, and `SET search_path` pinning on the function.

- `navigator_cases` — same columns as the original `cases` design (`id`, `owner_uid`, `title`, `description`, `created_at`, `updated_at`), **plus** `CHECK (char_length(title) <= 200)`.
- `navigator_case_members` — same columns as the original `case_members` design (`id`, `case_id`, `firebase_uid`, `role`, `created_at`), same `CHECK (role in ('OWNER'))` and `UNIQUE(case_id, firebase_uid)`.
- `navigator_documents` — same columns as the original `documents` design (`id`, `case_id`, `display_name`, `created_at`, `updated_at`), metadata-only, no raw content.
- `navigator_document_versions` — same columns as the original `document_versions` design (`id`, `document_id`, `version_number`, `original_filename`, `mime_type`, `file_size_bytes`, `content_hash`, `extraction_status`, `created_at`), same `UNIQUE(document_id, version_number)`.

Full exact SQL is in §7 (the proposed migration) — not duplicated here to avoid two slightly-differently-formatted copies of the same DDL existing in one document.

---

## 6. RLS Model

Identical security posture to the original design, applied to the new table names:

- RLS **enabled** on all four `navigator_*` tables.
- **Zero** permissive policies for `anon`/`authenticated` on any of them, at creation time or ever, absent a separate, deliberate future decision.
- **No `auth.uid()`** anywhere in this schema — ownership and membership are Firebase uids (`text`), matching the already-proven-correct `free_usage` pattern, not the dormant Supabase-Auth model the legacy `cases`/`documents` tables use.
- The only legitimate access path is the application's one `service_role` Supabase client (`api/services/access.ts`'s `getSupabase()`), gated by the application's own server-side `case_members`-equivalent authorization logic (in Phase 2A, simply "the caller's own verified uid," since no sharing feature exists yet).

---

## 7. Grants / Revokes Model

This is the one part of the design that goes **beyond** the original migration, per this task's explicit instruction not to rely solely on RLS where explicit privilege restriction is practical — it is practical here, at zero functional cost (the application never uses `anon`/`authenticated` against any table), so this design closes it explicitly rather than leaving it to Supabase's default project-wide privilege configuration (confirmed live, in this pass, to grant full CRUD to `anon`/`authenticated` by default on this project — see §2's grant findings for `cases`/`documents`, which is the same default behavior the new tables would otherwise silently inherit).

**Table privileges** (applied to each of the four new tables):
```sql
revoke all on public.navigator_cases from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_cases to service_role;
-- (repeated identically for navigator_case_members, navigator_documents, navigator_document_versions)
```

**Sequence privileges**: not applicable — every primary key in this schema is a `uuid` generated by `gen_random_uuid()`, not a `serial`/`identity` column backed by a Postgres sequence. There is no sequence object for any of these four tables, so there is nothing to grant or revoke at the sequence level.

**Function privileges**:
```sql
revoke all on function public.create_navigator_case_with_owner(text, text) from public, anon, authenticated;
grant execute on function public.create_navigator_case_with_owner(text, text) to service_role;
```

**Net effect**: even in a hypothetical future where a policy is mistakenly added to one of these tables for an unrelated reason, `anon`/`authenticated` would still be blocked at the privilege layer before RLS is ever evaluated — a genuine, low-cost, redundant control on top of RLS, exactly as requested. This also changes the *failure mode* a direct `anon`/`authenticated` attempt would see: instead of an RLS-shaped denial (an empty `SELECT` result, or a "new row violates row-level security policy" error on write), it now fails immediately with a plain "permission denied for table `navigator_cases`" error, before RLS logic is reached at all — see §9's test plan for exactly how this should be verified once applied.

---

## 8. Secure Function Design

`public.create_navigator_case_with_owner(p_owner_uid text, p_title text) returns public.navigator_cases`:

- **`SECURITY INVOKER`** (unchanged from the original design — there is no demonstrated reason for `SECURITY DEFINER` here: the function's only legitimate caller is already `service_role`, which needs no privilege elevation to do what this function does, and introducing `SECURITY DEFINER` would only add a privilege-escalation surface this design has no reason to accept).
- **Fully schema-qualified table references** — `public.navigator_cases`, `public.navigator_case_members` — everywhere, exactly as the original function did, which independently neutralizes the classic search-path-hijack attack class regardless of the `search_path` fix below.
- **`SET search_path = public, pg_temp`** added directly on the function definition (new in this design, addressing the pre-approval audit's §11 recommendation) — closes the standing Postgres/Supabase-linter "mutable search path" warning as defense-in-depth, even though the full-qualification above already prevents the specific attack this setting guards against.
- **No dynamic SQL** — both `INSERT` statements use plain, parameterized `VALUES (...)` clauses; `p_owner_uid`/`p_title` are never concatenated into a string and executed, so there is no SQL-injection surface.
- **No caller-controlled ownership** — the function has exactly two parameters, both supplied by its one caller (`api/services/cases.ts`), which in turn only ever receives `identity.uid` from `verifyFirebaseToken()`'s output, never a client-supplied value (traced end-to-end and unchanged from the original design's already-verified correct behavior).
- **Explicit `EXECUTE` privilege model**: §7's `REVOKE`/`GRANT` pair, applied in the same migration that creates the function (see §11, step 8) — never a window where the function exists without its privileges already restricted.
- **Does Postgres/Supabase permit restricting this to `service_role` only?** **Yes, unconditionally** — this is standard, first-class Postgres `GRANT`/`REVOKE` behavior, and Supabase places no platform-level restriction on an authorized migration author's ability to grant or revoke `EXECUTE` on their own functions in the `public` schema. There is no limitation to report here and no alternative approach is needed; the original migration simply omitted this straightforward, fully-supported step.

---

## 9. API Changes Required

Traced against the current, live code (`api/services/cases.ts`, `api/_server.ts`) — **exactly one line needs to change**, once this remediation is actually applied:

- **`api/services/cases.ts`**: the single `db.rpc("create_case_with_owner", {...})` call must become `db.rpc("create_navigator_case_with_owner", {...})`. This is the **only** place in the entire application that names either the old function or any of the old/new table names — confirmed by the same grep in §3 (zero table-name references anywhere) plus a direct re-read of `cases.ts`, whose only Supabase-facing call is that one `.rpc(...)` invocation.
- **`api/_server.ts`'s `POST /api/cases` route**: **no change required.** The route never references a table or function name directly — it calls `createCase(identity.uid, trimmedTitle)`, an already-existing abstraction that fully encapsulates the RPC name. Re-confirming each of the route's required properties against the *unchanged* route code:
  - Authenticates with `verifyFirebaseToken()` — unchanged, already correct.
  - Obtains ownership exclusively from verified `identity.uid` — unchanged.
  - Accepts only `title` from the client body — unchanged.
  - Ignores spoofed `ownerUid`/`uid`/`userId`/`role`/`id` — unchanged (these fields are simply never read, regardless of what the database layer is named).
  - Returns a generic error on failure (`"Failed to create case. Please try again."`) — unchanged; this message does not name any table, so it requires no update even though the underlying table names are changing.
  - Preserves the existing global `apiLimiter` — unchanged, since this route's rate-limiting is inherited from `app.use('/api', apiLimiter)`, untouched by this remediation.
  - Uses the replacement tables/function — achieved entirely through the one-line change in `cases.ts` above; the route itself needs no awareness of the underlying table names, which is a direct, positive consequence of the existing service-layer abstraction already being correctly designed.
  - Avoids exposing database details — unchanged (the generic-error behavior already covers this regardless of what the tables are named).

**Test-file impact** (for completeness, not implemented here): `api/services/cases.test.ts`'s fake `rpc()` double currently asserts `fn !== "create_case_with_owner"` — this string would need updating to `"create_navigator_case_with_owner"` alongside the real code change. No other test file references the table/function names.

**None of this is implemented in this audit**, per its read-only scope.

---

## 10. Exact Proposed Migration SQL

**FOR REVIEW ONLY. NOT EXECUTED. NOT APPLIED.** This is a proposed replacement for `create_case_ownership_foundation.sql`, not a second, additional migration to be applied alongside it — if approved in a future step, this content should replace that file's body (the "BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL" header convention, and the general shape, are preserved from the original for consistency with this repository's existing pending-migration pattern).

```sql
-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- Phase 2A (revised): the persistent case-ownership foundation, under
-- names that do NOT collide with the pre-existing, unused "dead schema"
-- tables (public.cases / public.documents) that already occupy those
-- names in production — see PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md and
-- PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md for the full reasoning.
--
-- This migration touches ONLY new objects. It creates nothing that shares
-- a name with any existing table, view, function, or other object in this
-- project, verified live immediately before writing this file. It does
-- not drop, rename, alter, or otherwise touch public.cases, public.documents,
-- or any of the other legacy tables in this schema.
-- ============================================================================

create table public.navigator_cases (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  title text not null check (char_length(title) <= 200),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index navigator_cases_owner_uid_idx on public.navigator_cases (owner_uid);

comment on table public.navigator_cases is
  'One CYFSA case/matter (Phase 2A). owner_uid is a Firebase uid, verified server-side by verifyFirebaseToken() before every write - never a client-supplied value. Named navigator_cases (not cases) specifically to avoid colliding with the pre-existing, unused legacy public.cases table - see PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md.';

-- ----------------------------------------------------------------------------

create table public.navigator_case_members (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.navigator_cases(id) on delete cascade,
  firebase_uid text not null,
  role text not null check (role in ('OWNER')),
  created_at timestamptz not null default now(),
  unique (case_id, firebase_uid)
);

create index navigator_case_members_case_id_idx on public.navigator_case_members (case_id);
create index navigator_case_members_firebase_uid_idx on public.navigator_case_members (firebase_uid);

comment on table public.navigator_case_members is
  'Who may access a navigator_cases row, and in what role. firebase_uid is always the server-verified uid from verifyFirebaseToken(). The case creator receives exactly one OWNER row here, created atomically with the case via create_navigator_case_with_owner().';

-- ----------------------------------------------------------------------------

create table public.navigator_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.navigator_cases(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index navigator_documents_case_id_idx on public.navigator_documents (case_id);

comment on table public.navigator_documents is
  'Persistent identity for one logical document within a navigator_cases row. Metadata-only in Phase 2A - no raw file storage, no OCR output, no AI analysis.';

-- ----------------------------------------------------------------------------

create table public.navigator_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.navigator_documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  original_filename text,
  mime_type text,
  file_size_bytes bigint,
  content_hash text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create index navigator_document_versions_document_id_idx on public.navigator_document_versions (document_id);
create index navigator_document_versions_content_hash_idx on public.navigator_document_versions (content_hash);

comment on table public.navigator_document_versions is
  'One uploaded/re-uploaded instance of a navigator_documents row. Metadata-only in Phase 2A.';

-- ============================================================================
-- Row-Level Security: enabled, zero policies, on all four tables.
-- ============================================================================

alter table public.navigator_cases enable row level security;
alter table public.navigator_case_members enable row level security;
alter table public.navigator_documents enable row level security;
alter table public.navigator_document_versions enable row level security;

-- ============================================================================
-- Explicit table-privilege restriction, in addition to RLS (not a
-- replacement for it) - closes this project's default anon/authenticated
-- table grants rather than leaving them in place and relying on RLS alone.
-- ============================================================================

revoke all on public.navigator_cases from public, anon, authenticated;
revoke all on public.navigator_case_members from public, anon, authenticated;
revoke all on public.navigator_documents from public, anon, authenticated;
revoke all on public.navigator_document_versions from public, anon, authenticated;

grant select, insert, update, delete on public.navigator_cases to service_role;
grant select, insert, update, delete on public.navigator_case_members to service_role;
grant select, insert, update, delete on public.navigator_documents to service_role;
grant select, insert, update, delete on public.navigator_document_versions to service_role;

-- ============================================================================
-- Atomic case + OWNER-membership creation.
-- SECURITY INVOKER (no elevation needed - the only caller is service_role,
-- which already bypasses RLS and holds full table privileges above).
-- search_path pinned as defense-in-depth; every reference below is already
-- fully schema-qualified regardless, so this is a hardening addition, not
-- a fix for a demonstrated exploit path.
-- ============================================================================

create or replace function public.create_navigator_case_with_owner(p_owner_uid text, p_title text)
returns public.navigator_cases
language plpgsql
set search_path = public, pg_temp
as $$
declare
  new_case public.navigator_cases;
begin
  insert into public.navigator_cases (owner_uid, title)
    values (p_owner_uid, p_title)
    returning * into new_case;

  insert into public.navigator_case_members (case_id, firebase_uid, role)
    values (new_case.id, p_owner_uid, 'OWNER');

  return new_case;
end;
$$;

comment on function public.create_navigator_case_with_owner(text, text) is
  'Atomically creates one navigator_cases row and its OWNER navigator_case_members row in a single Postgres transaction. Called via db.rpc(''create_navigator_case_with_owner'', {...}) from api/services/cases.ts. EXECUTE is restricted to service_role only - see the REVOKE/GRANT below.';

revoke all on function public.create_navigator_case_with_owner(text, text) from public, anon, authenticated;
grant execute on function public.create_navigator_case_with_owner(text, text) to service_role;

-- ============================================================================
-- POST-APPLY VERIFICATION (run these after applying, expect the results shown):
-- ============================================================================
-- select relrowsecurity from pg_class where relname in
--   ('navigator_cases','navigator_case_members','navigator_documents','navigator_document_versions');
--   -- EXPECTED: true for all four rows.
--
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename like 'navigator_%';
--   -- EXPECTED: 0.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name like 'navigator_%'
--   and grantee in ('anon','authenticated');
--   -- EXPECTED: zero rows (the explicit REVOKE above removed the project's
--   -- default anon/authenticated grants).
--
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
--   where routine_schema = 'public' and routine_name = 'create_navigator_case_with_owner';
--   -- EXPECTED: exactly one row - grantee = service_role, privilege_type = EXECUTE.
--
-- begin;
--   set local role anon;
--   select count(*) from public.navigator_cases;  -- EXPECTED: ERROR - permission denied (not RLS-empty; the table grant is gone)
-- rollback;
--
-- begin;
--   set local role anon;
--   select create_navigator_case_with_owner('x','x');  -- EXPECTED: ERROR - permission denied for function
-- rollback;
--
-- select create_navigator_case_with_owner('test-uid-verify', 'Verification Case');
--   -- EXPECTED (as service_role only): one row back, and a matching
--   -- navigator_case_members row with role='OWNER'. Clean up manually
--   -- after verifying: delete both rows this created.
--
-- -- Confirm zero interaction with the legacy schema:
-- select count(*) from public.cases;      -- EXPECTED: 0 (unchanged, untouched)
-- select count(*) from public.documents;  -- EXPECTED: 0 (unchanged, untouched)
```

---

## 11. Rollback Plan

**Scope**: affects only the four `navigator_*` tables and the one new function created above. **Never** touches `public.cases`, `public.documents`, or any other legacy object — there is no shared dependency, since every new object in this design has a distinct name from everything already in the schema.

```sql
-- Rollback for the Phase 2A (revised, navigator_*) migration ONLY.
-- Safe to run in any order relative to the legacy schema, since nothing
-- here references or is referenced by any legacy table.

drop function if exists public.create_navigator_case_with_owner(text, text);

-- Dependency order matters here: child tables before parents.
drop table if exists public.navigator_document_versions;
drop table if exists public.navigator_documents;
drop table if exists public.navigator_case_members;
drop table if exists public.navigator_cases;
```

**Dependencies between the new objects**: `navigator_case_members`/`navigator_documents` both reference `navigator_cases`; `navigator_document_versions` references `navigator_documents`. The `drop table` order above (versions, then documents, then members, then cases) respects this, and each statement's `on delete cascade` would in any case allow dropping `navigator_cases` first to cascade-drop the rest via `DROP TABLE ... CASCADE` — the explicit ordering above is preferred for clarity and to avoid relying on `CASCADE` at drop time, which can silently remove more than intended if the schema has grown since this rollback script was written.

**Would rollback require deleting any newly created application data?** **Yes, unconditionally, if this rollback is ever executed after real cases have been created** — dropping `navigator_cases` destroys every case, membership, document, and document-version row that exists at that point, with no automatic backup. This is an accepted, standard consequence of dropping a table, stated explicitly here per the task's instruction, not glossed over: **before running this rollback in a state where real data exists, an operator must independently decide whether that data needs to be exported/backed up first** — this rollback script itself performs no backup step, by design (a rollback script's job is to undo the schema, not to make data-retention decisions on an operator's behalf).

---

## 12. Security Test Plan

To be run **only once this design is separately approved and applied** — none of these were executed in this audit. Every write test below must run inside `BEGIN ... ROLLBACK`, exactly as this repository's established pattern (`PHASE_1_SECURITY_VERIFICATION.md` §3a) already does, so no test leaves any trace.

| # | Test | Method | Expected result |
|---|---|---|---|
| 1 | `anon` `SELECT` | `SET LOCAL ROLE anon; SELECT * FROM navigator_cases;` | `ERROR: permission denied for table navigator_cases` (table grant revoked — fails before RLS is even evaluated) |
| 2 | `anon` `INSERT` | `SET LOCAL ROLE anon; INSERT INTO navigator_cases (...) VALUES (...);` | `ERROR: permission denied for table navigator_cases` |
| 3 | `anon` `UPDATE` | `SET LOCAL ROLE anon; UPDATE navigator_cases SET title = 'x';` | `ERROR: permission denied for table navigator_cases` |
| 4 | `anon` `DELETE` | `SET LOCAL ROLE anon; DELETE FROM navigator_cases;` | `ERROR: permission denied for table navigator_cases` |
| 5 | `authenticated` `SELECT` | Same as #1, `SET LOCAL ROLE authenticated;` | Same denial as #1 |
| 6 | `authenticated` `INSERT` | Same as #2, `authenticated` | Same denial as #2 |
| 7 | `authenticated` `UPDATE` | Same as #3, `authenticated` | Same denial as #3 |
| 8 | `authenticated` `DELETE` | Same as #4, `authenticated` | Same denial as #4 |
| 9 | `service_role` `SELECT` | `SET LOCAL ROLE service_role; SELECT * FROM navigator_cases;` | Succeeds, returns rows (0 or more) with no error |
| 10 | `service_role` `INSERT` | Direct `INSERT` as `service_role` | Succeeds |
| 11 | `service_role` `UPDATE` | Direct `UPDATE` as `service_role` | Succeeds |
| 12 | `service_role` `DELETE` | Direct `DELETE` as `service_role` (on a row created in the same transaction) | Succeeds |
| 13 | Unauthorized function `EXECUTE` | `SET LOCAL ROLE anon; SELECT create_navigator_case_with_owner('x','x');` | `ERROR: permission denied for function create_navigator_case_with_owner` |
| 14 | Authorized server-side execution | `SET LOCAL ROLE service_role; SELECT create_navigator_case_with_owner('test-uid','Test');` | Succeeds; returns one `navigator_cases` row |
| 15 | Duplicate case membership | As `service_role`, attempt two `INSERT`s into `navigator_case_members` with the same `(case_id, firebase_uid)` | Second insert: `ERROR: duplicate key value violates unique constraint` |
| 16 | Invalid role | As `service_role`, `INSERT INTO navigator_case_members (..., role) VALUES (..., 'LAWYER')` | `ERROR: new row for relation "navigator_case_members" violates check constraint` |
| 17 | Foreign-key enforcement | As `service_role`, `INSERT INTO navigator_documents (case_id, ...) VALUES ('00000000-0000-0000-0000-000000000000', ...)` (a case id that doesn't exist) | `ERROR: insert or update on table "navigator_documents" violates foreign key constraint` |
| 18 | Case-creation atomicity | As `service_role`, call `create_navigator_case_with_owner()` with a value engineered to violate the `navigator_case_members` `role` check from inside the function (requires a temporary, in-transaction modification to force the second insert to fail — e.g. temporarily testing against a variant call, or verifying via code inspection that no `EXCEPTION` block exists to swallow the error) | The `navigator_cases` row created by the same call must NOT persist after the failure — confirm via `SELECT` immediately after, inside the same rolled-back transaction |
| 19 | Spoofed Firebase UID (application-layer) | `POST /api/cases` with `{"title":"x","ownerUid":"attacker-uid"}` | `201`, and the returned case's `ownerUid` equals the caller's real, server-verified uid, never `"attacker-uid"` — already covered by the existing automated test suite (`api/_server.test.ts`, `"uses the server-verified uid as owner, never a client-supplied one"`) |
| 20 | API route authorization | `POST /api/cases` with no `Authorization` header | `401`, `code: "SIGN_IN_REQUIRED"` — already covered by the existing automated test suite |

Tests 19-20 already exist and pass against the current (pre-remediation) code; once the one-line RPC-name change in §9 is made, they continue to apply unchanged and should be re-run as part of the eventual implementation step's own verification, alongside a `cases.test.ts` update to the new function name.

---

## 13. Legacy Schema Treatment

- **Is it safe to leave the legacy `cases` and `documents` tables permanently?** Yes, as they stand today: RLS is enabled, their policies are `auth.uid()`-based and therefore unreachable by this application (which never issues a Supabase-Auth session), they hold 0 rows, and — newly confirmed in this pass — nothing in the current codebase references them. Leaving them in place is a continuation of the same accepted posture already documented for the other 12 dead tables in `AUDIT.md`/`PHASE_1_FINAL_SECURITY_GATE.md`, not a new risk introduced by this remediation.
- **Is there any immediate need to migrate their data?** No — they hold zero rows. There is nothing to migrate.
- **Is there any reason Phase 2 should depend on them?** No. Their column shapes (`case_stage`, `risk_score`, `shared_with_lawyer_ids`, `file_url`, `extracted_text`) belong to a different, abandoned product design built around Supabase Auth and direct file-URL storage — none of it maps onto the Firebase-uid-owned, metadata-first model Phase 2A establishes. Depending on them would reintroduce exactly the `auth.uid()` fragility this whole remediation exists to avoid.
- **Should they be marked/deprecated in documentation?** Yes — recommend a short addition to `PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md` §18 (Database Design) or a follow-up note in `AUDIT.md`'s own dead-schema section, stating plainly that `public.cases`/`public.documents` are permanently superseded by `navigator_cases`/`navigator_documents` for this application's purposes, so a future contributor doesn't mistake the old names for the current ones when reading the schema. Not performed in this audit (out of scope — this task authorizes creating exactly one document).
- **What future conditions would justify a separate legacy-schema cleanup project?** (a) A deliberate product decision to permanently abandon the lawyer-sharing/case-stage/risk-scoring concepts the old schema was built for, freeing up the names and the foreign-key web for reuse or removal; (b) a data-governance or storage-cost driver (unlikely at 0 rows, but relevant if this ever changes); (c) an audit-hygiene pass that wants to reduce the schema's total surface area for reviewability, once Phase 2's own schema has matured enough that comparing the two side by side is no longer useful context. None of these conditions exist today, and this audit does not recommend starting that project now.

---

## 14. Regression Assessment

Verified fresh, in this pass, against the current codebase (unchanged by this audit):

```
npm test
 Test Files  4 passed (4)
      Tests  98 passed (98)

npx tsc --noEmit
(clean, 0 errors)

npm run build
✓ built in ~8-10s (same pre-existing heic2any chunk-size warning, unrelated)
```

- **Existing RLS migration state**: unaffected — this design creates zero policies and touches zero existing tables; the already-applied `free_usage`/`gmail_processed_messages`/`stale_payment_alerts`/`submissions` RLS fix (`PHASE_1_SECURITY_VERIFICATION.md` §3a) is not referenced or altered anywhere in this remediation.
- **Service-role access patterns**: unchanged — this design reuses the exact same `getSupabase()` singleton and `service_role`-only access model every other table in this application already uses; no new client, no new credential, no new access pattern.
- **Firebase authentication model**: unchanged — `verifyFirebaseToken()` is reused exactly as-is; this design adds no new authentication mechanism.
- **Conclusion**: this remediation design requires **no change whatsoever** to the Phase 1 security architecture. The only application-code change it calls for (§9) is a single string literal — an RPC function name — inside one existing service function.

---

## 15. Final Recommendation

# SAFE WITH CONDITIONS

The design itself — new, non-colliding table names; RLS enabled with zero policies; explicit table- and function-level `REVOKE`/`GRANT` closing the default-privilege gap; a `SECURITY INVOKER`, fully-qualified, `search_path`-pinned atomic function; a one-line, low-risk application-code change — is sound, internally consistent, and independently verified against live production schema data rather than assumption. Nothing about the design itself is unsafe.

**Conditions, all procedural, none of which are defects in the design**:
1. This document's SQL (§10) is a **proposal for a future, separately-approved migration file** — it must not be applied as a side effect of this audit being accepted, consistent with this task's own framing ("does NOT authorize database execution").
2. Before that future application step, `api/services/cases.ts`'s `.rpc("create_case_with_owner", ...)` call and `api/services/cases.test.ts`'s matching assertion must be updated to `"create_navigator_case_with_owner"` **in the same change**, so the application code and the applied schema never drift out of sync even briefly.
3. The existing `supabase/migrations_pending_approval/create_case_ownership_foundation.sql` file should be replaced by (or clearly superseded by, with the old one removed or marked obsolete) the SQL in §10, so there is never ambiguity in this repository about which of the two pending-migration files is the one actually intended for approval.
4. A human reviewer should independently re-run this document's §10 SQL through the same collision check this audit performed (a fresh `information_schema.tables`/`information_schema.routines` query for the `navigator_*` names and `create_navigator_case_with_owner`) immediately before applying, since time will have passed and this project's schema could in principle have changed in the interim.

None of these conditions require further design work — they are sequencing/process conditions for the eventual, separate approval-and-apply step this audit does not authorize.

---

## Git State

| Check | Result |
|---|---|
| Branch (before starting) | `phase-1.5-security-remediation` |
| Commit (before starting) | `b48c56081fa3f0832fdaae625f953f1ffbe9a859` |
| Working tree (before starting) | Clean |
| Remote sync (before starting) | `origin/phase-1.5-security-remediation` matched local HEAD exactly (`b48c560`) |

(Post-commit git state — branch, new commit SHA, working tree, verification results — is reported in the chat response accompanying this document, per this task's instructions.)

---

*This document was created fresh in this pass, as the only file created or modified. No database migration was applied. No production data, table, policy, function, or grant was created, altered, or dropped. No application code or test was modified. `main` was not touched. Nothing was merged. Phase 2B was not started.*
