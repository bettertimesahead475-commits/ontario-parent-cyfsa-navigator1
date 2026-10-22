-- ============================================================================
-- READ-ONLY verification for revoke_api_role_grants.sql. SELECT only.
-- Safe on production. Expected: every row has ok = true.
-- Output rows:  <object>|<anon privileges>|<authenticated privileges>|<ok>
-- ============================================================================

begin read only;

with expected(tbl, anon_expected) as (
  select t, case when t = 'document_walkthroughs' then 'SELECT' else '' end
  from unnest(array[
    'access_codes','analysis_results','audit_log','case_exports','cases','cyfsa_300rule_access_codes',
    'document_walkthroughs','documents','free_tool_usage','free_usage','gmail_processed_messages',
    'lawyer_leads','lawyer_profiles','parent_profiles','payments','reflection_conversations',
    'stale_payment_alerts','submissions','timeline_events','users'
  ]) as t
)
select e.tbl as object,
  coalesce((select string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = e.tbl and g.grantee = 'anon'), '') as anon_privs,
  coalesce((select string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = e.tbl and g.grantee = 'authenticated'), '') as auth_privs,
  (coalesce((select string_agg(privilege_type, ',' order by privilege_type)
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = e.tbl and g.grantee = 'anon'), '') = e.anon_expected
   and coalesce((select count(*) from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = e.tbl and g.grantee = 'authenticated'), 0) = 0) as ok
from expected e
order by e.tbl;

-- Sequence: neither API role may hold any privilege.
select 'navigator_matter_access_events_event_sequence_seq' as object,
  case when has_sequence_privilege('anon', 'public.navigator_matter_access_events_event_sequence_seq', 'USAGE') then 'USAGE' else '' end ||
  case when has_sequence_privilege('anon', 'public.navigator_matter_access_events_event_sequence_seq', 'SELECT') then ',SELECT' else '' end ||
  case when has_sequence_privilege('anon', 'public.navigator_matter_access_events_event_sequence_seq', 'UPDATE') then ',UPDATE' else '' end as anon_privs,
  case when has_sequence_privilege('authenticated', 'public.navigator_matter_access_events_event_sequence_seq', 'USAGE') then 'USAGE' else '' end ||
  case when has_sequence_privilege('authenticated', 'public.navigator_matter_access_events_event_sequence_seq', 'SELECT') then ',SELECT' else '' end ||
  case when has_sequence_privilege('authenticated', 'public.navigator_matter_access_events_event_sequence_seq', 'UPDATE') then ',UPDATE' else '' end as auth_privs,
  (not has_sequence_privilege('anon', 'public.navigator_matter_access_events_event_sequence_seq', 'USAGE')
   and not has_sequence_privilege('anon', 'public.navigator_matter_access_events_event_sequence_seq', 'SELECT')
   and not has_sequence_privilege('anon', 'public.navigator_matter_access_events_event_sequence_seq', 'UPDATE')
   and not has_sequence_privilege('authenticated', 'public.navigator_matter_access_events_event_sequence_seq', 'USAGE')
   and not has_sequence_privilege('authenticated', 'public.navigator_matter_access_events_event_sequence_seq', 'SELECT')
   and not has_sequence_privilege('authenticated', 'public.navigator_matter_access_events_event_sequence_seq', 'UPDATE')) as ok;

-- No unexpected grantees on the 20 tables (PUBLIC or any role other than the owner and service_role).
select 'unexpected_grantee' as object, grantee as anon_privs, table_name as auth_privs, 'f' as ok
from information_schema.role_table_grants
where table_schema = 'public' and grantee not in ('postgres', 'service_role', 'anon', 'authenticated')
  and table_name in ('access_codes','analysis_results','audit_log','case_exports','cases','cyfsa_300rule_access_codes',
    'document_walkthroughs','documents','free_tool_usage','free_usage','gmail_processed_messages',
    'lawyer_leads','lawyer_profiles','parent_profiles','payments','reflection_conversations',
    'stale_payment_alerts','submissions','timeline_events','users');

commit;
