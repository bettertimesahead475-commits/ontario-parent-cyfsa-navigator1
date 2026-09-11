-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- This migration is NOT applied. It is a draft artifact only, prepared for
-- review — not yet approved, not yet executed against production.
--
-- PURPOSE: creates the `accounts` table, the foundation of the
-- server-side application identity/ownership model:
--
--   Firebase identity -> accounts -> clients -> Matter -> documents/evidence/timeline/etc.
--
-- Firebase UID remains the sole authoritative identity mechanism. `accounts`
-- is a server-side application concept layered on top of it — NOT a
-- replacement for Firebase identity, and NOT a Supabase Auth user record.
--
-- SCOPE OF THIS MIGRATION: table-only, accounts only. It does NOT create
-- clients, matters, navigator_matters, navigator_matter_members, documents,
-- evidence, timeline tables, entitlements, organizations, audit telemetry,
-- or payment automation — those are separate, independently reviewable
-- future migrations. It does NOT touch navigator_cases,
-- navigator_case_members, navigator_documents, navigator_document_versions,
-- navigator_paid_sessions, access_codes, payments, or any other existing
-- table in this schema — this file contains no `alter table`, `drop`, or
-- `create policy` statement against any name other than the one new table
-- below.
--
-- OWNERSHIP MODEL (deliberately NOT auth.uid()-based — same pattern as the
-- already-reviewed navigator_* migrations in this same directory):
--   This application authenticates users exclusively via Firebase
--   Authentication, verified server-side with firebase-admin
--   (api/services/firebaseAdmin.ts). It has never used Supabase Auth, so
--   auth.uid() is always NULL for any request this application's own code
--   could ever issue. There is no browser-to-Supabase Firebase identity
--   bridge, so firebase_uid is never used inside a Supabase RLS policy.
--
--     Firebase ID token (client)
--       -> verifyFirebaseToken() (server, cryptographic verification)
--       -> verified Firebase uid (server-side only, never client-supplied)
--       -> server-side authorization check
--       -> service_role database operation (RLS-bypassing, as designed)
--
--   RLS is enabled on the table below with ZERO policies, AND table
--   privileges are explicitly revoked from PUBLIC/anon/authenticated and
--   granted only to service_role — the same defense-in-depth model
--   established in create_navigator_case_ownership_foundation.sql and
--   create_navigator_paid_sessions.sql, so a reviewer doesn't have to learn
--   a new pattern.
--
-- WHAT THIS CREATES:
--   public.accounts — one row per application account, keyed to a unique
--                      Firebase uid.
--
-- FIELD DESIGN NOTES:
--   - `firebase_uid` is a plain, indexed (via its UNIQUE constraint) `text`
--     column — NOT a foreign key into any Supabase-side identity table —
--     because Firebase's identity system is entirely external to Supabase's
--     relational one. This mirrors how the navigator_* tables already treat
--     Firebase uids throughout this codebase.
--   - `primary_role` is restricted to exactly 'parent', 'lawyer', 'admin' —
--     the three roles named in the approved architecture decision. Extending
--     this later is a one-line ALTER TABLE ... DROP CONSTRAINT ... ADD
--     CONSTRAINT ... - not a schema redesign - so this is not treated as
--     something to over-generalize now.
--   - `status` defaults to 'active' and is restricted to exactly 'active',
--     'suspended', 'deleted' — the three states named in the task. A
--     'deleted' status is modeled as a soft-delete marker on this row, not
--     an actual DELETE, so account history/audit trail is preserved; no
--     code path implementing that behavior exists yet, this column only
--     reserves the state.
--   - `email` and `display_name` are nullable: Firebase does not guarantee
--     every verified identity carries an email (verifyFirebaseToken() in
--     api/services/firebaseAdmin.ts returns `email: decoded.email || null`),
--     and a display name is not always collected at account-creation time.
--     Both are denormalized display/audit values only — NEVER an
--     authorization input.
--   - No `updated_at` trigger: this repository has no established
--     updated_at-maintenance trigger convention anywhere in its existing
--     migrations. create_navigator_case_ownership_foundation.sql's own
--     navigator_cases.updated_at column already has this exact same
--     no-trigger gap, left as an acknowledged, deliberately deferred item
--     rather than inventing a new trigger convention speculatively here.
--     `updated_at` is present (per the requested structure) and defaults to
--     now() on insert, but nothing currently keeps it current on UPDATE.
-- ============================================================================

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  primary_role text not null check (primary_role in ('parent', 'lawyer', 'admin')),
  email text,
  display_name text,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_firebase_uid_key unique (firebase_uid)
);

