-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- This migration is NOT applied. It is a draft artifact only, prepared for
-- review — not yet approved, not yet executed against production.
--
-- PURPOSE: Phase 3 Matter foundation. Establishes the permanent domain model:
--
--   Firebase identity -> accounts -> clients -> navigator_matters -> documents/evidence/timeline/etc.
--
-- per the approved architecture decision that `navigator_matters` (not a
-- continuation of `navigator_cases`) is the permanent Matter primitive, and
-- that `accounts` (not a raw Firebase uid column) is the authoritative
-- ownership relationship going forward.
--
-- SCOPE OF THIS MIGRATION — exactly five things, nothing else:
--   1. public.clients
--   2. public.navigator_matters
--   3. public.navigator_matter_members
--   4. public.create_navigator_matter_with_owner(...)
--   5. Retargeting navigator_documents' parent FK from case_id -> matter_id
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   - Does NOT touch navigator_cases, navigator_case_members, or
--     create_navigator_case_with_owner() in any way — no ALTER, no DROP, no
--     RENAME, no data migration. They remain exactly as applied, inert and
--     RLS-protected, per explicit instruction. A separate, later cleanup
--     migration retires them only after the application has fully moved to
--     the Matter path.
--   - Does NOT touch navigator_document_versions beyond what the case_id ->
--     matter_id rename on navigator_documents requires (nothing — that
--     table has no case_id/matter_id column of its own; it references
--     navigator_documents.id, which is unaffected by this rename).
--   - Does NOT touch public.cases, public.documents (unrelated legacy dead
--     schema), access_codes, payments, or navigator_paid_sessions.
--   - Does NOT create a Supabase Storage bucket, implement document upload,
--     or implement signed URLs — explicitly deferred to a later, separately
--     reviewed migration/task.
--   - Does NOT modify any application code. POST /api/cases and
--     api/services/cases.ts remain untouched and fully functional against
--     the old (still-live) navigator_cases path until a separate, later
--     authorized task migrates them to a new Matter route/service.
--
-- PRE-MIGRATION LIVE STATE (verified read-only, immediately before writing
-- this file, against project qboidsfpjuxeqtfotryj):
--   accounts                      — EXISTS (applied 20260909232624)
--   navigator_cases                — EXISTS (applied 20260909233412)
--   navigator_case_members         — EXISTS (applied 20260909233412)
--   navigator_documents             — EXISTS (applied 20260909233412), 0 rows
--   navigator_document_versions     — EXISTS (applied 20260909233412), 0 rows
--   clients                         — DOES NOT EXIST
--   navigator_matters               — DOES NOT EXIST
--   navigator_matter_members        — DOES NOT EXIST
--   create_navigator_matter_with_owner — DOES NOT EXIST
--   create_navigator_case_with_owner   — EXISTS (unaffected by this migration)
-- Zero rows in navigator_documents/navigator_document_versions means the
-- case_id -> matter_id column rename below is a pure schema change with no
-- data-loss risk — there is no existing data to lose.
--
-- OWNERSHIP MODEL (this migration's central architectural change vs. Phase
-- 2A): navigator_cases used a raw `owner_uid text` column bound directly to
-- a Firebase uid. navigator_matters instead uses `account_id uuid not null
-- references accounts(id)` — the Firebase uid remains the sole
-- authentication input (verified server-side by verifyFirebaseToken(),
-- exactly as before), but the *relational* identity now flows through the
-- accounts table:
--
--   Firebase ID token (client)
--     -> verifyFirebaseToken() (server, cryptographic verification)
--     -> verified Firebase uid (server-side only, never client-supplied)
--     -> create_navigator_matter_with_owner() resolves/creates the
--        corresponding accounts row FROM THAT VERIFIED UID (never from any
--        account id the browser could supply)
--     -> service_role database operation (RLS-bypassing, as designed)
--
-- Same defense-in-depth security model as every table added this session:
-- RLS enabled with ZERO policies, explicit REVOKE from PUBLIC/anon/
-- authenticated, GRANT restricted to service_role only.
-- ============================================================================

