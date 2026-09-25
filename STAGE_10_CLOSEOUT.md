# Stage 10 closeout: professional matter access

Date: 2026-09-25. Branch: `claude/stage-10-slice-8-activation`.

> **STAGE 10 IMPLEMENTATION COMPLETE — PENDING INDEPENDENT FINAL AUDIT AND FREEZE**
>
> This means **implementation complete**, not **independently audited and frozen**. Slices 4–7 and the decision record
> are frozen by audit tags. Slice 8 (this branch) and Stage 10 as a whole have **not** passed the final independent
> audit. No Stage 10 final tag exists, nothing is merged, nothing is deployed, and no production migration was applied.

## 1. The eight slices and the freeze chain

| # | Slice | Candidate | Branch | Freeze |
|---|---|---|---|---|
| 1 | Owner access-audit service (current-state report) | `97ec949` | `claude/youthful-newton-d1jxff` | ancestor of every later freeze |
| 2 | Append-only access event log | `621f634` | `claude/stage-10-access-event-log` | ancestor |
| 3 | Access-history read model and UI foundation | `08d751a` | `claude/stage-10-access-history` | ancestor |
| — | Stage 7B lifecycle remediation (merged in) | `a452c6c` | `claude/stage-7b-access-lifecycle-remediation` | `audit/stage-7b-access-lifecycle-frozen` |
| 4 | Atomic lifecycle and audit events (contract v3) | `d94800c` | `claude/stage-10-lifecycle-audit` | `audit/stage-10-slice-4-lifecycle-audit-frozen` |
| 5 | Mounted read routes and access-history UI | `4dff367` | `claude/stage-10-access-integration` | `audit/stage-10-slice-5-access-integration-frozen` |
| 6 | Lifecycle HTTP adapter (unmounted) | `bd1226c` | `claude/stage-10-lifecycle-http-adapter` | `audit/stage-10-slice-6-lifecycle-http-adapter-frozen` |
| — | Completion decision record | `783acab` | `claude/stage-10-completion-decisions` | `audit/stage-10-completion-decisions-frozen` |
| 7 | Recipient-bound lifecycle contract (v4) | `06b11ec` | `claude/stage-10-slice-7-recipient-bound-lifecycle` | `audit/stage-10-slice-7-recipient-bound-lifecycle-frozen` |
| 8 | **Activation** (this document) | see PR | `claude/stage-10-slice-8-activation` | **pending independent audit** |

- Slice 8 is based directly on `06b11ec`.
- It modifies no frozen tag, no frozen branch and no historical migration.
- Stage 10 has exactly these eight slices. There is no Slice 9.

## 2. Final architecture

```
Browser (owner)                                   Browser (professional)
  /review -> "Manage professional access"           /accept-invitation#t=<token>
  ProfessionalAccessPanel                              main.tsx imports invitationFragment FIRST:
    GET  /api/matters/:m/access-audit  (report)          capture t -> module memory, history.replaceState
    POST /api/matters/:m/access-grants (create)       RequireAuth (Firebase popup, no reload)
    POST /api/access-grants/:g/revoke  (revoke)       AcceptInvitation -> POST /api/access-invitations/accept {token}
                                                      -> /professional-workspace
Express (api/_server.ts)
  helmet -> CORS -> per-IP /api limiter (100/15 min) -> JSON parser -> routes
  lifecycle routes: verifyFirebaseIdentity (checkRevoked) -> per-account write limiter (30/15 min, key = uid)
                    -> transport validation -> service (requires contract v4) -> constant error mapping
PostgreSQL (SECURITY DEFINER, service_role only)
  create_recipient_bound_matter_grant / accept_recipient_bound_matter_grant / revoke_matter_grant
  every transition + its audit events in ONE transaction; append-only navigator_matter_access_events
```

**Database contract:** `navigator_matter_access_lifecycle_v4`.
- The service checks `navigator_matter_access_lifecycle_contract_v4()` before every lifecycle RPC.
- Without v4, all three mounted routes fail closed with a fixed 503 and write nothing. This is tested on a real v3-only
  database.

## 3. Recipient-bound invitation model (Slice 7, unchanged)

- **Binding.** Each invitation stores one canonical recipient email (trim, printable ASCII, exactly one `@`, 3–254
  characters, ASCII lower-case). No alias or provider rewriting is done.
