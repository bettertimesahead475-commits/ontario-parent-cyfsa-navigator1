begin;
create temp table setup_accounts (like public.accounts including all);
create temp table setup_clients (like public.clients including all);
create temp table setup_navigator_matters (like public.navigator_matters including all);
create temp table setup_navigator_matter_members (like public.navigator_matter_members including all);
create or replace function pg_temp.parent_setup_fixture(p_uid text, p_title text, p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare a pg_temp.setup_accounts%rowtype; m pg_temp.setup_navigator_matters%rowtype; client_id uuid;
begin
  if p_uid is null or length(trim(p_uid)) not between 1 and 128 or p_request is null
     or p_title is null or length(trim(p_title)) not between 1 and 200 then raise exception using errcode='22023',message='Invalid matter setup'; end if;
  insert into pg_temp.setup_accounts(firebase_uid,primary_role) values(p_uid,'parent') on conflict(firebase_uid) do nothing;
  select * into a from pg_temp.setup_accounts where firebase_uid=p_uid for update;
  if a.status <> 'active' then raise exception using errcode='42501',message='Account unavailable'; end if;
  select * into m from pg_temp.setup_navigator_matters where id=p_request;
  if found then
    if m.account_id <> a.id
       or not exists(select 1 from pg_temp.setup_navigator_matter_members where matter_id=m.id and account_id=a.id and role='OWNER')
       or not exists(select 1 from pg_temp.setup_clients where id=m.client_id and account_id=a.id) then
      raise exception using errcode='42501',message='Matter unavailable';
    end if;
    return jsonb_build_object('id',m.id,'title',m.title);
  end if;
  insert into pg_temp.setup_clients(account_id,name) values(a.id,'My case') returning id into client_id;
  insert into pg_temp.setup_navigator_matters(id,account_id,client_id,title) values(p_request,a.id,client_id,trim(p_title)) returning * into m;
  insert into pg_temp.setup_navigator_matter_members(matter_id,account_id,role) values(m.id,a.id,'OWNER');
  return jsonb_build_object('id',m.id,'title',m.title);
end;
$function$;
revoke all on function pg_temp.parent_setup_fixture(text,text,uuid) from public,anon,authenticated;
grant execute on function pg_temp.parent_setup_fixture(text,text,uuid) to service_role;

do $test$
declare fixture_matter_id uuid:=gen_random_uuid(); r jsonb; a uuid; n int; denied boolean:=false;
begin
r:=pg_temp.parent_setup_fixture('synthetic-setup-parent','Synthetic matter',fixture_matter_id);
if (r->>'id')::uuid<>fixture_matter_id then raise exception 'Wrong matter'; end if;
r:=pg_temp.parent_setup_fixture('synthetic-setup-parent','Retry title ignored',fixture_matter_id);
select count(*) into n from pg_temp.setup_navigator_matters;
if n<>1 or r->>'title'<>'Synthetic matter' then raise exception 'Duplicate matter on retry'; end if;
select account_row.id into a from pg_temp.setup_accounts account_row where firebase_uid='synthetic-setup-parent';
if not exists(select 1 from pg_temp.setup_navigator_matter_members where matter_id=fixture_matter_id and account_id=a and role='OWNER') then raise exception 'Missing OWNER membership'; end if;
begin perform pg_temp.parent_setup_fixture('synthetic-other-parent','Foreign matter',fixture_matter_id);
exception when insufficient_privilege then denied:=true; end;
if not denied then raise exception 'Cross account access allowed'; end if;
update pg_temp.setup_accounts set status='suspended' where firebase_uid='synthetic-setup-parent';
denied:=false;
begin perform pg_temp.parent_setup_fixture('synthetic-setup-parent','Blocked',gen_random_uuid());
exception when insufficient_privilege then denied:=true; end;
if not denied then raise exception 'Suspended account created a matter'; end if;
end $test$;
select 'PASS: atomic matter/account/client/OWNER setup, retry identity, cross-account denial, suspended-account denial' as synthetic_result;
rollback;
