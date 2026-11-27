begin read only;

select 'payments_uuid_primary_key' as check_name, exists (
  select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a
    on a.attrelid = c.conrelid and c.conkey = array[a.attnum]
  where c.conrelid = to_regclass('public.payments') and c.contype = 'p'
    and a.attname = 'id' and a.atttypid = 'uuid'::regtype
) as ok
union all
select 'postgres_15_or_newer', current_setting('server_version_num')::int >= 150000
union all
select 'expected_application_roles', count(*) = 3 from pg_catalog.pg_roles
  where rolname in ('anon', 'authenticated', 'service_role')
union all
select 'service_role_can_read_payments', coalesce(
  has_table_privilege((select oid from pg_catalog.pg_roles where rolname = 'service_role'), to_regclass('public.payments'), 'SELECT'), false
)
union all
select 'no_existing_ledger', to_regclass('public.payment_accounting_events') is null
  and to_regclass('public.payment_accounting_state') is null
  and to_regprocedure('public.read_payment_accounting_state(text)') is null
  and to_regprocedure('public.append_payment_accounting_event(uuid,text,text,text,text,jsonb)') is null;

commit;
