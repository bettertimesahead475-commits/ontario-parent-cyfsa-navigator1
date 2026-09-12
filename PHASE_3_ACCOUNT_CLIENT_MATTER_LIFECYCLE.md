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

Ready for code review as a backend lifecycle milestone, not production-release
approval. Isolated PostgreSQL/RLS and real transaction/concurrency validation remain
outstanding; no database, migration, Vercel, production, or remote-branch mutation
was performed. This implementation branch has not been pushed.
