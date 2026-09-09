-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- This migration is NOT applied. It is a draft artifact only, prepared for
-- review — not yet approved, not yet executed against production.
--
-- PURPOSE: creates the durable, server-side store needed to make paid
-- sessions (the `x-ps-session` bearer token issued by /api/activate-code)
-- individually revocable and bound to a verified Firebase identity, closing
-- the two outstanding findings from this remediation's session-security
-- audits:
--   - M-2 (AUDIT.md): "Session tokens have no server-side revocation" — a
--     paid user's access cannot be cut off before the token's own natural
--     expiry (e.g. after a refund/chargeback) without rotating the shared
--     signing secret, which logs out every other currently-valid session
--     too. This table gives each issued session its own row an admin can
--     revoke individually, or in bulk by Firebase UID, without touching any
--     other session.
--   - Finding 3 (paid-session security audit): the token is a fully
--     transferable bearer credential with no binding to the Firebase
--     identity that redeemed it — this table's `firebase_uid` column is
--     what a future verification step would check the caller against.
--
-- SCOPE OF THIS MIGRATION: table-only. It does NOT change how sessions are
-- issued, verified, or revoked today — that is application code
-- (api/services/access.ts, api/_server.ts) which is deliberately untouched
-- in this task. This migration only prepares the schema a later,
-- separately-reviewed application change will read and write. Until that
-- application change ships, this table sits empty and unused; today's
-- /api/activate-code / verifySessionToken() / requireSession() /
-- allowFreeToolUse() behavior is completely unaffected by this migration
-- existing, applied or not.
--
-- RELATIONSHIP TO PHASE 2A: none. This is a separate, independently
-- reviewable and independently executable migration from
-- create_navigator_case_ownership_foundation.sql (still itself pending,
-- unapplied). They touch unrelated concerns (case ownership vs. paid-session
-- identity) and entirely disjoint tables. Bundling them would make either
-- one harder to review or roll back on its own — see the architecture
-- audit that recommended this table for the explicit reasoning. This
-- migration follows the exact same conventions that one established
-- (RLS enabled with zero policies, explicit table-privilege revoke/grant,
-- gen_random_uuid() primary keys, named CHECK constraints) precisely so a
-- reviewer doesn't have to learn a second pattern.
--
-- WHAT THIS CREATES:
--   public.navigator_paid_sessions — one row per issued paid-session token.
--
-- WHAT THIS DOES NOT DO (must not be assumed from this migration alone):
--   - Does not alter, drop, or add policies/grants to any existing table
--     (access_codes, payments, users, cases, documents, or any other object
--     already in this schema) — confirmed by this file containing no
--     `alter table`, `drop`, or `create policy` statement against any name
--     other than the one new table below.
--   - Does not create a database function. Session issuance is a single-row
--     INSERT and revocation is a single-row UPDATE by primary key or by
--     firebase_uid — unlike Phase 2A's case+membership creation (which
--     needed one atomic function because it wrote two related tables in one
--     step), nothing here requires cross-table atomicity, so a
--     SECURITY-DEFINER/INVOKER function would only add surface area for no
--     benefit. If a future requirement needs one (e.g. "revoke and log to
--     audit_log atomically"), it should be reviewed and added at that time,
--     not speculatively now.
--   - Does not implement Firebase-authentication-at-redemption, JTI token
--     issuance, DB-backed verification, or admin revoke endpoints — those
--     are the application-code changes this schema exists to support, each
--     requiring its own separate review.
--
-- OWNERSHIP MODEL (same as Phase 2A, for the same reason): this application
-- authenticates exclusively via Firebase, verified server-side by
-- firebase-admin (api/services/firebaseAdmin.ts). It has never used Supabase
-- Auth, so auth.uid() is always NULL for any request this application's own
-- code could ever issue. firebase_uid is therefore a plain, indexed `text`
-- column — NOT a foreign key into any Supabase-side identity table — because
-- Firebase's identity system is entirely external to Supabase's relational
-- one. This mirrors how api/services/access.ts and the navigator_* tables
-- already treat Firebase uids throughout this codebase.
--
-- TIER VALUES: the currently valid production tiers are exactly 'Pro' and
-- 'Premium' — confirmed against api/services/access.ts's TIER_PRICES map,
-- the single source of truth the application actually prices and gates
-- against. The live public.access_codes.tier CHECK constraint additionally
-- allows two legacy values ('pro_advocate', 'premium_attorney') that are not
-- referenced anywhere in current application code (confirmed by a repo-wide
-- grep) — inherited schema drift from an earlier, abandoned tier-naming
-- scheme. This migration deliberately does NOT copy those dead values into
-- the new table's CHECK constraint, and does NOT touch access_codes' own
-- constraint (out of scope here; that cleanup, if ever done, is its own,
-- separately-reviewed change against a table this migration must not alter).
--
-- ACCESS-CODE RELATIONSHIP: public.access_codes.id is `uuid`, default
-- gen_random_uuid() (confirmed live, read-only, immediately before writing
-- this file). access_code_id below is a nullable FK to it:
--   - Nullable because a session need not always trace back to a redeemed
--     code — a future admin-issued "comp" session is a legitimate case this
--     schema shouldn't structurally forbid.
--   - `on delete set null`, not cascade and not restrict: this application's
--     code never deletes an access_codes row today (confirmed by grep — no
--     DELETE against that table anywhere in api/), so this behavior is
--     currently inert either way, but `set null` is the safe choice per the
--     explicit instruction to never let removing a code row silently delete
--     session/audit history: the session row survives, only the traceability
--     link is cleared, rather than either destroying the session (cascade)
--     or blocking an otherwise-legitimate cleanup of the code table
--     (restrict).
--   - UNIQUE(access_code_id): under the exact redemption logic in
--     verifyAccessCode() (api/services/access.ts:272-299), a code can be
--     successfully redeemed at most once, ever — the lookup is scoped to
--     `used_at IS NULL`, and redemption immediately sets `used_at`, so no
--     second call can ever match that same row again. One access code can
--     therefore produce at most one session under today's redemption flow,
--     and this constraint enforces that real invariant rather than
--     inventing a new restriction. Multiple NULLs remain allowed (Postgres's
--     standard behavior), so any number of non-code-derived sessions may
--     coexist. NOTE for whoever builds the next phase: if a future feature
--     lets one entitlement mint more than one session without a fresh code
--     (e.g. a "sign in on a new device" flow reusing an existing
--     entitlement), this constraint will need explicit revisiting then —
--     it is not being anticipated speculatively here.
--
-- FIELD DESIGN NOTES (deliberate deviations from the conceptual field list
-- this migration was drafted from):
--   - No separate `created_at`: `issued_at` already records exactly the
--     moment this row (and the session it represents) came into existence —
--     for this table, "created" and "issued" are the same event, so adding
--     both would be pure redundancy. issued_at is the canonical timestamp.
--   - No `updated_at`: this table has exactly one mutation path once a row
--     exists — revocation — and `revoked_at` already records that event
--     precisely. A generic `updated_at` would either duplicate `revoked_at`
--     or require a trigger to keep it honest across future mutation paths
--     that don't exist yet. Phase 2A's own audit trail flagged exactly this
--     ambiguity for navigator_cases.updated_at (no trigger exists there
--     either) and deferred it until a real UPDATE path was added — the
--     equivalent decision here is to not add the column until a mutation
--     exists that `revoked_at` alone can't already describe.
--   - `email` is included, but deliberately NULLABLE and explicitly commented
--     as non-authoritative: verifyFirebaseToken() (api/services/
--     firebaseAdmin.ts:59) returns `email: decoded.email || null` — Firebase
--     does not guarantee every verified identity carries an email — so a
--     NOT NULL constraint here would be factually wrong about what Firebase
--     actually verifies. It exists purely so a future admin support tool can
--     display "which session is this" without joining back through
--     access_codes/payments, and must never be read as an authorization
--     input anywhere it's eventually used.
--
-- ============================================================================

create table public.navigator_paid_sessions (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  email text,
  tier text not null check (tier in ('Pro', 'Premium')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  access_code_id uuid references public.access_codes(id) on delete set null,
  -- Never allow a reason to be recorded without an actual revocation
  -- timestamp - a reason with no revoked_at would be a data-entry mistake,
  -- not a real state this table should represent as valid.
  constraint navigator_paid_sessions_revocation_consistency_check
    check (revoked_at is not null or revocation_reason is null),
  constraint navigator_paid_sessions_access_code_id_key unique (access_code_id)
);

-- Required for the "revoke all sessions for this Firebase UID" operation
-- this table exists to support, and for a future "list my active sessions"
-- read - both filter by firebase_uid, never by id alone.
create index navigator_paid_sessions_firebase_uid_idx on public.navigator_paid_sessions (firebase_uid);

-- Postgres does not automatically index FK columns; this supports tracing
-- from an access_codes row forward to the session(s) it produced, and is
-- also the column the UNIQUE constraint above already needs to check.
create index navigator_paid_sessions_access_code_id_idx on public.navigator_paid_sessions (access_code_id);

comment on table public.navigator_paid_sessions is
  'One row per issued paid-session token (Pro/Premium access, redeemed via /api/activate-code). Exists to make sessions individually revocable and bound to a verified Firebase identity - see this migration''s header for the full M-2 / Finding 3 rationale. Table-only: no issuance/verification/revocation logic runs against this table yet (that is a separate, not-yet-implemented application change). firebase_uid is the server-verified uid from verifyFirebaseToken() - never a client-supplied value - once the application change that populates this table ships.';

comment on column public.navigator_paid_sessions.firebase_uid is
  'The Firebase uid that redeemed the access code / owns this session. Plain indexed text, not a foreign key - Firebase''s identity system is external to Supabase''s relational one (this app never uses Supabase Auth / auth.uid()).';

comment on column public.navigator_paid_sessions.email is
  'Denormalized display/audit value only - NEVER an authorization input. Nullable because Firebase does not guarantee every verified identity carries an email.';

comment on column public.navigator_paid_sessions.access_code_id is
  'Traces this session back to the access_codes row that produced it. Nullable (a future admin-issued session need not derive from a code) and ON DELETE SET NULL (removing a code row must never silently delete session/audit history). UNIQUE because the current redemption flow allows a given code to be successfully redeemed at most once - see migration header.';

comment on column public.navigator_paid_sessions.revoked_at is
  'NULL means the session is not revoked. Set once, never cleared - a re-issued session after a legitimate re-purchase gets its own new row, not a resurrected old one.';

-- ============================================================================
-- Row-Level Security: enabled, zero policies - same pattern as Phase 2A's
-- navigator_* tables and this project's existing free_usage /
-- gmail_processed_messages / stale_payment_alerts fix. anon/authenticated
-- are denied every operation by Postgres's own default-deny behavior; only
-- service_role can ever read or write. Reinforced, not replaced, by the
-- explicit table-privilege revocation immediately below.
-- ============================================================================

alter table public.navigator_paid_sessions enable row level security;

-- ============================================================================
-- Explicit table-privilege restriction, in addition to RLS (not a
-- replacement for it) - this project's default privileges grant full CRUD to
-- anon/authenticated on every new table unless explicitly revoked (the same
-- root cause as AUDIT.md's original C-1 finding, and the same reasoning
-- Phase 2A's navigator_* tables already apply). Closing it here means an
-- anon/authenticated request fails at the privilege-check layer, before RLS
-- is even evaluated.
-- ============================================================================

revoke all on public.navigator_paid_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_paid_sessions to service_role;

-- No database function is created by this migration - see the "WHAT THIS
-- DOES NOT DO" section in the header for why none is needed at this stage.

-- ============================================================================
-- POST-APPLY VERIFICATION (run these after applying, expect the results shown):
-- ============================================================================
-- select relrowsecurity from pg_class where relname = 'navigator_paid_sessions';
--   -- EXPECTED: true.
--
-- select count(*) from pg_policies where schemaname = 'public'
--   and tablename = 'navigator_paid_sessions';
--   -- EXPECTED: 0.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'navigator_paid_sessions'
--   and grantee in ('anon','authenticated');
--   -- EXPECTED: zero rows.
--
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'navigator_paid_sessions'
--   and grantee = 'service_role';
--   -- EXPECTED: four rows (select, insert, update, delete).
--
-- select indexname from pg_indexes where schemaname = 'public'
--   and tablename = 'navigator_paid_sessions';
--   -- EXPECTED: the primary key index plus
--   -- navigator_paid_sessions_firebase_uid_idx and
--   -- navigator_paid_sessions_access_code_id_idx.
--
-- select conname from pg_constraint where conrelid = 'public.navigator_paid_sessions'::regclass;
--   -- EXPECTED: primary key, the tier CHECK, the revocation-consistency
--   -- CHECK, the access_codes FK, and the access_code_id UNIQUE constraint.
--
-- begin;
--   set local role anon;
--   select count(*) from public.navigator_paid_sessions;  -- EXPECTED: ERROR - permission denied
-- rollback;
--
-- begin;
--   set local role authenticated;
--   select count(*) from public.navigator_paid_sessions;  -- EXPECTED: ERROR - permission denied
-- rollback;
--
-- -- Confirm zero interaction with existing tables:
-- select count(*) from public.access_codes;  -- EXPECTED: unchanged from before this migration.
-- select count(*) from public.payments;      -- EXPECTED: unchanged from before this migration.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Safe to roll back with a plain DROP ONLY while this table holds no rows a
-- human would need to keep - i.e. immediately after applying, before any
-- application code writes to it:
--
--   drop table if exists public.navigator_paid_sessions;
--
-- ONCE REAL SESSION DATA EXISTS, THIS DROP BECOMES UNSAFE AND MUST NOT BE
-- RUN AS A ROUTINE ROLLBACK: it would silently and irreversibly destroy the
-- only audit trail of which paid sessions were ever issued, to whom, and
-- whether/why they were revoked - exactly the record this table exists to
-- provide. If a rollback is ever needed after this table has real rows,
-- the correct approach is to export/back up its contents first (e.g.
-- `select * from public.navigator_paid_sessions` via the Supabase SQL
-- editor, saved externally), and to treat the drop as a deliberate,
-- data-loss-accepting decision made explicitly at that time - not something
-- this migration should make easy to do by accident via a one-line command.
