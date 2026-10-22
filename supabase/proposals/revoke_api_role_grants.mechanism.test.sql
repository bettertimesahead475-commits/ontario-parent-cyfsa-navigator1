-- Mechanism test for the sequence revoke. Disposable database only.
-- Models the event log: an identity column written only by a SECURITY DEFINER
-- function owned by postgres. After the API roles' sequence privileges are
-- removed, the definer path must still write, and direct API-role use must fail.
\set ON_ERROR_STOP on
begin;

create table public.__evt_stub (id bigint generated always as identity primary key, v text not null);
revoke all on table public.__evt_stub from public, anon, authenticated;

create function public.__record_stub(p text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.__evt_stub (v) values (p);
$$;
revoke all on function public.__record_stub(text) from public, anon, authenticated;
grant execute on function public.__record_stub(text) to service_role;

-- Remove the API roles' privileges on the identity sequence, as the fix does.
revoke all on sequence public.__evt_stub_id_seq from anon, authenticated;

do $$
declare ok boolean;
begin
  -- 1. Server path (definer) still writes.
  set local role service_role;
  perform public.__record_stub('server write');
  reset role;
  if not exists (select 1 from public.__evt_stub where v = 'server write') then
    raise exception 'FAIL 1: definer path did not write';
  end if;
  raise notice 'PASS 1: definer path writes after the sequence revoke';

  -- 2. API role cannot advance the sequence directly.
  ok := false;
  begin
    set local role anon;
    perform nextval('public.__evt_stub_id_seq');
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL 2: anon advanced the sequence'; end if;
  raise notice 'PASS 2: anon cannot call nextval';

  -- 3. API role cannot reset the sequence (setval).
  ok := false;
  begin
    set local role authenticated;
    perform setval('public.__evt_stub_id_seq', 1);
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL 3: authenticated changed the sequence'; end if;
  raise notice 'PASS 3: authenticated cannot call setval';

  -- 4. API role cannot write the table directly.
  ok := false;
  begin
    set local role anon;
    insert into public.__evt_stub (v) values ('direct');
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL 4: anon wrote the table directly'; end if;
  raise notice 'PASS 4: anon cannot write the table directly';
end $$;

rollback;