-- ============================================================================
-- 1. public.clients
-- ============================================================================
-- Minimal foundation only, per explicit instruction: no address, phone, DOB,
-- billing, subscription, or opposing-party fields. One owning account may
-- have multiple clients; a self-represented parent's own client record is
-- just an ordinary row here, associated with their own account — no special
-- casing in the schema for that.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_account_id_idx on public.clients (account_id);

comment on table public.clients is
  'A client belonging to an owning account (accounts -> clients -> navigator_matters). One account may have multiple clients. A self-represented parent''s own client record is an ordinary row here associated with their own account - no special-cased schema for that. Minimal foundation only: no address/phone/DOB/billing/subscription/opposing-party fields yet, per explicit Phase 3 scope decision.';

comment on column public.clients.account_id is
  'The owning accounts row. ON DELETE RESTRICT: an account cannot be deleted while it still owns client records, preventing silent data loss - the same caution already applied to navigator_matters below.';

alter table public.clients enable row level security;

revoke all on public.clients from public, anon, authenticated;
grant select, insert, update, delete on public.clients to service_role;

-- ============================================================================
-- 2. public.navigator_matters
-- ============================================================================
-- The permanent Matter primitive, replacing navigator_cases going forward
-- (navigator_cases itself is left untouched by this migration - see header).
-- Ownership is represented by account_id, never by a raw Firebase uid column
-- - this is the deliberate architectural shift from navigator_cases' design.

create table public.navigator_matters (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint navigator_matters_title_check
    check (char_length(btrim(title)) >= 1 and char_length(btrim(title)) <= 200)
);

create index navigator_matters_account_id_idx on public.navigator_matters (account_id);
create index navigator_matters_client_id_idx on public.navigator_matters (client_id);

comment on table public.navigator_matters is
  'One CYFSA Matter (Phase 3 permanent domain primitive, superseding navigator_cases - see this migration''s header for why navigator_cases itself is left untouched rather than dropped/renamed). Ownership is represented by account_id, not a raw Firebase uid column - the Firebase uid remains the sole authentication input, resolved to an accounts row server-side by create_navigator_matter_with_owner() before this table is ever written.';

comment on column public.navigator_matters.account_id is
  'The owning accounts row (resolved server-side from the verified Firebase uid - never client-supplied). ON DELETE RESTRICT: a Matter must not silently disappear because an account row is deleted.';

comment on column public.navigator_matters.client_id is
  'The client this Matter belongs to. Verified server-side (in create_navigator_matter_with_owner()) to actually belong to the resolved account before the Matter is created - a client id alone is never trusted without that ownership check. ON DELETE RESTRICT: a Matter must not silently disappear because a client row is deleted.';

comment on constraint navigator_matters_title_check on public.navigator_matters is
  'Rejects an empty or whitespace-only title (trimmed length >= 1) and caps title length at 200 characters - the same constraint already verified on navigator_cases.title, carried forward unchanged.';

alter table public.navigator_matters enable row level security;

revoke all on public.navigator_matters from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_matters to service_role;

-- ============================================================================
-- 3. public.navigator_matter_members
-- ============================================================================
-- Who may access a navigator_matters row, and in what role. Keyed to
-- account_id (not firebase_uid, unlike navigator_case_members) per the
-- approved relational identity model: Firebase verified uid -> accounts.id
-- -> Matter membership. OWNER-only for now - no REVIEWER/LAWYER/CO_COUNSEL/
-- ADMIN roles are added speculatively.

create table public.navigator_matter_members (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  role text not null check (role in ('OWNER')),
  created_at timestamptz not null default now(),
  constraint navigator_matter_members_matter_account_key unique (matter_id, account_id)
);

