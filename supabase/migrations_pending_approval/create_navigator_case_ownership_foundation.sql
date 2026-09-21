-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- Phase 2A (executable artifact): the persistent case-ownership foundation,
-- under names that do NOT collide with the pre-existing, unused "dead
-- schema" tables (public.cases / public.documents) that already occupy
-- those names in production.
--
-- This migration is NOT applied. It is prepared and reviewed, ready to run,
-- but withheld pending explicit human approval before touching production —
-- the same gate this repository has used for every prior schema change.
--
-- FULL REVIEW TRAIL for this migration (read these before approving):
--   1. PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md — found that the OBSOLETE
--      migration below (create_case_ownership_foundation.sql, same
--      directory) cannot apply: public.cases and public.documents already
--      exist in production as unrelated, incompatible legacy tables with
--      their own foreign-key web (6 inbound FKs to cases, 1 to documents).
--   2. PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md — designed this replacement:
--      new, non-colliding table names, plus explicit REVOKE/GRANT privilege
--      restriction beyond RLS alone, plus search_path pinning on the
--      function. Recommendation: SAFE WITH CONDITIONS.
--   3. PHASE_2A_FINAL_MIGRATION_APPROVAL_AUDIT.md — found that, at the time
--      it was written, no executable file implementing that design existed
--      yet (the design lived only inside the remediation markdown). This
--      file is that missing executable artifact.
--   4. PHASE_2A_MIGRATION_IMPLEMENTATION.md — documents exactly what this
--      file contains, the accompanying application-code change, test
--      results, and static validation, and confirms nothing here has been
--      applied to production.
--
-- ============================================================================
-- OBSOLETE MIGRATION NOTICE
-- ============================================================================
-- supabase/migrations_pending_approval/create_case_ownership_foundation.sql
-- (the ORIGINAL Phase 2A migration, same directory) is OBSOLETE and MUST
-- NOT BE EXECUTED. It creates tables named public.cases and
-- public.documents, both of which already exist in production as
-- unrelated legacy tables — applying it would fail outright with
-- "relation already exists" errors. It has been left on disk, unmodified,
-- for historical/audit-trail purposes only (per explicit instruction: do
-- not delete it, do not silently rewrite its contents). THIS file
-- (create_navigator_case_ownership_foundation.sql) is the correct,
-- reviewed, collision-free replacement — approve and apply THIS file, not
-- the obsolete one.
-- ============================================================================
--
-- WHAT THIS CREATES:
--   public.navigator_cases            — one row per CYFSA case/matter.
--   public.navigator_case_members     — who may access a case, and in what role.
--   public.navigator_documents        — persistent identity for one logical
--                                        document within a case (metadata
--                                        only — no raw file, no OCR output,
--                                        no AI analysis).
--   public.navigator_document_versions — one uploaded/re-uploaded instance
--                                        of a document (metadata only).
--   public.create_navigator_case_with_owner(text, text, text) — a Postgres
--                                        function that atomically creates a
--                                        case AND its OWNER membership row
--                                        in one transaction.
--
-- OWNERSHIP MODEL (deliberately NOT auth.uid()-based):
--   This application authenticates users exclusively via Firebase
--   Authentication, verified server-side with firebase-admin
--   (api/services/firebaseAdmin.ts). It has never used Supabase Auth, so
--   auth.uid() is always NULL for any request this application's own code
--   could ever issue.
--
--     Firebase ID token (client)
--       -> verifyFirebaseToken() (server, cryptographic verification)
--       -> verified Firebase uid (server-side only, never client-supplied)
--       -> server-side authorization (Phase 2A: the caller's own uid only)
--       -> service_role database operation (RLS-bypassing, as designed)
--
--   RLS is enabled on all four tables below with ZERO policies, AND table
--   privileges are explicitly revoked from PUBLIC/anon/authenticated and
--   granted only to service_role — a defense-in-depth model that does not
--   rely on RLS alone (see PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md §7 for
--   why this project's default privileges would otherwise silently grant
--   anon/authenticated full table access on any new table, exactly as
--   happened to free_usage before its own Phase 1 RLS fix).
--
-- LEGACY SCHEMA: this migration does not reference, read, write, drop,
-- alter, or rename public.cases, public.documents, or any other existing
-- table in this schema, anywhere. Every object created below has a name
-- that does not exist anywhere in this project today (verified live,
-- read-only, immediately before writing this file — see
-- PHASE_2A_MIGRATION_IMPLEMENTATION.md for the exact verification query
-- and result).
-- ============================================================================

create table public.navigator_cases (
  id uuid primary key default gen_random_uuid(),
  owner_uid text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Explicitly named (rather than relying on Postgres's implicit
  -- tablename_columnname_check auto-naming convention) so the `comment on
  -- constraint` below is unambiguous and independently verifiable by
  -- reading this file alone, with no dependency on inferring a
  -- system-generated identifier.
  constraint navigator_cases_title_check
    check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 200)
);

