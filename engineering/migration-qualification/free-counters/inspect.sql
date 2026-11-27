-- Read-only inventory. Run only against the independently verified target, with approval.
BEGIN READ ONLY;
SELECT current_database(), current_setting('server_version'), datcollate, datctype
FROM pg_database WHERE datname = current_database();

SELECT to_regclass('public.free_usage') AS counter_table,
       to_regclass('public.analyzer_jobs') AS queue_table,
       to_regclass('supabase_migrations.schema_migrations') AS migration_history;

SELECT attname, format_type(atttypid, atttypmod) AS data_type, attnotnull
FROM pg_attribute WHERE attrelid = to_regclass('public.free_usage') AND attnum > 0 AND NOT attisdropped
ORDER BY attnum;

SELECT oid::regclass AS relation, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid IN (to_regclass('public.free_usage'), to_regclass('public.analyzer_jobs'));
SELECT tablename, policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('free_usage', 'analyzer_jobs');

SELECT indrelid::regclass AS relation, indexrelid::regclass AS name, indisvalid, indisready,
       pg_get_indexdef(indexrelid)
FROM pg_index WHERE indrelid IN (to_regclass('public.free_usage'), to_regclass('public.analyzer_jobs'))
ORDER BY 2;

SELECT p.oid::regprocedure AS signature, md5(p.prosrc) AS body_md5, p.prosecdef,
       p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
  ('free_marker_uid', 'free_release_marker', 'free_reconcile', 'free_reserve_scan',
   'free_finalize_scan', 'free_release_scan', 'free_queue_settlement_key', 'paid_reconcile')
ORDER BY 1;

SELECT rolname, rolbypassrls, has_table_privilege(rolname, 'public.free_usage', 'SELECT') AS counter_read,
       has_table_privilege(rolname, 'public.free_usage', 'INSERT') AS counter_insert,
       has_table_privilege(rolname, 'public.free_usage', 'UPDATE') AS counter_update,
       has_table_privilege(rolname, 'public.free_usage', 'DELETE') AS counter_delete
FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role');
ROLLBACK;
