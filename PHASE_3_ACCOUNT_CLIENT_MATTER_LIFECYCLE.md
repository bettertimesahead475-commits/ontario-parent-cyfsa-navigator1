# Account → client → matter lifecycle

Base: `split/phase-2-foundations` at `ede4ad2bd905f9ea417e4b56f2d10de17671e4cf`.
Implementation branch: `phase-3-account-client-matter-lifecycle`.

## Implemented API

All routes require the existing revocation-aware Firebase verification and use the
existing service-role Supabase singleton. They are mounted behind the existing
server's CORS, request-size and rate-limit middleware. No browser-to-database
access, new identity system or client-controlled authorization has been added.

| Endpoint | Request | Result |
| --- | --- | --- |
| POST /api/account | No fields required; body fields ignored | 200 `{ account: { id, primaryRole, status } }` |
| POST /api/clients | `{ name }` | 201 `{ client: { id, name, createdAt, updatedAt } }` |
| POST /api/matters | `{ clientId, title, description? }` | 201 `{ matter }` |
| GET /api/matters/:matterId | UUID path parameter | 200 `{ matter }`, only for its owner |

Account creation/resolution also runs automatically during client and matter
creation. The UID and email come only from verified Firebase identity. New
accounts receive the server-selected `parent` role. `ON CONFLICT (firebase_uid)
DO NOTHING`, expressed through Supabase's conflict-ignore upsert, prevents duplicate
first-request accounts without overwriting existing profile, role or status.
Repeated account provisioning returns the same account. Reads of a matter never
provision an account. Suspended/deleted accounts are denied by these lifecycle
routes; this is not a change to the inherited paid-session or legacy case APIs.

Client names and matter titles are trimmed and limited to 1–200 characters.
Client/matter identifiers must be UUIDs. Descriptions may be absent/null or text
of up to 10,000 characters. Extra fields, including account/owner IDs, roles,
membership roles and created_by, are not forwarded to services or the database.

Clients use the existing `clients.account_id` model. Matter creation prechecks
client ownership and retains `create_navigator_matter_with_owner` for the atomic
matter/OWNER-membership insert and a second ownership check. Account provisioning
is independently committed and may remain after a later client/matter failure;
the whole multi-request lifecycle is not one transaction. Client and matter
creation are not retry-idempotent; only account provisioning is.

Matter reads require a matching `navigator_matters.account_id`, an OWNER
membership for that account, and ownership of the referenced client. No lawyer
or administrator bypass exists. Missing and foreign clients both return
404 `CLIENT_NOT_FOUND`; missing/inaccessible matters return 404 `MATTER_NOT_FOUND`.
This deliberately avoids exposing another account's record existence.

Only `LifecycleError` instances supply public error codes/messages. Arbitrary
database errors (including errors with statusCode fields) yield fixed operation
errors with HTTP 500. Authentication is inside the async error boundary. Logs
contain an operation code rather than tokens, request bodies or raw database
messages. Operational error tracing can be expanded separately with redaction.

## Schema and verification boundary

No new migration is required or created. The existing accounts unique constraint,
clients table, navigator_matters table, OWNER memberships and creation RPC provide
the needed contract. All six reviewed migration artifacts remain unchanged.
Their historical pending/unapplied headers do not supersede the applied ledger
inventory recorded in the reviewed closeout. No SQL is executed by this task.

`api/lifecycleRoutes.test.ts` runs real routes and services with a database
transport double and a Firebase-verifier double. It covers repeated/concurrent
provisioning, roles, inactive accounts, validation, cross-account creation/read
isolation, missing membership, ownership changes before the RPC, safe failures,
and simulated membership-insert rollback. Additional tests in `_server.test.ts`
verify the routes are actually mounted and require authentication.

The rollback test models the reviewed RPC's all-or-nothing contract; it does
**not** execute PostgreSQL or prove deployed RPC/RLS behavior. Real transaction,
concurrency and privilege checks in an explicitly isolated test database remain
a release gate. Account status is an application precheck, not a transactional
revocation barrier; concurrent administrative changes require separate hardening.

## Scope and remaining work

No existing UI exposes these routes, so no frontend redesign or unused client
plumbing was added. No list/update/delete, collaboration, document persistence,
page anchoring, evidence engine, payment changes or dependency upgrades are in
this milestone. Existing case routes remain unchanged.

Before page-anchored intelligence: validate this API against an isolated schema,
settle the document persistence/retention contract, and retain the previously
documented release gates for session exceptions, redemption recovery, legacy
tokens, dependency advisories and authenticated integration verification.

## Verification

