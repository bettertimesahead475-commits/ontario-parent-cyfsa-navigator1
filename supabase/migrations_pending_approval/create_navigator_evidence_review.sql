-- STAGE 5 PENDING APPROVAL. DO NOT EXECUTE against any project in this task.
-- Requires Stage 3 locked matter reads and Stage 4 page-evidence foundation.
-- No replacement or replay of previously applied artifacts.
begin;

create table public.navigator_review_actions (
 id uuid primary key default gen_random_uuid(),
 evidence_id uuid not null references public.navigator_evidence_items(id),
 actor_account_id uuid not null references public.accounts(id),
 from_state text not null check(from_state in ('UNREVIEWED','REVIEWED','CONFIRMED','DISPUTED','REQUIRES_SOURCE','NOT_RELEVANT')),
 to_state text not null check(to_state in ('UNREVIEWED','REVIEWED','CONFIRMED','DISPUTED','REQUIRES_SOURCE','NOT_RELEVANT')),
 created_at timestamptz not null default clock_timestamp(),
 evidence_updated_at timestamptz not null,
 check(from_state<>to_state)
);
create index navigator_review_actions_evidence_idx on public.navigator_review_actions(evidence_id,created_at desc,id desc);
create index navigator_review_actions_actor_idx on public.navigator_review_actions(actor_account_id);
create index navigator_evidence_review_order_idx on public.navigator_evidence_items(matter_id,created_at desc,id desc);
create index navigator_evidence_review_document_idx on public.navigator_evidence_items(matter_id,document_id,created_at desc,id desc);
create index navigator_evidence_review_state_idx on public.navigator_evidence_items(matter_id,review_state,created_at desc,id desc);
create index navigator_evidence_review_class_idx on public.navigator_evidence_items(matter_id,classification,created_at desc,id desc);
alter table public.navigator_review_actions enable row level security;
revoke all on public.navigator_review_actions from public,anon,authenticated,service_role;
grant select,insert on public.navigator_review_actions to service_role;

create function public.navigator_review_action_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'Review history is append only'; end $$;
create trigger navigator_review_action_immutable before update or delete on public.navigator_review_actions
for each row execute function public.navigator_review_action_guard();
revoke all on function public.navigator_review_action_guard() from public,anon,authenticated,service_role;

-- Server verified Firebase UID only. No browser account identity is accepted.
create function public.navigator_review_matters(p_uid text,p_after uuid default null) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' set timezone='UTC' as $$
declare a public.accounts%rowtype; rows jsonb; result jsonb; next_id uuid;
begin
 select * into a from public.accounts where firebase_uid=p_uid for share;
 if not found or a.status<>'active' then raise exception using errcode='P0002',message='Not found'; end if;
 -- One bounded query, locks even non-key ownership/membership updates.
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title) order by s.id),'[]'::jsonb) into rows
 from (select m.id,m.title from public.navigator_matters m
 join public.clients c on c.id=m.client_id and c.account_id=a.id
 join public.navigator_matter_members mm on mm.matter_id=m.id and mm.account_id=a.id and mm.role='OWNER'
 where m.account_id=a.id and (p_after is null or m.id>p_after)
 order by m.id limit 26 for share of m,c,mm) s;
 if jsonb_array_length(rows)>25 then next_id:=(rows->24->>'id')::uuid; end if;
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into result from jsonb_array_elements(rows) with ordinality x(value,ord) where ord<=25;
 return jsonb_build_object('items',result,'next',next_id);
end $$;

create function public.navigator_review_list(p_uid text,p_matter_id uuid,p_limit integer default 25,
 p_after_time timestamptz default null,p_after_id uuid default null,p_filters jsonb default '{}') returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' set timezone='UTC' as $$
declare m public.navigator_matters%rowtype; rows jsonb; result jsonb; cursor_value jsonb:=null;
 doc uuid; run uuid; cls text; state text; page integer; date_from date; date_to date; k text;
