-- ============================================================================
-- PROPOSED ADDITIVE MIGRATION: source-operation RPC and document/version guards (v2)
-- STATUS: PROPOSAL ONLY. NOT APPLIED. NOT PART OF THE OWNER-FROZEN SET.
--
-- PURPOSE: The upload and evidence path (begin_upload, complete_upload,
-- begin_evidence, complete_evidence, fail, read) lives in
-- navigator_source_operation(), which was in create_navigator_page_evidence_
-- foundation.sql, a file Phase 7A marked "DO NOT DEPLOY AS-IS". This file ports
-- that function and the document and version guards, copied verbatim, so the
-- source pipeline has its own reviewable change.
--
-- ORDER: after evidence_schema_additive_v1.sql and
-- read_navigator_owned_matter.sql. Do NOT apply create_navigator_page_evidence_
-- foundation.sql alongside this file. Pages, extraction runs, and evidence
-- already have their guards in evidence_schema_additive_v1.sql, so this file
-- attaches triggers only to navigator_documents and navigator_document_versions.
--
-- SECURITY: the function is SECURITY INVOKER (the caller's role). It is granted
-- to service_role only. Ownership is checked by read_navigator_owned_matter()
-- on the account's firebase_uid and matter, with OWNER membership, under
-- row locks. This file does not change RLS and grants no API-role access.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.read_navigator_owned_matter(text,uuid)') is null then
    raise exception 'REQUIRES read_navigator_owned_matter.sql first';
  end if;
  if to_regprocedure('public.navigator_quote_validate(text,jsonb)') is null then
    raise exception 'REQUIRES evidence_schema_additive_v1.sql first';
  end if;
  if to_regprocedure('public.navigator_source_operation(text,uuid,text,jsonb)') is not null then
    raise exception 'ALREADY_APPLIED: navigator_source_operation exists';
  end if;
end $$;

-- Verbatim from create_navigator_page_evidence_foundation.sql (lines 179-219).
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

-- Triggers for document and version rows only. Pages, runs and evidence are
-- covered by the guards in evidence_schema_additive_v1.sql.
create trigger navigator_document_source_guard before update on public.navigator_documents
  for each row execute function public.navigator_source_guard();
create trigger navigator_version_source_guard before update or delete on public.navigator_document_versions
  for each row execute function public.navigator_source_guard();

revoke all on function public.navigator_source_guard() from public, anon, authenticated, service_role;

-- Verbatim from create_navigator_page_evidence_foundation.sql (lines 233-375).
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