- **Who can accept.** Only an authenticated, active account whose Firebase email is verified (`email_verified === true`)
  and canonically equal to the recipient can accept. Owners and the grantor can never accept, and owners are never
  downgraded.
- **Wrong account.** A non-recipient gets exactly the unknown-token response and causes no write: no expiry transition,
  no event.
- **Token storage.** The raw token is 32 random bytes, returned once. Only its SHA-256 digest is stored.

## 4. Slice 8: activation

### 4.1 Mounted lifecycle routes (`api/_server.ts`)

- **Exactly three POST routes are added**, plus one path-scoped body-parse error handler:
  - `POST /api/matters/:matterId/access-grants`
  - `POST /api/access-invitations/accept`
  - `POST /api/access-grants/:grantId/revoke`
- **The complete Stage 10 access surface** is these three POSTs plus the Slice 5 GETs `access-audit`, `access-events` and
  `access-history`.
  - `matterAccessLifecycleRoutes.mounted.test.ts` pins this surface from the live route table: every other method on
    the lifecycle paths returns 404, and a token is never accepted from the URL.
  - It replaces the Slice 6 "unmounted" test. Each Slice 6 guarantee is mapped in that file's header.
- **The Slice 5 ordering test** now names the adapter's one path-scoped error handler explicitly. It asserts that handler
  is a 4-argument error handler that matches none of the read routes.

### 4.2 Per-account write limiter (`api/services/lifecycleWriteLimiter.ts`)

- **Budget:** 30 lifecycle writes (create + accept + revoke, all counted together) per account per 15 minutes.
  - For comparison, the existing per-IP limit is 100 per 15 minutes for all of `/api`, and the AI limit is 20 per 15
    minutes. 30 is far above normal owner or professional use.
  - Every attempt counts, including refused ones, so tokens cannot be probed for free.
- **Key:** the verified Firebase uid only. It is never an email, a token or an IP.
  - It is consumed **after** authentication, so unauthenticated requests never spend anyone's budget.
- **Response:** 429 `{ code: 'RATE_LIMITED', error: <constant> }` with `Retry-After`. It carries no identifiers.
- **Instance-local, not distributed.** Each server instance (each warm serverless function) keeps its own budget, and a
  cold start starts empty. The effective deployment-wide ceiling is therefore the limit multiplied by the number of warm
  instances.
  - It is an abuse brake, not a globally enforced limit.
  - A shared or distributed store is deferred post-Stage-10 hardening (decision record C2 / §11).
- **The global per-IP `/api` limiter is unchanged** and runs first. On the mounted lifecycle routes it still returns 429
  after 100 requests per IP (tested through the real server).

### 4.3 Owner Professional Access UI (`src/components/ProfessionalAccessPanel.tsx`)

- **Where it lives:** inside the existing owner screen (`/review`, `EvidenceReviewWorkspace`), behind a "Manage
  professional access" disclosure button beside Access history. There is no new dashboard.
- **What it reads:** the mounted, OWNER-only current-state report.
  - Each invitation shows the recipient email and a text status taken from the server's `effectiveStatus`: Pending (with
    expiry), Accepted — has access / no current access, Revoked, or Expired.
  - Internal account ids, token digests and raw server text are never rendered.
  - Non-owners see only "Only the matter owner can manage professional access."
- **Create:**
  - A labelled email input explains that the invitation must be created for the email the professional signs in with.
  - On 201, the browser builds `${window.location.origin}/accept-invitation#t=${token}` (fragment only; no hostname or
    environment variable).
  - The link is shown once, with a "Copy invitation link" button (clipboard, or a select-and-copy fallback) and "Done",
    which removes the token from the page.
  - There is no email delivery.
- **Revoke:**
  - Available for pending and accepted invitations, through an inline confirmation that receives focus.
  - It calls the audited backend and refreshes the list.
  - The confirmation message reports the server's `accessRemovedByThisRequest` honestly. With another accepted
    invitation still backing access, the professional keeps access, and the UI says so.

### 4.4 Acceptance (`/accept-invitation`, `src/components/AcceptInvitation.tsx`)

