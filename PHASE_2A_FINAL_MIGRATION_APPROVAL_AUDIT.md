# Phase 2A Final Migration Approval Audit

> **Historical snapshot — superseded for current status.** See [current closeout status](PHASE_1_SECURITY_VERIFICATION.md#current-closeout-status--2026-09-10) for the verified 139-test suite, applied migrations, actual PR scope and remaining blockers. Older counts, pending-approval claims, stateless-session descriptions and next-phase instructions below are historical, not current authorization. PR #21 remains draft. The obsolete eslint/Firebase configuration references in older handoff material do not describe the current tree.


**Type**: READ-ONLY FINAL APPROVAL AUDIT. No migration was applied. No DDL was executed. No production database object was created, altered, or dropped. No application code was modified. This is the only file created.

**Result of this audit, stated up front because it governs everything below**: **`NO EXECUTABLE MIGRATION PRESENT`.** The corrected `navigator_*` schema designed in `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` exists **only as a SQL code block embedded inside that markdown document** — no standalone, executable `.sql` file implementing it exists anywhere in this repository. `supabase/migrations_pending_approval/` contains exactly two files, and neither is the replacement: `enable_rls_free_usage_gmail_stale.sql` (already applied, Phase 1) and `create_case_ownership_foundation.sql`, which is still, verbatim, the **original, colliding** migration (`create table public.cases`, `create table public.documents`) that `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` already found cannot apply. Per this task's own explicit instruction for exactly this situation, this audit stops the SQL-execution-readiness review at that finding and does not fabricate one, and does not create the missing file itself. Sections 3-9 and 11-14 below are answered against the **reviewed design as documented**, explicitly marked as design-review (not executable-artifact) findings, per this document's own structure requirements — they are not a substitute for auditing an actual file, because no such file exists to audit.

---

## 1. Git State

Verified fresh, independently, in this pass:

| Check | Result |
|---|---|
| Branch | `phase-1.5-security-remediation` |
| HEAD SHA | `0e3000afe9fb8cbd9ee3a4950ea3d13fe51ef29c` |
| Working tree | Clean (`git status --short` empty) |
| Origin synchronization | `git log --oneline -1 origin/phase-1.5-security-remediation` returns the identical `0e3000a` |
| `main` state | `origin/main` HEAD is `760a0cf`; `git merge-base origin/main HEAD` returns that exact same SHA — `main` remains completely untouched, zero divergence introduced by this or any prior audit in this line of work |

Nothing was changed by this step.

---

## 2. Exact Migration Location

Searched, in this pass:
- `supabase/migrations_pending_approval/` — contains `enable_rls_free_usage_gmail_stale.sql` (unrelated, already-applied Phase 1 migration) and `create_case_ownership_foundation.sql`.
- `create_case_ownership_foundation.sql`'s actual current content was re-checked directly (`grep -n "create table public\."`) rather than assumed: it still reads `create table public.cases (...)`, `create table public.case_members (...)`, `create table public.documents (...)`, `create table public.document_versions (...)` — i.e., it is unmodified since the pre-approval audit found it colliding. It was **not** updated to the `navigator_*` names at any point.
- A repo-wide search for any other `.sql` file (`find . -name "*.sql" -not -path "*/node_modules/*"`) returns only those same two files. No third migration file exists.

**Conclusion**: `NO EXECUTABLE MIGRATION PRESENT` for the `navigator_*` design. The design exists, reviewed and sound (per `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md`), but only as prose/markdown content — it has not been materialized into a file this repository's own established workflow (`supabase/migrations_pending_approval/*.sql`, then Supabase MCP `apply_migration`) could actually execute. Per this task's instruction, no such file was created during this audit.

---

## 3. Exact SQL

There is no executable migration file to print verbatim in this section, because none exists (§2). For completeness and to avoid re-deriving it from memory, the SQL **as it currently exists only inside `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §10** is the design this audit's remaining sections evaluate — it is not reproduced a second time in this document; readers should treat that document's §10 as the authoritative current text of the reviewed design. **This distinction matters**: a block of SQL inside a markdown file is not a migration a future execution step can run — it must first be extracted into its own `.sql` file (see §14's execution plan, step 0, and §15).

---

## 4. Object Collision Audit

Re-verified live, in this pass (not assumed from the prior audit): `navigator_cases`, `navigator_case_members`, `navigator_documents`, `navigator_document_versions` still do not exist anywhere in `information_schema.tables` for the `public` schema — zero rows returned by a fresh query. No collision has newly appeared since the remediation design was written.

Reviewing the **design as documented** (not an executable file) against the collision/safety requirements:
- Creates only: `navigator_cases`, `navigator_case_members`, `navigator_documents`, `navigator_document_versions`, and one function, `create_navigator_case_with_owner(text, text)`. No other object is proposed.
- Does **not** `DROP`, `ALTER`, or `RENAME` `public.cases` or `public.documents` anywhere in the reviewed text — confirmed by re-reading `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §10 in full in this pass; every statement targets only `navigator_*`-prefixed names.
- Does **not** modify any legacy foreign key, legacy RLS policy, or legacy grant — no `ALTER TABLE public.cases`/`public.documents` statement of any kind appears in the reviewed design.
- **No new foreign key points at legacy `cases`/`documents`**: `navigator_case_members.case_id` and `navigator_documents.case_id` both reference `public.navigator_cases(id)`, never `public.cases(id)`; `navigator_document_versions.document_id` references `public.navigator_documents(id)`, never `public.documents(id)`. Verified by direct re-reading of each `references` clause in the design text.

**This section's finding is unchanged and reconfirmed: the design is collision-free and legacy-safe. The gap is not in the design's content — it is that the design has not been turned into an executable artifact (§2).**

---

## 5. Schema Audit

Reviewed against the design text (§3), not an executable file:

**`navigator_cases`**: UUID PK (`gen_random_uuid()`, server-generated) — present. `owner_uid text not null` — present. `title text not null check (char_length(title) <= 200)` — present (this is the DB-level length constraint this audit's predecessor recommended adding, and it is present in the reviewed design). `description text` (nullable) — present. `created_at`/`updated_at timestamptz not null default now()` — present. **Owner UID cannot be supplied by an untrusted client**: this is not a schema-level property at all — it is enforced entirely by the application layer (`identity.uid` from `verifyFirebaseToken()`, never a request-body field), confirmed again in §10 below; the schema itself has no mechanism to prevent a *direct, unauthenticated* database write from setting any `owner_uid` value, which is exactly why RLS/privilege restriction (§7/§8) is what actually closes that gap, not this column's definition. Index: `navigator_cases_owner_uid_idx` on `owner_uid` — present.

**`navigator_case_members`**: UUID PK — present. `case_id uuid not null references public.navigator_cases(id) on delete cascade` — present. `firebase_uid text not null` — present. `role text not null check (role in ('OWNER'))` — present, restricting to exactly `OWNER` today. `created_at` — present. `unique (case_id, firebase_uid)` — present. **FK behavior**: `ON DELETE CASCADE` to `navigator_cases` — see §6 for the acceptability assessment. **No accidental path to membership escalation**: the only way any row is ever inserted into this table (per the reviewed design and per `api/services/cases.ts`'s current, unrelated-but-informative pattern) is through `create_navigator_case_with_owner()`, which always inserts exactly one row with `role = 'OWNER'` for the same uid the case itself is being created for — there is no code path, in the design or in any adjacent application code reviewed, that could insert a row with a different uid than the case's own owner, so no escalation path exists in what's designed (none is designed to exist yet at all — Phase 2A intentionally has no invite/sharing feature).

**`navigator_documents`**: UUID PK — present. `case_id uuid not null references public.navigator_cases(id) on delete cascade` — present. `display_name text` (nullable) — present. `created_at`/`updated_at` — present. **No raw document body/content column** — confirmed; the column list contains nothing resembling file bytes, a URL, or extracted text.

**`navigator_document_versions`**: UUID PK — present. `document_id uuid not null references public.navigator_documents(id) on delete cascade` — present. `version_number integer not null check (version_number > 0)` — present (a sensible floor; see §11 for the concurrency caveat this does not, by itself, resolve). `original_filename text`, `mime_type text`, `file_size_bytes bigint` — all present, all nullable, all metadata-only. `content_hash text` (nullable) — present. `extraction_status text not null default 'pending' check (... 4 values ...)` — present. `unique (document_id, version_number)` — present. **No raw document body/content** — confirmed. **Sensible constraints on size/version values**: `version_number > 0` is present; `file_size_bytes` has no explicit upper-bound `CHECK` in the reviewed design — this is a minor, non-blocking observation (not previously flagged, worth noting): an application-supplied `file_size_bytes` is metadata describing a file, not a value the database itself needs to bound, since no raw content is ever stored here — flagged only for completeness, not as a blocking gap.

---

## 6. Foreign Keys and Deletion Behavior

| Relationship | Cascade behavior in the reviewed design | Assessment |
|---|---|---|
| `navigator_cases -> navigator_case_members` | `ON DELETE CASCADE` | Acceptable at this stage — a membership row has no independent meaning without its case. |
| `navigator_cases -> navigator_documents` | `ON DELETE CASCADE` | Acceptable at this stage, **conditionally** — see below. |
| `navigator_documents -> navigator_document_versions` | `ON DELETE CASCADE` | Acceptable — a version row has no independent meaning without its document. |

**Does a delete API currently exist that could accidentally trigger these cascades?** No. Confirmed by re-reading `api/_server.ts` and `api/services/cases.ts` in full in this pass: the only route implemented is `POST /api/cases` (create); there is no `DELETE /api/cases/:id` or equivalent anywhere in the current codebase, and no service function that issues a `DELETE` against any `navigator_*` (or legacy) table. The cascade behavior is therefore inert today — there is no way, through this application's existing code, to trigger it at all.

**Future requirement, stated explicitly per this task's instruction**: if `ON DELETE CASCADE` is retained (as this audit recommends, for the reasons already given in `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` §8 and reaffirmed in the remediation design), **any future case-deletion feature must receive its own, separate security review before implementation** — specifically to decide whether a hard cascade delete remains appropriate once real evidentiary content (documents, and in later phases, evidence items) can exist under a case, or whether a soft-delete gate (`navigator_cases.deleted_at`, as `PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md` §21 already recommends) should sit in front of it. This is not a defect in the current design — it is a correctly-scoped-out decision for a future phase, restated here as an explicit, named condition rather than left implicit.

---

## 7. RLS Audit

Reviewed against the design text: `alter table public.navigator_cases enable row level security;` and the identical statement for the other three tables — all four are present in the reviewed design, and no `create policy` statement of any kind appears anywhere in it. Specifically:
- **No `USING (true)` / `WITH CHECK (true)`** — none exist, because **zero** policies of any kind are created for any of the four tables.
- **Can the intended client roles (`anon`/`authenticated`) directly read or write case data?** Per RLS alone: no (deny-by-default, zero permissive policies). Per the reviewed design's *additional* explicit privilege revocation (§8): also no, at an earlier layer (the grant check), which is the correct defense-in-depth posture this task asked for.
- **No `auth.uid()` anywhere** — confirmed, the reviewed design uses `firebase_uid`/`owner_uid` as plain `text` columns throughout, never `auth.uid()`.
- **No Firebase/Supabase identity mismatch introduced** — since no policy references any identity function at all, there is no mismatch surface to introduce.
- **No client ownership policy** — confirmed, none exists.

This section's finding, evaluated against the design text, is that the RLS model is correct and complete **as designed**. It cannot be verified as *applied*, because it has not been applied (§2).

---

## 8. Privilege Audit

The reviewed design's exact privilege statements (from `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §10):

```sql
revoke all on public.navigator_cases from public, anon, authenticated;
grant select, insert, update, delete on public.navigator_cases to service_role;
-- (repeated identically for the other three tables)

revoke all on function public.create_navigator_case_with_owner(text, text) from public, anon, authenticated;
grant execute on function public.create_navigator_case_with_owner(text, text) to service_role;
```

**Resulting privilege model, stated exactly, not merely "RLS protects it"**:

| Grantee | Table privileges (all four tables) | Function `EXECUTE` |
|---|---|---|
| `PUBLIC` | None (explicitly revoked) | None (explicitly revoked) |
| `anon` | None (covered by the `PUBLIC` revoke; `anon` holds no direct grant either) | None |
| `authenticated` | None (same reasoning) | None |
| `service_role` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` (explicitly granted) | `EXECUTE` (explicitly granted) |

This is a real, additional, table/function-privilege-layer denial for `anon`/`authenticated` — **on top of** RLS, not instead of it. A direct `anon`/`authenticated` attempt against any of these tables would fail at the grant-check layer (`permission denied for table ...`) before RLS is ever evaluated, which is a cleaner, earlier, and more defense-in-depth-correct failure mode than relying on RLS's `USING`/`WITH CHECK` evaluation alone (which is what the *original*, pre-remediation migration relied on exclusively, per `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` §12's finding on the same issue).

**Is `service_role` a valid grant target for a table/function privilege in this Supabase environment?** **Yes, unconditionally and without qualification.** `service_role` is an ordinary Postgres role in every Supabase project (visible directly in this project's own `information_schema.role_table_grants` — every existing table in this schema, including `free_usage` and the legacy `cases`/`documents`, already carries an explicit `service_role` grant row, confirmed live in this and prior audits). There is no Supabase-specific restriction, special case, or platform limitation preventing a migration author from granting or revoking privileges to/from `service_role` exactly as this design proposes — it is standard, first-class Postgres `GRANT`/`REVOKE` behavior, already in continuous use throughout this exact project's existing schema. No limitation exists to report here.

**This section's finding, again evaluated against the design text**: the intended privilege model is correct, complete, and technically valid in this environment. It has not been verified as *actually applied*, because nothing has been applied.

---

## 9. Function Security Audit

`create_navigator_case_with_owner(p_owner_uid text, p_title text) returns public.navigator_cases`, reviewed against its text in `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §10:

- **`SECURITY INVOKER`**: confirmed present by the *absence* of a `SECURITY DEFINER` clause (Postgres's default).
- **`SET search_path` explicitly pinned**: confirmed — `set search_path = public, pg_temp` appears directly on the `CREATE FUNCTION` statement, addressing the one hardening gap the pre-approval audit flagged as missing from the original (unpinned) function.
- **Every table reference schema-qualified**: confirmed — `public.navigator_cases`, `public.navigator_case_members`, and the `declare new_case public.navigator_cases;` type reference are all fully qualified; no bare/unqualified identifier appears anywhere in the function body.
- **No dynamic SQL**: confirmed — both `INSERT` statements use plain, parameterized `VALUES (...)` clauses; no `EXECUTE`/`format()`/string concatenation anywhere.
- **No SQL injection surface**: follows directly from the above — `p_owner_uid`/`p_title` are only ever used as bound `plpgsql` parameters.
- **No caller-controlled role**: confirmed — the function hardcodes `'OWNER'` as a literal in the second `INSERT`; the caller cannot influence the `role` value at all through this function's two-parameter signature.
- **No caller-controlled ownership UID beyond the trusted API argument**: confirmed at the function level — `p_owner_uid` is the function's own single source for both the case's `owner_uid` and the membership's `firebase_uid`. Whether that argument itself is trustworthy is an application-layer property, not a function-level one — see §10, which confirms the one, sole caller (`api/services/cases.ts`) supplies only a server-verified `identity.uid` there.
- **Case INSERT and membership INSERT occur in one transaction; failure of either rolls back the other**: confirmed by the same reasoning as the pre-approval audit's §14 (unchanged in the reviewed redesign — the function body still contains exactly two `INSERT`s and no `EXCEPTION` block, so an unhandled error anywhere aborts the entire invocation; PostgREST additionally wraps the whole RPC call in its own transaction).
- **Generated IDs are server-side**: confirmed — `gen_random_uuid()` defaults on every table's primary key; the function never accepts or uses a client-supplied ID.
- **Function does not accidentally return sensitive database information**: confirmed by inspection — it returns exactly one `navigator_cases` row (`id`, `owner_uid`, `title`, `description`, `created_at`, `updated_at`), none of which is a secret or credential; no error detail, no other table's data, and no internal Postgres state is ever returned.
- **Cannot be called by `PUBLIC`/`anon`/`authenticated`**: confirmed by the explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated` in §8 — this is a genuine, explicit restriction in the reviewed design, not merely an assumption or an RLS-mediated side effect (unlike the *original* migration, which left this at Postgres's default `EXECUTE`-to-`PUBLIC` grant, per `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` §11).
- **Can be called by the intended server-side `service_role` path**: confirmed by the explicit `GRANT EXECUTE ... TO service_role` in the same block, and by §8's finding that `service_role` is a fully valid, unrestricted grant target in this environment.

**This section's finding, once more, is against the reviewed design text, not an executable, tested artifact.** The design is sound; it has not been created as a database object, so none of the above has been empirically exercised against a real Postgres instance.

---

## 10. API Alignment Audit

Re-read fresh, in this pass, directly from the current files on disk (not assumed from any prior report):

- **`api/services/cases.ts`** (current, unmodified): line 48 still reads `const { data, error } = await db.rpc("create_case_with_owner", { p_owner_uid: ownerUid, p_title: title });` — **this is the OLD function name**, matching the OLD, colliding migration, not the reviewed `navigator_*` redesign.
- **`api/services/cases.test.ts`** (current, unmodified): line 38's fake `rpc()` double still asserts `if (fn !== "create_case_with_owner")` — same OLD name.

**Determination**: the current application code has **not** been updated to call the new Phase 2A objects, and per this task's own explicit instruction, it was **not** modified during this audit either. This is expected and consistent — no prior task in this line of work has yet authorized or performed that code change; `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §15 listed it as a required condition for a *future* implementation step, not something already done.

**Exact files and exact conceptual changes still required** (not implemented here):
1. `api/services/cases.ts`, line 48: change the string literal `"create_case_with_owner"` to `"create_navigator_case_with_owner"`. No other line in this file needs to change — `mapCaseRow()`'s field mapping (`row.owner_uid`, `row.title`, etc.) is unaffected, since the reviewed `navigator_cases` table uses identical column names to the original design.
2. `api/services/cases.test.ts`, line 38 (and its surrounding comment referencing the old name): update the same string literal in the fake `rpc()` double's guard clause, so the test continues to exercise the real code path under its new name.
3. No change is required anywhere in `api/_server.ts` — reconfirmed in this pass, the `POST /api/cases` route never references a table or function name directly; it only calls `createCase(identity.uid, trimmedTitle)`, an abstraction that fully encapsulates the RPC name inside `cases.ts`.

**Spoofing-resistance re-confirmed, unchanged**: `POST /api/cases` (`api/_server.ts`) still authenticates via `verifyFirebaseToken(req.header("authorization"))`, still derives ownership exclusively from `identity.uid`, and still destructures only `{ title }` from `req.body` — `ownerUid`, `uid`, `userId`, `role`, and `id` are simply never read anywhere in the handler, confirmed by a direct re-read of the current route code in this pass. This property is independent of which table/function names the underlying service layer targets, and remains correct regardless of whether the §10.1/§10.2 changes above have been made yet.

---

## 11. Transaction/Concurrency Audit

- **Genuine atomicity of case + OWNER membership creation**: confirmed as designed, per §9 — a single `plpgsql` function body with no exception handler, itself wrapped in PostgREST's own per-request transaction. Unchanged in substance from the original design's already-correct atomicity strategy; only the object names differ.
- **Concurrent case creation** (two different users creating cases at the same time): no conflict is possible — each call generates its own independent `gen_random_uuid()` case ID and inserts an independent row; there is no shared resource being contended for.
- **Duplicate membership attempts**: prevented by `unique(case_id, firebase_uid)` on `navigator_case_members` — a second attempt to insert the same pair fails with a unique-constraint violation. Not reachable at all through `create_navigator_case_with_owner()` alone in Phase 2A (it always creates a brand-new case with a fresh ID before inserting its one membership row), but the constraint is correctly present for future phases where other code might insert into this table (e.g., an "invite a lawyer" feature).
- **Duplicate document versions**: prevented by `unique(document_id, version_number)` on `navigator_document_versions` — enforced, but see below for the allocation-strategy caveat.
- **UUID generation**: `gen_random_uuid()` on every table, server-side, cryptographically random, collision probability negligible — unchanged from the original, already-correct design.
- **Timestamp behavior**: `created_at`/`updated_at` both default to `now()` at row-creation time; as previously noted (`PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` §4), nothing in this design automatically refreshes `updated_at` on a future `UPDATE` — harmless today (no update path exists), a note for whenever an edit feature is built.

**`version_number` allocation — explicit determination, as requested**: **Yes, Phase 2B must implement a transaction-safe allocation strategy rather than a plain `SELECT MAX(version_number) + 1 FROM navigator_document_versions WHERE document_id = ...` followed by a separate `INSERT`.** That two-step read-then-write pattern has a genuine TOCTOU race under concurrent uploads for the same document: two near-simultaneous uploads could both read the same current max, both compute the same "next" number, and one of the two `INSERT`s would then fail on the `unique(document_id, version_number)` constraint — which is *safe* (no silent data corruption, the constraint catches it) but produces a **failed request** for one of the two legitimate, concurrent uploads, not a graceful outcome. Recommended strategies for Phase 2B to choose from (not implemented here, correctly out of this audit's scope): (a) retry-on-unique-violation (catch the constraint error and re-attempt with a freshly-computed next number), or (b) perform the max-and-insert inside its own dedicated Postgres function (mirroring `create_navigator_case_with_owner()`'s own pattern), which lets Postgres's row-level locking within one transaction serialize concurrent attempts for the same `document_id` correctly. This is a design note for a future phase, not a defect in the schema reviewed here — the `unique` constraint itself is correct and sufficient at the data-integrity level; only the *application-side allocation logic*, not yet written, needs to account for this.

---

## 12. Migration Ordering

Reviewed against the design text's statement order (§10 of the remediation document):

1. `CREATE TABLE navigator_cases` (no dependencies).
2. `CREATE INDEX` on `navigator_cases.owner_uid` (depends on step 1 — correctly ordered after it).
3. `CREATE TABLE navigator_case_members` (depends on `navigator_cases` existing, for its `FOREIGN KEY` — correctly ordered after step 1).
4. Its two indexes (depend on step 3 — correctly ordered after it).
5. `CREATE TABLE navigator_documents` (depends on `navigator_cases` — correctly ordered after step 1).
6. Its index (depends on step 5).
7. `CREATE TABLE navigator_document_versions` (depends on `navigator_documents` — correctly ordered after step 5).
8. Its two indexes (depend on step 7).
9. `ENABLE ROW LEVEL SECURITY` on all four tables (depends on all four tables existing — correctly ordered after steps 1-8).
10. `REVOKE`/`GRANT` on all four tables (depends on the tables existing — correctly ordered after steps 1-8; does not need to wait for RLS, but the reviewed design places it after, which is harmless either way since these are independent, orthogonal controls).
11. `CREATE FUNCTION create_navigator_case_with_owner` (depends on both `navigator_cases` and `navigator_case_members` existing, since its body references both — correctly ordered after steps 1-8).
12. `REVOKE`/`GRANT EXECUTE` on the function (depends on the function existing — correctly ordered after step 11).

**Every dependency is satisfied by an earlier statement in the reviewed design's own ordering.** No statement references an object that has not yet been created at that point in the file.

**Is it safe to run in a single transaction?** Yes, in principle — every statement here is ordinary DDL/DML-adjacent (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `REVOKE`/`GRANT`, `CREATE FUNCTION`), all of which are fully transactional in Postgres (none of these specific statement types requires running outside a transaction, unlike e.g. `CREATE INDEX CONCURRENTLY`, which does not appear anywhere in this design). Whether the *actual apply tool* used (the Supabase MCP `apply_migration`, per this repository's established pattern) wraps the whole file in one transaction is a property of that tool, not of this SQL — this audit notes the SQL itself imposes no obstacle to single-transaction application, without independently re-verifying the tool's own transactional behavior (already relied upon, without contradiction, in the already-applied Phase 1 RLS migration).

---

## 13. Rollback Audit

Reviewed against `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §11's rollback text:

```sql
drop function if exists public.create_navigator_case_with_owner(text, text);
drop table if exists public.navigator_document_versions;
drop table if exists public.navigator_documents;
drop table if exists public.navigator_case_members;
drop table if exists public.navigator_cases;
```

- **Affects only**: `navigator_cases`, `navigator_case_members`, `navigator_documents`, `navigator_document_versions`, and the one new function — confirmed, every statement names only these five objects.
- **Never touches**: `public.cases`, `public.documents`, or any other legacy table — confirmed by the complete absence of any legacy table name anywhere in the rollback text.
- **Dependency ordering**: children before parents (`document_versions` → `documents` → `case_members` → `cases`), which is correct and avoids relying on `ON DELETE CASCADE` firing implicitly at drop time.
- **Would rollback after real user data exists require a separate data-preservation decision?** **Yes, explicitly and unavoidably** — dropping `navigator_cases` destroys every case, membership, document, and document-version row in existence at that moment, with no automatic backup performed by the rollback script itself. This was already stated plainly in the remediation design (§11) and is reconfirmed, unchanged, here: an operator must independently decide whether to export/back up any real data **before** running this rollback, since the script performs no such step on its own, by design.

**This section's finding is again against reviewed text, not an executable, tested rollback** — it has never been run, because the migration it would undo has never been applied.

---

## 14. Future Execution Plan

**Not executed. This is the sequence a future, separately-authorized execution step should follow — after the §2 gap (no executable file) is first closed.**

0. **(Prerequisite, not part of the numbered sequence the task specified, but a genuine blocker)**: extract the reviewed SQL from `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` §10 into an actual, standalone file (e.g. replacing `supabase/migrations_pending_approval/create_case_ownership_foundation.sql`, or a new file with a name reflecting the `navigator_*` design), and update `api/services/cases.ts`/`cases.test.ts` per §10.1/§10.2 above, in the same reviewed change.
1. **Preflight collision check** — re-run `information_schema.tables`/`information_schema.routines` for the four `navigator_*` names and `create_navigator_case_with_owner`, immediately before applying, since time will have passed since this audit.
2. **Capture current schema state** — a snapshot of `information_schema.tables`/`pg_policies`/`role_table_grants` for the `public` schema, so any unexpected drift is detectable after the fact.
3. **Apply the exact, approved migration file** (from step 0) via the Supabase MCP `apply_migration` tool, matching this repository's established pattern.
4. **Verify tables** — confirm all four `navigator_*` tables now exist with the expected columns (a fresh `information_schema.columns` query).
5. **Verify RLS** — confirm `relrowsecurity = true` on all four.
6. **Verify policies** — confirm `pg_policies` returns zero rows for all four.
7. **Verify grants** — confirm `information_schema.role_table_grants` shows **no** `anon`/`authenticated` rows for any of the four tables, and exactly the expected `SELECT`/`INSERT`/`UPDATE`/`DELETE` rows for `service_role`.
8. **Verify function privileges** — confirm `information_schema.role_routine_grants` shows **no** `anon`/`authenticated`/`PUBLIC` row for `create_navigator_case_with_owner`, and exactly one `EXECUTE` row for `service_role`.
9. **Execute a controlled `service_role` smoke test** — a single, transactional (`BEGIN...ROLLBACK`) call to `create_navigator_case_with_owner('smoke-test-uid', 'Smoke Test')`, confirming one `navigator_cases` row and one matching `navigator_case_members` `OWNER` row are produced together, then rolled back, leaving no trace.
10. **Verify unauthorized access is blocked** — the full `anon`/`authenticated` × `SELECT`/`INSERT`/`UPDATE`/`DELETE` matrix and the unauthorized-function-execute test, exactly as specified in `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` §9's test plan (already written, ready to run against a real applied schema, not re-derived here).
11. **Run the application test suite** (`npm test`) — expect all pre-existing tests plus the two updated ones (§10.1/§10.2) to pass; expect no regression in any of the other 96 tests.
12. **Typecheck** (`npx tsc --noEmit`) — expect clean.
13. **Build** (`npm run build`) — expect success, same pre-existing chunk-size warning only.
14. **Inspect Git state** — confirm the code-change commit (step 0's application-code half) is the only application-code change, confirm `main` remains untouched, confirm the branch is still not merged.

**Explicit stop condition for the future execution step, restated as instructed**: if step 1, 4, 5, 6, 7, or 8 ever finds an object, policy, or grant that does not exactly match what this document and `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` describe — including, but not limited to, an object that already exists, a policy that exists where zero were expected, or a grant to `anon`/`authenticated` that the explicit `REVOKE` should have removed — **that future step must stop immediately, must not proceed to the next step, and must report the discrepancy rather than attempting to reconcile or work around it.**

---

## 15. Final Approval Decision

# DO NOT APPLY

**Reason, stated exactly**: there is no executable migration file for this audit to approve. `NO EXECUTABLE MIGRATION PRESENT` (§2) is not a defect in the reviewed design — every section above that evaluates the design's *content* (schema, RLS, privileges, function security, atomicity, rollback, API-alignment gap) finds it sound, complete, and a genuine improvement over the original colliding migration. But `SAFE TO APPLY` and `SAFE WITH CONDITIONS` both presuppose an actual artifact exists that a future step could execute, and this task's own criteria for `SAFE TO APPLY` explicitly require "there is an exact executable replacement migration" — which is false today. Using `SAFE WITH CONDITIONS` would risk implying a file exists that merely needs minor adjustment before running; that is not the situation. The honest, unambiguous verdict is `DO NOT APPLY`, with the single, specific, actionable blocker being: **no `.sql` file implementing the reviewed `navigator_*` design has been created yet** (§14, step 0). Once that file exists (and the two-line `cases.ts`/`cases.test.ts` update accompanies it, per §10), a fresh, subsequent approval pass against the actual file — not this document's evaluation of embedded markdown text — would be the correct next step, not a re-run of this same design review.

---

*This document was created fresh in this pass, as the only file created or modified. No migration was applied. No DDL was executed. No production database object was created, altered, or dropped. No application code was modified. `main` was not touched. Nothing was merged. Phase 2B was not started.*
