-- Owner-approved cutover only: pauses the shared free reservation RPC, not settlement.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.free_reserve_scan(text, text, integer, timestamptz, interval) FROM service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_roles
    WHERE rolname IN ('service_role', 'anon', 'authenticated')
      AND has_function_privilege(oid, 'public.free_reserve_scan(text,text,integer,timestamptz,interval)', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Free admission still executable through another grant; pause not established';
  END IF;
END
$$;

COMMIT;
