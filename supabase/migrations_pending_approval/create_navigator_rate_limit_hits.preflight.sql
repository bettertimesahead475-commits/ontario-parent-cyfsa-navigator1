-- READ-ONLY preflight and post-apply check for Migration C (create_navigator_rate_limit_hits.sql).
-- Runs in a read-only transaction; changes nothing.
--
-- Expected BEFORE applying C:
--   table_exists = false, window_idx_exists = false, function_exists = false,
--   supabase_roles_found = 3 (anon, authenticated, service_role).
--
-- Expected AFTER applying C:
--   table_exists = true, window_idx_exists = true, rls_enabled = true, rls_policy_count = 0,
--   function_exists = true, function_security_definer = true, function_search_path_pinned = true,
--   service_role_can_execute = true,
--   anon_can_execute = false, authenticated_can_execute = false, public_can_execute = false,
--   anon_can_select_table = false, authenticated_can_select_table = false, public_can_select_table = false.
begin read only;
select
  current_database() as database,
  to_regclass('public.navigator_rate_limit_hits') is not null as table_exists,
  to_regclass('public.navigator_rate_limit_hits_window_idx') is not null as window_idx_exists,
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'navigator_rate_limit_hits'
  ), false) as rls_enabled,
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public' and tablename = 'navigator_rate_limit_hits'
  ) as rls_policy_count,
  to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') is not null as function_exists,
  coalesce((
    select p.prosecdef
    from pg_proc p
    where p.oid = to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)')
  ), false) as function_security_definer,
  coalesce((
    select 'search_path=public, pg_temp' = any(p.proconfig)
    from pg_proc p
    where p.oid = to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)')
  ), false) as function_search_path_pinned,
  (
    select count(*)::integer
    from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ) as supabase_roles_found,
  case
    when to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') is null then null
    else has_function_privilege('service_role', 'public.navigator_rate_limit_hit(text,integer,integer)', 'EXECUTE')
  end as service_role_can_execute,
  case
    when to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') is null then null
    else has_function_privilege('anon', 'public.navigator_rate_limit_hit(text,integer,integer)', 'EXECUTE')
  end as anon_can_execute,
  case
    when to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') is null then null
    else has_function_privilege('authenticated', 'public.navigator_rate_limit_hit(text,integer,integer)', 'EXECUTE')
  end as authenticated_can_execute,
  case
    when to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') is null then null
    else has_function_privilege('public', 'public.navigator_rate_limit_hit(text,integer,integer)', 'EXECUTE')
  end as public_can_execute,
  case
    when to_regclass('public.navigator_rate_limit_hits') is null then null
    else has_table_privilege('anon', 'public.navigator_rate_limit_hits', 'SELECT')
  end as anon_can_select_table,
  case
    when to_regclass('public.navigator_rate_limit_hits') is null then null
    else has_table_privilege('authenticated', 'public.navigator_rate_limit_hits', 'SELECT')
  end as authenticated_can_select_table,
  case
    when to_regclass('public.navigator_rate_limit_hits') is null then null
    else has_table_privilege('public', 'public.navigator_rate_limit_hits', 'SELECT')
  end as public_can_select_table;
rollback;
