-- PENDING APPROVAL: do not execute automatically, including on the disposable DB.
-- Requires accounts, navigator case/matter foundations and read_navigator_owned_matter.
-- Existing applied SQL artifacts are not edited. No raw upload bytes are retained.
begin;
alter table public.navigator_documents add column original_filename text,
  add column content_type text, add column status text not null default 'pending'
    check(status in ('pending','processing','completed','failed'));
alter table public.navigator_document_versions add column page_count integer check(page_count between 1 and 20),
  add column parser_metadata jsonb not null default '{}'::jsonb,
  add constraint navigator_version_hash_unique unique(document_id,content_hash);

create table public.navigator_extraction_runs (
 id uuid primary key default gen_random_uuid(), matter_id uuid not null references public.navigator_matters(id),
 document_version_id uuid not null references public.navigator_document_versions(id) on delete cascade,
 document_id uuid not null,
 operation text not null check(operation in ('extraction','evidence')),
 provider text not null, model text not null, schema_version text not null,
 status text not null check(status in ('processing','completed','failed')),
 started_at timestamptz not null default now(), completed_at timestamptz,
 failure_category text check(failure_category in ('PROVIDER_FAILURE','INVALID_OUTPUT','TIMEOUT')),
 usage_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(usage_metadata)='object'),
 check ((status='processing' and completed_at is null and failure_category is null) or
 (status='completed' and completed_at is not null and failure_category is null) or
 (status='failed' and completed_at is not null and failure_category is not null)),
 check(completed_at is null or completed_at>=started_at)
);
alter table public.navigator_document_versions add column extraction_run_id uuid references public.navigator_extraction_runs(id);
create table public.navigator_document_pages (
 id uuid primary key default gen_random_uuid(), document_version_id uuid not null references public.navigator_document_versions(id) on delete cascade,
 page_number integer not null check(page_number between 1 and 20), text text not null check(char_length(text)<=100000),
 extraction_method text not null check(extraction_method in ('gemini-page-ocr','gemini-image-ocr','utf8-single-source')),
 confidence double precision check(confidence between 0 and 1), checksum text not null check(checksum ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), unique(document_version_id,page_number)
);
create table public.navigator_evidence_items (
 id uuid primary key default gen_random_uuid(), matter_id uuid not null references public.navigator_matters(id),
 document_id uuid not null references public.navigator_documents(id) on delete cascade,
 document_version_id uuid not null references public.navigator_document_versions(id) on delete cascade,
 page_id uuid not null references public.navigator_document_pages(id) on delete cascade,
 page_number integer not null check(page_number>0),
 classification text not null check(classification in ('FACT','ALLEGATION','OPINION','PROFESSIONAL_ASSESSMENT','INFERENCE','UNVERIFIED_CLAIM','UNKNOWN')),
 normalized_statement text not null check(char_length(normalized_statement) between 1 and 2000),
 exact_quote text not null check(char_length(exact_quote)<=10000),
 quote_start_offset integer, quote_end_offset integer,
 quote_verification text not null check(quote_verification in ('EXACT','NORMALIZED_WHITESPACE','ABSENT','AMBIGUOUS')),
 confidence double precision check(confidence between 0 and 1),
 review_state text not null check(review_state in ('UNREVIEWED','REVIEWED','CONFIRMED','DISPUTED','REQUIRES_SOURCE','NOT_RELEVANT')),
 extraction_run_id uuid not null references public.navigator_extraction_runs(id) on delete cascade,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((quote_verification in ('ABSENT','AMBIGUOUS') and quote_start_offset is null and quote_end_offset is null and review_state='REQUIRES_SOURCE') or
 (quote_verification in ('EXACT','NORMALIZED_WHITESPACE') and char_length(exact_quote)>0 and quote_start_offset is not null and quote_end_offset is not null and quote_start_offset>=0 and quote_end_offset>quote_start_offset))
);
create index navigator_runs_version_idx on public.navigator_extraction_runs(document_version_id,started_at);
-- Redundant identity coordinates are constrained, not independent citation claims.
alter table public.navigator_documents add constraint navigator_document_matter_identity unique(id,matter_id);
alter table public.navigator_document_versions add constraint navigator_version_document_identity unique(id,document_id);
alter table public.navigator_document_pages add constraint navigator_page_version_identity unique(id,document_version_id,page_number);
alter table public.navigator_extraction_runs add constraint navigator_run_version_identity unique(id,document_version_id,matter_id);
alter table public.navigator_evidence_items
 add constraint navigator_evidence_document_scope foreign key(document_id,matter_id) references public.navigator_documents(id,matter_id),
 add constraint navigator_evidence_version_scope foreign key(document_version_id,document_id) references public.navigator_document_versions(id,document_id),
 add constraint navigator_evidence_page_scope foreign key(page_id,document_version_id,page_number) references public.navigator_document_pages(id,document_version_id,page_number),
 add constraint navigator_evidence_run_scope foreign key(extraction_run_id,document_version_id,matter_id) references public.navigator_extraction_runs(id,document_version_id,matter_id);
