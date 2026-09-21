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
