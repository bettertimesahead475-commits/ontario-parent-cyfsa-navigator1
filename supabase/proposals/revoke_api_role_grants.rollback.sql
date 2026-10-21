-- ROLLBACK for revoke_api_role_grants.sql.
-- Restores the production state observed in the read-only snapshot: ALL
-- privileges for anon and authenticated on every listed table. RLS is unchanged
-- by the forward script, so this rollback does not change row access.
begin;

grant all on table public.access_codes, public.analysis_results, public.audit_log, public.case_exports, public.cases, public.cyfsa_300rule_access_codes, public.documents, public.free_tool_usage, public.free_usage, public.gmail_processed_messages, public.lawyer_leads, public.lawyer_profiles, public.parent_profiles, public.payments, public.reflection_conversations, public.stale_payment_alerts, public.submissions, public.timeline_events, public.users
  to anon, authenticated;

grant all on table public.document_walkthroughs to anon, authenticated;

commit;
