-- ============================================================================
-- PROPOSED ADDITIVE MIGRATION: evidence and page provenance (v1)
-- STATUS: PROPOSAL ONLY. NOT APPLIED. NOT PART OF THE OWNER-FROZEN SET.
--
-- PURPOSE: The Phase 7B reconciled evidence table (phase7b_reconciled_evidence_
-- foundation.sql) has four columns. The runtime needs the page, quote, and
-- extraction-run provenance defined in create_navigator_page_evidence_
-- foundation.sql. Phase 7A marked that original "DO NOT DEPLOY AS-IS".
--
-- This file keeps the 7B table and adds the missing columns, tables, keys,
-- guards, and grants. It replaces nothing and drops nothing. It does not
-- port the source-operation RPC (navigator_source_operation) or the document
-- and version guards. Those remain a separate, reviewed change.
--
-- ORDER: apply after create_accounts_foundation.sql,
-- create_navigator_case_ownership_foundation.sql,
-- create_navigator_matters_foundation.sql, and
-- phase7b_reconciled_evidence_foundation.sql. Do NOT apply
-- create_navigator_page_evidence_foundation.sql in addition to this file.
--
-- SAFETY: every ALTER that adds a NOT NULL column runs only when the table is
-- empty. The migration raises an exception instead of adding columns to
-- populated tables. Production navigator_matters, navigator_documents and
-- navigator_document_versions had 0 rows at audit time; navigator_evidence_items
-- does not exist in production (see the Phase 6 audit).
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.navigator_evidence_items') is null then
    raise exception 'REQUIRES phase7b_reconciled_evidence_foundation.sql first';
  end if;
  if to_regclass('public.navigator_extraction_runs') is not null
     or to_regclass('public.navigator_document_pages') is not null then
    raise exception 'ALREADY_APPLIED: navigator_extraction_runs or navigator_document_pages exists';
  end if;
  if exists (select 1 from public.navigator_evidence_items)
     or exists (select 1 from public.navigator_documents)
     or exists (select 1 from public.navigator_document_versions) then
    raise exception 'NOT_EMPTY: this additive proposal only runs on empty evidence and document tables';
  end if;
end $$;

-- Identity keys needed by the composite foreign keys below (additive).
alter table public.navigator_documents
  add constraint navigator_document_matter_identity unique (id, matter_id);

alter table public.navigator_documents
  add column original_filename text,
  add column content_type text,
  add column status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed'));

alter table public.navigator_document_versions
  add constraint navigator_version_document_identity unique (id, document_id),
  add constraint navigator_version_hash_unique unique (document_id, content_hash),
  add column page_count integer check (page_count between 1 and 20),
  add column parser_metadata jsonb not null default '{}'::jsonb,
  add column extraction_run_id uuid;

create table public.navigator_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.navigator_matters (id),
  document_id uuid not null,
  document_version_id uuid not null references public.navigator_document_versions (id) on delete cascade,
  operation text not null check (operation in ('extraction', 'evidence')),
  provider text not null,
  model text not null,
  schema_version text not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_category text check (failure_category in ('PROVIDER_FAILURE', 'INVALID_OUTPUT', 'TIMEOUT')),
  usage_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_metadata) = 'object'),
  check (
    (status = 'processing' and completed_at is null and failure_category is null) or
    (status = 'completed' and completed_at is not null and failure_category is null) or
    (status = 'failed' and completed_at is not null and failure_category is not null)
  ),
  check (completed_at is null or completed_at >= started_at),
  constraint navigator_run_version_identity unique (id, document_version_id, matter_id),
  constraint navigator_run_document_scope foreign key (document_id, matter_id)
    references public.navigator_documents (id, matter_id),
  constraint navigator_run_version_scope foreign key (document_version_id, document_id)
    references public.navigator_document_versions (id, document_id)
);

alter table public.navigator_document_versions
  add constraint navigator_version_extraction_run_fk
    foreign key (extraction_run_id) references public.navigator_extraction_runs (id);

create table public.navigator_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.navigator_document_versions (id) on delete cascade,
  page_number integer not null check (page_number between 1 and 20),
  text text not null check (char_length(text) <= 100000),
  extraction_method text not null check (extraction_method in ('gemini-page-ocr', 'gemini-image-ocr', 'utf8-single-source')),
  confidence double precision check (confidence between 0 and 1),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint navigator_page_version_number unique (document_version_id, page_number),
  constraint navigator_page_version_identity unique (id, document_version_id, page_number)
);

-- Evidence columns. The table is empty (guarded above), so NOT NULL is safe.
alter table public.navigator_evidence_items
  add column document_id uuid not null,
  add column document_version_id uuid not null,
  add column page_id uuid not null,
  add column page_number integer not null check (page_number > 0),
  add column normalized_statement text not null check (char_length(normalized_statement) between 1 and 2000),
  add column exact_quote text not null check (char_length(exact_quote) <= 10000),
  add column quote_start_offset integer,
  add column quote_end_offset integer,
  add column quote_verification text not null
    check (quote_verification in ('EXACT', 'NORMALIZED_WHITESPACE', 'ABSENT', 'AMBIGUOUS')),
  add column confidence double precision check (confidence between 0 and 1),
  add column review_state text not null default 'UNREVIEWED'
    check (review_state in ('UNREVIEWED', 'REVIEWED', 'CONFIRMED', 'DISPUTED', 'REQUIRES_SOURCE', 'NOT_RELEVANT')),
  add column extraction_run_id uuid not null,
  add constraint navigator_evidence_quote_state check (
    (quote_verification in ('ABSENT', 'AMBIGUOUS') and quote_start_offset is null and quote_end_offset is null
      and review_state = 'REQUIRES_SOURCE')
    or
    (quote_verification in ('EXACT', 'NORMALIZED_WHITESPACE') and char_length(exact_quote) > 0
      and quote_start_offset is not null and quote_end_offset is not null
      and quote_start_offset >= 0 and quote_end_offset > quote_start_offset)
  ),
  add constraint navigator_evidence_document_scope foreign key (document_id, matter_id)
    references public.navigator_documents (id, matter_id),
  add constraint navigator_evidence_version_scope foreign key (document_version_id, document_id)
    references public.navigator_document_versions (id, document_id) on delete cascade,
  add constraint navigator_evidence_page_scope foreign key (page_id, document_version_id, page_number)
    references public.navigator_document_pages (id, document_version_id, page_number) on delete cascade,
  add constraint navigator_evidence_run_scope foreign key (extraction_run_id, document_version_id, matter_id)
    references public.navigator_extraction_runs (id, document_version_id, matter_id) on delete cascade;

