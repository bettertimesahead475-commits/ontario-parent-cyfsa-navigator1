# Stage 10 slice 5: controlled route + access-history UI integration

Date: 2026-09-24. Branch: `claude/stage-10-access-integration`.

## Baselines (verified before any edit)

- **Slice 4:** starts from the frozen candidate `d94800c`.
  - `refs/tags/audit/stage-10-slice-4-lifecycle-audit-frozen` dereferences to `d94800c4d3b493a73327d28a965e94da334f917e`.
- **Stage 7B:** `refs/tags/audit/stage-7b-access-lifecycle-frozen` dereferences to `a452c6c4e8f25a48f0cc0f4ece778e4e3cbec7b1`, which
  is an ancestor of `d94800c`.
- **Stage 9:** `e24ce01` is not merged, and nothing here depends on it.

## Routes discovered (the repository, not the prompt, is the authority)

Slices 1–4 produced **three** route modules, not four:

| Module | Method and path | Service (authorization boundary) |
|---|---|---|
| `api/matterAccessAuditRoutes.ts` (slice 1) | `GET /api/matters/:matterId/access-audit` | `getMatterAccessAudit` (owner-only membership check) |
| `api/matterAccessEventRoutes.ts` (slice 2) | `GET /api/matters/:matterId/access-events` | `listMatterAccessEvents`, which calls the SQL function `list_matter_access_events` (OWNER: matter scope; REVIEWER: self scope) |
| `api/matterAccessHistoryRoutes.ts` (slice 3) | `GET /api/matters/:matterId/access-history` | `getMatterAccessHistory`, which calls the same SQL function once per page |

**No lifecycle (create / accept / revoke) HTTP route exists anywhere in the repository.**
- No module in `api/` or `src/` calls `createProfessionalGrant`, `acceptProfessionalGrant` or `revokeProfessionalGrant`.
- Building one would be new security surface, not integration. It would need decisions on:
  - raw-token delivery
  - accept-by-token request shape
  - CSRF and abuse controls
- No audit has covered such a route. It is therefore **not built in this slice** and is listed below as YELLOW.
- Sections 16–18 of the brief are satisfied by driving the lifecycle through its only trusted path, the service. Every
  effect is observed **through the mounted HTTP routes** on real PostgreSQL.

## What changed

- **`api/_server.ts`:** 3 imports and 3 `register…Routes(app)` calls, placed directly after `registerOfficialFormRoutes(app)`.
  - No other line changed.
  - Global middleware order is unchanged: helmet → CORS allowlist → `/api` rate limiter → compression → JSON parser, then routes.
  - The Vite/static `*` catch-all is still registered afterwards in `setupViteAndStart()`.
- **`src/components/EvidenceReviewWorkspace.tsx`:** after an owned matter is selected, a **"Show access history"** disclosure
  button (`aria-expanded` / `aria-controls`) mounts `AccessHistoryPanel` for that matter.
  - The panel collapses on every matter switch.
  - The panel's own stale-response guard discards any late response for the previous matter.
- **Comment-only edits:** the "NOT YET MOUNTED" headers in the three route modules and `AccessHistoryPanel.tsx`, which
  would otherwise be false. No code in those files changed.

### Why this UI location

- `EvidenceReviewWorkspace` (`/review`, behind `RequireAuth`) is the only screen where an **owner** operates inside one
  selected matter. Its matter list comes from `navigator_review_matters`, which contains owned matters only.
- The panel appears only there, only after a matter is selected, and only when asked for. It is not global, and it sends
  no request until it is opened.
- `ProfessionalWorkspace` (the reviewer screen) was **not** changed. Reviewers can already read their own events through the
  API (scope SELF). Whether to show them a panel is a product decision, listed below.

## Mounted method/path table and collision audit

- **Mounted:** exactly `GET` on the three paths above, each registered once. No POST, PUT, PATCH or DELETE exists on any
  Stage 10 path. A test asserts this from Express's live route table.
- **Whole-server check:** every `(method, path)` pair in the running app is unique (asserted).
- **No earlier route shadows a Stage 10 URL:**
  - `GET /api/matters/:matterId` is one segment shorter, and a test checks that it is the only route matching `/api/matters/<id>`.
  - The `*` catch-all is registered later and only outside Vercel.
- **No Stage 10 route shadows an existing one.** Its paths end in fixed suffixes (`access-audit`, `access-events`,
  `access-history`) that no other route uses.
- **Ordering:** all Stage 10 routes register after every global middleware (asserted). Mutant M14 proves that mounting
  one before CORS is caught.

## Authorization did not move

- The routes still do only three things: verify the Firebase token (401 if absent or unverifiable), parse query syntax,
  and hand `identity.uid` plus the raw `:matterId` to the service.
- **The route makes no allow/deny decision.** A mocked test shows that an unauthorized-looking caller still reaches the
  service, which refuses it. Real PostgreSQL tests show the database making every decision:
  - owner: MATTER scope
  - current reviewer: SELF scope, and 403 on the owner-only report
  - revoked reviewer, unrelated account, other matter's owner, nonexistent matter, cross-matter request: **one identical
    403 per route**
  - suspended account (reviewer or owner): 403

## Security review

- **CORS:**
  - `ALLOWED_ORIGINS` and the allowlist logic are untouched.
  - Tested: an allowed origin is echoed; a missing Origin is allowed (existing server-to-server policy); an unknown origin
    gets no `Access-Control-Allow-Origin` and the handler never runs. Preflight behaves the same way.
  - No credentials header is added.
