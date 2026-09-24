# Stage 10 slice 6: lifecycle HTTP adapter (UNMOUNTED)

Date: 2026-09-24. Branch: `claude/stage-10-lifecycle-http-adapter`.

## Base

- **Slice 5:** starts from the frozen candidate `4dff367`.
  - `refs/tags/audit/stage-10-slice-5-access-integration-frozen` dereferences to `4dff367`.
- **Ancestors (verified):**
  - Stage 7B `a452c6c`
  - Stage 10 slices 1–4: `97ec949`, `621f634`, `08d751a`, `d94800c`

## What this slice is and is not

This slice adds the HTTP boundary for the three lifecycle operations that already exist in the frozen service
`api/services/professionalMatterAccess.ts` (contract v3):

| Service | Database | Route (defined, **not mounted**) |
|---|---|---|
| `createProfessionalGrant` | `create_matter_grant` | `POST /api/matters/:matterId/access-grants` |
| `acceptProfessionalGrant` | `accept_matter_grant` | `POST /api/access-invitations/accept` |
| `revokeProfessionalGrant` | `revoke_matter_grant` | `POST /api/access-grants/:grantId/revoke` |

- **Not mounted.** `registerMatterAccessLifecycleRoutes` is not called from `api/_server.ts`, and no application entry point
  imports it.
  - `matterAccessLifecycleRoutes.unmounted.test.ts` fails if any of that changes, and it checks that each path returns
    404 on the real server.
  - None of these endpoints is reachable in Preview or Production.
- **Not decided here:**
  - recipient binding or bearer-link behavior
  - who may accept, beyond the frozen database rules
  - what the owner sees about an acceptor
  - invitation delivery, URLs or email
  - retention
  - any UI
- **Unchanged:** no schema change, no migration, no service change, no frontend change.

## Contract

The adapter authenticates with the existing `verifyFirebaseToken` (a bearer header; 401 `SIGN_IN_REQUIRED`), validates
transport input, calls the service with the verified uid, and translates the result.
- **No authorization decision is made in JavaScript.** The database functions stay authoritative.
- **Nothing reads the event log,** so history can never act as authority.

| | Create | Accept | Revoke |
|---|---|---|---|
| **Body** | `{ expiresInDays?: 1–365 }` (the service default applies when omitted) | `{ token }`: exactly 43 base64url characters | none |
| **Refused input** | Any other body field (`matterId`, `uid`, `role`, …); any query parameter | Any other field; any query parameter, **including `?token=`**; form-encoded bodies | Any body field or query parameter |
| **Success** | `201 { matterId, grant: {id, status, expiresAt, createdAt}, invitationToken }` | `200 { matterId, role: "REVIEWER" }` | `200 { grantId, status: "REVOKED", accessRemovedByThisRequest }` |
| **Refusal** (one body per operation) | `403 FORBIDDEN`: no account, not an owner, suspended, cross-matter, nonexistent matter | `410 INVITATION_UNAVAILABLE`: unknown, used, revoked or expired; `409 OWNER_CANNOT_ACCEPT`; `403 FORBIDDEN`: suspended or no account | `404 ACCESS_GRANT_NOT_FOUND`: unknown grant, not an owner, no account, suspended, cross-matter |
| **Failure** | `503 ACCESS_LIFECYCLE_UNAVAILABLE` | `503 ACCESS_LIFECYCLE_UNAVAILABLE` | `503 ACCESS_REVOCATION_UNCONFIRMED`: "Access may not have been removed." |
| **Retry** | Not idempotent: each call is a new invitation, token and event | Replay returns 410; nothing is recorded | Idempotent: 200 with `accessRemovedByThisRequest: false`; nothing recorded |

Every response sets `Cache-Control: no-store`. A malformed JSON body gets a fixed `400 INVALID_REQUEST_BODY` from a
path-scoped handler that only touches body-parser errors.

### Path-matter binding

- **Create:** the path `:matterId` is the only matter used.
  - It is validated and lower-cased.
  - Any body or query identifier is refused, not ignored.
  - A service result naming any other matter is never returned (response identity guard).
