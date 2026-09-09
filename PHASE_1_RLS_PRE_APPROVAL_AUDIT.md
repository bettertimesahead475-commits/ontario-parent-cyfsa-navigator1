# Phase 1 RLS Migration — Read-Only Pre-Approval Audit

**Scope of this document:** a read-only audit of one unapplied file, `supabase/migrations_pending_approval/enable_rls_free_usage_gmail_stale.sql`. No database was modified. No policy was created or altered. No migration was applied. `main` was not touched. This audit was performed on branch `phase-1.5-security-remediation` (HEAD `d027a00`), where the pending migration already lives.

**What was actually done to produce this report:** direct reads of the migration file and every application source file that touches the four tables in question; a repo-wide grep for all four table names with zero exceptions; and read-only SQL queries against the live Supabase project (`qboidsfpjuxeqtfotryj`) — `information_schema.columns`, `information_schema.table_constraints`, `information_schema.role_table_grants`, `pg_policies`, and `pg_class.relrowsecurity` — plus `SELECT count(*)` on all four tables. No `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`CREATE POLICY`/`DROP POLICY` statement was executed against the live database during this pass.

---

## 1. Executive Summary

The migration is **SAFE AS WRITTEN**, with one clarifying note (not a required change) on `submissions`. It does exactly what its own comments claim: it closes a real, freshly-re-confirmed hole (RLS is still disabled on `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, and `submissions`' one policy is still fully open — all four re-verified live, moments before this report was written) without touching the only access path the application actually uses. Every table this migration touches is either exclusively accessed server-side through a single `service_role` Supabase client, or — in `submissions`' case — accessed by *nothing in the application at all*. Enabling RLS with zero new policies, and dropping `submissions`' open policy with no replacement, both produce "deny anon/authenticated, unaffected service_role" — which is the correct model for all four tables under the application's current architecture.

**Recommended decision: `APPROVE`** (see §11 for the one clarifying note, which does not block approval).

---

## 2. Migration SQL (complete, verbatim)

