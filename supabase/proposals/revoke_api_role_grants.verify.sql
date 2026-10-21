-- READ-ONLY post-change verification for revoke_api_role_grants.sql.
-- Safe to run on production: SELECT only, inside a read-only transaction.
-- Expected result: every row has ok = true. Any ok = false row means the state is wrong.
begin read only;

with expected(tbl, anon_privs, auth_privs) as (
  select t, case when t = 'document_walkthroughs' then 'SELECT' else '' end, ''
  from unnest(array[
    'access_codes','analysis_results','audit_log','case_exports','cases','cyfsa_300rule_access_codes',
    'document_walkthroughs','documents','free_tool_usage','free_usage','gmail_processed_messages',
    'lawyer_leads','lawyer_profiles','parent_profiles','payments','reflection_conversations',
    'stale_payment_alerts','submissions','timeline_events','users'
  ]) as t
),
actual as (
  select e.tbl,
    coalesce((select string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = e.tbl and g.grantee = 'anon'), '') as anon_privs,
    coalesce((select string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = e.tbl and g.grantee = 'authenticated'), '') as auth_privs
  from expected e
)
select a.tbl,
  a.anon_privs,
  a.auth_privs,
  (a.anon_privs = case when a.tbl = 'document_walkthroughs' then 'SELECT' else '' end and a.auth_privs = '') as ok
from actual a
order by a.tbl;

-- Table-level grants from PUBLIC or any other role must also be absent.
select 'unexpected_grantee' as check, grantee, table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee not in ('postgres','service_role','anon','authenticated')
  and table_name in (
    'access_codes','analysis_results','audit_log','case_exports','cases','cyfsa_300rule_access_codes',
    'document_walkthroughs','documents','free_tool_usage','free_usage','gmail_processed_messages',
    'lawyer_leads','lawyer_profiles','parent_profiles','payments','reflection_conversations',
    'stale_payment_alerts','submissions','timeline_events','users')
  and grantee <> 'postgres';

commit;
