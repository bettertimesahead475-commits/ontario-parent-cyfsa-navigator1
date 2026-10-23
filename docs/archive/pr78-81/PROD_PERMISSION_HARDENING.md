# Production Permission Hardening: Preparation Only

**Status:** prepared and tested on a disposable database. **Not executed against production.** Requires explicit owner approval.

**Scope of this change:** table grants only, for the `anon` and `authenticated` roles. No RLS, policy, data, code, or configuration change.

## 1. Evidence base

All production checks were read-only (`begin read only`, catalog or `information_schema` queries). No writes.

| Check | Result | Confidence |
|---|---|---|
| Table grants, `anon` and `authenticated`, all public tables | Exactly **20 tables**. Each role holds all seven privileges: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER. | Confirmed (read-only snapshot) |
| Grants to `PUBLIC` pseudo-role | None on public tables | Confirmed |
| Function EXECUTE for `anon`, `authenticated` | **0 of 14** public functions | Confirmed |
| Schema `public`: CREATE for `anon`, `authenticated` | No | Confirmed |
| Schema `public`: USAGE for `anon` | Yes (default; needed to resolve names; not changed) | Confirmed |
| Sequence privileges | **Not checked** (query failed on a catalog object; re-run needed before approval) | Gap |
| `anon` TRUNCATE on the 20 tables | Granted. RLS does not restrict TRUNCATE. | Confirmed |
| Rows visible to `anon` (under `set local role anon`) | Only `document_walkthroughs`: 3 rows | Confirmed |
| Supabase Auth users | 0 | Confirmed |

Snapshot taken at the time of this report. Re-take it immediately before any approved change.

## 2. Who uses these grants? (external dependency check)

**Result: no code path in this repository uses the `anon` or `authenticated` role.**

| Question | Finding |
|---|---|
| Does the browser bundle create a Supabase client? | No. `src/` contains no `createClient`, no `@supabase/supabase-js` import, and no `VITE_SUPABASE_*` configuration. |
| Which Supabase clients does the server create? | One: `api/services/access.ts:277`, using the key resolved by `resolveSupabaseCredentials`. (`clients.ts` and `lifecycleRoutes.ts` call a local function named `createClient`, not Supabase.) |
| Which keys can the server select? | Only keys whose JWT `role` is `service_role` (`isCandidateAcceptable`). Anon and publishable keys are rejected. |
| Is there an anon-key fallback? | No. If no service-role key is found, `key` is `null` and the call fails closed. |
| Do any server routes call PostgREST or GraphQL directly? | No (`/rest/v1` and `/graphql/v1` not referenced). |
| Phase 1 audit (existing) | Concludes every table is server-only. `PHASE_1_FINAL_SECURITY_GATE.md` line 228 confirms no code path uses the anon key. |

**Not checked from this repository (must be checked by the owner before approval):**

- Supabase Edge Functions, database webhooks, or Supabase dashboard integrations that might use the anon key. The repository can't see these.
- Any third-party tool, mobile app, script, or saved query that uses the publishable key.
- Whether the **production** environment defines a service-role key under the variable names the code reads. Verify by name only, in the hosting dashboard. Do not read or print values.

**Unknown risk:** `PHASE_1_FINAL_SECURITY_GATE.md` (line 469) lists as unknown whether the anon key has ever been exposed outside this repository. If it was exposed, the `TRUNCATE` grant is an active destructive risk. The fix below removes it either way.

## 3. Before and after privilege matrix

**Scope:** 20 tables. "Before" is the production snapshot in section 1. "After" is the state the forward script produces. RLS is unchanged in both states.

| Table | anon before | anon after | authenticated before | authenticated after |
|---|---|---|---|---|
| access_codes | 7 (all) | none | 7 (all) | none |
| analysis_results | 7 | none | 7 | none |
| audit_log | 7 | none | 7 | none |
| case_exports | 7 | none | 7 | none |
| cases | 7 | none | 7 | none |
| cyfsa_300rule_access_codes | 7 | none | 7 | none |
| **document_walkthroughs** | 7 | **SELECT only** | 7 | none |
| documents | 7 | none | 7 | none |
| free_tool_usage | 7 | none | 7 | none |
| free_usage | 7 | none | 7 | none |
| gmail_processed_messages | 7 | none | 7 | none |
| lawyer_leads | 7 | none | 7 | none |
| lawyer_profiles | 7 | none | 7 | none |
| parent_profiles | 7 | none | 7 | none |
| payments | 7 | none | 7 | none |
| reflection_conversations | 7 | none | 7 | none |
| stale_payment_alerts | 7 | none | 7 | none |
| submissions | 7 | none | 7 | none |
| timeline_events | 7 | none | 7 | none |
| users | 7 | none | 7 | none |

