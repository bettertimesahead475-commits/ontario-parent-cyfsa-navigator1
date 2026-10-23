-- ============================================================================
-- RECOMMENDED FOLLOW-UP. PROPOSAL ONLY. NOT APPLIED. Requires separate owner approval.
--
-- PURPOSE: stop tables and sequences created by the postgres role from being
-- granted to anon and authenticated automatically.
--
-- OBSERVED STATE (read-only, 2026-10-22, PostgreSQL 17.6): default ACLs for
-- schema public give anon, authenticated and service_role:
--   * tables:    ALL
--   * sequences: USAGE, SELECT, UPDATE
-- Other default-ACL rows belong to supabase_admin, which the postgres role
-- cannot alter. Those need Supabase support or owner action (see runbook).
--
-- NOT INCLUDED: default EXECUTE on functions. Production functions currently
-- grant no EXECUTE to PUBLIC, anon or authenticated. Whether NEW functions
-- inherit PUBLIC EXECUTE depends on PostgreSQL 17 default-ACL behaviour, which
-- could not be reproduced on the local PostgreSQL 16 test server. This needs a
-- check on a PostgreSQL 17 staging branch before any function-default change.
--
-- WHY service_role IS GRANTED EXPLICITLY: PostgreSQL drops a default-ACL row
-- when a revoke empties it, which restores built-in defaults. The explicit
-- service_role grant keeps the row.
--
-- EFFECT ON THE SERVER: none. The server uses service_role only.
-- ============================================================================

begin;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;

commit;