create index navigator_runs_version_idx on public.navigator_extraction_runs (document_version_id, started_at);
create index navigator_runs_document_idx on public.navigator_extraction_runs (document_id);
create index navigator_runs_matter_idx on public.navigator_extraction_runs (matter_id);
create index navigator_evidence_page_idx on public.navigator_evidence_items (page_id);
create index navigator_evidence_version_idx on public.navigator_evidence_items (document_version_id);
create index navigator_evidence_document_idx on public.navigator_evidence_items (document_id);
create index navigator_evidence_run_idx on public.navigator_evidence_items (extraction_run_id);

-- Server-only access, matching the existing pattern. No anon or authenticated grants.
alter table public.navigator_extraction_runs enable row level security;
alter table public.navigator_document_pages enable row level security;

revoke all on public.navigator_extraction_runs, public.navigator_document_pages
  from public, anon, authenticated, service_role;
grant select, insert, update on public.navigator_extraction_runs to service_role;
grant select, insert on public.navigator_document_pages to service_role;

-- Verbatim helper functions from create_navigator_page_evidence_foundation.sql
-- (quote normalization and validation, evidence-run check). Copied, not retyped.
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

-- Helper access: API roles do not execute these. Only the service role may.
revoke all on function public.navigator_quote_normalize(text), public.navigator_quote_hits(text, text),
  public.navigator_quote_validate(text, jsonb), public.navigator_json_require(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.navigator_quote_normalize(text), public.navigator_quote_hits(text, text),
  public.navigator_quote_validate(text, jsonb), public.navigator_json_require(jsonb, text, text)
  to service_role;

-- Evidence rows: provenance is immutable. Review state may change.
-- The quote is validated against the stored page text on every insert.
create function public.navigator_evidence_items_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
declare source_text text;
begin
  if TG_OP = 'UPDATE' and (to_jsonb(new) - 'review_state' - 'updated_at')
     is distinct from (to_jsonb(old) - 'review_state' - 'updated_at') then
    raise exception 'Evidence provenance is immutable';
  end if;
  new.updated_at := clock_timestamp();
  if TG_OP = 'INSERT' then
    perform public.navigator_require_evidence_run(new.extraction_run_id, new.matter_id,
      new.document_id, new.document_version_id, new.page_id);
    select text into source_text from public.navigator_document_pages
      where id = new.page_id and document_version_id = new.document_version_id;
    perform public.navigator_quote_validate(source_text, to_jsonb(new));
  end if;
  return new;
end $$;

create trigger navigator_evidence_items_guard
  before insert or update on public.navigator_evidence_items
  for each row execute function public.navigator_evidence_items_guard();

-- Pages are insert-only, only while the version is processing, and checksum-bound.
create function public.navigator_document_pages_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
declare version_status text;
begin
  if TG_OP <> 'INSERT' then
    raise exception 'Extracted pages are immutable';
  end if;
  select extraction_status into version_status from public.navigator_document_versions
    where id = new.document_version_id for update;
  if version_status is distinct from 'processing' then
    raise exception 'Version not accepting pages';
  end if;
  if new.checksum is distinct from encode(sha256(convert_to(new.text, 'UTF8')), 'hex') then
    raise exception 'Page checksum mismatch';
  end if;
  return new;
end $$;

create trigger navigator_document_pages_guard
  before insert or update or delete on public.navigator_document_pages
  for each row execute function public.navigator_document_pages_guard();

-- Runs: provenance is immutable, and a terminal run cannot change.
create function public.navigator_extraction_runs_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if TG_OP = 'DELETE' then
    return old;
  end if;
  if TG_OP = 'UPDATE' then
    if old.status <> 'processing' then
      raise exception 'Terminal run is immutable';
    end if;
    if (new.id, new.matter_id, new.document_id, new.document_version_id, new.operation,
        new.provider, new.model, new.schema_version, new.started_at)
       is distinct from
       (old.id, old.matter_id, old.document_id, old.document_version_id, old.operation,
        old.provider, old.model, old.schema_version, old.started_at)
       or (new.usage_metadata -> 'pageId') is distinct from (old.usage_metadata -> 'pageId') then
      raise exception 'Run provenance is immutable';
    end if;
  end if;
  return new;
end $$;

create trigger navigator_extraction_runs_guard
  before update or delete on public.navigator_extraction_runs
  for each row execute function public.navigator_extraction_runs_guard();

revoke all on function public.navigator_evidence_items_guard(), public.navigator_document_pages_guard(),
  public.navigator_extraction_runs_guard() from public, anon, authenticated, service_role;

commit;
