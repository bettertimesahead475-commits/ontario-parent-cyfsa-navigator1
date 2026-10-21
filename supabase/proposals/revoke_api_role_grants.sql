-- ============================================================================
-- PROPOSAL ONLY. NOT APPLIED TO ANY DATABASE. Requires owner approval.
--
-- PURPOSE: remove API-role table privileges. Production snapshot (read-only,
-- information_schema.role_table_grants): anon and authenticated each hold ALL
-- privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) on
-- all 20 advisor tables.
--
-- WHY IT MATTERS: RLS does not apply to TRUNCATE. The anon role can therefore
-- empty these tables, regardless of the policies. Advisor lints do not report
-- this. RLS does not block the other privileges either where no policy exists.
--
-- RLS is unchanged. Only grants are removed.
--
-- EVIDENCE (read-only production check, see docs/SECURITY_EXPOSURE_VERIFICATION.md):
--   * No browser code uses a Supabase client; the server uses the service role.
--   * Supabase Auth has 0 users, so auth.uid() policies match nothing.
--   * document_walkthroughs is intended static reference content (AUDIT.md),
--     with no user identifiers and no contact or case-number patterns in a
--     count-only check. Its anon SELECT is kept. Other privileges are removed.
--
-- ORDER: any time after production state is confirmed. Independent of the
-- migration sequence.
-- ============================================================================

begin;

revoke all on table public.access_codes, public.analysis_results, public.audit_log, public.case_exports, public.cases, public.cyfsa_300rule_access_codes, public.documents, public.free_tool_usage, public.free_usage, public.gmail_processed_messages, public.lawyer_leads, public.lawyer_profiles, public.parent_profiles, public.payments, public.reflection_conversations, public.stale_payment_alerts, public.submissions, public.timeline_events, public.users
  from anon, authenticated;

-- document_walkthroughs: anon keeps SELECT only (intended public reference content).
revoke all on table public.document_walkthroughs from anon, authenticated;
grant select on table public.document_walkthroughs to anon;

commit;
