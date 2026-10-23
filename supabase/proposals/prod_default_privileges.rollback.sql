-- ROLLBACK for prod_default_privileges.sql. PROPOSAL ONLY. Requires owner approval.
-- Restores the observed default ACLs for tables and sequences created by postgres.
begin;

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to anon, authenticated;

commit;