- **CSRF:**
  - All three endpoints are read-only `GET`s.
  - Identity is an explicit `Authorization: Bearer <Firebase ID token>` header that `apiFetch` attaches. It is not a
    cookie, so a cross-site page cannot make the browser send it.
  - **There is no state-changing Stage 10 HTTP operation, so no CSRF surface exists.**
- **Error contract:**
  - Only `LifecycleError` codes and messages reach clients; anything else becomes a fixed 503 per route.
  - Tested: SQL text, relation/function names, service-role strings, token digests and Firebase internals never appear
    in responses or in the route's log line.
- **Privacy:**
  - Real responses were checked for the absence of raw tokens, token digests, `token_digest`, `firebase_uid`, uids,
    matter titles, client names, `service_role`, `event_sequence` and idempotency keys.
  - The history entry key set is asserted exactly.
- **Append-only:** POST, PUT, PATCH and DELETE on every Stage 10 path (including `access-events/<id>`) return 404 and
  change no row. The table still rejects UPDATE, DELETE and TRUNCATE.
- **Abuse surface:**
  - All three routes sit under the existing `/api` limiter (100 requests per 15 minutes per IP).
  - History pages are capped at 100 rows and events at 200 per request.
  - The routes read only: they do no invitation creation, accept retries or revoke retries (no such route exists).
  - Current-state enumeration is owner-only, and the refusal gives no matter-existence oracle.
  - **Residual risk:** there is no per-account limit. An authenticated owner can page their own history at the IP limit.
    This is accepted and documented, not new. Reading records no event, so reads cannot flood the log (asserted).

## Verification

- `api/matterAccessRoutes.integration.test.ts`: 50 tests through the real `_server.ts` (services mocked). Covers the
  route table, ordering, shadowing, delegation, 401 cases, safe 503s, no write methods, CORS and preflight, and parameter
  handling.
- `api/matterAccessRoutes.pg.test.ts`: 18 tests through the real `_server.ts` on real PostgreSQL 16, with all migrations
  in the deployment order. Covers:
  - roles and refusals, suspended accounts, credentials, and malformed or upper-case ids
  - full pagination walk; tampered, cross-matter and borrowed cursors; revocation between pages
  - the slice 1 report for every grant state, and history not treated as authority
  - exact audit events per transition, observed through HTTP
  - reads record nothing; injected audit failure rolls back; unauthorized lifecycle attempts change nothing
  - fixed 503 on database failure; append-only; privacy
- `src/components/EvidenceReviewWorkspace.accessHistory.test.tsx`: 15 tests of the parent and panel together. Covers:
  - the panel absent until a matter is chosen and loaded only on request
  - the correct matter id, keyboard disclosure, heading and aria wiring
  - loading, empty, refusal (unrelated, revoked, suspended), network, server and wrong-matter errors
  - all six wired event types, plus an unknown type that renders only a neutral label
  - SELF-scope rendering, pagination, revocation on page 2, matter switch with a late response
  - history never driving the page
- **Mutation testing:** 20 integration mutants, **20 killed**, each file restored byte-for-byte (sha256 checked).
  - **M04** (the query string overriding the path's matter id) first **survived**. That was a test gap, not a product
    defect: the database still authorized the substituted matter. A test now pins that identity comes only from the
    token and the matter only from the path, on all three routes.

| # | Mutant | Killed by |
|---|---|---|
| M01 | History route auth check removed | HTTP, PG |
| M02 | Audit route auth check disabled | HTTP, PG |
| M03 | uid and matter arguments swapped (events route) | HTTP, PG |
| M04 | Client-chosen matter from the query string | HTTP |
| M05 | Reviewer treated as owner (report) | PG |
| M06 | Backend authorization skipped (report) | PG |
| M07 | History shown as current access (UI) | UI |
| M08 | v3 contract gate removed | slice 4 / 7B suites, PG |
| M09 | Duplicate audit write at the HTTP layer | PG |
| M10 | Authority cached per cursor (unauthorized continuation) | PG |
| M11 | Cursor not bound to its matter | PG |
| M12 | CORS broadened | HTTP |
| M13 | Route not mounted | HTTP, PG |
| M14 | Route mounted before CORS, limiter and parser | HTTP |
| M15 | Raw error text leaked in a 503 | HTTP, PG |
| M16 | Panel keeps the old matter id (UI) | UI |
| M17 | Panel not collapsed on matter switch (UI) | UI |
| M18 | Caller-chosen reader identity (events route) | HTTP |
| M19 | uid from the query string (history route) | HTTP |
| M20 | Write route exposed on the event log | HTTP, PG |

## Dependency map after slice 5

| Item | Class |
|---|---|
| Lifecycle HTTP routes (create / accept / revoke), including raw-token delivery, CSRF and abuse limits | YELLOW: new security surface; needs a design decision and its own audit |
| Reviewer-side panel in `ProfessionalWorkspace` | YELLOW: product decision (the API already serves SELF scope) |
| UI for the slice 1 current-state report | YELLOW: product decision |
| Refusal-event logging; `ACCESS_AUDIT_VIEWED` emission; retention/erasure | YELLOW (unchanged from slice 4) |
| Per-account rate limit for Stage 10 reads | YELLOW: optional hardening |