- npm ci: passed (504 packages); existing Babel engine/deprecation warnings remain.
- npm run lint: passed, exit 0; TypeScript config unchanged.
- npm test: 183/183 passed across six files, including 44 added cases; no existing tests weakened.
- npm run build: passed (Vite and esbuild); existing large-chunk warning remains.
- npm audit: completed, exit 1; 10 moderate and 1 high vulnerability, unchanged from base (Nodemailer and uuid dependency chains). No audit fix ran.
- git diff --check: passed for this milestone's changes.
- Dependency files, tsconfig, frontend, inherited security services and all six SQL artifacts are unchanged from base.

The verification counts above describe the original lifecycle commit, before
the narrow security-hardening follow-up below.

## Narrow security hardening (pending database approval)

The shared JSON parser retains its 100mb cap. Only parser-originated failures on
lifecycle paths are normalized to fixed JSON messages: 400 invalid body, 413
oversized body, 415 unsupported encoding, or 500 unexpected parser failure.
No parser error objects, bodies or stacks are serialized. Existing CORS and rate
middleware remain ahead of the parser and unchanged; lifecycle application
errors retain their existing status/error handling.

GET /api/matters/:matterId retains all account, matter, OWNER and client prechecks,
then calls `read_navigator_owned_matter` using only the verified Firebase UID and
validated matter UUID. Only the RPC result is returned, never the prechecked row.
Missing/unavailable/failed RPCs fail closed; there is no compatibility fallback.
Deploying this application before separately approving and applying the pending
artifact would therefore make authorized matter reads fail with a safe 500.

`supabase/migrations_pending_approval/read_navigator_owned_matter.sql` is a new,
UNEXECUTED artifact. All previously applied artifacts remain unchanged. The new
function is VOLATILE, SECURITY INVOKER, with a pinned search_path and a five-second
lock timeout. EXECUTE is revoked from PUBLIC/anon/authenticated and granted only
to service_role. It does not accept a caller-selected account or role and does
not provision accounts or change table data, policies or table grants.

The authoritative operation locks account -> matter -> client -> membership with
FOR SHARE, checking active status, account ownership, client relationship and
OWNER role on the locked rows. These locks conflict with status/ownership/role
updates and deletion, including non-key updates. Revocation that wins the lock
first is observed after waiting (or the operation errors); revocation that loses
must wait for this transaction to finish. The final successful check is the
authorization linearization point. Locks last through transaction completion,
not HTTP delivery. Serialization failures, deadlocks and timeouts fail closed.

This is an atomic authorization-and-matter-read contract, NOT a reusable grant.
Future document retrieval must authorize and read protected data in one database
transaction; calling this RPC then fetching documents in another REST request is
unsafe. Document intelligence remains out of scope. Existing creation RPC/status
prechecks are unchanged; their concurrent administrative-write behavior remains
a separate creation-hardening concern and must not be described as fixed here.

The application tests model RPC acceptance/denial after successful prechecks,
including status, membership, role, account/client ownership and matter removal.
They prove fail-closed handling and authoritative data selection, NOT PostgreSQL
concurrency. Full-server tests cover malformed and genuinely oversized JSON,
valid JSON routing and unexpected downstream failures.

Disposable database release gate: load the reviewed prerequisites followed by
this pending artifact ONLY in a confirmed disposable environment. Verify function
creation, PostgREST result shape, active/foreign/missing/inconsistent fixtures and
anon/authenticated EXECUTE denial. With two connections, hold an uncommitted
revocation UPDATE/DELETE on each protected row, invoke the RPC, commit the writer,
and verify denial. Reverse the order: hold the successful RPC transaction open,
attempt each revocation and verify it blocks until the reader commits. Verify
lock timeout and serialization/deadlock failures never return matter data. Use
consistent lock ordering for multi-row administrative operations. No unit test
substitutes for this gate. Do not disable production constraints to create wrong
role fixtures; confirm the existing OWNER-only constraint rejects invalid roles.

Reliability follow-up: client and matter creation have no idempotency key. If a
creation commits but its HTTP response is lost, retrying can create another row.
No automatic retry or full idempotency implementation is added in this change.

Hardening verification: 195/195 tests passed across six files (12 added; original
183 retained), lint/typecheck exit 0, build exit 0 with the existing chunk warning,
and npm audit exit 1 with 10 moderate / 1 high advisories. No dependency fix ran.
The initial sandbox typecheck failed with Node EPERM resolving C:\Users\User;
the successful verification ran outside that filesystem restriction. Diff checks
passed. No SQL was executed; transaction and privilege behavior remain unverified
until the disposable-database gate above is completed.

Ready for code review as a backend lifecycle milestone, not production-release
approval. Isolated PostgreSQL/RLS and real transaction/concurrency validation remain
outstanding; no database, migration, Vercel, production, or remote-branch mutation
was performed. This implementation branch has not been pushed.