1. **Capture.** `src/main.tsx` imports `src/utils/invitationFragment.ts` **first**. ES modules evaluate in import order,
   so before `App.tsx` or either telemetry package is even evaluated, it:
   - reads `t` from the fragment (exactly one value, exactly 43 base64url characters);
   - keeps it in a module variable;
   - calls `history.replaceState` to remove the fragment, with no navigation and no new history entry.

   In addition:
   - A token-bearing fragment on any other path is scrubbed too, but not captured.
   - A link pasted into an already-open app is handled by `popstate`/`hashchange` listeners, registered before any
     telemetry script exists.
   - The built bundle keeps this order (checked in `dist/`): the capture code comes before both telemetry collectors and
     before `createRoot`.
2. **Sign-in.** The route is wrapped in `RequireAuth`, which signs in with a Firebase popup (`signInWithPopup`) and
   never navigates. The token therefore survives sign-in in memory only.
   - No browser storage is used.
   - A full reload loses it by design; the recipient reopens the link.
3. **Accept.** Nothing is sent until the user presses "Accept invitation". The token then travels only in the body of
   the authenticated POST.
4. **Result:**
   - **Success:** the token is discarded and the user is sent to the existing Professional Workspace, which now lists the
     matter.
   - **Any invitation refusal** (410, 409 or 403): one neutral message, "This invitation can't be accepted with the
     current account…". The recipient, matter, owner, status and expiry are never shown.
   - **Unverified email:** a non-sensitive message to verify the address with the sign-in provider. No verification
     infrastructure was added.
   - **429, 401 and 503** each have their own safe message.
   - "Sign in with a different account" signs out in place; the token stays in memory.

### 4.5 Telemetry and token-leak protection

**How the two packages were inspected.** `@vercel/analytics` 2.0.1 and `@vercel/speed-insights` 2.0.0 were read in
`node_modules`, not assumed:
- both inject their collector `<script>` from a React `useEffect`, so only after React mounts;
- both expose `beforeSend(event: { type, url })`, which may rewrite an event or drop it by returning `null`.

**Primary protection:** the fragment is removed before React mounts (§4.4), so a collector never finds the token in
`location`.

**Backstop:** `src/utils/telemetrySanitizer.ts` is passed as `beforeSend` to both packages. It:
- removes every fragment;
- removes the `t` and `token` query parameters, and all query text on `/accept-invitation`;
- drops the event if the held token or any 43-character token-shaped value remains anywhere, or if the URL cannot be
  parsed.

Ordinary telemetry is kept; telemetry is not disabled app-wide.

**Proof:** `src/telemetryTokenLeak.test.tsx` boots the real `main.tsx` → `App.tsx` with the **real, unmocked** packages,
starting from an invitation link. It shows:
- both collector scripts are injected only after the scrub;
- both packages receive the sanitizing `beforeSend`;
- a collector building an event from the live URL, or from the original link, sends no token;
- nothing fetched, stored, logged, placed in a cookie or rendered contains the token.

**Residual note:** the collector scripts themselves are remote code served by Vercel. Their internals cannot be pinned
by this repository. The guarantees above hold at the page boundary: `location` never holds the token when they run, and
every event passes through the backstop.

### 4.6 Privacy model

- **Recipient emails** appear only in the OWNER-only report and in the create response to the creating owner.
- **Everyone else gets no email:** reviewers, revoked reviewers, strangers, cross-matter owners, suspended accounts and
  unauthenticated callers receive no email on any route, including in error bodies.
- **Events:** the event log has no email column, and the event and history routes carry no email.
- **No response** returns a token digest, a Firebase uid or database internals.

### 4.7 Audit model

- **Same transaction.** Every lifecycle transition writes its audit events in the same database transaction. An injected
  audit failure rolls the whole HTTP transition back, with a fixed 503 and no raw text (tested for all five event types
  through the mounted routes).
- **Append-only.** Events are append-only: UPDATE, DELETE and TRUNCATE are refused by triggers.
- **Reads record nothing.**

## 5. Deployment prerequisites and activation order

> **APPLICATION ACTIVATION MUST NOT PRECEDE THE V4 DATABASE MIGRATION.**

1. **Approval.** The v4 migration
   `supabase/migrations_pending_approval/create_navigator_matter_access_lifecycle_recipient_v4.sql` has been reviewed
   and approved, and is no longer "pending approval". It depends on the event log, v2 and v3 migrations already being
   applied.
2. **Apply v4** to the target database, in one transaction. It raises `PREREQUISITE_MISSING` if v2 or v3 is absent.
3. **Verify the contract:** `select public.navigator_matter_access_lifecycle_contract_v4();` must return
   `navigator_matter_access_lifecycle_v4`.
   - `create_matter_grant` / `accept_matter_grant` (v3) now raise `CONTRACT_SUPERSEDED`.
   - `recipient_email` exists on `navigator_matter_access_grants`.