```sql
-- ============================================================================
-- BLOCKED — PRODUCTION DATABASE CHANGE REQUIRES HUMAN APPROVAL
-- ============================================================================
-- This migration is NOT applied. It is prepared and reviewed, ready to run,
-- but withheld per the remediation task's Rule 4: no staging/development
-- Supabase project exists for this application (the only other two Supabase
-- projects on this account — "olaios-production" and "ontario-parent-defense"
-- — are unrelated products, not staging copies of this one), so this change
-- cannot be tested in a non-production environment first. Per Rule 4, that
-- means STOP and report BLOCKED rather than apply it unilaterally.
--
-- WHAT THIS FIXES (AUDIT.md Finding C-1, CRITICAL):
--   public.free_usage, public.gmail_processed_messages, and
--   public.stale_payment_alerts currently have Row-Level Security DISABLED,
--   with full SELECT/INSERT/UPDATE/DELETE/TRUNCATE grants to both the `anon`
--   and `authenticated` Postgres roles.
--
-- EMPIRICAL PROOF THIS IS LIVE, GATHERED DURING THIS REMEDIATION PASS
-- (2026-09-09, via Supabase's own SQL execution against the live project,
-- each wrapped in a transaction that was rolled back so no data was left
-- behind):
--   BEGIN; SET LOCAL ROLE anon;
--     INSERT INTO public.free_usage (uid, email, analyses_used)
--       VALUES ('audit-test-anon-uid', 'audit-test-anon@example.invalid', 999)
--       RETURNING ...;
--   ROLLBACK;
--   -- Result: INSERT SUCCEEDED as `anon`.
--   -- Same result, separately, as `authenticated`.
-- free_usage contains 0 rows in production today (confirmed via a
-- service-role COUNT immediately before this test), so no existing parent
-- data was read or exposed by this proof — but the write path is real and
-- was proven, not assumed.
--
-- WHY THIS FIX IS BELIEVED SAFE TO APPLY (for the human reviewing this):
--   - The application's ENTIRE Supabase access path uses the service_role
--     key exclusively (api/services/access.ts, usage.ts, gmailAgent.ts) —
--     confirmed by `grep -rl "supabase" src/` returning zero matches, i.e.
--     the frontend never talks to Supabase directly and no anon/publishable
--     key is ever used by this app's own code.
--   - service_role bypasses Row-Level Security entirely, by Postgres/
--     Supabase design — enabling RLS here does not change anything the
--     running application actually does.
--   - No new policies are added for anon/authenticated below (see rationale
--     inline) — the desired outcome is "deny all access to these three
--     tables for every role except service_role," which is exactly what
--     `ENABLE ROW LEVEL SECURITY` with zero policies produces.
--   - This is trivially reversible: `ALTER TABLE ... DISABLE ROW LEVEL
--     SECURITY;` restores the exact prior state in one statement.
--
-- TO APPLY (after human approval), run via the Supabase MCP `apply_migration`
-- tool or the Supabase SQL editor, against project qboidsfpjuxeqtfotryj:
-- ============================================================================

alter table public.free_usage enable row level security;
alter table public.gmail_processed_messages enable row level security;
alter table public.stale_payment_alerts enable row level security;

-- No policies are added intentionally: the only role that should ever touch
-- these three tables is service_role, which bypasses RLS regardless of
-- policy count. Leaving zero policies means anon/authenticated are denied by
-- default, which is the correct outcome. If a future feature ever needs
-- authenticated end users to read their own free_usage row directly (e.g. a
-- future client-side Supabase integration), add a scoped policy such as:
--   create policy "free_usage_own_read" on public.free_usage
--     for select using (auth.uid()::text = uid);
-- at that time — do not add it speculatively now.

-- ============================================================================
-- POST-APPLY VERIFICATION (run these after applying, expect the results shown):
-- ============================================================================
-- begin;
--   set local role anon;
--   insert into public.free_usage (uid, email, analyses_used)
--     values ('post-fix-test', 'post-fix-test@example.invalid', 1);
--   -- EXPECTED: ERROR - new row violates row-level security policy
-- rollback;
--
-- -- Confirm the app's real access path still works (service_role bypasses
-- -- RLS unconditionally, so this should need no code change at all, but
-- -- worth re-running the app's own test suite against a real Supabase call
-- -- once this is live, not just trusting that bypass exists):
-- -- `npm test` (api/services/access.test.ts, api/services/gmailAgent.test.ts)
--
-- ROLLBACK IF NEEDED:
--   alter table public.free_usage disable row level security;
--   alter table public.gmail_processed_messages disable row level security;
--   alter table public.stale_payment_alerts disable row level security;


-- ============================================================================
-- SECOND, SEPARATE FIX BUNDLED HERE (AUDIT.md Finding M-6, same BLOCKED
-- reason as above): public.submissions has RLS enabled but its one policy
-- ("Allow all operations") is `USING (true) WITH CHECK (true)` for every
-- command and every role - fully open by explicit policy, not by an
-- RLS-disabled oversight. Confirmed via the live pg_policies query during
-- this remediation pass. The table currently holds 0 rows and is not
-- referenced anywhere in api/ or src/ (confirmed by grep), so nothing is
-- exposed today - but this is a landmine if the table is ever reused without
-- fixing the policy first. Also BLOCKED pending human approval for the same
-- reason: no staging Supabase project exists to test against first.
-- ============================================================================

drop policy if exists "Allow all operations" on public.submissions;

-- No replacement policy is added intentionally, for the same reason as
-- free_usage/gmail_processed_messages/stale_payment_alerts above: this table
-- is not used by any current application code, so the correct default is
-- deny-all for anon/authenticated until a real feature needs it, at which
-- point a properly-scoped policy should be written for that specific need.

-- POST-APPLY VERIFICATION:
-- begin;
--   set local role anon;
--   select count(*) from public.submissions;
--   -- EXPECTED: 0 rows (or an RLS-denial-shaped empty result), never an error
--   -- and never any row anon shouldn't see - there are 0 rows today either way.
-- rollback;
--
-- ROLLBACK IF NEEDED (restores the exact prior, insecure policy):
--   create policy "Allow all operations" on public.submissions
--     for all using (true) with check (true);
```

---

## 3. `free_usage` — table-by-table analysis

**Live-reconfirmed schema** (via `information_schema`, moments before this report):

| column | type | nullable | default |
|---|---|---|---|
| `uid` (PK) | text | NO | — |
| `email` | text | YES | — |
| `analyses_used` | integer | NO | 0 |
| `first_analysis_at` | timestamptz | YES | — |
| `last_analysis_at` | timestamptz | YES | — |