alter table public.navigator_extraction_runs
 add constraint navigator_run_document_scope foreign key(document_id,matter_id) references public.navigator_documents(id,matter_id),
 add constraint navigator_run_version_scope foreign key(document_version_id,document_id) references public.navigator_document_versions(id,document_id),
 add constraint navigator_run_current_identity unique(id,document_version_id);
alter table public.navigator_document_versions
 add constraint navigator_version_current_run_scope foreign key(extraction_run_id,id) references public.navigator_extraction_runs(id,document_version_id);
create index navigator_versions_run_idx on public.navigator_document_versions(extraction_run_id);
create index navigator_runs_document_idx on public.navigator_extraction_runs(document_id);
create index navigator_runs_matter_idx on public.navigator_extraction_runs(matter_id);
create index navigator_evidence_page_idx on public.navigator_evidence_items(page_id);
create index navigator_evidence_version_idx on public.navigator_evidence_items(document_version_id);
create index navigator_evidence_document_idx on public.navigator_evidence_items(document_id);
create index navigator_evidence_matter_idx on public.navigator_evidence_items(matter_id);
create index navigator_evidence_run_idx on public.navigator_evidence_items(extraction_run_id);
alter table public.navigator_extraction_runs enable row level security;
alter table public.navigator_document_pages enable row level security;
alter table public.navigator_evidence_items enable row level security;
revoke all on public.navigator_extraction_runs,public.navigator_document_pages,public.navigator_evidence_items from public,anon,authenticated,service_role;
grant select,insert,update on public.navigator_extraction_runs,public.navigator_evidence_items to service_role;
grant select,insert on public.navigator_document_pages to service_role;

-- Comparison-only whitespace: U+0009..000D, 0020, 00A0, 1680,
-- 2000..200A, 2028, 2029, 202F, 205F, 3000, FEFF. No Unicode folding.
create function public.navigator_quote_normalize(source text) returns text
language sql immutable strict security invoker set search_path=pg_catalog,public,pg_temp as $$
 select btrim(regexp_replace(translate(source,
 chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
 chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
 chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),repeat(' ',25)),' +',' ','g'));
$$;
create function public.navigator_json_require(obj jsonb,key text,kind text) returns void
language plpgsql immutable security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
 if jsonb_typeof(obj) is distinct from 'object' or not (obj ? key) then raise exception 'Missing required field'; end if;
 if kind in ('integer','number') then
  if jsonb_typeof(obj->key) is distinct from 'number' then raise exception 'Expected number'; end if;
  if kind='integer' and (obj->>key)!~'^(0|[1-9][0-9]*|-[1-9][0-9]*)$' then raise exception 'Expected integer'; end if;
 elsif kind='uuid' then
  if jsonb_typeof(obj->key) is distinct from 'string' or (obj->>key)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Expected UUID'; end if;
 elsif jsonb_typeof(obj->key) is distinct from kind then raise exception 'Invalid field type'; end if;
end $$;
-- Counts overlapping matches, bounded at two; exact matches take precedence.
create function public.navigator_quote_hits(source text,quote text) returns integer
language plpgsql immutable strict security invoker set search_path=pg_catalog,public,pg_temp as $$
declare at_pos integer; start_pos integer:=1; hits integer:=0;
begin
 if quote='' then return 0; end if;
 loop
  at_pos:=strpos(substring(source from start_pos),quote);
  exit when at_pos=0;
  hits:=hits+1; exit when hits=2;
  start_pos:=start_pos+at_pos;
 end loop;
 return hits;