create index navigator_cases_owner_uid_idx on public.navigator_cases (owner_uid);

comment on table public.navigator_cases is
  'One CYFSA case/matter (Phase 2A). owner_uid is a Firebase uid, verified server-side by verifyFirebaseToken() before every write - never a client-supplied value. Named navigator_cases (not cases) specifically to avoid colliding with the pre-existing, unused legacy public.cases table.';

comment on constraint navigator_cases_title_check on public.navigator_cases is
  'Rejects an empty or whitespace-only title (trimmed length >= 1) and caps title length at 200 characters, mirroring the existing application-layer validation in POST /api/cases as a database-level backstop.';

-- ----------------------------------------------------------------------------

create table public.navigator_case_members (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.navigator_cases(id) on delete cascade,
  firebase_uid text not null,
  -- CHECK constraint deliberately lists only the role(s) Phase 2A actually
  -- needs. Extending it later (e.g. adding 'REVIEWER' for a future lawyer
  -- workflow) is a one-line ALTER TABLE ... DROP CONSTRAINT ... ADD
  -- CONSTRAINT ... - not a schema redesign.
  role text not null check (role in ('OWNER')),
  created_at timestamptz not null default now(),
  -- Prevents the same Firebase user from accidentally becoming a duplicate
  -- member of the same case (e.g. a retried request after a network blip).
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
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index navigator_documents_case_id_idx on public.navigator_documents (case_id);

comment on table public.navigator_documents is
  'Persistent identity for one logical document within a navigator_cases row. Metadata-only in Phase 2A - no raw file storage, no OCR output, no AI analysis. See navigator_document_versions for per-upload metadata.';

-- ----------------------------------------------------------------------------

create table public.navigator_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.navigator_documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  content_hash text not null,
  -- No DEFAULT: every insert must explicitly state the extraction outcome.
  -- The CHECK constraint keeps this a real, enforced state enum rather than
  -- an arbitrary free-text column, matching the reviewed design's intent.
  extraction_status text not null check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  -- Prevents two versions of the same document from accidentally claiming
  -- the same version number.
  unique (document_id, version_number)
);

create index navigator_document_versions_document_id_idx on public.navigator_document_versions (document_id);
create index navigator_document_versions_content_hash_idx on public.navigator_document_versions (content_hash);

comment on table public.navigator_document_versions is
  'One uploaded/re-uploaded instance of a navigator_documents row. Metadata-only in Phase 2A (no raw file bytes, no extracted text/pages yet) - content_hash and extraction_status exist now so a future phase can populate them without another migration.';

-- ============================================================================
-- Row-Level Security: enabled, zero policies, on all four tables above.
-- anon/authenticated are denied every operation by Postgres's own
-- default-deny behavior; only service_role can ever read or write. This is
-- reinforced, not replaced, by the explicit table-privilege revocation
-- immediately below.
-- ============================================================================

alter table public.navigator_cases enable row level security;
alter table public.navigator_case_members enable row level security;
alter table public.navigator_documents enable row level security;
alter table public.navigator_document_versions enable row level security;

-- ============================================================================
-- Explicit table-privilege restriction, in addition to RLS (not a
-- replacement for it). This project's default privileges grant full CRUD
-- to anon/authenticated on every new table unless explicitly revoked
-- (confirmed live, read-only, against this exact project in
-- PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md §12 and reconfirmed in
-- PHASE_2A_FINAL_MIGRATION_APPROVAL_AUDIT.md §8) - closing it here means an
-- anon/authenticated request fails at the privilege-check layer, before
-- RLS is even evaluated, rather than relying on RLS as the only barrier.
-- Role names (anon, authenticated, service_role) verified against this
-- project's actual role grants immediately before writing this file - see
-- PHASE_2A_MIGRATION_IMPLEMENTATION.md.
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
--
-- SECURITY INVOKER (Postgres's default, no elevation needed - the only
-- intended caller is service_role, which already bypasses RLS and holds
-- full table privileges above; SECURITY DEFINER would only add an
-- unnecessary privilege-escalation surface).
--
-- search_path pinned explicitly as defense-in-depth (closes the standing
-- Postgres/Supabase-linter "mutable search path" warning). Every table
-- reference in the body is ALSO fully schema-qualified regardless, which
-- independently neutralizes the classic search-path-hijack attack class -
-- the pinning below is redundant-but-correct hardening, not a fix for a
-- demonstrated exploit path.
--
-- p_description defaults to NULL so the existing application code
-- (api/services/cases.ts), which does not yet collect a description, can
-- keep calling this with exactly two named arguments; a future phase that
-- adds description support to the UI needs no further migration to use it.
-- ============================================================================