begin
 perform 1 from public.accounts where firebase_uid=p_uid for update;
 select * into m from public.read_navigator_owned_matter(p_uid,p_matter_id);
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_after_time is null)<>(p_after_id is null)
 or jsonb_typeof(p_filters) is distinct from 'object' then raise exception using errcode='22023',message='Invalid filters'; end if;
 for k in select jsonb_object_keys(p_filters) loop
  if k not in ('documentId','classification','reviewState','createdFrom','createdTo','page','runId') then raise exception using errcode='22023',message='Invalid filters'; end if;
 end loop;
 if p_filters ? 'documentId' then perform public.navigator_json_require(p_filters,'documentId','uuid'); doc:=(p_filters->>'documentId')::uuid; end if;
 if p_filters ? 'runId' then perform public.navigator_json_require(p_filters,'runId','uuid'); run:=(p_filters->>'runId')::uuid; end if;
 if p_filters ? 'classification' then
  perform public.navigator_json_require(p_filters,'classification','string'); cls:=p_filters->>'classification';
  if cls not in ('FACT','ALLEGATION','OPINION','PROFESSIONAL_ASSESSMENT','INFERENCE','UNVERIFIED_CLAIM','UNKNOWN') then raise exception using errcode='22023',message='Invalid classification'; end if;
 end if;
 if p_filters ? 'reviewState' then
  perform public.navigator_json_require(p_filters,'reviewState','string'); state:=p_filters->>'reviewState';
  if state not in ('UNREVIEWED','REVIEWED','CONFIRMED','DISPUTED','REQUIRES_SOURCE','NOT_RELEVANT') then raise exception using errcode='22023',message='Invalid state'; end if;
 end if;
 if p_filters ? 'page' then perform public.navigator_json_require(p_filters,'page','integer'); page:=(p_filters->>'page')::int;
  if page not between 1 and 20 then raise exception using errcode='22023',message='Invalid page'; end if;
 end if;
 if p_filters ? 'createdFrom' then perform public.navigator_json_require(p_filters,'createdFrom','string'); date_from:=(p_filters->>'createdFrom')::date; end if;
 if p_filters ? 'createdTo' then perform public.navigator_json_require(p_filters,'createdTo','string'); date_to:=(p_filters->>'createdTo')::date; end if;
 if date_from>date_to then raise exception using errcode='22023',message='Invalid dates'; end if;
 select coalesce(jsonb_agg(s.row_data order by s.created_at desc,s.id desc),'[]'::jsonb) into rows
 from (select e.id,e.created_at,to_jsonb(e)||jsonb_build_object('document_name',d.display_name,'version_number',v.version_number,
  'last_review',(select jsonb_build_object('actor_account_id',ra.actor_account_id,'created_at',ra.created_at,'from_state',ra.from_state,'to_state',ra.to_state)
    from public.navigator_review_actions ra where ra.evidence_id=e.id order by ra.created_at desc,ra.id desc limit 1)) row_data
 from public.navigator_evidence_items e join public.navigator_documents d on d.id=e.document_id and d.matter_id=m.id
 join public.navigator_document_versions v on v.id=e.document_version_id and v.document_id=d.id
 where e.matter_id=m.id and (doc is null or e.document_id=doc) and (run is null or e.extraction_run_id=run)
 and (cls is null or e.classification=cls) and (state is null or e.review_state=state) and (page is null or e.page_number=page)
 and (date_from is null or e.created_at>=date_from::timestamp at time zone 'UTC')
 and (date_to is null or e.created_at<(date_to+1)::timestamp at time zone 'UTC')
 and (p_after_time is null or (e.created_at,e.id)<(p_after_time,p_after_id))
 order by e.created_at desc,e.id desc limit p_limit+1) s;
 if jsonb_array_length(rows)>p_limit then cursor_value:=jsonb_build_object('time',rows->(p_limit-1)->>'created_at','id',rows->(p_limit-1)->>'id'); end if;
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into result from jsonb_array_elements(rows) with ordinality x(value,ord) where ord<=p_limit;
 return jsonb_build_object('items',result,'next',cursor_value,'matter',jsonb_build_object('id',m.id,'title',m.title));
end $$;