1. **Table affected**: `public.free_usage`.
2. **RLS enabled today**: **NO** (`pg_class.relrowsecurity = false`, reconfirmed live).
3. **Policies created by this migration**: none. The migration only runs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
4. **Roles each policy applies to**: N/A — no policy is created.
5. **SELECT/INSERT/UPDATE/DELETE permitted by a policy**: none — with RLS enabled and zero policies, Postgres denies all DML for every role subject to RLS (i.e., every role except the table owner and roles with `BYPASSRLS`, which `service_role` has).
6. **`USING` conditions**: none exist (no policy).
7. **`WITH CHECK` conditions**: none exist (no policy).
8. **Does the (non-existent) policy rely on `auth.uid()`, email, admin secrets, service-role, or anything else?**: not applicable — there is no policy. Enforcement here comes entirely from RLS's default-deny behavior combined with `service_role`'s RLS-bypass privilege, not from any policy expression.
9. **Does this permit client-side access?**: No. After this migration, `anon` and `authenticated` get zero rows and zero successful writes. Before this migration (today), they get full CRUD — this was re-proven live during Phase 1.5 (see §2) and is the exact hole this migration closes.
10. **Could this accidentally lock out legitimate server-side application operations?** **No.** Verified two independent ways: (a) `getFreeUsage()`/`recordFreeUse()` in `api/services/usage.ts` are the *only* code in the entire repository that touches `free_usage` (confirmed by repo-wide grep — see §7), and both go through `getSupabase()` in `api/services/access.ts`, which constructs its client with `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY` — the `service_role` key. (b) `service_role` has `BYPASSRLS` on every Supabase project by design (this is Supabase's own documented security model, not an assumption specific to this project) — RLS being enabled or disabled is invisible to a `service_role` connection regardless of policy count. There is no code path anywhere in this repository that connects to Supabase as `anon` or `authenticated` (see §7/§8) — so there is no legitimate operation this migration could break.
11. **Could this still permit unauthorized access after the fix?** Only in one scenario, which is unrelated to this migration and already true today regardless of it: if `SUPABASE_SERVICE_ROLE_KEY` itself were ever exposed, RLS provides no protection against it (this is inherent to what the service_role key *is* — it is meant to be a trusted backend secret, and RLS is explicitly not a defense against its compromise). This migration does not increase or decrease that particular risk; it only closes the `anon`/`authenticated` hole, which is the hole this migration was written to close.

---

## 4. `gmail_processed_messages` — table-by-table analysis

**Live-reconfirmed schema**:

| column | type | nullable | default |
|---|---|---|---|
| `message_id` (PK) | text | NO | — |
| `processed_at` | timestamptz | NO | now() |
| `matched_reference` | text | YES | — |
| `outcome` | text | YES | — |
| `alerted_at` | timestamptz | YES | — |

1. **Table affected**: `public.gmail_processed_messages`.
2. **RLS enabled today**: **NO** (reconfirmed live).
3. **Policies created**: none (same `ENABLE ROW LEVEL SECURITY`-only pattern as `free_usage`).
4–7. Same as `free_usage` above: no policy exists, so no roles/operations/`USING`/`WITH CHECK` to describe — enforcement is RLS default-deny plus `service_role`'s bypass.
8. **Reliance on `auth.uid()`/email/admin secret/service-role**: enforcement is via `service_role`'s `BYPASSRLS`, not via any identity-based policy condition.
9. **Permits client-side access?** No, after the fix. Yes, today (full CRUD grant to `anon`/`authenticated`, confirmed by `information_schema.role_table_grants` during Phase 1.5 and unchanged as of this pass).
10. **Could this lock out legitimate server-side operations?** No. This table is written and read *exclusively* by `scanForPayments()` in `api/services/gmailAgent.ts` (dedup-checking a message via `.select("message_id").eq(...).maybeSingle()`, then `.insert(...)` with an outcome of `no_reference_found`, `no_amount_found`, `matched_pending_manual_approval`, or an error string). `scanForPayments()` is only ever invoked from `GET /api/admin/check-payments`, which requires either the `x-admin-secret` header or a Vercel-Cron-supplied `Authorization: Bearer <CRON_SECRET>` — there is no user-facing or client-side entry point to this table at all. It uses the same `getSupabase()` service_role client as everything else.
11. **Could unauthorized access remain possible?** Same caveat as `free_usage` (§3.11) — only via `service_role` key compromise, which this migration neither worsens nor is intended to address.

**Is this an internal backend-only table that should be completely inaccessible to normal client roles?** **Yes, unambiguously.** It has no user-identifying column (it's keyed on a Gmail message ID, not a parent/user identity), it records the operator's own payment-detection bookkeeping, and zero application code path reaches it from anything other than the admin/cron-gated scan.

---

## 5. `stale_payment_alerts` — table-by-table analysis

**Live-reconfirmed schema**:

| column | type | nullable | default |
|---|---|---|---|
| `id` (PK) | uuid | NO | gen_random_uuid() |
| `reference_number` | text | NO | — (has its own `UNIQUE` constraint, confirmed) |
| `alerted_at` | timestamptz | NO | now() |

1. **Table affected**: `public.stale_payment_alerts`.
2. **RLS enabled today**: **NO** (reconfirmed live).
3–7. Identical pattern to the two tables above: no policy is created; enforcement is RLS default-deny + `service_role` bypass.
8. Same as above — no identity-based policy condition; enforcement is role-bypass-based.
9. **Permits client-side access?** No, after the fix. Yes, today (full CRUD grant to `anon`/`authenticated`, reconfirmed live).
10. **Could this lock out legitimate server-side operations?** No. This table is touched only inside `checkStalePendingPayments()` in `api/services/gmailAgent.ts` — a `.select(...).eq(...)` dedup check (has this stale reference already been alerted?) followed by an `.insert({ reference_number })` once an alert email is actually sent. This function is only ever called from inside `scanForPayments()`, which (as above) is only reachable via the admin/cron-gated route. Same `getSupabase()` service_role client.
11. Same caveat as above — service_role-key compromise only, unrelated to this migration.

**Is this an internal backend-only table?** **Yes.** Its only purpose is deduplicating admin-alert emails about payments stuck in "pending" — a purely operational bookkeeping table with no user data and no legitimate reason for any client role to touch it.

---

## 6. `submissions` — dedicated audit (Step 4)

**Live-reconfirmed schema**:

| column | type | nullable | default |
|---|---|---|---|
| `id` (PK) | uuid | NO | gen_random_uuid() |
| `created_at` | timestamp (no tz) | YES | now() |
| `email` | text | YES | — |
| `content` | text | YES | — |
| `result` | text | YES | — |
| `approved` | boolean | YES | false |
| `payment_submitted` | boolean | YES | false |

**Current policy** (reconfirmed live, unchanged since Phase 1.5): one policy, `"Allow all operations"`, `cmd: ALL`, `roles: {public}` (i.e. every role, RLS-subject or not — though this is moot for `service_role`, which bypasses RLS regardless), `USING (true)`, `WITH CHECK (true)`. RLS itself **is** enabled on this table (`relrowsecurity = true`) — the exposure here is a wide-open *policy*, not a missing one. Table-level grants to `anon`/`authenticated` include full `SELECT`/`INSERT`/`UPDATE`/`DELETE` (reconfirmed live via `information_schema.role_table_grants`), so the open policy is fully "live" in the sense that nothing else is holding it back.

- **Why does this table exist?** Not documented anywhere in the current codebase or its migration history (`list_migrations` shows only `create_access_codes_table`, `access_codes_use_hash_not_plaintext`, `create_cyfsa_300rule_access_codes`, `add_free_tool_usage`, and `gmail_agent_admin_alerts` — no migration for `submissions` exists in this project's tracked migration history, meaning it predates whatever migration tracking started, or was created ad hoc outside a tracked migration). Its column shape — `email`, `content`, `result`, `approved`, `payment_submitted` — reads as an early prototype of exactly the "submit a document, get an AI result, then pay to unlock/approve it" flow the application eventually implemented differently (the current architecture never persists a submission or its AI result server-side at all — see `AUDIT.md` §6, reconfirmed unchanged in this pass). This is best characterized as a **legacy/orphaned prototype table from an earlier product iteration**, not as a component of any currently-designed feature.
- **Does the application currently use it?** **No.** A repo-wide grep for `submissions` (as a quoted table-name string, in any form) across every `.ts`/`.tsx` file returns **zero results**. This was re-verified fresh in this pass, not carried over from memory.
- **Does it contain user-submitted data?** It is *shaped* to hold user-submitted data (an `email` and free-text `content`/`result`), but it currently holds **zero rows** (reconfirmed live). So: shaped for it, but empty.
- **Can anonymous users currently read/write it?** **Yes** — confirmed live: `anon` has `SELECT`/`INSERT`/`UPDATE`/`DELETE` grants, and the one policy is `USING (true) WITH CHECK (true)`, so nothing blocks any of those operations for any role.
- **Can authenticated users currently read/write it?** **Yes**, identically to anonymous — the policy makes no distinction by role.
- **Can ownership be enforced?** Not today (the policy has no ownership condition), but the schema *could* support it later — `email` is a plausible ownership column if this table is ever revived, though it would need a proper `auth.uid()`-based or Firebase-verified-email-based policy rewritten from scratch, not a partial fix of the current one.
- **Should it be server-only?** Yes, under the current architecture — for the same reason as the three tables above: nothing in this application talks to Supabase except the one `service_role` client, so *every* table in this project should currently be server-only unless a specific feature needs otherwise, and no feature currently needs `submissions` to be anything else.
- **Should it be removed from the application/security model entirely if unused?** That is a legitimate question but **out of scope for this audit to answer** (the task instructs read-only analysis, and dropping a table is a data-destructive decision this audit is not authorized to recommend as an immediate action). What this audit *can* say: the migration under review does not drop or truncate `submissions` — it only removes the dangerously-open policy and adds no replacement, which is the correct minimal fix regardless of whether the table is kept, revived, or eventually dropped in a separate, explicit decision.

---

## 7. Application Usage Map (Step 2, full detail)

Every reference to the four tables found by a repo-wide `grep -rn` across `.ts`/`.tsx` files (comments included, to show there are no hidden references anywhere, not even in dead code or old comments referring to a different access path):

| Table | File | Function/Route | Operation | Client- or server-side | Key/credential used | Identity available at that point | Expected audience |
|---|---|---|---|---|---|---|---|
| `free_usage` | `api/services/usage.ts:15` | `getFreeUsage(uid)` | SELECT | Server | `service_role` (via `getSupabase()`) | Firebase `uid`, obtained from `verifyFirebaseToken()` in the calling route (`api/_server.ts:764-773`, inside `POST /api/analyze`) — **never** a client-supplied uid | Normal signed-in users, indirectly (they trigger this server-side call; they never touch the table directly) |
| `free_usage` | `api/services/usage.ts:29` | `recordFreeUse(uid, email)` | UPSERT (INSERT-or-UPDATE) | Server | `service_role` | Same as above, plus the verified `identity.email` | Same as above |
| `gmail_processed_messages` | `api/services/gmailAgent.ts:299` | `scanForPayments()` (dedup check) | SELECT | Server | `service_role` | None user-specific — keyed on a Gmail `message_id`, not a user | Backend-only; triggered by `GET /api/admin/check-payments` (admin-secret or cron-secret gated) |
| `gmail_processed_messages` | `api/services/gmailAgent.ts:320,334,369,387` | `scanForPayments()` (record outcome) | INSERT | Server | `service_role` | None user-specific | Backend-only, same trigger as above |
| `stale_payment_alerts` | `api/services/gmailAgent.ts:251` | `checkStalePendingPayments()` (dedup check) | SELECT | Server | `service_role` | None user-specific — keyed on a payment `reference_number` | Backend-only, same trigger chain |
| `stale_payment_alerts` | `api/services/gmailAgent.ts:272` | `checkStalePendingPayments()` (record alert) | INSERT | Server | `service_role` | None user-specific | Backend-only, same trigger chain |
| `submissions` | *(none found anywhere)* | — | — | — | — | — | **No application code references this table at all** |

All other matches from the grep (in `api/services/access.ts`, `usage.ts`, and `gmailAgent.ts`'s own comments, and in `api/services/gmailAgent.test.ts`'s mock fixtures) are either explanatory prose or unit-test mocks of the exact same functions listed above — they do not represent additional, distinct access paths. Test-file mocks (`gmailAgent.test.ts`) replace `getSupabase()` entirely with an in-memory fake and never touch a real Supabase project.

**Does any operation use the Supabase anon key?** No — zero occurrences anywhere in this repository (see §8).
**Does any operation use an authenticated user's Supabase JWT?** No — this application does not use Supabase Auth at all (it uses Firebase Auth for user identity, plus its own HMAC-signed session token for paid access — neither produces a Supabase-issued JWT).
**Does any operation use the service-role key?** Yes — every single operation on all three actively-used tables (`free_usage`, `gmail_processed_messages`, `stale_payment_alerts`) uses it, exclusively, via the one `getSupabase()` singleton.

---

## 8. Supabase Authentication/Access Model (Step 5)

- **Supabase client creation**: exactly **one** call to `createClient()` in the entire repository — `api/services/access.ts`, inside `getSupabase()`. Confirmed by a repo-wide grep for `createClient(` returning exactly one real call site (plus one comment describing it in `access.test.ts`, and one test-mock intercepting it).
- **Which key it uses (variable names only, no values reported)**: `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`, falling back to `process.env.SUPABASE_SERVICE_KEY` if the former is unset. Both of these are **service_role**-tier variables by name and by the code's own explicit comments — there is no code path that reads any anon/publishable-key-shaped environment variable anywhere in this repository (confirmed by grepping for `SUPABASE_ANON`, `SUPABASE_PUBLISHABLE`, `sb_publishable`, `VITE_SUPABASE`, `NEXT_PUBLIC_SUPABASE` across every `.ts`/`.tsx`/`.json`/`.env*` file — zero matches).
- **Server-side Supabase clients**: one (`getSupabase()` in `access.ts`), shared as a module-level singleton by every caller (`usage.ts`, `gmailAgent.ts`, and `access.ts` itself for `payments`/`access_codes`/`free_tool_usage`).
- **Browser/client-side Supabase clients**: **none exist.** `grep -rl "supabase" src/` (the entire frontend source tree) returns zero matches, and `@supabase/supabase-js` is imported in exactly two files in the whole repository — `api/services/access.ts` and `api/services/access.test.ts` (which mocks it).
- **Authentication/session handling actually used by this application**: Firebase Authentication (client-side Google sign-in via `src/utils/firebase.ts`, verified server-side via `firebase-admin` in `api/services/firebaseAdmin.ts`) for user identity, plus a separate, custom HMAC-SHA256-signed session token (`api/services/access.ts`, `issueSessionToken`/`verifySessionToken`) for paid-tier access. **Neither of these produces or requires a Supabase Auth session or JWT.** This is precisely why `payments`/`access_codes`/`free_tool_usage`'s existing `auth.uid() = ...`-style policies (documented in `AUDIT.md` §5) are effectively unreachable today: `auth.uid()` is a Supabase-Auth concept, and nothing in this application ever authenticates to Supabase as a Supabase Auth user.
- **Exact access path used by each affected table**: all four tables (`free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions`) are reachable, in principle, only through the one `service_role` `getSupabase()` client described above — `submissions` simply has zero code that actually does so. There is no other access path (no REST/GraphQL call from the frontend, no separate client construction, no anon-key usage) through which any of these four tables could be reached by this application's own code.

---

## 9. Security Risks

1. **Current, live risk (pre-migration, re-confirmed in this pass)**: `free_usage`, `gmail_processed_messages`, and `stale_payment_alerts` have RLS fully disabled with full CRUD grants to `anon`/`authenticated`; `submissions` has RLS enabled but a fully-open policy plus full CRUD grants to `anon`/`authenticated`. In all four cases, the only thing preventing exploitation today is that this application's own code never uses the Supabase anon/publishable key anywhere — the risk is entirely contingent on that key ever being obtained by a third party through some channel outside this application's own code (a future client-side integration mistake, a leak via another tool, or the key being treated as more sensitive than Supabase's own security model assumes it is). No such exposure was found anywhere in this repository during this audit or the Phase 1.5 pass that preceded it.
2. **Residual risk after the migration (unchanged by it, inherent to the architecture)**: `service_role` key compromise would still grant full access, since RLS never restricts `service_role`. This is true today and remains true after the migration — the migration does not increase this risk, and no available Postgres/Supabase mechanism (RLS included) mitigates a `service_role` key leak; that risk is managed by secret-storage practices (Vercel env vars), not by database policy.
3. **No policy-authoring risk in this specific migration**: because the migration adds *zero* new policies (it only flips `ENABLE ROW LEVEL SECURITY` and drops one existing open policy with no replacement), there is no new `USING`/`WITH CHECK` logic to get wrong, no `auth.uid()` type-mismatch risk, and no accidental over- or under-scoping to review. This materially lowers this migration's risk profile compared to a migration that *adds* new access-granting policies.
4. **Risk of NOT applying this migration**: the four tables remain exploitable by anyone who ever obtains the project's anon/publishable key, for as long as this stays unapplied — including the parent-identifying `email`/`uid` columns in `free_usage`, which double as a paywall-bypass vector if ever written to by an outside party.

---

## 10. Recommended Policy Model (Step 3)

| Table | Recommendation | Why |
|---|---|---|
| `free_usage` | **A — Server-only / service-role access** | Contains a per-parent free-tier counter keyed on a server-verified Firebase uid; every read/write in the entire codebase already goes through the one service-role client; no code path exists for a client to legitimately touch it directly. **`free_usage` should NOT be writable by `anon` or `authenticated` today** — the empirically-confirmed ability for either role to `INSERT` into it (proven live in the Phase 1.5 pass) is a straightforward paywall-bypass and PII-exposure vector with no corresponding legitimate use, since the application never authenticates end users to Supabase itself. |
| `gmail_processed_messages` | **A — Server-only / service-role access** (equivalently, could be labeled D — Admin-only, since its only trigger is admin/cron-gated, but the *database-level* model is identical: no `anon`/`authenticated` access of any kind) | Pure backend bookkeeping for the payment-detection agent; no user-identifying data; zero legitimate reason for any client role to reach it. |
| `stale_payment_alerts` | **A — Server-only / service-role access** (same admin/cron-only trigger chain as above) | Same reasoning as `gmail_processed_messages` — operational alert-dedup bookkeeping, no client-facing purpose. |
| `submissions` | **E — No application access / obsolete table** (today); if ever revived, it would need to move to **B — Authenticated user access with ownership policies**, built fresh rather than patched | Zero application code references it; its current wide-open policy is a leftover from what looks like an earlier, abandoned product design. Recommending "no application access" for its *current* state is not the same as recommending deletion — that is a separate, explicit decision this audit does not make (see §6). |

**Confirmed explicit answers to the questions this audit was specifically asked to resolve:**
- **Should `free_usage` be writable by `anon` or `authenticated`?** **No.** Nothing in the current architecture calls for it, and its current writability by both roles is the core of the Critical finding this migration fixes.
- **Are `gmail_processed_messages` and `stale_payment_alerts` internal backend tables that should be completely inaccessible to normal client roles?** **Yes, unambiguously, for both.**

---

## 11. Migration Safety Assessment (Step 6)

**Verdict: SAFE AS WRITTEN.**

Reasoning:
- It touches exactly the four tables this audit was asked to review, and no others.
- It adds **zero** new policies — the only DDL operations are `ENABLE ROW LEVEL SECURITY` (×3) and one `DROP POLICY IF EXISTS` (×1) — meaning there is no new access-control *logic* to get wrong, only a removal of existing over-broad access.
- Every currently-legitimate application code path was traced end-to-end (§7) and confirmed to use the `service_role` client exclusively, which is provably unaffected by either operation in this migration.
- The `DROP POLICY IF EXISTS` phrasing is itself defensively written — it will not error even if the policy has already been removed or renamed by the time this is applied, which matters given some time may pass between this audit and actual application.
- Both changes are correctly and specifically documented with their own exact rollback commands inline in the file, and those rollback commands were independently verified against this audit's own understanding of the current state (they restore exactly the state re-confirmed live in §3–§6 of this report).

**One clarifying note (not a required change, does not block approval):** the `submissions` fix's inline rollback comment (line 120-121 of the file) says restoring the old policy requires `create policy "Allow all operations" on public.submissions for all using (true) with check (true);` — this is correct and was independently verified to reproduce the exact current live policy definition (same name, same `cmd: ALL`, same `qual`/`with_check` of `true`/`true`). No change needed here; noted only so the reviewer has independent confirmation the rollback text is accurate, not just internally self-consistent.

**Is this migration INCOMPLETE?** In the narrow sense of "does it fully close the specific holes it names" — no, it is complete for that purpose. In a broader sense worth flagging to the reviewer: it does not address `payments`, `access_codes`, or `free_tool_usage`'s existing RLS policies (which rely on a Supabase-Auth `auth.uid()` model this application doesn't use — see §8) — but those three tables already have RLS *enabled* today (unlike the three this migration targets), and their policies, while built on an unreachable identity model, still correctly deny `anon`/`authenticated` in practice (since `auth.uid()` is always `NULL` for those roles under this application's actual usage, and `NULL = <anything>` is never true). That is a separate, lower-priority architectural observation already captured in `AUDIT.md` and `PHASE_1_SECURITY_VERIFICATION.md`, not a gap in *this* migration's stated scope.

**Should a rollback migration be prepared?** It already is — both fixes in this file carry their own exact, tested-against-current-state rollback SQL inline (lines 84-87 and 119-121). A separate rollback *file* is not necessary given how short and self-contained these commands are, but if the reviewer prefers a standalone rollback script for procedural reasons (e.g., to paste directly into an incident-response runbook without re-opening this file), that would be a trivial follow-up, not a prerequisite to approval.

---

## 12. Production/Staging Assessment (Step 7)

**Can this be safely tested without a dedicated staging Supabase project? Yes — via read-only, session-scoped role impersonation, exactly as this audit and the original Phase 1.5 pass both did.** Postgres's `SET LOCAL ROLE <role>` inside a transaction that ends in `ROLLBACK` lets you observe *exactly* what `anon`/`authenticated` can and cannot do under a proposed policy state, without a staging environment and without leaving any trace — this is how the original exploitability proof was gathered, and it is equally usable to verify the *post-fix* state before committing to it outside a transaction:

```sql
begin;
  alter table public.free_usage enable row level security;  -- test the change itself, transactionally
  set local role anon;
  insert into public.free_usage (uid, email, analyses_used)
    values ('staging-less-test', 'test@example.invalid', 1);
  -- observe: does this now fail with a row-level-security error?
rollback;  -- always rollback: the ALTER, the role change, and the insert attempt are all undone
```

This lets a reviewer empirically verify the fix *before* committing to it for real, entirely inside a single transaction against the production database, with **zero persisted change** regardless of outcome — no staging project is actually required for this specific kind of verification.

**If a fuller staging environment were still preferred**, the safest available procedure for applying this to production while preserving rollback capability, in order:
1. Run the transactional dry-run above (or equivalent `SET LOCAL ROLE` checks for each of the four tables) to confirm the expected before/after behavior one more time, immediately before applying for real.
2. Apply the migration exactly as written, via the Supabase MCP `apply_migration` tool (which records it as a named, tracked migration — visible later via `list_migrations` — unlike an ad hoc `execute_sql` call).
3. Immediately run the "POST-APPLY VERIFICATION" blocks already written into the migration file itself (§2) — both the `anon`-denied-insert check and a live run of `npm test` for `access.test.ts`/`gmailAgent.test.ts` (those tests are currently mocked and won't call the real database, so this step is really about confirming the *deployed application* still functions, e.g. by exercising `/api/analyze`'s free-tier path end-to-end once, not just re-running the existing unit tests).
4. Keep the exact rollback commands (already written inline in the migration file) on hand for the following few hours of normal traffic, in case anything unexpected surfaces.

**Nothing above was executed as a real, persisted change during this audit.** The transactional dry-run pattern shown above is offered as the recommended *future* verification step, not something this audit performed non-transactionally.

---

## 13. Exact Next Action Required

This audit is complete. The next action is **yours**: decide whether to authorize applying `supabase/migrations_pending_approval/enable_rls_free_usage_gmail_stale.sql` to the production Supabase project, exactly as written, via the Supabase MCP `apply_migration` tool (or the Supabase SQL editor). No code change, branch merge, or deployment is required or recommended as part of that decision — this migration is fully independent of the rest of the `phase-1.5-security-remediation` branch and could be applied on its own regardless of what happens to that branch/PR.

---

## Decision

**`APPROVE`**

This migration is safe as written for the application's current architecture: it adds no new access-granting logic, it correctly targets the four tables independently re-confirmed (via live queries in this pass, not assumption) to be over-exposed today, every legitimate application code path was traced end-to-end and confirmed immune to this change, and both fixes carry accurate, independently-verified inline rollback commands.
