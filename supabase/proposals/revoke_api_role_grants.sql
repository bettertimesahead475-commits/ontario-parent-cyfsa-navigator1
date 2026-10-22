-- ============================================================================
-- MINIMAL PRODUCTION SECURITY FIX. PROPOSAL ONLY. NOT APPLIED TO ANY DATABASE.
-- Requires explicit owner approval. Do not run without the preflight in
-- docs/PROD_SECURITY_FIX_RUNBOOK.md.
--
-- PURPOSE: remove direct table and sequence privileges held by the API roles
-- anon and authenticated.
--
-- OBSERVED STATE (read-only production snapshot, 2026-10-22):
--   * 20 public tables: anon and authenticated each hold ALL seven table
--     privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER).
--   * 1 public sequence, navigator_matter_access_events_event_sequence_seq:
--     anon and authenticated each hold USAGE, SELECT, UPDATE.
--   * No PUBLIC grants on public tables. No EXECUTE grants on public functions
--     for anon or authenticated (0 of 14).
--
-- WHY: RLS does not restrict TRUNCATE. The sequence privileges let an API
-- caller change the audit sequence (setval), which can cause collisions or
-- reordering in the append-only access event log.
--
-- NOT CHANGED: RLS, policies, data, function definitions, schema privileges
-- (anon keeps USAGE on schema public, which is needed to resolve names), and
-- service_role privileges. The server uses service_role only.
--
-- INTENTIONAL EXCEPTION: anon SELECT on document_walkthroughs stays. It is
-- static reference content (AUDIT.md). The owner must confirm before apply.
-- ============================================================================

begin;

revoke all on table
  public.access_codes, public.analysis_results, public.audit_log,
  public.case_exports, public.cases, public.cyfsa_300rule_access_codes,
  public.documents, public.free_tool_usage, public.free_usage,
  public.gmail_processed_messages, public.lawyer_leads, public.lawyer_profiles,
  public.parent_profiles, public.payments, public.reflection_conversations,
  public.stale_payment_alerts, public.submissions, public.timeline_events,
  public.users
  from anon, authenticated;

-- document_walkthroughs: anon keeps SELECT only (intended public reference content).
revoke all on table public.document_walkthroughs from anon, authenticated;
grant select on table public.document_walkthroughs to anon;

-- Event-log sequence. Its only writer is a SECURITY DEFINER function owned by
-- postgres (record_matter_access_event), so the server path does not need
-- these API-role privileges.
revoke all on sequence public.navigator_matter_access_events_event_sequence_seq
  from anon, authenticated;

commit;