end $$;
create function public.navigator_quote_validate(source text,item jsonb) returns void
language plpgsql immutable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare q text; state text; expected text; hits integer; start_pos integer; end_pos integer; fragment text;
begin
 if source is null then raise exception 'Source missing'; end if;
 perform public.navigator_json_require(item,'exact_quote','string');
 perform public.navigator_json_require(item,'quote_verification','string');
 q:=item->>'exact_quote'; state:=item->>'quote_verification';
 if char_length(q)>10000 then raise exception 'Quote too long'; end if;
 if not (item ? 'quote_start_offset') or not (item ? 'quote_end_offset') then raise exception 'Missing offsets'; end if;
 hits:=case when public.navigator_quote_normalize(q)='' then 0 else public.navigator_quote_hits(source,q) end;
 if hits=1 then expected:='EXACT';
 elsif hits=2 then expected:='AMBIGUOUS';
 else
  hits:=public.navigator_quote_hits(public.navigator_quote_normalize(source),public.navigator_quote_normalize(q));
  expected:=case hits when 1 then 'NORMALIZED_WHITESPACE' when 2 then 'AMBIGUOUS' else 'ABSENT' end;
 end if;
 if state is distinct from expected then raise exception 'Noncanonical quote verification'; end if;
 if state in ('ABSENT','AMBIGUOUS') then
  if item->'quote_start_offset' is distinct from 'null'::jsonb or item->'quote_end_offset' is distinct from 'null'::jsonb or item->>'review_state' is distinct from 'REQUIRES_SOURCE' then raise exception 'Invalid unsupported quote'; end if;
  return;
 end if;
 if q='' then raise exception 'Empty verified quote'; end if;
 perform public.navigator_json_require(item,'quote_start_offset','integer');
 perform public.navigator_json_require(item,'quote_end_offset','integer');
 start_pos:=(item->>'quote_start_offset')::integer; end_pos:=(item->>'quote_end_offset')::integer;
 if start_pos<0 or end_pos<=start_pos or end_pos>char_length(source) then raise exception 'Invalid quote bounds'; end if;
 fragment:=substring(source from start_pos+1 for end_pos-start_pos);
 if state='EXACT' then
  if fragment<>q then raise exception 'Unsupported quote'; end if;
 else
  if public.navigator_quote_normalize(fragment)<>public.navigator_quote_normalize(q) then raise exception 'Unsupported quote'; end if;
  -- JS normalized offsets start/end at the first/last non-whitespace character.
  if public.navigator_quote_normalize(left(fragment,1))='' or public.navigator_quote_normalize(right(fragment,1))='' then raise exception 'Noncanonical normalized offsets'; end if;
 end if;
end $$;

-- Canonical INSERT provenance check, shared by RPC and direct table writes.
-- Caller must lock the version first. FOR UPDATE holds the run in processing
-- until the insertion transaction ends; terminalization cannot pass this lock.
create function public.navigator_require_evidence_run(p_run_id uuid,p_matter_id uuid,p_document_id uuid,p_version_id uuid,p_page_id uuid)
returns public.navigator_extraction_runs language plpgsql volatile security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare evidence_run public.navigator_extraction_runs%rowtype;
begin
 if p_run_id is null or p_matter_id is null or p_document_id is null or p_version_id is null or p_page_id is null then raise exception 'Missing evidence hierarchy'; end if;
 select * into evidence_run from public.navigator_extraction_runs where id=p_run_id for update;
 if not found then raise exception 'Evidence run missing'; end if;
 if evidence_run.matter_id is distinct from p_matter_id or evidence_run.document_id is distinct from p_document_id or evidence_run.document_version_id is distinct from p_version_id then raise exception 'Evidence run hierarchy mismatch'; end if;
 if evidence_run.operation is distinct from 'evidence' then raise exception 'Wrong evidence run operation'; end if;
 if evidence_run.status is distinct from 'processing' then raise exception 'Evidence run is terminal'; end if;
 perform public.navigator_json_require(evidence_run.usage_metadata,'pageId','uuid');
 if (evidence_run.usage_metadata->>'pageId')::uuid is distinct from p_page_id then raise exception 'Evidence run page mismatch'; end if;
 return evidence_run;
