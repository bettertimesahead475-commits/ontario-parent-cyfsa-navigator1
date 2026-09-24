# Stage 10 slice 2: append-only matter access event log (foundation)

Date: 2026-09-24. Branch: `claude/stage-10-access-event-log`, stacked on the Stage 10 slice 1 candidate `97ec949`
(PR #26). It contains no Stage 7B remediation (PR #27) and no Form 33B.1 or Stage 9 history.

## Roadmap authority and why this slice

- `HANDOFF.md` §9 names Stage 10 **Firm Collaboration / Permissions / Audit**. `STAGE_9_ROADMAP_DECISION.md`
  assigns "audit workflows" to Stage 10 and records that no firm/team contract has been adopted.
- At the Stage 7B baseline, `revokeProfessionalGrant` carried an explicit placeholder to "record audit event" once
  "a dedicated table" existed. No such table existed.
- Slice 1 (`STAGE_10_PARALLEL_ACCESS_AUDIT.md`) listed the append-only access log as the missing piece. Its report
  can only reconstruct the **current** state; it cannot say who did what, and when.

This slice builds that historical trail's **foundation**. It adopts no firm/team model.

## Two distinct concepts, kept separate

| | Slice 1: access report (`matterAccessAudit.ts`) | Slice 2: event log (`matterAccessEvents.ts`) |
|---|---|---|
| Question answered | Who can open this matter **now**, and is the state consistent? | What access actions **happened**, by whom, when? |
| Source | Live grant and membership rows | Append-only `navigator_matter_access_events` |
| Mutable? | Reflects current rows | Never updated or deleted |

## Design

**Migration.** `supabase/migrations_pending_approval/create_navigator_matter_access_event_log.sql` is additive and
pending. It creates:
- `public.navigator_matter_access_events`, with RLS enabled, **zero** policies, and **no** table privileges for
  `anon`, `authenticated` or `service_role`.
- An append-only guard: a `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger. These refuse
  the operation for every role, including the table owner. Only a superuser disabling triggers can bypass them, which is
  outside the application's trust model.
- `record_matter_access_event(...)`: the **only** write path. It is `SECURITY DEFINER` with a pinned `search_path`, and
  only `service_role` may execute it.
- `list_matter_access_events(...)`: the **only** read path, with the same protections as the recorder.

**Event catalog.** Only events the current architecture actually supports:

| Event | Emitted by |
|---|---|
| `GRANT_CREATED`, `GRANT_ACCEPTED`, `GRANT_EXPIRED`, `GRANT_REVOKED` | Stage 7B invitation lifecycle |
| `REVIEWER_ACCESS_ADDED`, `REVIEWER_ACCESS_REMOVED` | Membership role transitions |
| `ACCESS_AUDIT_VIEWED` | Owner viewing the slice 1 report |

There is no "rejected" invitation event, because the application has no reject path. There is no general
access-denied logging either (see YELLOW). Outcomes are `SUCCEEDED` or `REFUSED`; a refusal must carry an `UPPER_SNAKE`
reason code.

**Trust boundary.**
- The recorder **derives** the actor account (from a server-verified Firebase uid), the actor's role on that matter at
  that moment, and `occurred_at`. None of these are parameters; a test asserts the exact parameter list.
- It verifies that the matter, subject account and grant exist, and that the grant belongs to that matter.
- CHECK constraints enforce each event's shape, e.g. grant events need a grant, and only `GRANT_EXPIRED` may be recorded
  by the system without an acting account.
- No route writes events. `recordMatterAccessEvent` is server-internal.

**Integrity.**
- `event_sequence` (an identity column) gives a total, stable order and is the paging cursor.
- An optional idempotency key per matter makes retries return the original event. Reusing a key for different content
  raises `IDEMPOTENCY_CONFLICT`. Both behaviors are proven under concurrency.

**Bounded refusals.** Identical `REFUSED` events (same matter, actor, type and reason) collapse to one row per rolling
hour, serialized with an advisory lock. Writing one needs an existing account and an existing matter, so neither an
anonymous caller nor a retrying caller can grow the log without limit.

**Privacy.** The table holds identifiers and fixed vocabularies only. There is no free-text, JSON or metadata column; a
test asserts the exact column list. No document content, allegation, child record, legal strategy or form answer can be
stored.

**Retention.** There are no foreign keys, deliberately: the log must not block or be cascaded by any future deletion.
Existence is verified at write time. The retention period and any erasure process are an owner/legal decision.

## Read authorization (least privilege)

| Reader | Result |
|---|---|
| Active matter OWNER | Every event on that matter (scope `MATTER`) |
| Active REVIEWER on the matter | Only events it performed or that are about it (scope `SELF`); never another reviewer's |
| Revoked professional (no membership) | `NOT_AUTHORIZED` |
| Unrelated account / owner of another matter | `NOT_AUTHORIZED` |
| Suspended account (even an OWNER row) | `NOT_AUTHORIZED` |
| Nonexistent matter | the same `NOT_AUTHORIZED` (no existence oracle) |
| Admin / system reader | Not provided; this needs a policy decision (YELLOW) |

Service mapping: `NOT_AUTHORIZED` → 403 `FORBIDDEN`. Page size is 1–200, ordered by sequence. The response is validated
field by field, and anything unrecognized fails closed.

## Route

`GET /api/matters/:matterId/access-events?after=&limit=` lives in `api/matterAccessEventRoutes.ts`. It is **not
mounted**, for the same reason as slice 1: `api/_server.ts` is shared with in-flight Stage 9 work. There is no write
route.

## Dependency map (updated)

| Component | Class | Why |
|---|---|---|
| Slice 1 access report + route | GREEN, done (PR #26) | — |
| Event log table, guards, recorder, reader, service, route | **GREEN, done (this slice)** | Depends only on frozen table schemas |
| Emit `GRANT_*` / `REVIEWER_ACCESS_*` from invite/accept/revoke | YELLOW | Those functions are being rewritten by PR #27. Integrate after its freeze, ideally inside the same database transaction as the state change. |
| Emit `ACCESS_AUDIT_VIEWED` from the slice 1 report | YELLOW | Needs a product decision on whether a failed audit write should block the owner's view |
| Mount both Stage 10 routes in `api/_server.ts` | YELLOW | Shared-file collision with Stage 9 |
| Owner / reviewer UI for access history | YELLOW | Needs mounted routes and `src/App.tsx` (shared) |
| Access-denied logging at request gates | YELLOW | Needs rate-limit and retention policy; the recorder already bounds refusals |
| Admin / compliance reader, retention and erasure policy | YELLOW | Owner/legal decision |
| Reviewer data-read logging (who viewed which record) | RED | Must cover Stage 9D research and form/work-product routes, which aren't final |
| Firm/team tenant model, firm-level delegation and permissions | RED | No roadmap contract |
| Firm-shared permissions on form drafts | RED | Depends on unfinished Form 33B.1 |

## Verification

- Real PostgreSQL 16 (`matterAccessEvents.pg.test.ts`, opt-in via `NAVIGATOR_PG_TEST_ADMIN_URL`, local hosts only,
  disposable database): 45 tests, stable over repeated runs.
- Mocked service and route tests: 51.
- Mutation testing: all 19 security-guard mutants are killed. This covers append-only (row and truncate), table
  privileges, actor derivation and verification, matter existence, grant cross-matter binding, reviewer read scope,
  suspended readers, read authorization, the read cross-matter filter, refusal bounding, idempotency content, the
  reason-code format, recorder EXECUTE, and the service's type, response, system-actor and reason validation.
- Not validated: a hosted Supabase project.
