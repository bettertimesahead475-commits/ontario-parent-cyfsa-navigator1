# Database Exposure Verification (Priority 1)

Scope: the Supabase advisor's report of 20 public tables visible to the `anon` role through GraphQL. This is a current verification, not the historical finding in `INTEGRATION_PHASE_6_LIVE_DATABASE_VERIFICATION.md`.

Target: production project `cyfsa-navigator live` (`qboidsfpjuxeqtfotryj`). Read-only. No DDL, no grants, no policies, no data, no configuration were changed. Every query ran inside `begin read only` or was a catalog SELECT. The `anon` checks used `set local role anon` inside a read-only transaction, which is how PostgREST evaluates an anonymous request.

## Method

1. Catalog query: RLS state, forced RLS, grants to `anon` and `authenticated`, policy count for every public table.
2. Full policy definitions from `pg_policies`.
3. Row counts as the owner role, then as `anon`, for each table. The difference shows what RLS hides.
4. Supabase security advisor (read-only).
5. Supabase Auth user count, to see whether any `auth.uid()` can match a row.
6. Repository search for direct Supabase client use in the browser bundle.

## Findings

**Supabase Auth has 0 users.** The app authenticates with Firebase (1 Firebase-linked account in production). So `auth.uid()` is NULL for every request. Every policy that compares to `auth.uid()` matches nothing.

**Grant-level exposure is current.** The advisor reports the same 20 tables as GraphQL-visible to `anon` and 20 to `authenticated`. This is confirmed by the grants, not inferred from history.

**Row-level exposure is limited to one table.** Under `anon`, one table returns rows: `document_walkthroughs` (3 rows, `walkthroughs_public` policy `USING (true)`).

Per-table status (20 advisor tables):

| Table | RLS | Policies | Owner rows | Rows visible to anon | Status |
|---|---|---|---|---|---|
| access_codes | on | 0 | 1 | 0 | Grant exposed, rows hidden by RLS (verified) |
| analysis_results | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert (no auth users) |
| audit_log | on | 1 (`auth.uid()` admin) | 0 | 0 | Grant exposed, no rows; policy inert |
| case_exports | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert |
| cases | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert |
| cyfsa_300rule_access_codes | on | 0 | 1 | 0 | Grant exposed, row hidden by RLS (verified) |
| document_walkthroughs | on | 1 (`USING (true)`) | 3 | **3** | **Rows readable by anon (verified).** Content is document-guide text (title, what it is, red flags, legal references). Intent to be confirmed by owner. |
| documents | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert |
| free_tool_usage | on | 0 | 0 | 0 | Grant exposed, no rows |
| free_usage | on | 0 | 2 | 0 | Grant exposed, rows hidden by RLS (verified) |
| gmail_processed_messages | on | 0 | 0 | 0 | Grant exposed, no rows |
| lawyer_leads | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert |
| lawyer_profiles | on | 2 (one `auth.uid()`, one public: active and approved) | 0 | 0 | Grant exposed. Public-read policy is latent: it exposes approved profiles once any exist. Review fields before first approval. |
| parent_profiles | on | 1 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policy inert |
| payments | on | 2 (`auth.uid()`) | 2 | 0 | Grant exposed, rows hidden by RLS (verified) |
| reflection_conversations | on | 1 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policy inert |
| stale_payment_alerts | on | 0 | 0 | 0 | Grant exposed, no rows |
| submissions | on | 0 | 0 | 0 | Grant exposed, no rows |
| timeline_events | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert |
| users | on | 2 (`auth.uid()`) | 0 | 0 | Grant exposed, no rows; policies inert |

Plus, not in the advisor list, the `navigator_*` tables (`navigator_matters`, `navigator_matter_access_grants`, and others) have RLS on and zero policies. Under `anon` they return no rows, and `anon` has no grants on them.

## Verification limits

- Empty tables (0 rows) are "no current exposure", not "safe". Policies and grants still apply when rows arrive.
- The `anon` count proves what RLS shows an anonymous request. It does not prove what the GraphQL endpoint returns for an authenticated Firebase user. Firebase users reach the database only through the server, with the service-role key.
- The policy analysis assumes no Supabase Auth JWT with a `sub` claim. True today (0 auth users).
- I did not inspect `document_walkthroughs` row contents. Only column names and the count.

## Remediation (proposed, not applied)

Grant-level remediation (removes the advisor finding). Requires that no non-app client uses the anon key. The repository shows none: browser code has no Supabase client, and the server uses the service-role key. External consumers have not been ruled out.

```sql
-- PROPOSAL ONLY. Do not apply without owner approval.
revoke select on public.access_codes, public.analysis_results, public.audit_log,
  public.case_exports, public.cases, public.cyfsa_300rule_access_codes,
  public.documents, public.free_tool_usage, public.free_usage,
  public.gmail_processed_messages, public.lawyer_leads, public.lawyer_profiles,
  public.parent_profiles, public.payments, public.reflection_conversations,
  public.stale_payment_alerts, public.submissions, public.timeline_events,
  public.users
  from anon, authenticated;
```

`document_walkthroughs`: keep `anon` SELECT only if the owner confirms the content is meant to be public. Otherwise revoke it too. Revoke `authenticated` SELECT on it either way, since no Firebase user reads it directly.

Rollback: `grant select on <table> to anon, authenticated;` for each table. Revoking grants does not change data or RLS.

Policy remediation (recommended, not urgent):

- Decide whether `auth.uid()` policies are dead code. The app uses Firebase. If Supabase Auth is never adopted, remove them so the schema states the real access model. Keep them only if Supabase Auth adoption is planned.
- Review `lawyer_profiles_public_read` columns before any profile is approved.

Explicit deny (optional, cosmetic): the 21 "RLS enabled, no policy" INFO findings are fail-closed by design. Leave them as they are, or add a comment documenting the deny-all intent.

## Owner decisions

1. Approve the grant revocation above (19 tables, plus the `document_walkthroughs` decision).
2. Confirm whether `document_walkthroughs` is public content.
3. Confirm no external service uses the anon key against this project.
4. Decide whether to keep Supabase Auth policies.

## Priority 1 status

- Exposure: **verified current at grant level for 20 tables; verified row-level exposure for 1 table (`document_walkthroughs`, 3 rows)**.
- Fix: **proposed, not applied.** Requires owner approval (production change).