4. **Configuration.** The existing application configuration must be present: `FIREBASE_SERVICE_ACCOUNT_JSON` and the
   existing Supabase service configuration. No new variable is introduced.
5. **Deploy** the Slice 8 application.
6. **Smoke-test the lifecycle endpoints:** unauthenticated `POST /api/access-invitations/accept` → 401, and `GET` on
   each lifecycle path → 404.
7. **Smoke-test the owner report:** the owner opens `/review` → "Manage professional access"; the report loads, and a
   non-owner is refused.
8. **Smoke-test invitation creation:** the owner invites a test professional's sign-in email. The link has the form
   `<origin>/accept-invitation#t=…`, and "Copy invitation link" works.
9. **Smoke-test acceptance:**
   - Open the link. The address bar immediately shows `/accept-invitation` with no fragment.
   - Sign in as the invited address and accept. The matter appears in the Professional Workspace.
   - A different account gets the neutral refusal.
10. **Smoke-test revocation:**
    - Revoke a pending invitation: its link then shows the neutral refusal.
    - Revoke accepted access: the matter leaves that professional's workspace.

**Rollback:**
- Redeploying the Slice 7 application is safe: its routes are unmounted, and its report works on a v4 database.
- The v4 migration is additive and may stay.
- Never roll the database back below v4 while the Slice 8 application is live.

## 6. Retention acknowledgement (Decision 4, unresolved)

- The grant recipient email is **retained on grant rows**.
- Access events remain **append-only**.
- **No automated purge or redaction exists.**
- The **retention duration requires legal/privacy review before production activation.**

That the model is technically implemented does not mean it is legally approved. This acknowledgement must be made
before production activation. No retention period was invented, and no purge was implemented.

## 7. Deferred (post-Stage-10)

Not implemented, and out of scope for Stage 10:
- a shared/distributed rate-limit store
- a retention policy with purge/redaction
- invitation email delivery and notifications
- declining an invitation
- refusal-event logging
- create idempotency
- firm/team/tenant models
- lawyer credential or Law Society verification
- lawyer-role provisioning
- new email-verification infrastructure

## 8. Test and mutation evidence

**Full suite, compared by test identity with frozen Slice 7 `06b11ec`:**

| Run | Baseline `06b11ec` | Slice 8 candidate | Baseline failures | Candidate-only regressions |
|---|---|---|---|---|
| CI-style (no PostgreSQL) | 2294 passed, 0 failed, 419 skipped | 2386 passed, 0 failed, 444 skipped | 0 | **0** |
| With real PostgreSQL | 2611 passed, 0 failed, 102 skipped | 2728 passed, 0 failed, 102 skipped | 0 | **0** |

