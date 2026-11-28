-- Migration P read-only postcheck. Every row must be ok = true; otherwise run preserve_monthly_renewal_P.rollback.sql.
begin transaction read only;

select 'redeem_access_code_atomic equals 20261110004740_preserve_monthly_renewal.sql' as check_name,
       coalesce((select md5(prosrc) from pg_proc where oid = 'public.redeem_access_code_atomic(text,text,text)'::regprocedure)::text, 'missing') as detail,
       (select md5(prosrc) from pg_proc where oid = 'public.redeem_access_code_atomic(text,text,text)'::regprocedure) = 'b835b252c9d2b97413e43271c712e5ce' as ok
union all
select 'access_codes.redeemed_session_id is a nullable uuid',
       coalesce((select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public'
                 and table_name = 'access_codes' and column_name = 'redeemed_session_id'), 'missing'),
       (select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public'
         and table_name = 'access_codes' and column_name = 'redeemed_session_id') = 'uuid:YES'
union all
select 'foreign key to navigator_paid_sessions(id) present',
       (select count(*) from pg_constraint where conrelid = 'public.access_codes'::regclass and contype = 'f'
          and confrelid = 'public.navigator_paid_sessions'::regclass)::text,
       exists (select 1 from pg_constraint where conrelid = 'public.access_codes'::regclass and contype = 'f'
               and confrelid = 'public.navigator_paid_sessions'::regclass)
union all
select 'only service_role (and the owner) can execute the RPC',
       coalesce((select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges
                 where routine_schema = 'public' and routine_name = 'redeem_access_code_atomic'), 'none'),
       not exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
                   and routine_name = 'redeem_access_code_atomic' and grantee in ('anon', 'authenticated', 'PUBLIC'))
       and exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
                   and routine_name = 'redeem_access_code_atomic' and grantee = 'service_role')
union all
select 'no access_codes row rewritten: links set only by new redemptions',
       (select count(*) from public.access_codes where redeemed_session_id is not null)::text, true;

rollback;
