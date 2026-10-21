-- ============================================================================
-- Tests for supabase/proposals/evidence_pipeline_additive_v2.sql
--
-- Disposable database only. Apply in order, then run this file:
--   create_accounts_foundation.sql
--   create_navigator_case_ownership_foundation.sql
--   create_navigator_matters_foundation.sql
--   create_professional_reviews.sql
--   phase7b_reconciled_evidence_foundation.sql
--   evidence_schema_additive_v1.sql
--   read_navigator_owned_matter.sql
--   evidence_pipeline_additive_v2.sql
-- Runs in one transaction and rolls back. Each expectation prints PASS or raises FAIL.
-- ============================================================================

begin;

do $$
declare
  v_owner_acct uuid; v_other_acct uuid; v_client uuid; v_other_client uuid;
  v_matter uuid; v_other_matter uuid;
  v_payload jsonb; v_result jsonb; v_doc uuid; v_ver uuid; v_count int;
  v_err text; v_ok boolean;
  v_checksum text := repeat('c', 64);
begin
  insert into public.accounts (firebase_uid, primary_role, status) values ('uid-owner', 'parent', 'active')
    returning id into v_owner_acct;
  insert into public.accounts (firebase_uid, primary_role, status) values ('uid-other', 'parent', 'active')
    returning id into v_other_acct;

  insert into public.clients (account_id, name) values (v_owner_acct, 'Owner client') returning id into v_client;
  insert into public.clients (account_id, name) values (v_other_acct, 'Other client') returning id into v_other_client;

  insert into public.navigator_matters (account_id, client_id, title) values (v_owner_acct, v_client, 'Owner matter')
    returning id into v_matter;
  insert into public.navigator_matters (account_id, client_id, title) values (v_other_acct, v_other_client, 'Other matter')
    returning id into v_other_matter;

  insert into public.navigator_matter_members (matter_id, account_id, role) values (v_matter, v_owner_acct, 'OWNER');
  insert into public.navigator_matter_members (matter_id, account_id, role) values (v_other_matter, v_other_acct, 'OWNER');

  v_payload := jsonb_build_object(
    'checksum', v_checksum, 'filename', 'affidavit.txt', 'mime', 'text/plain', 'size', 120,
    'provider', 'test', 'model', 'test');

  -- 1. Owner begins an upload: document, version (processing) and extraction run are created.
  v_result := public.navigator_source_operation('uid-owner', v_matter, 'begin_upload', v_payload);
  select count(*) into v_count from public.navigator_documents where matter_id = v_matter;
  if v_count <> 1 then raise exception 'FAIL 1: expected 1 document, found %', v_count; end if;
  select id into v_ver from public.navigator_document_versions where content_hash = v_checksum;
  if v_ver is null then raise exception 'FAIL 1: version not created'; end if;
  if not exists (select 1 from public.navigator_extraction_runs
                 where document_version_id = v_ver and operation = 'extraction' and status = 'processing') then
    raise exception 'FAIL 1: extraction run not created in processing state';
  end if;
  raise notice 'PASS 1: owner begin_upload creates document, version and processing run';

  -- 2. Another account cannot start an upload on this matter.
  v_ok := false;
  begin
    perform public.navigator_source_operation('uid-other', v_matter, 'begin_upload',
      jsonb_set(v_payload, '{checksum}', to_jsonb(repeat('d', 64))));
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 2: non-owner upload was accepted'; end if;
  raise notice 'PASS 2: non-owner rejected (%)', v_err;

  -- 3. Owner cannot upload into another account's matter (cross-matter isolation).
  v_ok := false;
  begin
    perform public.navigator_source_operation('uid-owner', v_other_matter, 'begin_upload',
      jsonb_set(v_payload, '{checksum}', to_jsonb(repeat('e', 64))));
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 3: cross-matter upload was accepted'; end if;
  raise notice 'PASS 3: cross-matter upload rejected (%)', v_err;

  -- 4. Repeating the same upload while it is still processing is refused.
  v_ok := false;
  begin
    perform public.navigator_source_operation('uid-owner', v_matter, 'begin_upload', v_payload);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 4: duplicate in-progress upload was accepted'; end if;
  raise notice 'PASS 4: duplicate in-progress upload refused (%)', v_err;

  -- 5. Invalid MIME type is rejected before any row is written.
  v_ok := false;
  begin
    perform public.navigator_source_operation('uid-owner', v_matter, 'begin_upload',
      jsonb_set(v_payload, '{mime}', to_jsonb('application/x-msdownload'::text)));
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 5: invalid MIME type was accepted'; end if;
  raise notice 'PASS 5: invalid MIME rejected (%)', v_err;

  -- 6. Document-level identity is immutable once a version exists.
  v_ok := false;
  begin
    update public.navigator_documents set matter_id = v_other_matter where matter_id = v_matter;
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 6: document was moved to another matter'; end if;
  raise notice 'PASS 6: document move across matters rejected (%)', v_err;

  -- 7. Version source identity (content hash) is immutable.
  v_ok := false;
  begin
    update public.navigator_document_versions set content_hash = repeat('f', 64) where id = v_ver;
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 7: version content hash was changed'; end if;
  raise notice 'PASS 7: version hash change rejected (%)', v_err;

  -- 8. The operation is not callable by API roles.
  if has_function_privilege('anon', 'public.navigator_source_operation(text,uuid,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.navigator_source_operation(text,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'FAIL 8: API role can execute navigator_source_operation';
  end if;
  raise notice 'PASS 8: no API-role execute on navigator_source_operation';
end $$;

rollback;
