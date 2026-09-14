# Stage 5 Evidence Review Foundation

## Objective and status

First Stage 5 milestone: matter-scoped Evidence Review workspace. Implementation is uncommitted and pending review, based on Stage 4 commit `d0ce37774b4473aaac9c340c5bfba5442a01b33f` on `phase-3-account-client-matter-lifecycle`.
No chronology, contradiction, corroboration or legal-intelligence engine is implemented.
**The new migration is PENDING APPROVAL and has not been executed on any database.** The new workspace fails closed with a safe unavailable response until its RPCs are installed after separate approval. Stage 4 live validation is not evidence that Stage 5 SQL has executed successfully.

## Architecture and schema audit

Decision: **B — existing foundation sufficient with a small additive migration**. Keep all Stage 4 source/evidence tables and immutable coordinates unchanged. Add only `navigator_review_actions`, indexes and four review RPCs in `supabase/migrations_pending_approval/create_navigator_evidence_review.sql`.

Reviewed repository SQL provides accounts/clients/matters, OWNER memberships, pages, evidence and `navigator_extraction_runs` (not a separate generic analysis_runs table). Architecture docs describe future review actions, timeline events and contradictions. Historical collision audits mention old timeline/analysis tables tied to a different Supabase Auth/case model. They are not activated or assumed compatible. No current navigator review-action persistence exists before this proposal. No speculative intelligence tables are added.

Shared wire types in `shared/evidenceReview.ts` separate classification from review state. Server services use the existing Supabase singleton and Firebase-verified UID; browser code imports no server credentials or provider modules. Navigation lazy-loads the workspace at `/evidence-review`, inside RequireAuth.

## API contracts

All endpoints require Firebase identity, use inherited global CORS/rate limits, return no-store and make one RPC call per request. They make no AI calls.

| Endpoint | Contract |
|---|---|
| GET /api/review-matters | Optional UUID `after`; 25 owned matters plus next ID. No account provisioning. |
| GET /api/matters/:matterId/evidence | `limit` 1–50 (default 25); optional `cursor`, `classification`, `reviewState`, `documentId`, `createdFrom`, `createdTo`, `page` 1–20, `runId`. Returns items, nextCursor and authorized matter title/ID. |
| PATCH /api/matters/:matterId/evidence/:evidenceId/review | Exactly `reviewState` and `expectedUpdatedAt`. Returns resulting state/timestamp, changed flag and action when changed. Unknown fields rejected, including classification, quote, coordinates and actor. |
| GET /api/matters/:matterId/evidence/:evidenceId/source | Requires `documentId`, `versionId`, `pageId`; returns only the evidence's matching original extracted page and source identities. |

404 is shared by foreign/missing/inactive ownership failures; stale revision is 409; lock contention is 409; unavailable RPC/internal errors become safe 503. Input errors are 400. Database errors are not serialized. The existing real JSON parser normalizes malformed review bodies.

## Authorization and provenance

The pending list/source/update functions lock the verified UID's account, invoke `read_navigator_owned_matter`, and retrieve or update within that same transaction. Source/update lock document then version then evidence, rechecking hierarchy after candidate discovery. Matter selection locks account and bounded candidate matter/client/OWNER membership rows. Functions are VOLATILE SECURITY INVOKER, pin search_path and set a five-second lock timeout. Public/anon/authenticated EXECUTE is revoked.

No detached precheck grants retrieval. No browser account identity or ownership is accepted. Old Stage 4 functions/triggers and migration files remain unchanged.

Review update changes only review_state. Stage 4's guard verifies provenance and assigns updated_at. The pending function requires the exact prior timestamp, including microseconds, to reject lost updates. It atomically inserts an action with server-resolved actor account, from/to state, timestamp and evidence revision. A no-op has no new action. Failure to append rolls back the state change.

Audit history is append-only under table grants and a mutation guard; service_role has SELECT/INSERT only. This records actions through the review RPC. Trusted service-role direct writes inherited from Stage 4 can still change review_state without this RPC; do not claim a universal database audit of all privileged maintenance. Restrict maintenance operationally; a universal actor-enforced audit design needs separate review. Earlier review states have no fabricated reviewer/history. UI explicitly marks missing action history.

ABSENT/AMBIGUOUS quotations remain REQUIRES_SOURCE. This milestone cannot resolve an unsupported quotation or override the source guard. Human confirmation does not change classification, prove a fact or generate a legal finding. Documents remain untrusted text, escaped by React, never rendered as HTML instructions.

## Pagination and performance

Evidence order: created_at DESC, id DESC. Fetch limit+1, expose at most limit, encode last delivered timestamp/UUID as base64url JSON. Preserve PostgreSQL timestamp precision rather than round-tripping through JavaScript Date. A cursor is an ordering position, not an authorization token. Every request reauthorizes and reapplies filters.

Added indexes support matter ordering and document/state/classification variations. Latest review uses a bounded indexed subquery per selected row inside the one DB request; there is no application N+1 network loop. Matter selector queries at most 26 candidates in one RPC. Source page is fetched only on View source, not with every list row. Page text is bounded by Stage 4's 100,000-character limit. List quotes/statements remain bounded by existing constraints, but row pagination is not a strict HTTP byte budget: maximum-size quotations can still produce substantial responses. Measure bytes and query plans in the separately approved database validation.