end $$;
revoke all on function public.navigator_require_evidence_run(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.navigator_require_evidence_run(uuid,uuid,uuid,uuid,uuid) to service_role;

-- Permanent guards, not a caller-controlled maintenance bypass. Completed sources
-- cannot be deleted through cascades either. Retention/deletion needs separate design.
create function public.navigator_source_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare version_status text; source_text text; page_total integer; last_page integer;
begin
 if TG_TABLE_NAME='navigator_documents' then
  if (new.id,new.matter_id) is distinct from (old.id,old.matter_id) and exists(select 1 from public.navigator_document_versions where document_id=old.id) then raise exception 'Document source relationship is immutable'; end if;
 elsif TG_TABLE_NAME='navigator_document_versions' then
  if old.extraction_status='completed' then raise exception 'Completed version is immutable'; end if;
  if TG_OP='UPDATE' then
   if (new.id,new.document_id,new.content_hash) is distinct from (old.id,old.document_id,old.content_hash) then raise exception 'Version source relationship is immutable'; end if;
   if new.extraction_run_id is not null and not exists(select 1 from public.navigator_extraction_runs where id=new.extraction_run_id and document_version_id=new.id and operation='extraction') then raise exception 'Invalid current extraction run'; end if;
   if new.extraction_status='completed' then
    select count(*),max(page_number) into page_total,last_page from public.navigator_document_pages where document_version_id=new.id;
    if page_total not between 1 and 20 or new.page_count is distinct from page_total or last_page<>page_total then raise exception 'Incomplete source pages'; end if;
   end if;
  end if;
 elsif TG_TABLE_NAME='navigator_document_pages' then
  if TG_OP<>'INSERT' then raise exception 'Extracted pages are immutable'; end if;
  select extraction_status into version_status from public.navigator_document_versions where id=new.document_version_id for update;
  if version_status is distinct from 'processing' then raise exception 'Version not accepting pages'; end if;
  if new.checksum is distinct from encode(sha256(convert_to(new.text,'UTF8')),'hex') then raise exception 'Page checksum mismatch'; end if;
 elsif TG_TABLE_NAME='navigator_extraction_runs' then
  if old.status<>'processing' then raise exception 'Terminal run is immutable'; end if;
  if (new.id,new.matter_id,new.document_id,new.document_version_id,new.operation,new.provider,new.model,new.schema_version,new.started_at) is distinct from
     (old.id,old.matter_id,old.document_id,old.document_version_id,old.operation,old.provider,old.model,old.schema_version,old.started_at) or
     (new.usage_metadata->'pageId') is distinct from (old.usage_metadata->'pageId') then raise exception 'Run provenance is immutable'; end if;
 elsif TG_TABLE_NAME='navigator_evidence_items' then
  if TG_OP='UPDATE' and (to_jsonb(new)-'review_state'-'updated_at') is distinct from (to_jsonb(old)-'review_state'-'updated_at') then raise exception 'Evidence provenance is immutable'; end if;
  perform 1 from public.navigator_document_versions where id=new.document_version_id for update;
  if TG_OP='INSERT' then
   perform public.navigator_require_evidence_run(new.extraction_run_id,new.matter_id,new.document_id,new.document_version_id,new.page_id);
  end if;
  -- Pages are immutable; the parent version lock serializes page insertion.
  -- Do not require UPDATE privilege merely to lock an immutable page for reading.
  select text into source_text from public.navigator_document_pages where id=new.page_id and document_version_id=new.document_version_id;
  perform public.navigator_quote_validate(source_text,to_jsonb(new));
  new.updated_at:=clock_timestamp();
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger navigator_document_source_guard before update on public.navigator_documents for each row execute function public.navigator_source_guard();
create trigger navigator_version_source_guard before update or delete on public.navigator_document_versions for each row execute function public.navigator_source_guard();
create trigger navigator_page_source_guard before insert or update or delete on public.navigator_document_pages for each row execute function public.navigator_source_guard();
create trigger navigator_run_source_guard before update on public.navigator_extraction_runs for each row execute function public.navigator_source_guard();
create trigger navigator_evidence_source_guard before insert or update on public.navigator_evidence_items for each row execute function public.navigator_source_guard();
revoke all on function public.navigator_quote_normalize(text),public.navigator_json_require(jsonb,text,text),public.navigator_quote_hits(text,text),public.navigator_quote_validate(text,jsonb),public.navigator_source_guard() from public,anon,authenticated,service_role;
grant execute on function public.navigator_quote_normalize(text),public.navigator_json_require(jsonb,text,text),public.navigator_quote_hits(text,text),public.navigator_quote_validate(text,jsonb) to service_role;
-- Trigger execution does not require granting callers direct EXECUTE on its function.

-- One server-only transactional boundary. Caller UID MUST be Firebase-verified.
-- Matter/account/client/membership locks remain held while data is read/written.
-- Matter row is additionally locked for version allocation/deduplication. Never
-- carry authorization from this transaction into a separate content query.
create function public.navigator_source_operation(p_uid text,p_matter_id uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' as $$
declare d public.navigator_documents%rowtype; v public.navigator_document_versions%rowtype;
 r public.navigator_extraction_runs%rowtype; pg public.navigator_document_pages%rowtype;
 item jsonb; seq integer:=0; candidate uuid;
begin
 -- Lock order: account -> matter -> client -> OWNER membership -> document
 -- -> version -> run/page. Candidate lookups confer no authorization.
 -- Serialize this owner's source operations before taking the existing matter
 -- authorization locks, avoiding concurrent SHARE-to-UPDATE upgrades. This is
 -- intentionally conservative; future independent-page throughput needs review.
 perform 1 from public.accounts where firebase_uid=p_uid for update;
 perform 1 from public.read_navigator_owned_matter(p_uid,p_matter_id);
 if not found then raise exception using errcode='P0002',message='Source not found'; end if;
 perform 1 from public.navigator_matters where id=p_matter_id for update;

 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Payload must be object'; end if;
 if p_operation='begin_upload' then
  perform public.navigator_json_require(p_payload,'checksum','string');
  perform public.navigator_json_require(p_payload,'filename','string');
  perform public.navigator_json_require(p_payload,'mime','string');
  perform public.navigator_json_require(p_payload,'size','integer');
  perform public.navigator_json_require(p_payload,'provider','string');
  perform public.navigator_json_require(p_payload,'model','string');
  if (p_payload->>'size')::numeric<0 or p_payload->>'mime' not in ('application/pdf','text/plain','image/png','image/jpeg','image/webp') then raise exception 'Invalid source metadata'; end if;
  if p_payload->'documentId' is not null and p_payload->'documentId'<>'null'::jsonb then perform public.navigator_json_require(p_payload,'documentId','uuid'); end if;
  if p_payload->>'checksum' !~ '^[0-9a-f]{64}$' or char_length(p_payload->>'filename') not between 1 and 255 then raise exception 'Invalid source metadata'; end if;
  if p_payload->>'documentId' is not null then
   select * into d from public.navigator_documents where id=(p_payload->>'documentId')::uuid and matter_id=p_matter_id for update;
   if not found then raise exception using errcode='P0002',message='Source not found'; end if;
   select * into v from public.navigator_document_versions where document_id=d.id and content_hash=p_payload->>'checksum' for update;
  else
   -- Candidate discovery is not authorization. Lock and recheck document first.
   select nd.id into candidate from public.navigator_documents nd
    where nd.matter_id=p_matter_id and exists(select 1 from public.navigator_document_versions dv where dv.document_id=nd.id and dv.content_hash=p_payload->>'checksum')
    order by nd.created_at,nd.id limit 1;
   if candidate is not null then
    select * into d from public.navigator_documents where id=candidate for update;
    if not found or d.matter_id<>p_matter_id then raise exception using errcode='P0002',message='Source not found'; end if;
    select * into v from public.navigator_document_versions where document_id=d.id and content_hash=p_payload->>'checksum' for update;
   end if;
  end if;
  if v.id is not null and v.extraction_status='completed' then return jsonb_build_object('cached',true,'documentId',d.id,'version',to_jsonb(v)); end if;
  if v.id is not null and v.extraction_status='processing' then
   select * into r from public.navigator_extraction_runs where id=v.extraction_run_id;
   if r.started_at>now()-interval '10 minutes' then raise exception using errcode='55P03',message='Extraction in progress'; end if;
   update public.navigator_extraction_runs set status='failed',failure_category='TIMEOUT',completed_at=now() where id=r.id;
  end if;
  if d.id is null then
   insert into public.navigator_documents(matter_id,display_name,original_filename,content_type,status)
    values(p_matter_id,p_payload->>'filename',p_payload->>'filename',p_payload->>'mime','processing') returning * into d;
  end if;
  if v.id is null then
   insert into public.navigator_document_versions(document_id,version_number,filename,mime_type,size_bytes,content_hash,extraction_status)
    select d.id,coalesce(max(version_number),0)+1,p_payload->>'filename',p_payload->>'mime',(p_payload->>'size')::bigint,p_payload->>'checksum','processing'
     from public.navigator_document_versions where document_id=d.id returning * into v;
  end if;
  insert into public.navigator_extraction_runs(matter_id,document_version_id,document_id,operation,provider,model,schema_version,status)
   values(p_matter_id,v.id,d.id,'extraction',p_payload->>'provider',p_payload->>'model','page-evidence-v1','processing') returning * into r;
  update public.navigator_document_versions set extraction_status='processing',extraction_run_id=r.id where id=v.id;
  update public.navigator_documents set status='processing',updated_at=now() where id=d.id;
  return jsonb_build_object('cached',false,'documentId',d.id,'versionId',v.id,'runId',r.id);
 end if;

 perform public.navigator_json_require(p_payload,'versionId','uuid');
 select document_id into candidate from public.navigator_document_versions where id=(p_payload->>'versionId')::uuid;
 select * into d from public.navigator_documents where id=candidate for update;
 if not found or d.matter_id<>p_matter_id then raise exception using errcode='P0002',message='Source not found'; end if;
 select * into v from public.navigator_document_versions where id=(p_payload->>'versionId')::uuid for update;
 if not found or v.document_id<>d.id then raise exception using errcode='P0002',message='Source not found'; end if;
 if p_operation='read' then
  return jsonb_build_object('document',to_jsonb(d),'version',to_jsonb(v),'pages',coalesce((select jsonb_agg(to_jsonb(p) order by page_number) from public.navigator_document_pages p where document_version_id=v.id),'[]'::jsonb),
   'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by created_at) from public.navigator_evidence_items e where document_version_id=v.id),'[]'::jsonb));
 end if;
 if p_operation='begin_evidence' then
  perform public.navigator_json_require(p_payload,'pageId','uuid');
  perform public.navigator_json_require(p_payload,'model','string');
  if v.extraction_status<>'completed' then raise exception 'Extraction incomplete'; end if;
  select * into pg from public.navigator_document_pages where id=(p_payload->>'pageId')::uuid and document_version_id=v.id;
  if not found then raise exception using errcode='P0002',message='Source not found'; end if;
  insert into public.navigator_extraction_runs(matter_id,document_version_id,document_id,operation,provider,model,schema_version,status,usage_metadata)
   values(p_matter_id,v.id,d.id,'evidence','anthropic',p_payload->>'model','page-evidence-v1','processing',jsonb_build_object('pageId',pg.id)) returning * into r;
  return jsonb_build_object('runId',r.id,'page',to_jsonb(pg));
 end if;
 perform public.navigator_json_require(p_payload,'runId','uuid');
 select * into r from public.navigator_extraction_runs where id=(p_payload->>'runId')::uuid and document_version_id=v.id and matter_id=p_matter_id and status='processing' for update;
 if not found then raise exception 'Run no longer active'; end if;
 if r.operation='extraction' and v.extraction_run_id is distinct from r.id then raise exception 'Stale extraction run'; end if;
 if p_operation='fail' then
  perform public.navigator_json_require(p_payload,'category','string');
  update public.navigator_extraction_runs set status='failed',failure_category=p_payload->>'category',completed_at=now() where id=r.id;
  if r.operation='extraction' then
   update public.navigator_document_versions set extraction_status='failed' where id=v.id;
   update public.navigator_documents set status='failed',updated_at=now() where id=d.id;
  end if;
  return jsonb_build_object('status','failed');
 end if;
 if p_operation='complete_upload' and r.operation='extraction' then
  perform public.navigator_json_require(p_payload,'pages','array');
  if jsonb_array_length(p_payload->'pages') not between 1 and 20 then raise exception 'Invalid pages'; end if;
  for item in select * from jsonb_array_elements(p_payload->'pages') loop
   perform public.navigator_json_require(item,'pageNumber','integer');
   perform public.navigator_json_require(item,'text','string');
   perform public.navigator_json_require(item,'extractionMethod','string');
   seq:=seq+1;
   if (item->>'pageNumber')::int<>seq then raise exception 'Invalid page order'; end if;
   insert into public.navigator_document_pages(document_version_id,page_number,text,extraction_method,checksum)
    values(v.id,seq,item->>'text',item->>'extractionMethod',encode(sha256(convert_to(item->>'text','UTF8')),'hex'));
  end loop;
  update public.navigator_document_versions set extraction_status='completed',page_count=seq,parser_metadata=jsonb_build_object('schema','page-evidence-v1','offsetUnit','unicode-code-points') where id=v.id;
  update public.navigator_documents set status='completed',updated_at=now() where id=d.id;
 elsif p_operation='complete_evidence' and r.operation='evidence' then
  perform public.navigator_json_require(r.usage_metadata,'pageId','uuid');
  select * into pg from public.navigator_document_pages where id=(r.usage_metadata->>'pageId')::uuid and document_version_id=v.id;
  if not found then raise exception 'Source page unavailable'; end if;
  r:=public.navigator_require_evidence_run(r.id,p_matter_id,d.id,v.id,pg.id);
  perform public.navigator_json_require(p_payload,'items','array');
  if jsonb_array_length(p_payload->'items')>50 then raise exception 'Too many items'; end if;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
   perform public.navigator_json_require(item,'page_id','uuid');
   perform public.navigator_json_require(item,'page_number','integer');
   perform public.navigator_json_require(item,'classification','string');
   perform public.navigator_json_require(item,'review_state','string');
   perform public.navigator_json_require(item,'normalized_statement','string');
   if (item->>'page_id')::uuid<>pg.id or (item->>'page_number')::int<>pg.page_number then raise exception 'Wrong page'; end if;
   if item->>'classification' not in ('ALLEGATION','OPINION','PROFESSIONAL_ASSESSMENT','INFERENCE','UNVERIFIED_CLAIM','UNKNOWN') or item->>'review_state' not in ('UNREVIEWED','REQUIRES_SOURCE') then raise exception 'Invalid automated evidence state'; end if;
   if item ? 'confidence' and item->'confidence'<>'null'::jsonb then
    perform public.navigator_json_require(item,'confidence','number');
    if (item->>'confidence')::numeric not between 0 and 1 then raise exception 'Invalid confidence'; end if;
   end if;
   perform public.navigator_quote_validate(pg.text,item);
   insert into public.navigator_evidence_items(matter_id,document_id,document_version_id,page_id,page_number,classification,normalized_statement,exact_quote,quote_start_offset,quote_end_offset,quote_verification,confidence,review_state,extraction_run_id)
    values(p_matter_id,d.id,v.id,pg.id,pg.page_number,item->>'classification',item->>'normalized_statement',item->>'exact_quote',(item->>'quote_start_offset')::int,(item->>'quote_end_offset')::int,item->>'quote_verification',(item->>'confidence')::float8,item->>'review_state',r.id);
  end loop;
 else raise exception 'Unsupported source operation'; end if;
 if p_payload ? 'usage' then perform public.navigator_json_require(p_payload,'usage','object'); end if;
 if coalesce(p_payload->'usage','{}'::jsonb) ? 'pageId' then raise exception 'Reserved provenance field'; end if;
 update public.navigator_extraction_runs set status='completed',completed_at=now(),usage_metadata=usage_metadata||coalesce(p_payload->'usage','{}'::jsonb) where id=r.id;
 return jsonb_build_object('status','completed','runId',r.id);
end $$;
revoke all on function public.navigator_source_operation(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.navigator_source_operation(text,uuid,text,jsonb) to service_role;
commit;
