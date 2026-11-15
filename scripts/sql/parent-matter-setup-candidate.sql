begin;
create or replace function public.navigator_parent_matter_setup(p_uid text, p_title text, p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare a public.accounts%rowtype; m public.navigator_matters%rowtype; client_id uuid;
begin
  if p_uid is null or length(trim(p_uid)) not between 1 and 128 or p_request is null
     or p_title is null or length(trim(p_title)) not between 1 and 200 then raise exception using errcode='22023',message='Invalid matter setup'; end if;
  insert into public.accounts(firebase_uid,primary_role) values(p_uid,'parent') on conflict(firebase_uid) do nothing;
  select * into a from public.accounts where firebase_uid=p_uid for update;
  if a.status <> 'active' then raise exception using errcode='42501',message='Account unavailable'; end if;
  select * into m from public.navigator_matters where id=p_request;
  if found then
    if m.account_id <> a.id
       or not exists(select 1 from public.navigator_matter_members where matter_id=m.id and account_id=a.id and role='OWNER')
       or not exists(select 1 from public.clients where id=m.client_id and account_id=a.id) then
      raise exception using errcode='42501',message='Matter unavailable';
    end if;
    return jsonb_build_object('id',m.id,'title',m.title);
  end if;
  insert into public.clients(account_id,name) values(a.id,'My case') returning id into client_id;
  insert into public.navigator_matters(id,account_id,client_id,title) values(p_request,a.id,client_id,trim(p_title)) returning * into m;
  insert into public.navigator_matter_members(matter_id,account_id,role) values(m.id,a.id,'OWNER');
  return jsonb_build_object('id',m.id,'title',m.title);
end;
$function$;
revoke all on function public.navigator_parent_matter_setup(text,text,uuid) from public,anon,authenticated;
grant execute on function public.navigator_parent_matter_setup(text,text,uuid) to service_role;
commit;
