-- ============================================================================
-- ROLLBACK for revoke_api_role_grants.sql. PROPOSAL ONLY. Requires owner approval.
--
-- Restores the observed production state exactly:
--   * tables: ALL seven privileges for anon and authenticated (20 tables)
--   * sequence: USAGE, SELECT, UPDATE for anon and authenticated
-- Does not change data, RLS, policies, or function definitions.
-- ============================================================================

begin;

grant all on table
  public.access_codes, public.analysis_results, public.audit_log,
  public.case_exports, public.cases, public.cyfsa_300rule_access_codes,
  public.documents, public.free_tool_usage, public.free_usage,
  public.gmail_processed_messages, public.lawyer_leads, public.lawyer_profiles,
  public.parent_profiles, public.payments, public.reflection_conversations,
  public.stale_payment_alerts, public.submissions, public.timeline_events,
  public.users
  to anon, authenticated;

grant all on table public.document_walkthroughs to anon, authenticated;

grant usage, select, update on sequence public.navigator_matter_access_events_event_sequence_seq
  to anon, authenticated;

commit;