create function public.navigator_review_source(p_uid text,p_matter_id uuid,p_evidence_id uuid,p_document_id uuid,p_version_id uuid,p_page_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' set timezone='UTC' as $$
declare e public.navigator_evidence_items%rowtype; p public.navigator_document_pages%rowtype;
begin
 perform 1 from public.accounts where firebase_uid=p_uid for update;
 perform 1 from public.read_navigator_owned_matter(p_uid,p_matter_id);
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 perform 1 from public.navigator_documents where id=p_document_id and matter_id=p_matter_id for update;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 perform 1 from public.navigator_document_versions where id=p_version_id and document_id=p_document_id for update;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 select * into e from public.navigator_evidence_items where id=p_evidence_id and matter_id=p_matter_id
 and document_id=p_document_id and document_version_id=p_version_id and page_id=p_page_id for share;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 select * into p from public.navigator_document_pages where id=e.page_id and document_version_id=e.document_version_id and page_number=e.page_number;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 return jsonb_build_object('evidenceId',e.id,'documentId',e.document_id,'versionId',e.document_version_id,'page',to_jsonb(p));
end $$;

create function public.navigator_review_update(p_uid text,p_matter_id uuid,p_evidence_id uuid,p_state text,p_expected_updated_at timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' set timezone='UTC' as $$
declare actor uuid; e public.navigator_evidence_items%rowtype; candidate public.navigator_evidence_items%rowtype; previous text; action public.navigator_review_actions%rowtype;
begin
 select id into actor from public.accounts where firebase_uid=p_uid for update;
 perform 1 from public.read_navigator_owned_matter(p_uid,p_matter_id);
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 if p_state is null or p_expected_updated_at is null or p_state not in ('UNREVIEWED','REVIEWED','CONFIRMED','DISPUTED','REQUIRES_SOURCE','NOT_RELEVANT') then raise exception using errcode='22023',message='Invalid review'; end if;
 -- Discovery is not the final grant: lock source parents in Stage 4 order, then recheck evidence.
 select * into candidate from public.navigator_evidence_items where id=p_evidence_id and matter_id=p_matter_id;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 perform 1 from public.navigator_documents where id=candidate.document_id and matter_id=p_matter_id for update;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 perform 1 from public.navigator_document_versions where id=candidate.document_version_id and document_id=candidate.document_id for update;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 select * into e from public.navigator_evidence_items where id=p_evidence_id and matter_id=p_matter_id
 and document_id=candidate.document_id and document_version_id=candidate.document_version_id and page_id=candidate.page_id for update;
 if not found then raise exception using errcode='P0002',message='Not found'; end if;
 if e.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict'; end if;
 if e.quote_verification in ('ABSENT','AMBIGUOUS') and p_state<>'REQUIRES_SOURCE' then raise exception using errcode='22023',message='Source resolution required'; end if;
 if e.review_state=p_state then return jsonb_build_object('id',e.id,'review_state',e.review_state,'updated_at',e.updated_at,'changed',false); end if;
 previous:=e.review_state;
 update public.navigator_evidence_items set review_state=p_state where id=e.id returning * into e;
 -- The existing Stage 4 trigger validates and preserves all provenance and sets updated_at.
 insert into public.navigator_review_actions(evidence_id,actor_account_id,from_state,to_state,evidence_updated_at)
 values(e.id,actor,previous,e.review_state,e.updated_at) returning * into action;
 return jsonb_build_object('id',e.id,'review_state',e.review_state,'updated_at',e.updated_at,'changed',true,'review_action',to_jsonb(action));
end $$;

revoke all on function public.navigator_review_matters(text,uuid),public.navigator_review_list(text,uuid,integer,timestamptz,uuid,jsonb),
 public.navigator_review_source(text,uuid,uuid,uuid,uuid,uuid),public.navigator_review_update(text,uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.navigator_review_matters(text,uuid),public.navigator_review_list(text,uuid,integer,timestamptz,uuid,jsonb),
 public.navigator_review_source(text,uuid,uuid,uuid,uuid,uuid),public.navigator_review_update(text,uuid,uuid,text,timestamptz) to service_role;
commit;