comment on table public.accounts is
  'One row per application account, the foundation of the accounts -> clients -> Matter -> documents/evidence/timeline ownership model. firebase_uid is the server-verified uid from verifyFirebaseToken() - never a client-supplied value - and is the sole authoritative identity link back to Firebase. Not a Supabase Auth user record; auth.uid() is never used against this table.';

comment on column public.accounts.firebase_uid is
  'The Firebase uid that owns this account. Plain, unique, indexed text - not a foreign key - Firebase''s identity system is external to Supabase''s relational one (this app never uses Supabase Auth / auth.uid()).';

comment on column public.accounts.primary_role is
  'One of parent, lawyer, admin. Determines the account''s primary application role; does not itself grant Supabase-level access - all authorization happens server-side before a service_role database operation is issued.';

comment on column public.accounts.email is
  'Denormalized display/audit value only - NEVER an authorization input. Nullable because Firebase does not guarantee every verified identity carries an email.';

comment on column public.accounts.status is
  'active, suspended, or deleted. deleted is a soft-delete marker on this row (no code path implementing that behavior exists yet) - it is not a substitute for an actual DELETE and does not remove the row.';

-- ============================================================================
-- Row-Level Security: enabled, zero policies - same pattern as the existing
-- navigator_* migrations in this directory. anon/authenticated are denied
-- every operation by Postgres's own default-deny behavior; only service_role
-- can ever read or write. Reinforced, not replaced, by the explicit
-- table-privilege revocation immediately below.
-- ============================================================================

alter table public.accounts enable row level security;

-- ============================================================================
-- Explicit table-privilege restriction, in addition to RLS (not a
-- replacement for it) - this project's default privileges grant full CRUD to
-- anon/authenticated on every new table unless explicitly revoked (the same
-- root cause as AUDIT.md's original C-1 finding, and the same reasoning the
-- navigator_* migrations already apply). Closing it here means an
-- anon/authenticated request fails at the privilege-check layer, before RLS
-- is even evaluated.
-- ============================================================================

revoke all on public.accounts from public, anon, authenticated;
grant select, insert, update, delete on public.accounts to service_role;

-- No database function is created by this migration, and no other table is
-- referenced, altered, or dropped.

-- ============================================================================
-- POST-APPLY VERIFICATION (run these after applying, expect the results shown):
-- ============================================================================
-- select relrowsecurity from pg_class where relname = 'accounts';
--   -- EXPECTED: true.
--
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename = 'accounts';
--   -- EXPECTED: 0.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'accounts'
--   and grantee in ('anon','authenticated');
--   -- EXPECTED: zero rows.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'accounts'
--   and grantee = 'service_role';
--   -- EXPECTED: four rows (select, insert, update, delete).
--
-- select conname from pg_constraint where conrelid = 'public.accounts'::regclass;
--   -- EXPECTED: primary key, the firebase_uid UNIQUE constraint, the
--   -- primary_role CHECK, and the status CHECK.
--
-- begin;
--   set local role anon;
--   select count(*) from public.accounts;  -- EXPECTED: ERROR - permission denied
-- rollback;
--
-- begin;
--   set local role authenticated;
--   select count(*) from public.accounts;  -- EXPECTED: ERROR - permission denied
-- rollback;
--
-- -- Confirm zero interaction with existing tables:
-- select count(*) from public.navigator_paid_sessions;  -- EXPECTED: relation does not exist (still unapplied)
-- select count(*) from public.access_codes;              -- EXPECTED: unchanged from before this migration.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Safe to roll back with a plain DROP ONLY while this table holds no rows a
-- human would need to keep - i.e. immediately after applying, before any
-- application code writes to it:
--
--   drop table if exists public.accounts;
--
-- ONCE REAL ACCOUNT DATA EXISTS, THIS DROP BECOMES UNSAFE AND MUST NOT BE RUN
-- AS A ROUTINE ROLLBACK - it would silently and irreversibly destroy every
-- account record. If a rollback is ever needed after this table has real
-- rows, export/back up its contents first, and treat the drop as a
-- deliberate, data-loss-accepting decision made explicitly at that time.
