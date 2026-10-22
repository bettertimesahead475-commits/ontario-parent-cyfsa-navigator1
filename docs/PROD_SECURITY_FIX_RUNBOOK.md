# Production Security Fix Runbook (minimal, independent)

**Status:** prepared and tested on a disposable PostgreSQL 16 database. **Not executed against production.** Requires explicit owner approval, recorded in writing, before any step below touches production.

**What this fix is:** revoke direct table and sequence privileges from the `anon` and `authenticated` API roles. It changes grants only.

**What this fix is not:** it does not change RLS, policies, function definitions, data, application code, environment variables, or any feature flag. It does not depend on, and does not include, the feature upgrade PRs (#69 to #81) or the migration proposals. It is based on `main`.

## 1. Scope

### 1.1 Objects changed

| Object | Type | Before (observed, read-only) | After |
|---|---|---|---|
| 19 tables (listed in the script) | table | `anon`, `authenticated`: all 7 privileges | no privileges |
| `document_walkthroughs` | table | `anon`, `authenticated`: all 7 privileges | `anon`: SELECT only (intentional); `authenticated`: none |
| `navigator_matter_access_events_event_sequence_seq` | sequence | `anon`, `authenticated`: USAGE, SELECT, UPDATE | none |

Total: 20 tables and 1 sequence. The table list in `revoke_api_role_grants.sql` matches the production snapshot exactly (compared programmatically).

### 1.2 Not changed

- RLS enabled or disabled state, and all policies
- `service_role` privileges (the server's only database role)
- Schema `public` USAGE for `anon` (needed to resolve names; not a data exposure)
- Function EXECUTE (already none for `anon` and `authenticated`)
- Default privileges (see section 6; a separate, recommended follow-up)

### 1.3 Evidence (read-only checks, 2026-10-22, PostgreSQL 17.6)

| Check | Result |
|---|---|
| Table grants to `anon` / `authenticated` | 20 tables, all 7 privileges each |
| Grants to `PUBLIC` on public tables | None |
| Sequence privileges | 1 sequence; `anon` and `authenticated` hold USAGE, SELECT, UPDATE |
| Function EXECUTE for `anon` / `authenticated` | 0 of 14 functions |
| Function EXECUTE for `PUBLIC` | 0 of 14 (no `=X` entries in ACLs) |
| Schema `public` CREATE for `anon` / `authenticated` | No |
| Supabase advisor, GraphQL exposure | 20 tables visible to `anon`, 20 to `authenticated` (current) |
| Rows readable by `anon` | `document_walkthroughs`: 3 rows. Other tables: 0 (RLS hides rows where data exists). |
| Owner and security of the event-log writer | `record_matter_access_event` and `list_matter_access_events`: owner `postgres`, SECURITY DEFINER. Sequence owner `postgres`. |
| Supabase Auth users | 0 |

The sequence check was the one that previously failed. It now succeeded using a catalog query that does not mix sequence and table objects in one expression.

## 2. Why this is the minimum fix

- It removes the **destructive** path first. `TRUNCATE` is not restricted by RLS, so the `anon` key can empty every listed table today.
- It removes the **integrity** path for the audit sequence. `anon` and `authenticated` can call `setval`, which can cause collisions or reordering in the append-only event log.
- It changes nothing the server uses. The server reads and writes with `service_role` only.
- It is reversible with a script that restores the exact observed grants.

## 3. Dependencies and external consumers

### 3.1 What the repository shows (verified)

| Question | Result |
|---|---|
| Does browser code create a Supabase client? | No. No `createClient` in `src/`, no `VITE_SUPABASE_*` configuration. |
| How many Supabase clients does the server create? | One, in `api/services/access.ts`. Other `createClient` matches are unrelated local functions. |
| Which key does that client use? | Only a key whose JWT role is `service_role`, or an opaque `sb_secret_*` key. Anon and publishable keys are rejected. |
| Is there an anon-key fallback? | No. If no key is found, the client is not created. |
| Do any routes call PostgREST (`/rest/v1`) or GraphQL (`/graphql/v1`) directly? | No. |
| Do CI workflows, scripts, or `vercel.json` reference Supabase or anon keys? | No. |
| Repository dependency | `@supabase/supabase-js` (library only). |

### 3.2 Service-role environment variable (name check)

The application reads these names, in precedence order (`api/services/access.ts`):

1. `SUPABASE_SERVICE_ROLE_KEY` (primary; referenced in 31 places)
2. Keys matching `sb_secret_*_SERVICE_ROLE_KEY`, `sb_secret_*_SECRET_KEY`, or `SUPABASE_SECRET_KEY`
3. `SUPABASE_SERVICE_KEY` (legacy)

The Supabase URL is read from `SUPABASE_URL` (or `sb_secret_*_URL`).

**Production names: NOT VERIFIED.** The Vercel CLI is not installed in this environment, and the Vercel connector is disconnected. The owner must confirm, in the hosting dashboard, that `SUPABASE_SERVICE_ROLE_KEY` (or one of the fallback names) is set for the production environment. Name only; do not copy or print any value.

If none of these names is set in production, the server already cannot reach the database, and this change is not the cause. Confirm before approval anyway.

### 3.3 External consumers that cannot be verified from this repository

| Possible consumer | Can the repository see it? | Action |
|---|---|---|
| Supabase Edge Functions | No | Owner checks the Supabase dashboard for any deployed functions |
| Database webhooks and triggers that call external URLs | No | Owner checks the dashboard |
| Supabase dashboard integrations, saved queries, or scheduled jobs | No | Owner checks |
| Mobile app, script, spreadsheet, or third-party tool using the publishable key | No | Owner confirms none exists |
| Anyone who holds the publishable key outside the repository | No. Whether it was ever exposed is unknown (`PHASE_1_FINAL_SECURITY_GATE.md`). | This fix removes the destructive path either way. |

**If any of these exists, it will lose access when the grants are revoked.** That is the main reason the owner must confirm the list in section 5 before approval.

## 4. Preflight checklist (all items required before the change)

Each item is read-only unless marked otherwise. Record the result and the time.

| # | Check | Pass condition | Done by |
|---|---|---|---|
| P1 | Owner written approval for this exact script | Recorded | Owner |
| P2 | Owner has confirmed section 3.3 (no external consumers) | Recorded | Owner |
| P3 | Owner has confirmed `document_walkthroughs` is intended public content | Recorded | Owner |
| P4 | Production service-role variable name confirmed (name only) | Recorded | Owner |
| P5 | Fresh grant snapshot taken (same queries as section 1.3), saved outside the repository | Matches section 1.3, or the procedure stops for re-review | Operator |
| P6 | Verify script run **before** the change (`revoke_api_role_grants.verify.sql`) | Shows the pre-change state: 21 rows with ok = false | Operator |
| P7 | Staging test run on an isolated Supabase branch (not the main staging database) | Test script passes on that branch | Operator, with approval |
| P8 | Low-traffic window chosen; on-call contact available for 60 minutes after | Recorded | Owner |
| P9 | Rollback script reviewed and ready to run | Reviewed | Operator |
| P10 | Log monitoring for `permission denied`, `401`, `403`, and key errors enabled | Confirmed | Owner |

Do not start step 5 until P1 to P10 are recorded.

## 5. Procedure

### 5.1 Apply

1. Run `revoke_api_role_grants.sql` as a single transaction. It has `begin` and `commit`. If any statement errors, the whole transaction rolls back.
2. Record the time and the transaction result.

### 5.2 Verify (read-only)

3. Run `revoke_api_role_grants.verify.sql`.
   - **Pass:** 21 rows, every `ok` true. No `unexpected_grantee` rows.
   - **Fail:** any row with `ok` false, or any `unexpected_grantee` row. Go to section 7.

### 5.3 Smoke test (read-only, no production writes)

4. Use the owner's existing health or read-only route, if one exists, to confirm the server still reaches the database with its service-role key. **Do not create test data in production.**
5. Watch the logs for 60 minutes (P10). Expected: no new `permission denied` or key errors from the database layer.

## 6. Recommended follow-up (separate approval)

`prod_default_privileges.sql` changes default privileges for **tables and sequences** created by the `postgres` role, so future objects are not granted to `anon` and `authenticated` automatically. It was tested locally (PostgreSQL 16) and its rollback restores the observed defaults.

**Not included:** default EXECUTE on functions. Production functions currently grant no EXECUTE to `PUBLIC`, `anon`, or `authenticated`. Whether **new** functions inherit `PUBLIC` EXECUTE on PostgreSQL 17 could not be reproduced locally. Check it on a PostgreSQL 17 staging branch before changing function defaults.

**Also outside this repository's control:** the default-ACL rows for `supabase_admin` (schemas `public`, `graphql`, `graphql_public`, `realtime`, `auth`, `extensions`). The `postgres` role cannot alter those. Supabase support or the owner must handle them if the owner wants the same guarantee there.

## 7. Failure recovery

### 7.1 When to roll back

Roll back immediately if any of these occur after step 5.1:

- `verify.sql` shows an unexpected state that the procedure cannot explain.
- Server logs show database `permission denied` errors that began at the change time and affect a path the owner expects to work.
- Any user-visible failure on a flow that the owner confirms uses the database.

### 7.2 Rollback

1. Run `revoke_api_role_grants.rollback.sql` as a single transaction.
2. Run `revoke_api_role_grants.verify.sql`, and compare against the snapshot taken at P5. The rollback restores the observed state; verify should now show the original grants.
3. Confirm the failing path works again.

The rollback changes grants only. It does not change data, RLS, policies, or functions, so there is no data to restore.

### 7.3 Partial failure

- If the forward script fails mid-way, it is inside one transaction and nothing is committed. Re-check the snapshot.
- If the change committed and only the sequence step is the problem (for example, an event write fails with `permission denied for sequence`), restore only the sequence grant:

```sql
grant usage, select, update on sequence public.navigator_matter_access_events_event_sequence_seq to anon, authenticated;
```

Restoring the sequence grant alone reopens the sequence exposure, so do it only if the event path is blocked, and plan the fix for that path separately.

## 8. Tests performed

All on a disposable PostgreSQL 16 database. Supabase roles were simulated (`anon`, `authenticated`, `service_role`). Stub tables carry the observed default grants.

| Test | Script | Result |
|---|---|---|
| Before the fix: 20 tables and 1 sequence reproduce the observed grants | `revoke_api_role_grants.test.sh` | PASS |
| After the fix: anon has no TRUNCATE on any table; anon SELECT only on `document_walkthroughs`; authenticated has no table SELECT; sequence has no API-role privileges | same | PASS |
| `verify.sql` after the fix: 21 of 21 objects in the expected state, no unexpected grantees | same | PASS |
| Mechanism: the SECURITY DEFINER writer still inserts with the identity sequence after the revoke; anon cannot call `nextval`, authenticated cannot call `setval`, anon cannot insert directly | `revoke_api_role_grants.mechanism.test.sql` | PASS (4 of 4) |
| Rollback restores the observed grants exactly | same | PASS |
| Default privileges: new tables and sequences are not granted to anon after the fix; rollback restores defaults | `prod_default_privileges.test.sh` | PASS |

**Not tested:**

- Real Supabase roles, JWTs, and PostgREST or GraphQL behaviour (PostgreSQL 16, simulated roles only)
- PostgreSQL 17 (production engine) default-ACL behaviour for functions
- The repository's `*.pg.test.ts` suites against this change (they run the migration chain, which this fix does not use)
- Production data or production traffic

## 9. Owner approval required

Before any step in section 5:

1. **Approve** `revoke_api_role_grants.sql` for production, with rollback `revoke_api_role_grants.rollback.sql`.
2. **Confirm** `document_walkthroughs` should remain publicly readable (`anon` SELECT).
3. **Confirm** no external consumer uses the anon or publishable key (section 3.3), after checking the Supabase dashboard for Edge Functions, webhooks, and integrations.
4. **Confirm** the production service-role variable name (section 3.2), name only.
5. **Schedule** the low-traffic window and name the on-call contact (P8).
6. **Approve** staging validation on an isolated Supabase branch (P7), if that has not already been done.

Separately, and not required for this fix:

7. **Decide** whether to approve `prod_default_privileges.sql` (tables and sequences) after the fix is applied.
8. **Decide** whether to test function defaults on a PostgreSQL 17 staging branch.

## 10. Go / no-go for the security fix

**GO for the security fix, conditional on:** owner approval (section 9, items 1 to 5), a passing staging run on an isolated branch (P7), and a fresh snapshot matching section 1.3 (P5).

**Why it is GO now:**

- The exposure is confirmed in production, read-only, and is severe: anon can truncate 20 tables and change the audit sequence.
- The fix is grants-only, reversible, and tested for the mechanism it depends on.
- The server does not use the anon key, so the fix does not change the server path.

**What keeps it from being an unconditional GO:**

- External consumers of the anon key cannot be verified from this repository (section 3.3).
- The production service-role variable name has not been verified (section 3.2).
- The sequence check was added after the first analysis, and the production-side result for it came from one read-only query.

Owner approval is the gate. Nothing in this runbook has been executed against production.

## 11. Relationship to other work

- The feature upgrade PRs (#69 to #81) and the migration proposals are **unchanged** by this runbook.
- `docs/PROD_PERMISSION_HARDENING.md` (in PR #81) predates the sequence finding. This runbook supersedes it for the production procedure. PR #81 has not been modified.
