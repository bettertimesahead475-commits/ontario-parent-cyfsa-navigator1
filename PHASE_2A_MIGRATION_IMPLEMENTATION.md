# Phase 2A Migration — Implementation

> **Phase 2 reconstruction status — 2026-09-11.** This document preserves reviewed historical planning/audit evidence from `37db0b03a54970f3b7ddc8089a85dabc4b1948b6`. Current local branch `split/phase-2-foundations` inherits verified security branch `split/phase-1-security` at `6dbcbfd1ef020d333adb59063f4d407b8d5b271e` and restores only the reviewed case/matter foundations and reset-button removal. Phase 1 document scope notices describe the parent security branch; case/matter APIs are present on this dependent branch. Historical 139-test evidence is not a fresh verification of this reconstruction. Account/client provisioning remains incomplete; matter-specific and isolated transaction coverage remain outstanding. All SQL artifacts are provenance only: preserve the obsolete case-migration warning and never execute or replay any migration in this split. No Phase 2B or Phase 3 implementation, push, merge, production change or deployment is authorized. PR #21 and original refs remain unchanged.


> **Historical snapshot — superseded for current status.** See [current closeout status](PHASE_1_SECURITY_VERIFICATION.md#current-closeout-status--2026-09-10) for the verified 139-test suite, applied migrations, actual PR scope and remaining blockers. Older counts, pending-approval claims, stateless-session descriptions and next-phase instructions below are historical, not current authorization. PR #21 remains draft. The obsolete eslint/Firebase configuration references in older handoff material do not describe the current tree.


**Type**: Migration-artifact creation + minimal, necessary application-code alignment. **No migration was applied to Supabase. No DDL was executed against production. No production database object was created, altered, or dropped. No legacy table was touched, modified, or renamed.**

**Builds on**: `PHASE_2A_MIGRATION_PRE_APPROVAL_AUDIT.md` (found the original migration collides with legacy `public.cases`/`public.documents`), `PHASE_2A_SCHEMA_COLLISION_REMEDIATION.md` (designed the `navigator_*` replacement, recommendation `SAFE WITH CONDITIONS`), and `PHASE_2A_FINAL_MIGRATION_APPROVAL_AUDIT.md` (found no executable file existed yet implementing that design — `NO EXECUTABLE MIGRATION PRESENT`). This task closes exactly that gap.

---

## 1. New Migration Filename

`supabase/migrations_pending_approval/create_navigator_case_ownership_foundation.sql`

This is a **new, standalone file**. It does not overwrite, rewrite, or delete the original.

---

## 2. Why the Old Migration Is Obsolete

`supabase/migrations_pending_approval/create_case_ownership_foundation.sql` creates tables named `public.cases` and `public.documents`. Both names are already occupied in production by unrelated, incompatible legacy tables (confirmed live, read-only, across three prior audits) — `public.cases` has 6 inbound foreign keys from other legacy tables, `public.documents` has 1. Applying the old file would fail immediately with `relation "cases" already exists` / `relation "documents" already exists`. **It is left on disk, completely unmodified, per explicit instruction** — not deleted, not silently rewritten. Its obsolescence is documented in three places instead of by editing the file itself: (a) this document, (b) a prominent "OBSOLETE MIGRATION NOTICE" block inside the new migration file's own header comment, and (c) the three prior audit documents already in this repository's history.

---

## 3. New Table Names

| Old (colliding, obsolete) | New (this migration) |
|---|---|
| `public.cases` | `public.navigator_cases` |
| `public.case_members` | `public.navigator_case_members` |
| `public.documents` | `public.navigator_documents` |
| `public.document_versions` | `public.navigator_document_versions` |

**Live collision check performed immediately before writing the migration file** (read-only, this pass):
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'navigator_%';
-- result: zero rows
```
None of the four new names, nor `create_navigator_case_with_owner`, exist anywhere in the project today.

---

## 4. Security Model

- **RLS**: enabled on all four new tables, **zero** policies created — Postgres's default-deny behavior blocks `anon`/`authenticated` entirely; only `service_role` (this application's one and only Supabase access path, via `api/services/access.ts`'s `getSupabase()`) can read or write.
- **No `auth.uid()` anywhere** — this application authenticates exclusively via Firebase (`verifyFirebaseToken()`), never Supabase Auth, so `owner_uid`/`firebase_uid` are plain `text` columns holding Firebase uids, not `auth.uid()`-based policy expressions.
- **Defense-in-depth beyond RLS**: explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT SELECT, INSERT, UPDATE, DELETE ... TO service_role` on every table, plus the equivalent `REVOKE`/`GRANT EXECUTE` on the function — closing this project's default per-table privilege grant to `anon`/`authenticated` (confirmed live, in prior audits, to exist by default on new tables in this project) rather than relying on RLS as the sole barrier.
- **Legacy schema**: zero statements in the new migration reference, read, write, drop, alter, or rename `public.cases`, `public.documents`, or any other existing table. Verified by direct re-reading of the complete file in this pass — every `create table`, `alter table`, `create index`, `revoke`, `grant`, and `create function` statement names only the four new `navigator_*` objects (or, for `revoke`/`grant`, the well-known role keywords `public`/`anon`/`authenticated`/`service_role`).

---

## 5. Function Name and Design

`public.create_navigator_case_with_owner(p_owner_uid text, p_title text, p_description text default null) returns public.navigator_cases`

- `SECURITY INVOKER` (Postgres's default — no `SECURITY DEFINER` clause present).
- `SET search_path = public, pg_temp` pinned explicitly on the function definition.
- Every table reference inside the body (`public.navigator_cases`, `public.navigator_case_members`) is fully schema-qualified.
- No dynamic SQL anywhere (`EXECUTE`/`format()`/string concatenation) — both `INSERT`s use plain, parameterized `VALUES (...)`.
- `role` is hardcoded to the literal `'OWNER'` inside the function body — the caller cannot influence it through this function's signature at all.
- `p_owner_uid` is the function's only source for both `navigator_cases.owner_uid` and `navigator_case_members.firebase_uid` — no separate, independently-controllable ownership argument exists.
- Both `INSERT`s execute inside one function invocation with no `EXCEPTION` block — an unhandled error in either statement aborts and rolls back the whole call (standard Postgres/plpgsql transactional behavior, additionally reinforced by PostgREST wrapping the whole RPC call in its own transaction).
- All IDs (`navigator_cases.id`, `navigator_case_members.id`) are server-generated via `gen_random_uuid()` table defaults — the function never accepts or uses a client-supplied ID.
- The function returns the full, newly-created `navigator_cases` row (matching what `api/services/cases.ts`'s `createCase()` already expects and maps via `mapCaseRow()` — no change needed to that mapping function).
- Does not touch `public.cases` or `public.documents` anywhere.
- **`p_description`** is a new, third parameter (not present in the originally-reviewed two-parameter design) added to match `navigator_cases.description`'s existence in the schema — it defaults to `NULL`, so the existing application code (which does not yet collect a description) continues to call this function with exactly the same two named arguments it always has (`p_owner_uid`, `p_title`); PostgREST's named-parameter RPC calling convention correctly applies the default for the omitted third parameter. No application-code change was needed to accommodate this.

---

## 6. Privilege Model (exact)

**Tables** (all four — `navigator_cases`, `navigator_case_members`, `navigator_documents`, `navigator_document_versions`):

| Grantee | Resulting privilege |
|---|---|
| `PUBLIC` | None (`REVOKE ALL ... FROM PUBLIC` — also removes any privilege `anon`/`authenticated` would otherwise inherit through `PUBLIC`) |
| `anon` | None (no direct grant exists; also explicitly named in the `REVOKE` for clarity/auditability, even though revoking from `PUBLIC` alone is sufficient) |
| `authenticated` | None (same reasoning) |
| `service_role` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` (explicitly granted) |

**Function** (`create_navigator_case_with_owner`):

| Grantee | Resulting privilege |
|---|---|
| `PUBLIC` / `anon` / `authenticated` | None (`REVOKE ALL ... FROM PUBLIC, anon, authenticated`) |
| `service_role` | `EXECUTE` (explicitly granted) |

**Role names verified live, immediately before writing the migration** (read-only, this pass):
```sql
select rolname from pg_roles where rolname in ('anon','authenticated','service_role','public');
-- result: authenticated, anon, service_role  (public is a keyword, not a pg_roles row — expected)
```

---

## 7. API Changes

**Files changed**: `api/services/cases.ts`, `api/services/cases.test.ts`. **No change** to `api/_server.ts` — the `POST /api/cases` route never references a table or function name directly; it only calls `createCase(identity.uid, trimmedTitle)`, an abstraction fully encapsulating the RPC name inside `cases.ts`.

**Exact change in `api/services/cases.ts`**: the single `db.rpc("create_case_with_owner", {...})` call is now `db.rpc("create_navigator_case_with_owner", {...})`, with the same two named arguments (`p_owner_uid`, `p_title`) as before — `p_description` is simply omitted, relying on the function's own `DEFAULT NULL`. Accompanying comments updated to reference the new migration filename and function name. No other line changed; `mapCaseRow()` is untouched (the new table's column names are identical to the old design's).

**Exact change in `api/services/cases.test.ts`**: the fake `rpc()` double's guard clause (`if (fn !== "create_case_with_owner")`) now checks for `"create_navigator_case_with_owner"`, matching the real code. One comment updated to match. No test assertion, expected value, or test case was added, removed, or weakened.

**Security behavior re-confirmed unchanged** (re-read directly from the current, now-updated files in this pass):
- `POST /api/cases` still authenticates via `verifyFirebaseToken(req.header("authorization"))` before anything else.
- Ownership still comes exclusively from `identity.uid`.
- The route still destructures only `{ title }` from `req.body` — `ownerUid`, `uid`, `userId`, `role`, and `id` are still simply never read anywhere in the handler.
- The OWNER membership is still created server-side, inside the atomic function, never by any client-supplied value.
- Error handling is still generic (`"Failed to create case. Please try again."`) — unaffected by the RPC name change.
- Rate limiting is still inherited from the existing global `apiLimiter` (`app.use('/api', apiLimiter)`) — untouched.

---

## 8. Test Results

```
npm test
 Test Files  4 passed (4)
      Tests  98 passed (98)
```
(Unchanged count from before this change — the two modified tests still pass under their updated assertions; no test was added, removed, or weakened; no unrelated test was touched.)

```
npx tsc --noEmit
(clean, 0 errors)
```

```
npm run build
✓ built in ~8s (same pre-existing heic2any chunk-size warning, unrelated)
dist/server.cjs   113.0kb
```

All three were run **after** the application-code change, confirming it compiles, typechecks, and does not regress any existing behavior.

---

## 9. Static SQL Validation (no execution, no live database)

**No local Supabase/Postgres test environment exists in this session** — this is stated explicitly, not glossed over, per the task's own instruction. `psql` is present on this machine but there is no local Postgres server to connect it to, and connecting it to the production project would itself constitute executing DDL against production, which this task explicitly forbids. No offline SQL-parsing tool (e.g. `sqlfluff`, a Node SQL-parser package) is installed in this project's `node_modules` or on the system. Rather than fabricate a validation tool that doesn't exist, the following **manual, textual static review** was performed directly against the finished file:

- **Statement termination**: every DDL/DML-adjacent statement ends with a semicolon; none are left unterminated.
- **Balanced delimiters**: every `(` has a matching `)`; the function body's `$$ ... $$` dollar-quoting is opened and closed exactly once, correctly.
- **Object-name uniqueness**: every `CREATE TABLE`, `CREATE INDEX`, and `CREATE FUNCTION` name in the file is unique within the file (no duplicate definitions).
- **Foreign-key target existence and ordering**: `navigator_case_members.case_id` and `navigator_documents.case_id` both reference `public.navigator_cases(id)`, defined earlier in the same file; `navigator_document_versions.document_id` references `public.navigator_documents(id)`, also defined earlier. No forward reference to an object not yet created at that point in the file.
- **Constraint syntax**: `CHECK` constraints use valid boolean expressions over columns that exist on their own table (`char_length(btrim(title))`, `version_number > 0`, `size_bytes >= 0`, `role in (...)`, `extraction_status in (...)`) — verified each references only columns declared in the same `CREATE TABLE` statement.
- **`COMMENT ON CONSTRAINT` risk found and fixed during this pass**: the `title` length/non-blank check was initially written as an unnamed, inline `CHECK`, which Postgres would auto-name via its `tablename_columnname_check` convention — this audit judged relying on that implicit convention (to then reference it in a `COMMENT ON CONSTRAINT ... IS ...` statement) as an avoidable, unverifiable-without-execution risk, and corrected it by giving the constraint an **explicit name** (`constraint navigator_cases_title_check check (...)`) directly in the table definition. This removes the risk entirely rather than merely flagging it — the `COMMENT ON CONSTRAINT` statement now references a name declared verbatim two lines above it in the same file, with no dependency on inferring a system-generated identifier.
- **Grants/revokes reference only real, live-verified role names** (`anon`, `authenticated`, `service_role`) and the `PUBLIC` keyword — no typo or invented role name.
- **Function signature consistency**: the `(text, text, text)` signature is used identically and correctly in the `CREATE FUNCTION` statement, the `COMMENT ON FUNCTION` statement, and both `REVOKE`/`GRANT` statements — a mismatched signature in any of these would cause Postgres to report "function does not exist" for that specific statement; all four were checked to match exactly.
- **Legacy-table non-interference**: a full-file text search for the literal strings `cases` and `documents` (without the `navigator_` prefix) confirms they appear only inside comments (explaining *why* the new names were chosen), never inside an executable statement.
- **Duplicate-object hazard**: re-confirmed live, immediately before finalizing this file, that none of the four table names or the function name currently exist (§3) — the file itself also does not attempt to create any object more than once.

**This review was not, and cannot be, a substitute for actually running the migration against a real Postgres instance** — it catches syntax and self-consistency errors, not runtime behavior (e.g., whether `gen_random_uuid()` is available without an explicit `pgcrypto`/`pgcrypto`-equivalent extension enabled in this specific project — already confirmed used successfully by other existing tables in this schema, e.g. `stale_payment_alerts.id`, so this is not a new risk, but is called out here as the kind of thing only a live apply can fully confirm).

---

## 10. Confirmation: No Production Migration Executed

No `CREATE`, `ALTER`, `DROP`, `INSERT`, `GRANT`, or `REVOKE` statement was executed against the live Supabase project during this task. The only database interaction performed was two read-only `SELECT`-shaped queries (`information_schema.tables`, `pg_roles`), both confirmed to be read-only by their own text, run to verify the collision-free naming and the exact role names before writing the file — not to apply anything.

## 11. Confirmation: Legacy Tables Untouched

`public.cases` and `public.documents` are not named in any executable statement in the new migration file, are not read from or written to by any application code changed in this task, and were not queried, altered, or otherwise interacted with beyond the read-only `information_schema.tables` collision check in §3, which only confirms the *new* `navigator_*` names don't exist — it does not touch the legacy tables at all.

---

## 12. Git

See the chat response accompanying this document for the exact branch, commit SHA, working-tree status, and confirmation of origin synchronization after this change was committed and pushed.

---

*This migration has not been applied. It is ready for a separate, future approval-and-execution audit — not authorized by this document.*
