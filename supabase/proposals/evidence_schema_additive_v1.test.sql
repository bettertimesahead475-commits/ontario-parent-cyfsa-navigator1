-- ============================================================================
-- Tests for supabase/proposals/evidence_schema_additive_v1.sql
--
-- Run on a DISPOSABLE database only, after applying, in order:
--   create_accounts_foundation.sql
--   create_navigator_case_ownership_foundation.sql
--   create_navigator_matters_foundation.sql
--   create_professional_reviews.sql
--   phase7b_reconciled_evidence_foundation.sql
--   evidence_schema_additive_v1.sql
-- The whole file runs in one transaction and rolls back. It writes no data.
-- Each expectation prints PASS or raises FAIL.
-- ============================================================================

begin;

do $$
declare
  v_account uuid; v_client uuid; v_matter uuid; v_matter_other uuid;
  v_doc uuid; v_version uuid; v_page uuid; v_run uuid; v_run_other uuid;
  v_text text := 'The worker said the child was left alone on Monday.';
  v_quote text := 'the child was left alone';
  v_start int;
  v_ok boolean;
  v_err text;
  v_other_account uuid; v_other_client uuid; v_doc_other uuid; v_version_other uuid; v_page_other uuid;
begin
  -- Fixture: two matters so cross-matter links can be attempted.
  insert into public.accounts (firebase_uid, primary_role) values ('test-uid-a', 'parent') returning id into v_account;
  insert into public.clients (account_id, name) values (v_account, 'Test Client') returning id into v_client;
  insert into public.navigator_matters (account_id, client_id, title) values (v_account, v_client, 'Matter A') returning id into v_matter;
  insert into public.navigator_matters (account_id, client_id, title) values (v_account, v_client, 'Matter B') returning id into v_matter_other;

  insert into public.navigator_documents (matter_id, display_name) values (v_matter, 'Affidavit A') returning id into v_doc;
  insert into public.navigator_document_versions
    (document_id, version_number, filename, mime_type, size_bytes, content_hash, extraction_status)
    values (v_doc, 1, 'a.txt', 'text/plain', 56, repeat('a', 64), 'processing') returning id into v_version;

  insert into public.navigator_document_pages
    (document_version_id, page_number, text, extraction_method, confidence, checksum)
    values (v_version, 1, v_text, 'utf8-single-source', 1,
      encode(sha256(convert_to(v_text, 'UTF8')), 'hex')) returning id into v_page;

  insert into public.navigator_extraction_runs
    (matter_id, document_version_id, document_id, operation, provider, model, schema_version, status, usage_metadata)
    values (v_matter, v_version, v_doc, 'evidence', 'test', 'test', 'page-evidence-v1', 'processing',
      jsonb_build_object('pageId', v_page)) returning id into v_run;

  -- Second matter, its own document/version/page/run.
  insert into public.navigator_documents (matter_id, display_name) values (v_matter_other, 'Other') returning id into v_doc_other;
  insert into public.navigator_document_versions
    (document_id, version_number, filename, mime_type, size_bytes, content_hash, extraction_status)
    values (v_doc_other, 1, 'b.txt', 'text/plain', 56, repeat('b', 64), 'processing') returning id into v_version_other;
  insert into public.navigator_document_pages
    (document_version_id, page_number, text, extraction_method, confidence, checksum)
    values (v_version_other, 1, v_text, 'utf8-single-source', 1,
      encode(sha256(convert_to(v_text, 'UTF8')), 'hex')) returning id into v_page_other;
  insert into public.navigator_extraction_runs
    (matter_id, document_version_id, document_id, operation, provider, model, schema_version, status, usage_metadata)
    values (v_matter_other, v_version_other, v_doc_other, 'evidence', 'test', 'test', 'page-evidence-v1', 'processing',
      jsonb_build_object('pageId', v_page_other)) returning id into v_run_other;

  v_start := strpos(v_text, v_quote) - 1;

  -- 1. A valid EXACT quote is accepted.
  insert into public.navigator_evidence_items
    (matter_id, classification, document_id, document_version_id, page_id, page_number,
     normalized_statement, exact_quote, quote_start_offset, quote_end_offset, quote_verification,
     extraction_run_id)
    values (v_matter, 'ALLEGATION', v_doc, v_version, v_page, 1,
      'Child was left alone', v_quote, v_start, v_start + char_length(v_quote), 'EXACT', v_run);
  raise notice 'PASS 1: valid EXACT quote accepted';

  -- 2. An unsupported quote is recorded as ABSENT with REQUIRES_SOURCE and null offsets.
  insert into public.navigator_evidence_items
    (matter_id, classification, document_id, document_version_id, page_id, page_number,
     normalized_statement, exact_quote, quote_verification, review_state, extraction_run_id)
    values (v_matter, 'UNVERIFIED_CLAIM', v_doc, v_version, v_page, 1,
      'Something the page does not say', 'the moon was made of cheese', 'ABSENT', 'REQUIRES_SOURCE', v_run);
  raise notice 'PASS 2: ABSENT quote accepted with REQUIRES_SOURCE';

  -- 3. Quote not on the page, claimed EXACT: rejected.
  v_ok := false;
  begin
    insert into public.navigator_evidence_items
      (matter_id, classification, document_id, document_version_id, page_id, page_number,
       normalized_statement, exact_quote, quote_start_offset, quote_end_offset, quote_verification, extraction_run_id)
      values (v_matter, 'FACT', v_doc, v_version, v_page, 1, 'x', 'not on the page', 0, 5, 'EXACT', v_run);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 3: fabricated quote was accepted'; end if;
  raise notice 'PASS 3: fabricated quote rejected (%)', v_err;

  -- 4. Wrong offsets for an EXACT quote: rejected.
  v_ok := false;
  begin
    insert into public.navigator_evidence_items
      (matter_id, classification, document_id, document_version_id, page_id, page_number,
       normalized_statement, exact_quote, quote_start_offset, quote_end_offset, quote_verification, extraction_run_id)
      values (v_matter, 'FACT', v_doc, v_version, v_page, 1, 'x', v_quote, 0, 5, 'EXACT', v_run);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 4: wrong offsets were accepted'; end if;
  raise notice 'PASS 4: wrong offsets rejected (%)', v_err;

  -- 5. Run belonging to another page: rejected (page mismatch).
  v_ok := false;
  begin
    insert into public.navigator_evidence_items
      (matter_id, classification, document_id, document_version_id, page_id, page_number,
       normalized_statement, exact_quote, quote_start_offset, quote_end_offset, quote_verification, extraction_run_id)
      values (v_matter, 'FACT', v_doc, v_version, v_page, 1, 'x', v_quote, v_start, v_start + char_length(v_quote), 'EXACT', v_run_other);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 5: run from another matter was accepted'; end if;
  raise notice 'PASS 5: cross-matter run rejected (%)', v_err;

  -- 6. Evidence for matter A pointing at matter B's document: rejected by the same-matter key.
  v_ok := false;
  begin
    insert into public.navigator_evidence_items
      (matter_id, classification, document_id, document_version_id, page_id, page_number,
       normalized_statement, exact_quote, quote_start_offset, quote_end_offset, quote_verification, extraction_run_id)
      values (v_matter, 'FACT', v_doc_other, v_version_other, v_page_other, 1, 'x', v_quote, v_start, v_start + char_length(v_quote), 'EXACT', v_run_other);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 6: cross-matter document link was accepted'; end if;
  raise notice 'PASS 6: cross-matter document link rejected (%)', v_err;

  -- 7. Changing quote provenance after insert: rejected.
  v_ok := false;
  begin
    update public.navigator_evidence_items set exact_quote = 'changed' where page_id = v_page and quote_verification = 'EXACT';
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 7: quote provenance was mutated'; end if;
  raise notice 'PASS 7: provenance mutation rejected (%)', v_err;

  -- 8. Review state may change.
  update public.navigator_evidence_items set review_state = 'REVIEWED' where page_id = v_page and quote_verification = 'EXACT';
  raise notice 'PASS 8: review_state update accepted';

  -- 9. Pages are insert-only.
  v_ok := false;
  begin
    update public.navigator_document_pages set text = 'tampered' where id = v_page;
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 9: page text was mutated'; end if;
  raise notice 'PASS 9: page mutation rejected (%)', v_err;

  -- 10. Page checksum must match the text.
  v_ok := false;
  begin
    insert into public.navigator_document_pages
      (document_version_id, page_number, text, extraction_method, confidence, checksum)
      values (v_version, 2, 'second page', 'utf8-single-source', 1, repeat('0', 64));
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 10: checksum mismatch was accepted'; end if;
  raise notice 'PASS 10: checksum mismatch rejected (%)', v_err;

  -- 11. Terminal runs are immutable.
  update public.navigator_extraction_runs set status = 'completed', completed_at = now() where id = v_run;
  v_ok := false;
  begin
    update public.navigator_extraction_runs set status = 'failed', failure_category = 'TIMEOUT' where id = v_run;
  exception when others then v_ok := true; v_err := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL 11: terminal run was changed'; end if;
  raise notice 'PASS 11: terminal run immutable (%)', v_err;

  -- 12. RLS is enabled and API roles have no privileges on the new tables.
  if not (select relrowsecurity from pg_class where relname = 'navigator_extraction_runs')
     or not (select relrowsecurity from pg_class where relname = 'navigator_document_pages')
     or not (select relrowsecurity from pg_class where relname = 'navigator_evidence_items') then
    raise exception 'FAIL 12: RLS not enabled on evidence tables';
  end if;
  if has_table_privilege('anon', 'public.navigator_evidence_items', 'SELECT')
     or has_table_privilege('authenticated', 'public.navigator_evidence_items', 'SELECT')
     or has_table_privilege('anon', 'public.navigator_document_pages', 'SELECT')
     or has_table_privilege('authenticated', 'public.navigator_extraction_runs', 'SELECT') then
    raise exception 'FAIL 12: anon or authenticated has privileges on evidence tables';
  end if;
  raise notice 'PASS 12: RLS enabled, no anon or authenticated privileges';
end $$;

rollback;