- **Revoke:** grant-scoped on purpose. `revoke_matter_grant` takes no matter id, so a matter segment in the path would imply
  a check the database does not make. A matter-scoped revoke path would need a new database contract (a decision for
  later).
- **Accept:** no matter in the request. The matter comes only from the database's confirmed acceptance.

### Error mapping (`api/services/matterAccessLifecycleHttpErrors.ts`)

- **Exact matching:** service messages are matched by exact string. Anything unrecognized becomes the fixed 503 for that
  operation: database errors, contract mismatch, non-Error values, other `LifecycleError`s.
- **Constant bodies:** every response body is a constant. The one exception is a 400 describing the caller's own input.
- **Fixed log line:** the log carries only `<OP>_FAILED`, never the error, body, token or uid.
- **Drift check:** a test parses the frozen service and fails if it throws a message the table does not classify.

## Verification

- **`api/services/matterAccessLifecycleHttpErrors.test.ts` (13 tests):** totality, the drift check, non-enumeration,
  constant bodies, immutability.
- **`api/matterAccessLifecycleRoutes.test.ts` (85 tests, isolated app, service mocked):**
  - authentication (missing, non-Bearer, unverifiable, and a throwing verifier)
  - uid only from the token; path-matter authority
  - refusal of body and query overrides; token refused from the URL; form-encoded requests refused
  - input validation; response identity guard
  - fixed 503s with nothing raw in the response or the log
  - malformed JSON; method restrictions
  - non-enumerating refusals; revoke wording
- **`api/matterAccessLifecycleRoutes.unmounted.test.ts` (6 tests, real `_server.ts`):**
  - no lifecycle path in the route table
  - each path returns 404 on the real server and reaches no service
  - no non-test source file imports the adapter
  - the Stage 10 surface is exactly the three slice 5 GET routes
- **`api/matterAccessLifecycleRoutes.pg.test.ts` (25 tests, real PostgreSQL 16, pool-backed):**
  - create/accept/revoke success with exact events, actor and subject
  - refusals indistinguishable and changing nothing (reviewer, stranger, other owner, cross-matter, nonexistent
    matter, no account, suspended)
  - owner preservation (grantor and co-owner get 409; roles unchanged)
  - unknown, replayed, revoked and expired invitations all get one 410; the expiry is persisted by the database
  - the three revoke cases, plus an idempotent retry
  - concurrency: 8 × three simultaneous accepts (exactly one wins); 8 × accept racing revoke (always consistent)
  - audit-failure injection for every event type rolls back with a fixed 503
  - a missing v3 contract refuses all three operations
  - history is not authority
  - append-only
  - privacy: no digest, uid, account id or database text, and the token appears only in the create response
- **Mutation testing:** 16 of 16 killed. Files, including the temporarily mutated `_server.ts` and v3 migration, were
  restored byte-for-byte:
  - authentication removed
  - body override of the path matter
  - identity guard removed
  - raw error in the fallback
  - raw error in the handler
  - expired invitations made distinguishable
  - revoke non-owner made distinguishable
  - substring instead of exact matching
  - **router mounted in `_server.ts`**
  - token accepted from the query string
  - revoke always claiming access was removed
  - `no-store` removed
  - raw error logged
  - body-parse handler removed
  - database authorization bypass (a reviewer may create)
  - `ACCOUNT_UNAVAILABLE` passed through

## Before this adapter may be mounted (open decisions, unchanged)

| Decision | Why it matters |
|---|---|
| Bearer link vs recipient binding | Today anyone holding a token and an active account can accept. |
| Who may accept | The frozen rule is any active account that is not an owner. |
| What the owner sees about an acceptor | The report shows only an account id. |
| Retention / erasure of access events | They cannot be deleted by the application. |
| Rate limiting | The `/api` limiter uses an in-memory store (per serverless instance); consider per-uid limits for create. |
| JSON-parse error handling | The server's own normalizer covers `/api/(account|clients|matters)`; this adapter brings its own for its paths. |
