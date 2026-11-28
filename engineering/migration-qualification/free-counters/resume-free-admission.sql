-- Owner-approved cutover only: run after old Pages routes are fenced, never on rollback to old Pages.
BEGIN;

GRANT EXECUTE ON FUNCTION public.free_reserve_scan(text, text, integer, timestamptz, interval) TO service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.free_reserve_scan(text,text,integer,timestamptz,interval)', 'EXECUTE')
     OR EXISTS (
       SELECT FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
         AND has_function_privilege(oid, 'public.free_reserve_scan(text,text,integer,timestamptz,interval)', 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'Unexpected free admission grants; resume not established';
  END IF;
END
$$;

COMMIT;