**Summary:** before, 40 role-table grants of 7 privileges each (280 privilege entries). After, 1 grant of 1 privilege (`anon` SELECT on `document_walkthroughs`). All write, TRUNCATE, REFERENCES, and TRIGGER privileges are removed. Unchanged: schema USAGE, function EXECUTE (already none), and RLS.

**Check against the script:** the 20 table names in `revoke_api_role_grants.sql` equal the 20 in the snapshot (compared programmatically, no differences).

## 4. Why `document_walkthroughs` keeps `anon` SELECT

- `AUDIT.md` describes it as static reference content (document-type explainers), and that RLS policy `walkthroughs_public` (`USING (true)`) is intentional.
- It has no user identifier column. Columns are: `id`, `document_type`, `title`, `what_it_is`, `what_it_should_contain`, `red_flags`, `parent_response_steps`, `legal_references`, `order_in_list`, `created_at`.
- A count-only check found zero rows matching email, phone, or case-number patterns. No row contents were printed or stored.
- No code in `api/`, `shared/`, or `src/` reads the table.

**Owner must confirm** the content is meant to be public before the SELECT grant is kept. If not, the forward script can be changed to revoke it too.

## 5. Reversible deployment procedure

Files (all in `supabase/proposals/`):

- `revoke_api_role_grants.sql` (forward)
- `revoke_api_role_grants.rollback.sql` (restores the observed ALL grants exactly)
- `revoke_api_role_grants.verify.sql` (read-only check, same logic used in tests)
- `revoke_api_role_grants.test.sh` (disposable-database test, passing)

**Preconditions (all required):**

1. Owner approval recorded for this exact change.
2. Owner confirms the three items in section 2 that are not verifiable from this repository.
3. Owner confirms the production service-role key is set under the name the code reads (name check only).
4. Fresh pre-change snapshot taken read-only. It must match section 1, or the procedure stops for re-review.
5. Staging run first (see `STAGING_TEST_PLAN.md`, section 4).

**Steps:**

| Step | Action | Who | Evidence |
|---|---|---|---|
| 1 | Take a fresh read-only snapshot of grants (section 1 queries) and save it | Owner or agent with approval | Saved snapshot file |
| 2 | Run `revoke_api_role_grants.verify.sql` before the change | Same | Expect 20 rows ok=false (confirms the starting state) |
| 3 | Apply `revoke_api_role_grants.sql` in a low-traffic window | Owner | Transaction committed |
| 4 | Run `verify.sql` | Same | Expect 20 rows ok=true, no unexpected grantees |
| 5 | Smoke test the server's database paths with a test account (login, matter list, report view). Owner approves the test account. | Owner | Pass/fail per path |
| 6 | Watch server logs for 60 minutes for `permission denied`, `401`, `403`, or Supabase key errors | Owner | Log review |
| 7 | If any step fails, apply the rollback (step R below) | Owner | Verify with the snapshot from step 1 |

**Rollback (step R):** apply `revoke_api_role_grants.rollback.sql`, then compare against the step 1 snapshot. The rollback restores all seven privileges on each table for both roles, which is the observed production state. It does not change data or RLS.

**Why this is safe to revert:** grants are catalog metadata. Applying or reverting them does not modify rows, RLS policies, or functions, and it takes only brief locks.

**What could break:** any code or integration that uses the `anon` or `authenticated` role directly. Section 2 found none in this repository. This is the main unverified risk, and it is why the owner check in precondition 2 is required.

## 6. Verification of the script (tested)

On a disposable PostgreSQL 16 database, with stub tables carrying the observed default ALL grants:

| Check | Result |
|---|---|
| Before revoke: 20 of 20 tables have anon TRUNCATE, SELECT, INSERT, auth SELECT | Matches production |
| Forward script: anon TRUNCATE on 0 tables; anon SELECT only on `document_walkthroughs`; authenticated SELECT on 0 | PASS |
| `verify.sql` after revoke: 20 rows ok=true, no unexpected grantees | PASS |
| `verify.sql` before revoke: 20 rows ok=false, 0 ok=true | PASS (the check discriminates) |
| Rollback: restores the 20 tables to the observed state | PASS |

**Not tested:** real Supabase roles and JWTs, PostgREST and GraphQL behaviour, and production data. The stubs have only an `id` column. The test uses PostgreSQL role semantics, which match Supabase's grant model.

## 7. Approval requests

1. **Approve the production revoke** (`revoke_api_role_grants.sql`), after the section 2 owner checks and staging validation.
2. **Confirm `document_walkthroughs` is intended public content.** If yes, keep the SELECT grant as written.
3. **Confirm no Supabase Edge Function, webhook, dashboard integration, mobile app, or external script uses the anon or publishable key** against this project.
4. **Confirm the production service-role key variable name** matches what the code reads.
5. **Approve a read-only sequence-privilege check** (not yet completed), so the matrix covers every grant type.
