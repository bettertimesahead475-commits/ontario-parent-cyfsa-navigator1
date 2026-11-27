SET ROLE service_role;
DO $$
DECLARE
  counter_key text;
  allowance integer;
BEGIN
  FOR counter_key, allowance IN SELECT * FROM (VALUES
    ('paused-legacy-uid', 3), ('fq:' || repeat('e', 40), 1), ('ff:' || repeat('e', 40), 1)
  ) AS requests(key, allowed)
  LOOP
    BEGIN
      PERFORM public.free_reserve_scan(counter_key, 'during-pause', allowance, now(), interval '15 min');
      RAISE EXCEPTION 'Free admission succeeded while paused';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'permission denied for function free_reserve_scan%' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END
$$;
RESET ROLE;