- **Removed test names:** exactly the six Slice 6 "unmounted" tests. Activation replaces them on purpose, and each maps
  to its counterpart in `matterAccessLifecycleRoutes.mounted.test.ts` (mapping in that file's header).
- **No other test** changed from passing to failing or skipped.

**Real PostgreSQL:** 342 tests across 8 files: Stage 7B service (60), Slice 2 events (45), Slice 3 history (37), Slice 4
audit (55), Slice 5 routes (24), Slice 6 adapter (25), Slice 7 recipient (71) and Slice 8 activation (25). All pass.

**Mutation testing (Slice 8 security points).** Each mutant was applied, typechecked and tested, then restored and
verified by SHA-256.

| # | Mutant | Result | Killed by (intended reason) |
|---|---|---|---|
| M01 | lifecycle authentication removed | KILLED | 401 tests (unit, mounted surface) |
| M02 | owner check on create removed | KILLED | E2E 2/3: reviewer/stranger create refused |
| M03 | recipient verification on accept removed | KILLED | E2E 11/19/20: mismatch gets 410, no mutation |
| M04 | accept trusts a request-body email | KILLED | body identity fields refused (unit + E2E) |
| M05 | recipient email exposed to a reviewer | KILLED | E2E 31 + Slice 5/7 report privacy |
| M06 | invitation link uses `?t=` | KILLED | panel link-format tests |
| M07 | `replaceState` scrub skipped | KILLED | fragment tests, telemetry boot test |
| M08 | token persisted in localStorage | KILLED | storage tests (fragment, boot, acceptance) |
| M09 | token persisted in sessionStorage | KILLED | storage tests |
| M10a | raw token logged (browser) | KILLED | acceptance log-capture tests |
| M10b | raw token logged (server) | KILLED | E2E 27 log-capture assertions |
| M11a | telemetry `beforeSend` backstop removed | KILLED | boot test: both packages get the sanitizer |
| M11b | sanitizer passes URLs through | KILLED | sanitizer tests + boot collector simulation |
| M11c | capture import moved after `App` | KILLED | import-order guard (see note) |
| M12 | raw token as rate-limit key | KILLED | "token changes do not reset", key inspection |
| M13 | per-account limiter disabled | KILLED | limiter adapter tests + E2E 28 |
| M14 | limiter keyed only by IP | KILLED | "changing IP", "same IP, different accounts" |
| M15 | revoke owner authorization removed | KILLED | E2E 23/24/25 |
| M16 | unintended route mounted | KILLED | exact mounted-surface test |
| M17 | v4 prerequisite bypassed | KILLED | contract-gate tests (no lifecycle RPC without v4) |
| M18 | event atomicity removed (accept) | KILLED | E2E 27: `GRANT_ACCEPTED` failure rolls back |
| M19c | token digest exposed by the report API (compiles) | KILLED | report key/privacy tests |
| M19b | token digest shown in the owner UI | KILLED | panel "no digests" test |

**Totals and classification:**
- **Mutants run:** 24.
- **Killed for the intended security reason, on a compiling mutant:** 22.
- **M11c: killed by the structural ordering guard.** At runtime this mutant is equivalent: the scrub still runs before
  `createRoot`, so before any collector is injected. The guard exists to keep the capture as early as possible.
- **M19a: INVALID.** It failed to compile (undeclared field). It is superseded by the compiling M19c.
- **Survived:** 0.

**Suites added in Slice 8:**

| Suite | Scope |
|---|---|
| `api/matterAccessActivation.pg.test.ts` | Section 18 items 1–32 through the real server on real PostgreSQL, plus the v4-absent database |
| `api/matterAccessLifecycleRoutes.mounted.test.ts` | Exact mounted surface |
| `api/matterAccessLifecycleRateLimit.test.ts`, `api/services/lifecycleWriteLimiter.test.ts` | Per-account limiter |
| `src/utils/invitationFragment{,.listeners}.test.tsx` | Fragment capture and scrub |
| `src/utils/telemetrySanitizer.test.tsx`, `src/telemetryTokenLeak.test.tsx` | Telemetry |
| `src/components/AcceptInvitation.test.tsx` | Acceptance page, non-enumeration, token handling |
| `src/components/ProfessionalAccessPanel.test.tsx`, `src/components/EvidenceReviewWorkspace.professionalAccess.test.tsx` | Owner UI and accessibility |

**Accessibility evidence** (the repository has no axe tooling; tests assert roles, names and focus):
- native labelled inputs and buttons
- `aria-describedby` / `aria-invalid` error association
- `role="status"` / `role="alert"` announcements
- focus moved to the link, the revoke confirmation, and the acceptance result
- a disclosure button with `aria-expanded` / `aria-controls`
- status shown as text, not color

## 9. Known limitations

1. **The per-account limiter is instance-local** (§4.2).
2. **A page reload drops an unaccepted token** (by design; no storage). The link must be reopened.
3. **Sign-in is Google (popup) only.** Google accounts normally report a verified email, so the unverified-email path is
   rare in practice. The server-side verified-email match remains the authority.
4. **Owners must invite the exact address the professional signs in with.** An invitation to a firm address does not
   match a personal sign-in. The UI states this.
5. **Suspended callers** receive the frozen Slice 5 account refusal on the report, not the shared `FORBIDDEN` (documented
   in Slice 7 and tested to carry no identity).
6. **The telemetry collectors are remote code** (§4.5 residual note).
7. **Retention is unresolved** (§6).
8. **The link can survive outside the page.** `history.replaceState` cleans the page's own history entry, but the
   browser may already have recorded the original `#t=` URL in its local history or address-bar suggestions. The link
   also remains wherever the owner sent it (email, chat). No page code can remove those copies.
   - The mitigation is the Slice 7 recipient binding: a token is useless to anyone except the verified recipient.
   - The owner can revoke a pending invitation at any time.