create or replace function public.create_navigator_case_with_owner(
  p_owner_uid text,
  p_title text,
  p_description text default null
)
returns public.navigator_cases
language plpgsql
set search_path = public, pg_temp
as $$
declare
  new_case public.navigator_cases;
begin
  insert into public.navigator_cases (owner_uid, title, description)
    values (p_owner_uid, p_title, p_description)
    returning * into new_case;

  insert into public.navigator_case_members (case_id, firebase_uid, role)
    values (new_case.id, p_owner_uid, 'OWNER');

  return new_case;
end;
$$;

comment on function public.create_navigator_case_with_owner(text, text, text) is
  'Atomically creates one navigator_cases row and its OWNER navigator_case_members row in a single Postgres transaction, so a case can never exist without an owner even if one of the two inserts fails. Called via db.rpc(''create_navigator_case_with_owner'', {...}) from api/services/cases.ts. Role is always OWNER, hardcoded - never caller-controlled. Does not touch public.cases or public.documents.';

-- ============================================================================
-- Function privileges: same defense-in-depth reasoning as the table
-- privileges above. Postgres grants EXECUTE on a new function to PUBLIC by
-- default unless explicitly revoked - left in place, this function would
-- be directly callable by anon/authenticated via PostgREST's RPC endpoint
-- (its actual writes would still be blocked by RLS/table privileges, but
-- relying on that alone was exactly the gap PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md
-- §11 flagged in the original design). service_role is confirmed, in that
-- same audit and reconfirmed in PHASE_2A_FINAL_MIGRATION_APPROVAL_AUDIT.md
-- §8, to be a fully valid, unrestricted grant target for a function
-- privilege in this Supabase environment - no platform limitation applies.
-- ============================================================================

revoke all on function public.create_navigator_case_with_owner(text, text, text) from public, anon, authenticated;
grant execute on function public.create_navigator_case_with_owner(text, text, text) to service_role;

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
--   -- EXPECTED: zero rows.
--
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
--   where routine_schema = 'public' and routine_name = 'create_navigator_case_with_owner';
--   -- EXPECTED: exactly one row - grantee = service_role, privilege_type = EXECUTE.
--
-- begin;
--   set local role anon;
--   select count(*) from public.navigator_cases;  -- EXPECTED: ERROR - permission denied
-- rollback;
--
-- begin;
--   set local role anon;
--   select create_navigator_case_with_owner('x','x');  -- EXPECTED: ERROR - permission denied for function
-- rollback;
--
-- select * from create_navigator_case_with_owner('test-uid-verify', 'Verification Case');
--   -- EXPECTED (as service_role only): one row back, and a matching
--   -- navigator_case_members row with role='OWNER'. Clean up manually
--   -- after verifying: delete both rows this created.
--
-- -- Confirm zero interaction with the legacy schema:
-- select count(*) from public.cases;      -- EXPECTED: 0 (unchanged, untouched)
-- select count(*) from public.documents;  -- EXPECTED: 0 (unchanged, untouched)
--
-- ============================================================================
-- ROLLBACK IF NEEDED (affects ONLY the objects created above - never touches
-- public.cases, public.documents, or any other legacy object):
-- ============================================================================
-- drop function if exists public.create_navigator_case_with_owner(text, text, text);
-- drop table if exists public.navigator_document_versions;
-- drop table if exists public.navigator_documents;
-- drop table if exists public.navigator_case_members;
-- drop table if exists public.navigator_cases;
--
-- NOTE: if real case/document data exists at rollback time, dropping these
-- tables destroys it with no automatic backup. Back up first if needed -
-- this rollback script performs no data-preservation step of its own.