Browser holds one evidence page and an in-memory cursor stack; changing filters/matter resets pagination. Review saves reload the first page because state filters may remove the reviewed row. No persistent browser evidence cache or public HTTP cache is introduced. Caching/repeated-source reuse can be considered only with identity/revocation and immutable source guarantees. No snapshot isolation across pagination requests is claimed: concurrent review-state changes can affect filtered membership; refresh starts a new traversal.

## UI workflow

Open a matter from a bounded selector; apply document/classification/review/date/page/run filters; select an evidence card; inspect claim, classification, review state, exact quote, match status, document/version/page/run identities, creation timestamp and last recorded reviewer/time. Filter-this-document avoids copying IDs. Date filters mean evidence creation in UTC, not event dates. Structured entity/person data does not exist, so entity filtering is explicitly unavailable.

View source retrieves the exact page coordinates and original extracted text, with Unicode code-point highlighting for uniquely verified quotes. It does not re-OCR, paraphrase, or display a recreated PDF image. Ambiguous/absent text has no highlight. The review selector offers only permitted states. Save carries the last-seen revision, clears obsolete page selection and refreshes; conflicts require reload. Loading, empty, unavailable and authorization states are explicit. Source responses from older selections are ignored.

## Verification and limitations

Targeted Stage 5 contracts plus full-server route/parser tests: 170/170 across two files. Full regression suite: 373/373 across ten files. Includes 64 Stage 5 service/API/rendering/SQL-declaration checks plus two new mounted-server checks. Existing Stage 4 tests were preserved.

These tests mock Firebase and database transport; denial cases test mapping of the transactional RPC contract, not live RLS. Offline SQL tests inspect required declarations, bounds, authorization calls, revision checks and audit coupling; they do not prove PostgreSQL installation, plans, lock behavior or rollback. Independent SQL/security review and explicitly approved isolated installation/concurrency validation are required before enabling the workspace against real data.

React server rendering tests verify escaped output and source highlighting; shared interaction contracts verify filter/cursor serialization, state restrictions and source jump coordinates. A local browser-only synthetic fixture was served without credentials or backend access, but the browser controller timed out twice. No successful interactive browser verification is claimed. Keyboard/mobile interactions and save/filter/source behavior need browser validation in a working browser environment.

No new dependency or tsconfig change. Existing release conditions (Firebase-authenticated HTTP integration, dependency advisories, production readiness and Stage 4 operational debt) remain. Additional review history pagination, readable reviewer profile labels, document-picker search, structured entities and chronology are not implemented.

## Next milestone

First: independent read-only review of Stage 5 API/UI and pending SQL; approved isolated SQL validation and browser verification; correct findings before milestone acceptance. After this review foundation is accepted, scope the matter-wide chronology milestone with source-linked events. Do not begin chronology or contradictions automatically.

### Final local verification

Standalone typecheck passed with exit 0 after correcting a JSX key typing issue using a keyed native wrapper; no dependency or tsconfig change. The Stage 5 64-test suite passed again after that correction. The earlier full-server targeted run passed 170/170 and full suite passed 373/373. Production build passed with exit 0; workspace lazy chunk 12.79 kB (4.29 kB gzip); existing >800 kB chunk warning remains. npm audit exited 1 with unchanged 10 moderate and 1 high advisories; no fix applied. Tracked diff and new-file whitespace checks passed. The temporary synthetic UI server was stopped.

Database actions: none. No credentials read, no SQL executed, no Supabase/Vercel access, no deployment, commit, push or merge. HEAD remains d0ce37774b4473aaac9c340c5bfba5442a01b33f. Work is intentionally uncommitted for review.

## Stage 6 integration boundary

Stage 6 can later consume the authorized EvidencePage/EvidenceRow contract: matter_id, evidence id, immutable document/version/page/run identities, exact_quote and verified offsets, classification, review_state, and last recorded action. It must continue to authorize each read; cursors and evidence IDs are not access grants. Stage 6 output must remain separate from immutable evidence and must not reclassify source provenance.

created_at is evidence creation time, not an event date. No structured event date/range or person/entity references exist in this milestone; those values are unavailable, not inferred from timestamps or invented as empty legal-mapping fields. Future typed additions require a separately reviewed source model. No Stage 6 implementation or generic shared abstraction was added.

## Pre-approval source audit corrections

The list service now enforces the requested row limit and matching matter identity on RPC results and returns only the documented envelope. The pending RPCs pin timezone to UTC so their timestamp strings remain compatible with microsecond-preserving cursors and review revision inputs even under a non-UTC session. Function-local settings restore the caller's prior setting on exit (PostgreSQL CREATE FUNCTION documentation: https://www.postgresql.org/docs/current/sql-createfunction.html). Source display also verifies the physical page number.

Static review found no need to alter applied Stage 3/4 artifacts. Foreign keys, append-only action grants/guard, state constraints, transactional ownership locks, document-before-version lock order and atomic action insertion remain intact. Concurrent requests using the same prior timestamp serialize and the loser must fail the revision check; no-op requests append no action. This is a source-level conclusion requiring real PostgreSQL verification, not a concurrency test result. Privileged direct action INSERTs remain trusted and can fabricate/duplicate history; the RPC is the supported audit path, not a universal privileged-write audit system. Account-wide serialization, live pagination membership changes, payload sizes and query plans remain validation concerns.