create index navigator_matter_members_matter_id_idx on public.navigator_matter_members (matter_id);
create index navigator_matter_members_account_id_idx on public.navigator_matter_members (account_id);

comment on table public.navigator_matter_members is
  'Who may access a navigator_matters row, and in what role. Keyed to account_id (the relational identity), not firebase_uid directly - see this migration''s header for the accounts-first identity model. The Matter creator receives exactly one OWNER row here, created atomically with the Matter via create_navigator_matter_with_owner(). Role is currently restricted to OWNER only - extending it later (e.g. a future REVIEWER role for lawyer access) is a one-line ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ..., not a schema redesign, and is deliberately not anticipated speculatively here.';

comment on column public.navigator_matter_members.matter_id is
  'ON DELETE CASCADE: a membership row has no meaning once its Matter is gone - this is the one relationship in this migration where cascade, not restrict, is correct (mirrors navigator_case_members.case_id''s existing verified behavior).';

alter table public.navigator_matter_members enable row level security;

revoke all on public.navigator_matter_members from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_matter_members to service_role;

-- ============================================================================
-- 4. Matter creation function
-- ============================================================================
-- Supersedes create_navigator_case_with_owner() for new code going forward
-- WITHOUT touching that function in any way (see header). Adapts the same
-- atomic-creation guarantee to the new accounts-first identity model.
--
-- IDENTITY RULE (the reason this function exists in this exact shape):
-- p_firebase_uid is the ONLY identity input this function trusts as
-- authoritative. It is the server-verified uid from verifyFirebaseToken(),
-- supplied by the calling application code - never a client-supplied
-- account id, and never a client-supplied firebase uid either (the calling
-- route must obtain this value itself via Firebase token verification
-- before ever invoking this function - exactly as api/services/cases.ts
-- does today for create_navigator_case_with_owner()). This function accepts
-- no accountId parameter at all - the account is always resolved (or
-- created) from the verified Firebase uid, never accepted as a caller-
-- supplied value. This is the concrete mechanism that makes "the browser
-- must never be authoritative for either identity" true.
--
-- FIRST-USE ACCOUNT CREATION AND primary_role:
-- public.accounts.primary_role is NOT NULL with no DEFAULT (per the applied
-- create_accounts_foundation.sql), so an account cannot be inserted without
-- supplying one. Rather than hardcoding a role (the application supports
-- both parents and lawyers, and this database function must not silently
-- classify every newly created account as a parent), p_primary_role is an
-- explicit function parameter, supplied by the calling application code -
-- NOT a browser-authoritative identity field. This function is EXECUTE-
-- restricted to service_role only (see below), so p_primary_role is trusted
-- from the same caller (this application's own server-side code, after
-- Firebase token verification) that already supplies p_firebase_uid and
-- p_client_id - it carries no more trust exposure than those existing
-- parameters. The eventual Matter API/service layer is responsible for
-- determining the correct role server-side from the authenticated identity/
-- account context before calling this function; the browser must never be
-- allowed to choose an arbitrary account role - that responsibility lives
-- one layer up, in application code not yet written (a separate, later
-- authorized task), not in this database function.
--
-- VALIDATION: public.accounts.primary_role already carries a CHECK
-- constraint restricting it to exactly 'parent', 'lawyer', 'admin' (applied
-- in create_accounts_foundation.sql, unmodified by this migration). This
-- function does NOT duplicate that check with its own IF/RAISE - an invalid
-- p_primary_role value is rejected by that existing CHECK constraint at
-- INSERT time, with Postgres's own clear constraint-violation error. Adding
-- a second, redundant validation here would only maintain two copies of the
-- same rule with no additional safety.
--
-- primary_role is used ONLY when creating a brand-new account (inside the
-- INSERT ... ON CONFLICT DO NOTHING below) - it is never applied to, or
-- capable of overwriting, an existing account's primary_role, exactly like
-- every other account field this function touches.
--
-- ACCOUNT UPSERT CONSERVATISM: uses INSERT ... ON CONFLICT (firebase_uid) DO
-- NOTHING, then a separate SELECT to resolve the id whether the insert
-- happened or not. This is the most conservative option available: an
-- existing account's email/display_name/status/primary_role is NEVER
-- overwritten by a later Matter-creation call, even if the caller supplies
-- a different p_email than what's already on file. Only a brand-new
-- account's row is ever written by this function.
--
-- p_client_id is verified to actually belong to the resolved account before
-- the Matter is created - a client id supplied by the caller is checked,
-- never trusted blindly, closing the one place this function accepts an id
-- from outside its own resolution logic.
--
-- SECURITY INVOKER (Postgres default, no SECURITY DEFINER used - no
-- unavoidable reason for elevation was found; the only intended caller is
-- service_role, which already bypasses RLS and holds full privileges on
-- every table this function touches, exactly mirroring
-- create_navigator_case_with_owner()'s existing verified design).
--
-- search_path pinned exactly as the existing verified function does, for
-- the same defense-in-depth reasoning (every table reference below is also
-- fully schema-qualified regardless).
-- ============================================================================

create or replace function public.create_navigator_matter_with_owner(
  p_firebase_uid text,
  p_primary_role text,
  p_client_id uuid,
  p_title text,
  p_description text default null,
  p_email text default null
)
returns public.navigator_matters
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
  new_matter public.navigator_matters;
begin
  -- Resolve or create the accounts row from the verified Firebase uid only.
  -- p_primary_role is used ONLY for a brand-new account (see header) - the
  -- existing accounts.primary_role CHECK constraint ('parent'/'lawyer'/
  -- 'admin') validates it; this function does not duplicate that check.
  -- ON CONFLICT DO NOTHING + separate SELECT: the most conservative option -
  -- an existing account's fields (primary_role included) are never
  -- overwritten by this call.
  insert into public.accounts (firebase_uid, primary_role, email)
    values (p_firebase_uid, p_primary_role, p_email)
    on conflict (firebase_uid) do nothing;

  select id into v_account_id
    from public.accounts
    where firebase_uid = p_firebase_uid;

  if v_account_id is null then
    raise exception 'Failed to resolve or create an account for the given Firebase uid.';
  end if;

  -- Verify the supplied client id actually belongs to the resolved account -
  -- never trust a client id from the caller without this check.
  if not exists (
    select 1 from public.clients
    where id = p_client_id and account_id = v_account_id
  ) then
    raise exception 'The supplied client does not belong to the resolved account.';
  end if;

  insert into public.navigator_matters (account_id, client_id, title, description)
    values (v_account_id, p_client_id, p_title, p_description)
    returning * into new_matter;

  insert into public.navigator_matter_members (matter_id, account_id, role)
    values (new_matter.id, v_account_id, 'OWNER');

  return new_matter;
end;
$$;

comment on function public.create_navigator_matter_with_owner(text, text, uuid, text, text, text) is
  'Atomically resolves-or-creates the caller''s accounts row from a server-verified Firebase uid, verifies the supplied client belongs to that account, then creates one navigator_matters row and its OWNER navigator_matter_members row in a single Postgres transaction. Does not accept an account id from the caller - the account is always resolved from p_firebase_uid, never supplied directly, so the browser cannot be authoritative for either identity. p_primary_role (parent/lawyer/admin, enforced by the existing accounts.primary_role CHECK constraint) is used only when creating a brand-new account and is never applied to an existing one - the calling application''s server-side code is responsible for determining the correct role from the authenticated identity/account context; the browser must never choose it. Supersedes create_navigator_case_with_owner() for new code; that function is left unmodified and still exists.';

revoke all on function public.create_navigator_matter_with_owner(text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_navigator_matter_with_owner(text, text, uuid, text, text, text) to service_role;

-- ============================================================================
-- 5. Retarget navigator_documents from Case -> Matter
-- ============================================================================
-- navigator_documents currently has zero rows and zero consuming application
-- code (verified read-only, repo-wide, immediately before writing this
-- file) - the cleanest possible time to make this change, with no data-loss
-- risk and no code to update in the same breath.
--
-- navigator_document_versions is NOT altered: it references
-- navigator_documents.id (an opaque uuid), which is completely unaffected
-- by renaming navigator_documents' own parent-pointer column.

alter table public.navigator_documents drop constraint navigator_documents_case_id_fkey;
drop index if exists public.navigator_documents_case_id_idx;

alter table public.navigator_documents rename column case_id to matter_id;

alter table public.navigator_documents
  add constraint navigator_documents_matter_id_fkey
  foreign key (matter_id) references public.navigator_matters(id) on delete cascade;

create index navigator_documents_matter_id_idx on public.navigator_documents (matter_id);

comment on column public.navigator_documents.matter_id is
  'The navigator_matters row this document belongs to. Retargeted from case_id (navigator_cases) to matter_id (navigator_matters) in this migration - navigator_documents held zero rows and zero consuming application code at the time of this change, so no data migration or code update was required.';

-- ============================================================================
-- POST-APPLY VERIFICATION (run these after applying, expect the results shown):
-- ============================================================================
-- select relrowsecurity from pg_class where relname in
--   ('clients','navigator_matters','navigator_matter_members');
--   -- EXPECTED: true for all three rows.
--
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename in ('clients','navigator_matters','navigator_matter_members');
--   -- EXPECTED: 0.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public'
--   and table_name in ('clients','navigator_matters','navigator_matter_members')
--   and grantee in ('anon','authenticated');
--   -- EXPECTED: zero rows.
--
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
--   where routine_schema = 'public' and routine_name = 'create_navigator_matter_with_owner'
--   and grantee in ('anon','authenticated');
--   -- EXPECTED: zero rows.
--
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'navigator_documents';
--   -- EXPECTED: matter_id present, case_id absent.
--
-- -- Confirm zero interaction with the untouched old case objects:
-- select count(*) from public.navigator_cases;          -- EXPECTED: 0 (unchanged, untouched)
-- select count(*) from public.navigator_case_members;    -- EXPECTED: 0 (unchanged, untouched)
-- select proname from pg_proc where proname = 'create_navigator_case_with_owner';
--   -- EXPECTED: still exists, unchanged.
--
-- select * from create_navigator_matter_with_owner('test-uid-verify', 'parent', '<a real client id>', 'Verification Matter');
--   -- EXPECTED (as service_role only, after first creating a test client row):
--   -- one row back, a matching navigator_matter_members row with role='OWNER',
--   -- and an accounts row for 'test-uid-verify' if one didn't already exist.
--   -- Clean up manually after verifying.
--
-- ============================================================================
-- ROLLBACK IF NEEDED (affects ONLY the objects created/altered above - never
-- touches navigator_cases, navigator_case_members, create_navigator_case_with_owner,
-- or any other existing object):
-- ============================================================================
-- alter table public.navigator_documents drop constraint navigator_documents_matter_id_fkey;
-- drop index if exists public.navigator_documents_matter_id_idx;
-- alter table public.navigator_documents rename column matter_id to case_id;
-- alter table public.navigator_documents
--   add constraint navigator_documents_case_id_fkey
--   foreign key (case_id) references public.navigator_cases(id) on delete cascade;
-- create index navigator_documents_case_id_idx on public.navigator_documents (case_id);
--
-- drop function if exists public.create_navigator_matter_with_owner(text, text, uuid, text, text, text);
-- drop table if exists public.navigator_matter_members;
-- drop table if exists public.navigator_matters;
-- drop table if exists public.clients;
--
-- NOTE: if real Matter/client data exists at rollback time, dropping these
-- tables destroys it with no automatic backup. Back up first if needed -
-- this rollback script performs no data-preservation step of its own.
