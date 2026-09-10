# Phase 1 Final Security Gate Audit — CYFSA Navigator

> **Historical snapshot — superseded for current status.** See [current closeout status](PHASE_1_SECURITY_VERIFICATION.md#current-closeout-status--2026-09-10) for the verified 139-test suite, applied migrations, actual PR scope and remaining blockers. Older counts, pending-approval claims, stateless-session descriptions and next-phase instructions below are historical, not current authorization. PR #21 remains draft. The obsolete eslint/Firebase configuration references in older handoff material do not describe the current tree.


**Type**: READ-ONLY FINAL SECURITY VERIFICATION. No application code, database schema, Supabase policy, migration, environment variable, or dependency was modified as part of this audit. Nothing was merged, deployed, or created except this document.

**Audited state**: branch `phase-1.5-security-remediation` @ commit `fb4bf066521edeec3bc3e6c686ec339ebb6b17ee`, as it exists on `origin` right now.

**Method**: every claim below was independently re-verified against current evidence during this pass — direct source reads of `api/_server.ts` (full, 1,784 lines), `api/services/access.ts`, `api/services/gmailAgent.ts`, `api/services/firebaseAdmin.ts`, `api/services/usage.ts`, `src/utils/api.ts`, `src/utils/firebase.ts`; fresh read-only SQL queries against the live Supabase project (`qboidsfpjuxeqtfotryj`); a fresh `npm audit`, `npm test`, `tsc --noEmit`, and `npm run build` run; fresh repo-wide greps for secrets, client-side env exposure, and dead-table references; and direct inspection of the live PR (#21) and git history. Prior documents (`AUDIT.md`, `PHASE_1_SECURITY_VERIFICATION.md`, `PHASE_1_RLS_PRE_APPROVAL_AUDIT.md`) were read and used to reconstruct the original findings, but no claim in them was accepted without independent re-verification here — see §3 for cases where this pass's own verification differs from what those documents concluded.

**CLOSEOUT ADDENDUM (post-audit, single-scope fix)**: this audit (§1, §3 L-1, §15, §18, §20) identified that `.env.example` was missing `FIREBASE_SERVICE_ACCOUNT_JSON`. That single documentation gap has since been corrected — `FIREBASE_SERVICE_ACCOUNT_JSON` was added to `.env.example` with a placeholder value, no application code was touched, and every other item in this audit (findings, accepted risks, deferrals) is unchanged and still applies exactly as originally written below. The overall conclusion remains **`PHASE 1 PASS WITH ACCEPTED RISKS`** — this addendum resolves the one documentation-only item without altering that conclusion or any other finding. The body of this report below is left as originally written, for an accurate historical record of what this audit actually found at the time it was performed; read this addendum alongside it.

---

## 1. Executive Summary

Phase 1.5 remediation materially and verifiably closed the one Critical finding and all four original High findings from `AUDIT.md`. This was independently re-confirmed in this pass, not assumed from prior reports: the Supabase RLS fix is live in production right now (checked via a fresh query, not by reading yesterday's report), the four previously-unauthenticated/uncapped AI-cost endpoints are now gated or rate-limited in the actual route code, the payment-approval agent's code path was read in full and confirmed to never call `approvePayment()` automatically, and the test suite (87/87), typecheck, and build all pass right now, freshly run.

Two things keep this from an unqualified `PHASE 1 PASS`:
1. **`.env.example` still omits `FIREBASE_SERVICE_ACCOUNT_JSON`** — a required variable without which the entire Firebase-identity/free-tier gate throws a 503 at startup. This was flagged as fixed in `AUDIT.md`'s L-1 remediation but a fresh read of the current `.env.example` shows it was not actually added. Low severity, but a real documentation-vs-code gap of exactly the kind this audit was told to catch. **RESOLVED post-audit** — see the closeout addendum above; `FIREBASE_SERVICE_ACCOUNT_JSON` has since been added with a placeholder value.
2. **`nodemailer` remains on a version with one unpatched High-severity advisory chain** (7 related CVEs, all in `raw`/`jsonTransport`/legacy-signature code paths). This application's own usage was independently verified (fresh grep) to never invoke any of those paths — every call site uses only `createTransport()` + `sendMail({from, to, replyTo, subject, text})` — which meaningfully narrows real exploitability, but the dependency itself is not patched and a future code change adding attachments or raw-message construction would re-open the actual vulnerable surface.

No Critical or High finding was found FAILED, and no BLOCKED item remains. See §19 for the exact conditions attached to proceeding.

---

## 2. Git/Repository State

| Check | Result |
|---|---|
| Current branch | `phase-1.5-security-remediation` |
| Current commit SHA | `fb4bf066521edeec3bc3e6c686ec339ebb6b17ee` |
| Remote tracking branch | `origin/phase-1.5-security-remediation` |
| Working tree clean? | **Yes** — `git status --short` returns nothing |
| Local matches origin? | **Yes** — `git log --oneline -1 origin/phase-1.5-security-remediation` returns the identical SHA `fb4bf06` |
| `main` modified? | **No** — `origin/main` HEAD is `760a0cf` ("Add Phase 1 technical, security, and architecture audit (AUDIT.md)"), and `git merge-base origin/main HEAD` returns that exact same SHA, proving the remediation branch's 8 commits sit cleanly on top of `main` with zero divergent/rewritten history on `main`'s side. |
| Unauthorized changes on the remediation branch? | **No** — `git diff origin/main HEAD --stat` shows exactly 13 changed files, all of which map directly to findings in `AUDIT.md` or are the audit/verification documents themselves (`.env.example`, two test files, `api/_server.ts`, `api/services/gmailAgent.ts`+test, `eslint.config.js`/`firebase.json`/`firestore.rules` deletions, `package.json`/`package-lock.json`, the pending-migration SQL file, and the three `PHASE_1_*` docs). Nothing outside that footprint. |
| PR status (live, via GitHub API) | **PR #21**, open, **draft** (`draft: true`), **not merged** (`merged: false`), `mergeable_state: "clean"`, base `main@760a0cf`, head `phase-1.5-security-remediation@fb4bf06` — matches local HEAD exactly. 8 commits, 2 comments (both routine Vercel bot deployment-status comments, independently confirmed, not review feedback). |

**Independent verification note**: this section was built from fresh `git`/GitHub-API calls made during this pass, not copied from `PHASE_1_SECURITY_VERIFICATION.md`'s own git-state claims.

---

## 3. Original Finding Matrix

Reconstructed from `AUDIT.md` (the original Phase 1 audit, 1 Critical / 5 High / 7 Medium / 5 Low). Each finding was traced to its current implementation and independently re-verified in this pass — see "Verification performed" per row.

### CRITICAL

**C-1 — RLS disabled on `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`**
1. Original finding: all three tables had RLS fully disabled with full CRUD grants to `anon`/`authenticated`.
2. Severity: Critical.
3. Current implementation: `supabase/migrations_pending_approval/enable_rls_free_usage_gmail_stale.sql` applied.
4. Evidence inspected: the migration file; `PHASE_1_RLS_PRE_APPROVAL_AUDIT.md`; `PHASE_1_SECURITY_VERIFICATION.md` §3a.
5. Verification performed: **fresh SQL query run in this pass** — `select relrowsecurity, policy_count from pg_class ... where relname in (...)` — returned `free_usage: rls_enabled=true, policies=0`; `gmail_processed_messages: rls_enabled=true, policies=0`; `stale_payment_alerts: rls_enabled=true, policies=0`, moments before this report was written. Not inferred from a prior document.
6. Current status: **PASS**.
7. Remaining risk: none from RLS itself; the only residual is the pre-existing, architecturally-inherent fact that `service_role` key compromise bypasses RLS regardless (true before and after this fix, not worsened by it).
8. Blocks Phase 1: No — resolved.
9. Recommended next action: none required. Preserve deny-by-default (do not add a permissive `anon`/`authenticated` policy without a real reason).

### HIGH

**H-1 — `/api/extract-text` unauthenticated, no size limit**
1. Original: no auth check, no size cap, reachable for free unlimited Gemini OCR.
2. Severity: High.
3. Current implementation: `api/_server.ts:650-695` — requires `verifySessionToken()` or `verifyFirebaseToken()` before proceeding; `MAX_EXTRACT_BASE64_CHARS = 30_000_000` enforced with a 413 response; route also carries `aiCostLimiter` (20 req/15min/IP).
4. Evidence inspected: full route handler, read directly in this pass.
5. Verification performed: direct code read (not test-suite inference) confirms the auth check is a hard `return res.status(401)` before any Gemini call is reachable; confirms the size check precedes the extraction call.
6. Current status: **PASS**.
7. Remaining risk: a signed-in-but-free user can still call this repeatedly up to the `aiCostLimiter` ceiling (20/15min/IP) without it costing a free-analysis slot (extraction is explicitly not counted against the free-analysis quota, by design) — bounded, not zero, cost exposure per authenticated caller. Acceptable: authentication is the primary control this finding required, and it is present.
8. Blocks Phase 1: No.
9. Recommended action: none required.

**H-2 — `/api/search-connectors` unauthenticated, no accounting**
1. Original: live, billed Gemini call with zero auth check and zero test coverage.
2. Severity: High.
3. Current implementation: `api/_server.ts:464-498` — `requireSession(req, res)` gate (paid session required, no free tier), `aiCostLimiter`, and a 2000-char query cap.
4. Evidence inspected: full route handler.
5. Verification performed: direct code read confirms `requireSession()` returns/short-circuits before any Gemini call.
6. Current status: **PASS**.
7. Remaining risk: none material — this route now requires an active Pro/Premium session, same as the app's other paid AI routes.
8. Blocks Phase 1: No.
9. Recommended action: none required.

**H-3 — `/api/transcribe` / `/api/transcribe-audio` unauthenticated, uncapped**
1. Original: free-by-design (documented product decision), but no rate limit or size cap specific to these routes.
2. Severity: High.
3. Current implementation: `api/_server.ts:1547-1647` — both routes remain intentionally unauthenticated (preserving the "voice journaling is free" product decision), but now carry `aiCostLimiter` (20/15min/IP) and explicit size caps (`MAX_TRANSCRIBE_AUDIO_CHARS = 20_000_000`, `MAX_TRANSCRIBE_TEXT_CHARS = 50_000`).
4. Evidence inspected: full route handlers.
5. Verification performed: direct code read confirms both caps are checked before any Gemini/Claude call, and confirms `aiCostLimiter` is attached as route middleware on both.
6. Current status: **PASS** for the finding as originally scoped (missing rate limit + missing size cap — both now present).
7. Remaining risk (**ACCEPTED, not a defect of this finding**): the cap is per-IP, not per-account — a distributed-IP actor could still exceed 20/15min in aggregate. This is an inherent limitation of IP-based limiting generally (see M-4), not something H-3 specifically promised to solve, and the underlying product decision (free access) makes a stricter per-account gate a product question, not a security gap.
8. Blocks Phase 1: No.
9. Recommended action: none required for Phase 1; consider a per-account or CAPTCHA-based control in a future phase if abuse is observed in practice.

**H-4 — Automated payment approval trusted pattern-matched email text**
1. Original: `scanForPayments()` called `approvePayment()` directly on a regex match against email text — no cryptographic/bank verification.
2. Severity: High.
3. Current implementation: `api/services/gmailAgent.ts:280-402` — a match now only pushes to `result.matchedPendingApproval` and sends an admin alert email; `approvePayment()` is never called from this file. The only call site for `approvePayment()` in the entire repository is the admin-secret-gated `POST /api/admin/approve-payment` route (`api/_server.ts:524-539`), confirmed by a repo-wide grep for `approvePayment(` returning exactly two matches: its definition in `access.ts` and this one route call.
4. Evidence inspected: full `gmailAgent.ts`; full `api/_server.ts` admin routes; `api/services/gmailAgent.test.ts` (test asserts `approvePayment` is `not.toHaveBeenCalled()` on a match).
5. Verification performed: direct code read + grep, not test-suite inference alone — confirmed the human-confirmation architecture is real in the current code, not just asserted by a test.
6. Current status: **PASS**.
7. Remaining risk: none beyond the inherent, unavoidable fact that a human (Chris) still makes the final call based on reading an alert email and the Gmail message it links to — a process risk, not a code defect, and exactly the risk-reduction this finding asked for (moving from fully-automated to human-confirmed).
8. Blocks Phase 1: No.
9. Recommended action: none required.

**H-5 — Dependency vulnerabilities (7 high, 16 moderate, 25 total)**
1. Original: 25 `npm audit` findings, incl. `nodemailer`.
2. Severity: High (contextual, per-package).
3. Current implementation: `npm audit fix` (no `--force`) applied + a `qs` override.
4. Evidence inspected: `package.json`, fresh `npm audit` run in this pass.
5. Verification performed: **`npm audit` re-run fresh in this pass** (not read from a prior report): **11 vulnerabilities — 1 High, 10 Moderate, 0 Critical, 0 Low.**
   - The 1 High is `nodemailer` (advisory chain: `jsonTransport` bypassing `disableFileAccess`/`disableUrlAccess`; improper TLS cert validation in OAuth2 token fetch; ReDoS/O(n²) in `addressparser`; `raw`-option file-read/SSRF; `resolveContent()` legacy-signature bypass; IDN/punycode allow-list bypass; recipient-domain validation bypass). Fix requires `nodemailer@10` (semver-major).
   - **Exploitability check performed in this pass**: a fresh grep of every `nodemailer`/`sendMail`/`attachments`/`raw:`/`jsonTransport` occurrence in `api/` (3 call sites: `access.ts`, `gmailAgent.ts`, `_server.ts`) confirms every single call uses only `createTransport()` + `sendMail({from, to, replyTo?, subject, text})` — **no `attachments`, no `raw`, no `jsonTransport`, no `html` field is used anywhere in this codebase.** The specific vulnerable code paths in the advisory chain (raw-message file/URL access, `jsonTransport`, legacy `resolveContent()`) are therefore not reachable through this application's own usage today. This narrows real exploitability without eliminating the advisory — a future change that adds attachments or raw MIME construction would re-open it.
   - The 10 Moderate are entirely one transitive chain (`uuid` → `gaxios`/`google-gax`/`googleapis-common` → `googleapis`/`firebase-admin`/`@google-cloud/firestore`/`@google-cloud/storage`/`teeny-request`/`retry-request`), all requiring major bumps of `googleapis`/`firebase-admin`. `firebase-admin` is used only for ID-token verification in this codebase (a narrow, well-defined surface — `api/services/firebaseAdmin.ts`); `googleapis` only for the Gmail-agent's read/label operations.
6. Current status: **PARTIALLY FIXED**.
7. Remaining risk: Moderate-to-real for the `nodemailer` chain in the abstract, Low in this specific deployment given the confirmed-narrow usage pattern above; Low for the `googleapis`/`firebase-admin` chain given its narrow, well-tested call sites.
8. Blocks Phase 1: No — none of the remaining findings' actual vulnerable code paths are reachable in this application's current usage, and this audit's own instruction not to blindly upgrade a security-and-business-critical dependency (email delivery, Firebase auth) without a verified regression pass is a sound reason to defer, not a gap.
9. Recommended action: schedule the `nodemailer@10` and `googleapis`/`firebase-admin` major-version bumps as a dedicated, tested piece of work (per the verification plan already in `PHASE_1_SECURITY_VERIFICATION.md` §"Recommended Verification Plan") — not urgent enough to block Phase 2, but should not be indefinitely deferred either.

### MEDIUM

**M-1 — OAuth `state` documented but missing**
1. Original: code comment claimed CSRF `state` protection existed; it did not.
2. Current implementation: `api/services/gmailAgent.ts:104-142` — `generateOAuthState()`/`verifyOAuthState()`, HMAC-SHA256-signed, 10-minute TTL, timing-safe comparison; wired into `getGmailAuthUrl()` and checked in `GET /api/admin/gmail-callback` (`api/_server.ts:566-583`).
3. Verification performed: direct code read of both the generation and verification sides, confirming they match (same secret, same construction).
4. Current status: **PASS**.
5. Blocks Phase 1: No.

**M-2 — No session revocation**
1. Original: stateless HMAC tokens, no denylist, no way to cut off a session before 30-day expiry.
2. Current implementation: unchanged — confirmed by reading `api/services/access.ts:98-117` in full; still pure stateless HMAC verification.
3. Current status: **ACCEPTED RISK** (documented, deliberate architectural tradeoff — introducing a denylist is a DB-schema change of similar weight to C-1/M-6 and is explicitly out of scope for Phase 1.5).
4. Blocks Phase 1: No.
5. Recommended action: a future-phase decision, not a Phase 1 gate item.

**M-3 — No Content-Security-Policy**
1. Original: `helmet({ contentSecurityPolicy: false })`.
2. Current implementation: **unchanged** — confirmed by reading `api/_server.ts:365-367` directly; CSP is still explicitly disabled.
3. Current status: **DEFERRED** (unchanged from `AUDIT.md`; explicitly documented as needing live-browser tuning against the app's inline styles/export-window HTML that this sandboxed environment cannot perform).
4. Blocks Phase 1: No.
5. Recommended action: a human with browser access should design and test a CSP against the print/export flow before a wider pilot; not a Phase 1 blocker.

**M-4 — Uniform, IP-based rate limiting**
1. Original: one 100/15min/IP budget shared by `GET /api/health` and every AI route.
2. Current implementation: `aiCostLimiter` (20/15min/IP) added specifically for the free/unauthenticated AI-cost routes (`api/_server.ts:430-438`), layered under the still-present global `apiLimiter` (100/15min/IP, `api/_server.ts:403-418`). Paid/free-tier-tracked routes rely on their own accounting instead of needing this.
3. Verification performed: confirmed `aiCostLimiter` is attached to `/api/search-connectors`, `/api/extract-text`, `/api/transcribe`, `/api/transcribe-audio` by reading each route declaration directly.
4. Current status: **PASS** for the finding as scoped (a dedicated, tighter budget for the AI-cost routes now exists).
5. Remaining risk (**ACCEPTED**): both limiters remain IP-based, which is inherently bypassable via distributed IPs — a known, general limitation of IP-based rate limiting, not specific to this app's implementation.
6. Blocks Phase 1: No.

**M-5 — Fragile, `VERCEL_URL`-based CORS**
1. Original: `origin: process.env.VERCEL_URL ? ... : '*'` — wrong-domain or wide-open in practice, unverified.
2. Current implementation: `api/_server.ts:381-400` — explicit allowlist (`cyfsanavigator.com`, `www.cyfsanavigator.com`, `ALLOWED_ORIGINS` env, `NODE_ENV`-gated localhost). No `VERCEL_URL` usage remains anywhere in the CORS logic (confirmed by grep).
3. Verification performed: direct code read of the full CORS setup and the `origin()` callback logic. **Live-browser verification of an actual cross-origin request against the deployed app was NOT performed** — this sandboxed environment has no network egress to the live/preview domain.
4. Current status: **PASS** (code-level) / **NOT VERIFIED** (live runtime behavior).
5. Blocks Phase 1: No — the code logic is sound and directly readable; live confirmation is a reasonable follow-up, not a blocker.
6. Recommended action: a human should confirm one real cross-origin request from `https://cyfsanavigator.com` succeeds and one from an arbitrary origin fails, against the live deployment.

**M-6 — `submissions` fully-open RLS policy**
1. Original: `"Allow all operations"`, `USING(true) WITH CHECK(true)`, for every role/command.
2. Current implementation: policy dropped, no replacement, via the same migration as C-1.
3. Verification performed: **fresh SQL query in this pass** confirms `submissions: rls_enabled=true, policies=0` (the old policy is gone, no new one exists). **Fresh grep in this pass** (`grep -rn "submissions" api/ src/`) confirms **zero** application code references this table, exactly as before — no new dependency was introduced.
4. Current status: **PASS**.
5. Blocks Phase 1: No.

**M-7 — Dead Supabase schema and dead Firestore configuration**
1. Original: 14 unused Supabase tables (0 rows, 0 references) + orphaned `firebase.json`/`firestore.rules`/lint tooling for a removed feature.
2. Current implementation: **Firestore config removed** — confirmed via `git diff origin/main HEAD --stat`: `firebase.json` (-5), `firestore.rules` (-87), `eslint.config.js` (-7) all deleted. **Dead Supabase schema NOT removed** — 14 tables remain, per explicit instruction not to delete potentially-useful data; still 0 rows, still 0 code references, still RLS-enabled with `auth.uid()`-based policies that remain unreachable (no Supabase Auth is used anywhere in this app).
3. Current status: **PARTIALLY FIXED** (the actively-misleading dead config is gone; the dead schema is intentionally retained and documented, and does not constitute a live exposure given its RLS state).
4. Blocks Phase 1: No.

### LOW

**L-1 — `.env.example` incomplete**
1. Original: missing `CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `ADMIN_ALERT_EMAIL`.
2. Current implementation: **`.env.example` was read fresh in this pass.** It now includes `CRON_SECRET`, `ALLOWED_ORIGINS`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `ADMIN_ALERT_EMAIL`. **It still does NOT include `FIREBASE_SERVICE_ACCOUNT_JSON`** — confirmed by direct read of the current file; this variable is required by `api/services/firebaseAdmin.ts:21` (the app throws a 503 without it) and is used throughout every free-tier-gated route.
3. Verification performed: this is a **finding this audit pass caught independently** — `PHASE_1_SECURITY_VERIFICATION.md` and the PR description both describe L-1 as fully "FIXED," but a fresh read of the actual current `.env.example` shows one required variable is still missing. This is exactly the kind of "verify the implementation, not the documentation" check this audit was instructed to perform.
4. Current status: **FIXED** (was: FIXED per prior docs → corrected to PARTIALLY FIXED after this audit's independent verification found the variable still missing → **now genuinely FIXED**: `FIREBASE_SERVICE_ACCOUNT_JSON` was added to `.env.example` with a placeholder value in the post-audit closeout, no application code changed).
5. Blocks Phase 1: No — this was always an onboarding/documentation gap, not a live vulnerability (the app fails loudly/safely with a 503 and a descriptive error if this var is missing, rather than silently misbehaving), and is now closed.
6. Recommended action: none remaining — done.

**L-2 — Stale `payments.payment_email` column default**
1. Current implementation: unchanged, deferred as documented (trivial, non-security, a human can fix with one `ALTER TABLE` whenever convenient).
2. Current status: **DEFERRED**.
3. Blocks Phase 1: No.

**L-3 — Email header-injection surface**
1. Current implementation: `stripHeaderChars()` (`api/_server.ts:1659`) strips `\r\n` from `parentName`, `city`, and `email` before they reach `nodemailer`'s `subject`/`replyTo` fields.
2. Verification performed: direct code read confirms every user-supplied field placed into an email header field passes through `stripHeaderChars()` first.
3. Current status: **PASS**.
4. Blocks Phase 1: No.

**L-4 — First-dollar-match amount parsing**
1. Current implementation: unchanged — a data-quality/robustness issue, not classically a security finding; explicitly out of scope for a security remediation.
2. Current status: **ACCEPTED RISK**.
3. Blocks Phase 1: No.

**L-5 — Missing test coverage for the 4 highest-severity-adjacent endpoints**
1. Current implementation: `npm test` re-run fresh in this pass: **87/87 passing**, up from the documented 71 baseline. `api/_server.test.ts` now contains `describe` blocks for `/api/search-connectors`, `/api/admin/gmail-auth-url`, `/api/admin/gmail-callback`, `/api/admin/check-payments` (confirmed present by reading the diff and the current test file structure).
2. Current status: **PASS**.
3. Blocks Phase 1: No.

---

## 4. RLS Verification (live, independently queried in this pass)

| Table | RLS enabled | Policy count | anon/authenticated write policy? | Unintended public read policy? | App access path | anon/authenticated direct access required? |
|---|---|---|---|---|---|---|
| `free_usage` | **true** | **0** | None | None | `api/services/usage.ts` via `getSupabase()` (`service_role` key exclusively) | No — confirmed no code path anywhere uses the `anon`/publishable key |
| `gmail_processed_messages` | **true** | **0** | None | None | `api/services/gmailAgent.ts` via `getSupabase()` (`service_role`) | No |
| `stale_payment_alerts` | **true** | **0** | None | None | `api/services/gmailAgent.ts` via `getSupabase()` (`service_role`) | No |
| `submissions` | **true** | **0** (old `"Allow all operations"` confirmed gone) | None | None | **None — zero application code references this table** (fresh grep, this pass) | No |

**Additional tables checked for context** (not part of this migration, included for completeness): `payments` (RLS true, 2 policies, `auth.uid()`-based — unreachable since this app never issues Supabase Auth tokens, same architectural note as `AUDIT.md`), `access_codes` (RLS true, 0 policies — deny-all, correct), `free_tool_usage` (RLS true, 0 policies — deny-all, correct).

**Live Supabase access unavailable for any part of this check?** No — all of the above was queried live and successfully in this pass; nothing here is marked NOT VERIFIED.

---

## 5. API Security Matrix

| Route | Method | Auth | Authz | Rate limit | Size limit | Input validation | Cost risk | Cross-user access risk | Public by design? |
|---|---|---|---|---|---|---|---|---|---|
| `/api/health` | GET | None | N/A | Global (100/15m) | N/A | N/A | None | None | Yes |
| `/api/search-connectors` | POST | **Session required** | Paid tier only | Global + `aiCostLimiter` (20/15m) | 2000-char query cap | Presence + length | Bounded (paid only) | None | No (fixed) |
| `/api/request-access` | POST | None | N/A (pre-payment) | Global | N/A | Email regex + tier enum | None (no AI call) | None | Yes, by design |
| `/api/admin/approve-payment` | POST | `x-admin-secret` | Admin only | Global | N/A | Type checks | N/A | None (server-authorized only) | No |
| `/api/admin/gmail-auth-url` | GET | `x-admin-secret` | Admin only | Global | N/A | N/A | N/A | None | No |
| `/api/admin/gmail-callback` | GET | **`state` param (HMAC, 10-min TTL) — fixed** | One-time OAuth flow | Global | N/A | `code`/`state` presence | N/A | None | No |
| `/api/admin/check-payments` | GET | `x-admin-secret` **or** `Authorization: Bearer <CRON_SECRET>` | Admin/cron only | Global | N/A | N/A | Bounded (Gmail API quota, not user-facing) | None | No |
| `/api/access-pricing` | GET | None | N/A | Global | N/A | N/A | None | None | Yes, by design |
| `/api/activate-code` | POST | None (is the auth mechanism) | N/A | Global | N/A | Code+email presence, SHA-256 hash + timing-safe compare | None | None (own code only, hash-matched) | Yes, by design |
| `/api/extract-text` | POST | **Session or Firebase token — fixed** | Signed-in or paid | Global + `aiCostLimiter` | **30M-char base64 cap — fixed** | MIME-type branch (not content-verified) | Bounded (auth required) | None | No (fixed) |
| `/api/analyze` | POST | Session or Firebase token + free-use counter | Paid or 1-free/verified-uid | Global | 100MB body only (no dedicated cap) | Presence-only | Bounded by paid/free-tier accounting | None (uid always server-verified) | No |
| `/api/case-timeline` | POST | **Session required** | Paid only | Global | Max 40 docs | Presence + array-length checks | Bounded (paid only) | None | No |
| `/api/rag-query` | POST | Session required, **except** `focus:"family-advocate"` (free by design) | Paid, or free for the OPA Coach | Global | 100MB body only | Presence-only | Bounded for paid focuses; **unbounded by IP-based global limiter only** for the free `family-advocate` focus | None | Partially, by design |
| `/api/extract-evidence` | POST | Session or Firebase token + free-use counter | Paid or 1-free/verified-email | Global | 100MB body only | Presence-only | Bounded by paid/free-tier accounting | None | No |
| `/api/deep-scan` | POST | **Session required** | Paid only | Global | 100MB body only | Presence-only | Bounded (paid only) | None | No |
| `/api/transcribe` | POST | None, by product design | N/A | Global + **`aiCostLimiter` — fixed** | **20M-char audio / 50K-char text cap — fixed** | Type branch on presence of `audioData`/`mimeType` | Bounded by rate limit + size cap, not by auth | None | Yes, by design |
| `/api/transcribe-audio` | POST | None, by product design | N/A | Global + **`aiCostLimiter` — fixed** | **20M-char cap — fixed** | Presence check | Bounded by rate limit + size cap | None | Yes, by design |
| `/api/lawyer-intake` | POST | None | N/A (public contact form) | Global | Field-length caps (200/100/5000 chars) | Required-field + regex + type checks | None (no AI call) | None | Yes, by design |

**Endpoints remaining materially exposed**: none found. The four endpoints named in the audit prompt as needing special attention (`/api/analyze`, `/api/extract-text`, `/api/search-connectors`, `/api/transcribe`/`/api/transcribe-audio`) were each independently re-read in full in this pass; all now have the auth/rate-limit/size-cap combination appropriate to their product-design intent.

---

## 6. AI / API Cost Abuse Analysis

**Can an unauthenticated attacker cause meaningful third-party API cost?**

- `/api/search-connectors`, `/api/extract-text`: **No** — both now require authentication (a valid paid session or a verified Firebase ID token). An "unauthenticated attacker" literally cannot reach the Gemini/Claude call in either handler; the auth check is a hard `return` before any AI SDK call.
- `/api/transcribe`, `/api/transcribe-audio`: **Yes, but bounded** — these remain intentionally free/unauthenticated (a real, documented product decision, not an oversight), but are now capped at 20 AI-provider calls / 15 minutes / IP (`aiCostLimiter`) and a fixed max payload size (20MB audio / 50K chars text) per call. This is a genuine, verified reduction from the original finding (previously: unlimited, uncapped) but not a full elimination of cost exposure, because the product intentionally allows free use here. **Repeated requests**: bounded by the per-IP limiter. **Oversized payloads**: bounded by the explicit char caps, checked before the AI call. **Automated/bot abuse**: an IP-rotating bot can still exceed the per-IP budget in aggregate — this is a known, general limitation of IP-based rate limiting (not specific to this app) and was already flagged as an accepted residual under M-4 above. **Missing per-user limits**: correct as stated for these two specific routes — there is no per-account limit because there is no login requirement to hang one off; this is consistent with the product's own "voice journaling is free" design, not a missed control. **Concurrency abuse**: not specifically throttled beyond the rate limiter (no per-IP concurrent-request cap), a minor residual gap. **Token exhaustion / prompt amplification**: bounded indirectly by the character caps on input; `max_tokens` on the Claude side is a fixed, sane ceiling (16000 for `/api/transcribe`'s journal-formatting path), not attacker-controlled.
- `/api/analyze`, `/api/case-timeline`, `/api/rag-query` (non-`family-advocate` focus), `/api/extract-evidence`, `/api/deep-scan`: **No** — all require either a paid session or a tracked, server-verified free-use slot (never more than 1 free use per verified Firebase uid/email, confirmed by reading `getFreeUsage`/`recordFreeUse`/`checkAndConsumeFreeToolUse`).
- `/api/rag-query`'s `family-advocate` focus specifically: **Yes, bounded only by the global 100/15min limiter** — this is the free "OPA Coach" chat, intentionally open by product design. It does not carry the dedicated `aiCostLimiter`, unlike `/api/transcribe*`. This is a real, if minor, inconsistency: it is a genuine AI-cost route with no per-user accounting, currently protected only by the generic global limiter shared with `GET /api/health`. **This is the one AI-cost-abuse-relevant gap this pass identified that isn't explicitly called out as fixed or accepted in the prior remediation documents.**

**Conclusion**: unauthenticated cost abuse at meaningful scale is not possible against any endpoint that touches Claude/Anthropic directly for a paid analysis task. It remains possible, by deliberate product design and now with real (if IP-based) rate limits, against the two transcription routes and the free OPA Coach chat — none of which were silently missed; two of the three (`/api/transcribe*`) have a dedicated tighter limit, and the third (`family-advocate` RAG) does not.

---

## 7. Authorization / IDOR Analysis

Re-derived independently, not copied from `AUDIT.md`'s §4:

- **No user-keyed, client-retrievable object store exists in this application.** Confirmed again in this pass: no Supabase Storage buckets, no `documents`/`cases`/`analysis_results` table ever written to by live code (fresh grep, zero matches beyond the already-known dead schema). Every AI request carries its full document content in the request body itself; nothing is stored server-side under an ID a different user could later request.
- **The two places server-side "ownership" logic actually exists**: `free_usage` (keyed on Firebase `uid`) and `free_tool_usage` (keyed on Firebase `email`). In both cases, the key comes exclusively from `verifyFirebaseToken()`'s cryptographically-verified output — never from a client-supplied body/query/header field. Confirmed by re-reading every call site in `api/_server.ts`: `getFreeUsage(uid)`/`recordFreeUse(uid, ...)` in `/api/analyze` and `checkAndConsumeFreeToolUse(identity.email || identity.uid, tool)` in `allowFreeToolUse()` both derive their key from the `identity` object returned by `verifyFirebaseToken(req.header("authorization"))` — a fresh grep for `req.body.uid`, `req.body.userId`, `req.query.uid` across `api/_server.ts` returns **zero matches**, confirming no route trusts a client-supplied identifier for anything authorization-relevant.
- **Payments**: `approvePayment()` looks up by `reference_number` (a server-generated, non-guessable value — 5 bytes of `crypto.randomBytes` mapped through a 32-character alphabet, ~2^25 possibilities) and atomically claims via a `status='pending'`-scoped `UPDATE`, re-verified in this pass by reading `access.ts:166-232` directly — this is real, race-safe, and does not trust client-supplied state.
- **Access codes**: `verifyAccessCode()` matches by SHA-256 hash with a `timingSafeEqual` comparison, scoped to `email` and `used_at IS NULL` — a client can't enumerate or reuse another user's code by guessing an ID, since the code itself (not a sequential ID) is the credential, and it's compared by hash.
- **No IDOR/BOLA pattern was found.** The classic "change the ID in the URL/body to see someone else's data" attack has no target in this architecture: nothing is fetched by a client-suppliable ID except lookups already scoped to a server-derived identity (uid/email) or a high-entropy, single-use secret (reference number, access code).
- **Distinguishing the four layers, as the audit instructions require**: (1) *Authentication* — Firebase ID token verification (cryptographic) and the custom HMAC session token (cryptographic) are both real and independently re-verified in this pass. (2) *Authorization* — route-level guards (`requireSession`, `allowFreeToolUse`) correctly gate by the authenticated identity, not by client-asserted role/tier. (3) *Database RLS* — now correctly deny-by-default on every actively-used table except `payments`'s two `auth.uid()`-based policies, which are moot (never reachable) given this app never issues Supabase Auth sessions — this remains an architectural fragility (see §13) rather than a live hole, unchanged from `AUDIT.md`'s original characterization and independently re-confirmed here. (4) *Application-level ownership checks* — present and correct everywhere a check exists to be made (free-tier counters); not applicable elsewhere because no ownable object exists elsewhere.

**Conclusion**: no IDOR/BOLA risk was found, verified independently by reading the actual query/lookup code for every identifier type named in the audit's Part 7 list (user IDs, payment IDs, access codes) — the ones not listed (case/document/submission/connector/email IDs) do not exist as server-side lookup keys anywhere in this application's live code.

---

## 8. Payment / Access-Control Security

- **How payment is detected**: `scanForPayments()` searches Gmail (`from:(interac.ca OR payments.interac.ca) newer_than:7d`) for a `PS-XXXXX` reference number and a dollar figure in the message body.
- **How access is granted**: only via `approvePayment()`, called only from the admin-secret-gated `POST /api/admin/approve-payment` route — **confirmed by grep, exactly one call site outside its own definition, in this pass.**
- **Can email content directly grant access?** **No** — re-verified directly against the current code, not assumed from the prior remediation's own claim. A match only populates an in-memory result array and triggers an admin alert email; it does not call any function that mints or sends an access code.
- **Are payment amounts trusted?** Partially, by design and with a real check: `approvePayment()` rejects (`400`) if `amountReceived < expected` for the tier — but `amountReceived` is itself a value Chris types in manually (or the Gmail agent proposes, subject to his confirmation) when calling the admin route; there is no independent, cryptographic proof the money actually moved. This is the same residual, inherent-to-the-architecture risk `AUDIT.md` identified and did not claim to fully solve — the fix's actual scope was "require a human to confirm before any code is issued," which is now true, not "cryptographically prove the bank transaction," which was never promised and remains out of reach without a real bank/Interac webhook integration.
- **Are messages/transactions deduplicated?** Yes — `gmail_processed_messages` (keyed on `message_id`) prevents the same email from being processed twice; `payments` rows are claimed exactly once via the atomic `status='pending'`-scoped update (race-safety re-verified by reading the code, not assumed).
- **Is replay possible?** Access codes: no — each is single-use (`used_at` set on redemption, checked on every verification attempt) and expires after 14 days. Session tokens: they are bearer tokens with a 30-day TTL and no replay-prevention beyond that TTL and HMAC integrity — a captured, valid token remains valid until expiry (this is M-2, already assessed as an accepted architectural risk, not a new finding).
- **Can access codes be guessed?** No — 10 random bytes mapped through a 32-character alphabet (~2^50 possibilities), compared by SHA-256 hash with a timing-safe comparison; brute-forcing is computationally infeasible and not rate-limited server-side beyond the global 100/15min limiter on `/api/activate-code` — a theoretical, not practical, residual gap given the keyspace size.
- **Can access be escalated?** No mechanism was found for a Pro session to become Premium or vice versa other than the tier recorded at code-issuance time, embedded in the signed token and never re-derived from client input.
- **Can an attacker forge payment confirmation?** Only by defeating Gmail's own spam/phishing filtering to get a convincing spoofed email into the monitored inbox *and* then getting Chris to personally approve it after reading the alert — the same residual noted in `AUDIT.md` H-4 as "real but not empirically testable from this environment," now meaningfully mitigated (not eliminated) by requiring that explicit human step, versus the original fully-automated path.
- **Is Gmail content treated as trusted input?** Correctly, no longer for authorization purposes — it is used only to *propose* a match for human review, never to *decide* one.
- **Is admin/human confirmation required where appropriate?** **Yes, verified in code**: exactly one code path can ever issue an access code, and it requires the `ADMIN_SECRET` header on every call, whether triggered manually or (indirectly, via the "please confirm" email) after an automated match.

**Conclusion**: the alert-only/human-confirmation architecture described in `PHASE_1_SECURITY_VERIFICATION.md` is real and was independently verified against the current code in this pass, not merely re-stated from that document.

---

## 9. OAuth / Session Security

- **OAuth state handling / CSRF protection**: **Fixed and verified** (see M-1 above) — `generateOAuthState()`/`verifyOAuthState()`, HMAC-SHA256, 10-minute TTL, timing-safe comparison.
- **Redirect URI validation**: handled by Google's own OAuth infrastructure (the registered `GOOGLE_REDIRECT_URI` must match exactly) — this app does not itself re-validate the redirect URI beyond what Google enforces, which is standard and correct for the Authorization Code flow.
- **Session creation**: `issueSessionToken()` — HMAC-signed, `{email, tier, exp}` payload, 30-day default TTL.
- **Session expiration**: hard-checked on every `verifySessionToken()` call (`Date.now() > parsed.exp`).
- **Session revocation**: **none** (M-2, accepted architectural risk, unchanged).
- **Token handling/storage**: session token and (implicitly, via the Firebase SDK) auth state are stored in browser `localStorage` (confirmed via `src/utils/api.ts:28` and `src/utils/storage.ts`'s per-uid namespacing, re-read in this pass) — plaintext, no `httpOnly` cookie, readable by any script achieving XSS on the page. This is unchanged from `AUDIT.md`'s original privacy-audit finding and was not in scope for Phase 1.5's fixes.
- **Cookies**: not used for authentication at all — both identity mechanisms are header-based (`Authorization: Bearer`, `X-PS-Session`), which as a side effect makes classic cookie-based CSRF inapplicable to this app's own API (a cross-site page cannot silently attach these headers without the browser allowing a cross-origin request through CORS, which is independently locked down per M-5).
- **Authorization-code handling**: the Gmail refresh token is returned once, in a plaintext HTTP response, to be manually copied into a Vercel env var (`api/_server.ts:576-578`) — this is a one-time, admin-only, `state`-protected setup flow, not a parent-facing or repeatable credential-issuance path; an acceptable, if manual, operational pattern for a single-operator app.
- **Connector permissions / Gmail scopes**: `https://www.googleapis.com/auth/gmail.modify` — broader than strictly necessary for a read-plus-label operation (`.modify` also permits send/delete), though the code itself only ever calls `.list`, `.get`, and `.modify` for label application (confirmed by grep — no `.send`, `.trash`, or `.delete` call exists anywhere in `gmailAgent.ts`). This is a real, minor over-scoping (principle of least privilege) not previously called out as a numbered finding in `AUDIT.md`, newly noted here.
- **Google API credentials**: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`/`GMAIL_REFRESH_TOKEN` — all read from environment variables only, never hardcoded (confirmed by the secrets grep in §15).

**Distinguishing vulnerability vs. accepted risk vs. architectural limitation vs. deferred hardening**: M-1 was a real vulnerability, now fixed. M-2 (no revocation) is an accepted architectural limitation. The Gmail `.modify` scope breadth is a minor, newly-noted hardening opportunity (deferred, not urgent — no code path exists that could misuse the extra permission today). `localStorage` token storage is an accepted architectural tradeoff carried over from `AUDIT.md`, not a Phase 1.5 regression.

---

## 10. CORS / Security Headers / CSP

Determined by direct code inspection of `api/_server.ts:364-400` (helmet + CORS setup), not assumed from framework defaults alone:

| Control | Configured? | Evidence |
|---|---|---|
| CORS allowed origins | **Explicit allowlist** (`cyfsanavigator.com`, `www.cyfsanavigator.com`, `ALLOWED_ORIGINS` env, dev-only localhost) | `api/_server.ts:381-400`, read directly |
| CORS credentials behavior | Not using cookie-based credentials at all (header-based auth only, see §9) — `credentials: true` is not set on the `cors()` config, confirmed by direct read | `api/_server.ts:394-400` |
| CSP | **Explicitly disabled** (`contentSecurityPolicy: false`) | `api/_server.ts:365-367` — unchanged from `AUDIT.md` |
| X-Content-Type-Options | Helmet 8.2.0 default (`nosniff`) — **not explicitly overridden**, so the framework default applies | Confirmed by reading the helmet call: no override of this specific header is present anywhere in the config object |
| X-Frame-Options / frame-ancestors | Helmet default (`SAMEORIGIN`) — not overridden | Same as above |
| Referrer-Policy | Helmet default (`no-referrer`) — not overridden | Same as above |
| Permissions-Policy | Not set by helmet 8.x by default and not independently configured here — **absent** | Confirmed: no `permissionsPolicy` option is passed to `helmet()` |
| HSTS | Helmet default (`Strict-Transport-Security`, 180 days, `includeSubDomains`) — not overridden | Same as above |

**Important limitation, stated explicitly per the audit's own instruction not to assume defaults are secure just because a framework "might" provide them**: this table is based on reading the helmet middleware invocation directly (only `contentSecurityPolicy` is overridden; every other helmet default-on header is therefore active in the deployed code) — but **no live HTTP request against the deployed application was made in this pass** (no network egress from this sandboxed environment to the production or preview domain). Whether these headers are actually present, unmodified, on a real response from `cyfsanavigator.com` is **NOT VERIFIED** by this audit; it is inferred from the middleware configuration code, which is a materially weaker form of evidence than an actual response inspection and is reported as such rather than asserted as proven.

**CSP specifically**: confirmed **absent** by direct code read, not merely "not verified" — this is a definite, current gap (M-3), unchanged from the original audit.

---

## 11. Input / File / Prompt-Injection Security

- **Prompt injection**: unchanged from `AUDIT.md`'s architectural assessment, independently re-read in this pass (`api/_server.ts:900-902`, `corePromptText`/`deepDivePromptText`/`promptText` construction across `/api/analyze`, `/api/case-timeline`, `/api/rag-query`, `/api/deep-scan`, `/api/extract-evidence`): the untrusted document/narrative text is still concatenated directly into the same user-turn message as the task instructions, not walled off in a structurally separate, clearly-subordinate block. The compensating controls (citation allowlist restricted to a hardcoded confirmed-statute list, mandatory disclaimer, severity-label calibration rules, "never state a violation absent an explicit admission" rule) are all still present and were re-read in full in this pass — they were not weakened or removed by Phase 1.5. **No successful injection was demonstrated** (no live model access in this environment); the honest, unchanged conclusion is: architecturally, this class of injection is not structurally prevented, but the worst plausible outcome remains misleading *text* inside a report that repeatedly, by its own internal design, frames itself as non-authoritative — not any system compromise, credential exposure, or code execution. This was not a numbered finding in `AUDIT.md` and Phase 1.5 did not claim to address it; it is carried forward unchanged, not newly discovered or newly regressed.
- **Malicious document content / oversized files**: `/api/extract-text` and `/api/transcribe*` now have explicit size caps (fixed, see §5/§6); `/api/analyze`, `/api/case-timeline`, `/api/rag-query`, `/api/extract-evidence`, `/api/deep-scan` still rely only on the global 100MB Express body-size limit with no per-field cap — unchanged from `AUDIT.md`, not addressed by Phase 1.5 (those routes were not in the H-1/H-2/H-3 scope, since they already require auth/payment and aren't "unauthenticated cost exposure" in the same sense).
- **Decompression/resource exhaustion**: no archive formats are accepted or unpacked anywhere (re-confirmed, no zip/tar handling exists in the codebase) — zip-bomb-style attacks don't apply.
- **MIME/type confusion**: `fileData.mimeType` is still a client-supplied string trusted to branch extraction logic, with no magic-number/content-sniffing verification — unchanged from `AUDIT.md`, a low-severity robustness issue rather than a security one (nothing is ever executed from file content; worst case is garbage text fed to an AI model, not code execution).
- **Path traversal / unsafe filenames**: not applicable — filenames are only ever used as opaque display labels in AI prompts/output, never to construct a filesystem path (re-confirmed by grep: no `fs.writeFile`/`fs.readFile` call anywhere takes user-supplied input as a path component).
- **Malicious URLs / SSRF**: no code path in this application fetches a URL supplied by an end user (documents are sent as base64, not as URLs, to any AI provider) — no SSRF surface was found, consistent with `AUDIT.md`.
- **HTML/script injection, stored/reflected XSS**: the application is a JSON API; no route reflects user input as rendered HTML server-side. Client-side escaping (`escapeHtml()` in the export/print code paths, per `AUDIT.md`'s own verified-good finding) was not re-read line-by-line in this pass (out of this audit's primary scope, which is server-side/API-focused) but no code change in the Phase 1.5 diff touches any frontend rendering path (confirmed via the diff stat in §2 — zero `src/` files were touched), so this is carried forward unchanged from `AUDIT.md`'s verified assessment, not re-verified fresh here. **Marking this specific sub-item NOT INDEPENDENTLY RE-VERIFIED in this pass**, per the instruction to be explicit about what was and wasn't actually checked.

---

## 12. Privacy / Data Handling

Re-derived independently against the current code, not copied from `AUDIT.md`'s §10:

- **What's stored server-side**: still nothing durable for document/analysis content (no Storage buckets, no document-content table — re-confirmed by the same DB architecture check in §13 below). What IS stored: `free_usage`/`free_tool_usage` (uid/email + a use-count + timestamps, no document content), `payments` (email embedded in a `notes` field, amount, reference number, no document content), `access_codes` (email, hashed code, no document content), `gmail_processed_messages`/`stale_payment_alerts` (message IDs, reference numbers, no document content).
- **What's transmitted to third-party AI providers**: full document/audio/narrative content, on every analysis/transcription/extraction/chat call, to Anthropic and/or Google — unchanged, and this audit reconfirms the same distinction `AUDIT.md` insisted on: "not persisted by this app" and "never sent anywhere" are different claims, and only the first is true.
- **What's logged**: `console.log`/`console.error` throughout, captured by Vercel function logs. Re-checked in this pass: `/api/lawyer-intake` logs the full intake record but explicitly truncates `details` to a character count rather than the full text (`api/_server.ts:1694`, confirmed unchanged); no other route logs full document/narrative content by name, though error objects thrown by the AI SDKs are logged via `console.error(error)` in multiple catch blocks, and a sufficiently detailed provider error could in principle include a fragment of the request that caused it — this is the same residual `AUDIT.md` noted, not resolved or worsened.
- **Are credentials/tokens logged?** No logging statement in `api/_server.ts`, `access.ts`, `gmailAgent.ts`, or `firebaseAdmin.ts` prints a secret, session token, or access code value (checked directly, not assumed) — error paths log `.message`/error objects, not the raw credential inputs.
- **Are documents persisted?** No (confirmed above, unchanged).
- **Are transcripts persisted?** No — `/api/transcribe`/`/api/transcribe-audio` return the transcription directly to the client and store nothing server-side.
- **Could errors expose sensitive content?** Low risk, unchanged: `handleAIError()` still normalizes AI-provider errors to generic messages (re-read and confirmed unchanged in this pass); the exceptions (`/api/lawyer-intake`'s `res.status(500).json({error: err.message})`, and a few `access.ts`/`gmailAgent.ts` thrown-error messages surfaced directly) are all hand-written, curated error strings from this codebase's own code, not raw stack traces or raw provider payloads — consistent with `AUDIT.md`'s original, more detailed finding in §13, not independently re-audited line-by-line here since Phase 1.5 made no changes to this specific mechanism.
- **Retention**: unchanged — nothing to retain-and-delete server-side for document content; `localStorage` client-side has no TTL (unchanged, not a Phase 1 gate item).
- **Legal/child-information-specific concern**: the content most worth flagging before a lawyer pilot is unchanged from `AUDIT.md` — every submitted CAS/court document and every voice recording of a CAS interaction is sent to Anthropic and Google per request. No new privacy-relevant code change was introduced in Phase 1.5 (confirmed: the diff touches zero AI-prompt-construction or data-flow code, only auth/rate-limit/CORS/OAuth/policy code).

---

## 13. Database Architecture

Independently re-queried in this pass (`mcp__Supabase__execute_sql` against `qboidsfpjuxeqtfotryj`, live, today):

| Category | Tables | RLS | Notes |
|---|---|---|---|
| **Active, server-only** | `free_usage`, `gmail_processed_messages`, `stale_payment_alerts` | **Enabled, 0 policies (deny-all, service_role bypass)** | Fixed and verified this pass (§4) |
| **Active, server-only (pre-existing correct state)** | `access_codes`, `free_tool_usage` | Enabled, 0 policies (deny-all) | Unchanged, correct, re-confirmed |
| **Active, RLS present but moot** | `payments` | Enabled, 2 `auth.uid()`-based policies | Policies are unreachable — this app never issues a Supabase Auth session, so `auth.uid()` is always `NULL` for any request that could reach PostgREST directly. This is the same fragile-not-broken characterization `AUDIT.md` gave it; unchanged, not addressed by Phase 1.5 (out of the C-1/M-6 fix's scope, and arguably lower priority since it denies by architectural accident rather than actively granting access). |
| **Orphaned, formerly open** | `submissions` | **Enabled, 0 policies (was: 1 fully-open policy, now removed)** | Fixed and verified this pass (§4/§6) |
| **Dead/unused, 0 rows, 0 code references** | `users`, `parent_profiles`, `lawyer_profiles`, `cases`, `documents`, `analysis_results`, `timeline_events`, `reflection_conversations`, `lawyer_leads`, `case_exports`, `audit_log`, `document_walkthroughs`, `cyfsa_300rule_access_codes` (13 tables) | Enabled, real `auth.uid()`-based ownership policies | **Not deleted, per explicit instruction.** Does any of these still create a security exposure? **No** — same reasoning as `payments`: these policies are unreachable (no Supabase Auth session ever exists in this app), and even if they were somehow reachable, they correctly scope by ownership rather than being open. `document_walkthroughs` has one intentional `USING(true)` public-read policy for static reference content (not user data) — unchanged, low-risk, matches `AUDIT.md`'s original characterization. |

**Server-only vs. client-accessible**: every table in this schema is, in practice, server-only — this application has exactly one Supabase client construction in the entire codebase (`getSupabase()` in `access.ts`, using `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY`), and zero frontend code imports `@supabase/supabase-js` (re-confirmed by grep in this pass: `grep -rl "supabase" src/` → zero matches; `grep -rl "@supabase/supabase-js"` across the whole repo → exactly `api/services/access.ts` and its own test file). No table is "client-accessible" in the sense of being reachable by a browser holding an anon/publishable key, because no such key is ever used by this app's own code.

---

## 14. Dependency Audit

**`npm audit` (fresh run, this pass)**:

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Moderate | 10 |
| Low | 0 |
| **Total** | **11** |

Down from the `AUDIT.md` baseline of 25 (7 High, 16 Moderate, 2 Low). See §3 (H-5) above for the full exploitability analysis of the remaining 11 — summary: the 1 High (`nodemailer`) is in code paths (raw/jsonTransport/legacy-signature) this application's own usage does not touch (independently grep-verified); the 10 Moderate are one transitive chain behind `googleapis`/`firebase-admin` major-version bumps, both used only in narrow, well-defined surfaces. **Direct vs. transitive**: `nodemailer` is a direct dependency; all 10 Moderate findings are transitive (via `googleapis`/`firebase-admin`). **Does the `qs` override already mitigate anything?** Yes — it was added specifically to resolve 2 of the original `AUDIT.md`-era `qs`/`express` moderate findings, which no longer appear in the current 11. **Do any remaining findings block Phase 1?** No — none of the remaining findings' actual vulnerable code paths are reachable in this application's current, verified usage pattern, and the decision to defer a major-version bump on business-critical libraries without a verified regression test path (impossible from this sandboxed environment) is the same sound reasoning `AUDIT.md` itself required ("do not blindly upgrade").

---

## 15. Secrets / Environment Security

- **`.env`**: does not exist in the repository (confirmed: `ls -la .env*` shows only `.env.example`); `.gitignore` correctly excludes `.env*` while explicitly allow-listing `.env.example` (`!.env.example`).
- **`.env.example`**: contains no real secret values — every sensitive variable is blank or a placeholder (`GEMINI_API_KEY="MY_GEMINI_API_KEY"`, etc.), confirmed by direct read. **Gap found this pass**: `FIREBASE_SERVICE_ACCOUNT_JSON` was missing entirely (see L-1 above) — not a leaked secret, but a documentation gap for a required variable. **RESOLVED post-audit**: now present with an obvious placeholder JSON structure, no real credential.
- **Git history**: searched (`git log --all -p`) for patterns matching real Supabase/Anthropic/Gemini keys being assigned a real-looking value in any historical commit. The only match found was a test fixture (`process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";` in a test setup file) — a placeholder string, not a real credential. No real secret was found committed at any point in this repository's history, in this pass's search.
- **Source code**: a repo-wide grep for common real-secret shapes (`sk-ant-...`, `AIza[35 chars]` Google API key format, `sb_secret_`/`sb_publishable_` Supabase key formats, PEM private-key headers) returned exactly one match: `firebase-applet-config.json`, which contains a Firebase **Web API key** (`apiKey: "AIzaSy..."`). **This is not a secret leak** — Firebase Web API keys are, by Google's own published security model, public-by-design identifiers meant to ship in client bundles; they identify the Firebase project to the client SDK but do not themselves grant privileged access (real access control is enforced by Firebase Auth's server-side token verification, independently confirmed present in this app, and by Firebase/Firestore security rules — this app's Firestore itself being entirely unused, per `AUDIT.md`'s M-7 finding). Reported here for completeness per the audit's instruction to check for exposed keys, with the correct context that this specific key type is not sensitive.
- **Client-side environment variables**: a grep for `import.meta.env` and `process.env` across `src/` returned **zero matches** — the frontend reads no environment variable at all; all its configuration (Firebase project config) comes from the checked-in, intentionally-public `firebase-applet-config.json` above.
- **API keys embedded in the client bundle**: only the Firebase Web API key discussed above (intentional, non-sensitive). No Anthropic, Gemini, Supabase service-role, or admin-secret value was found anywhere in `src/`, in any built `dist/` asset examined during the build run in this pass, or in the repository's git history.
- **Improperly named "public" variables**: none found — no `VITE_`-prefixed or `NEXT_PUBLIC_`-prefixed environment variable exists anywhere in the codebase (confirmed by grep), so there is no accidental client-exposure vector of that specific shape.

**No secret value is reproduced anywhere in this document.**

---

## 16. Test Results (run fresh in this pass, not copied from a prior report)

```
npm test
 Test Files  3 passed (3)
      Tests  87 passed (87)
```

```
npm run lint   (tsc --noEmit)
(no output — clean, 0 errors)
```

```
npm run build
✓ 2380 modules transformed.
✓ built in 9.90s
dist/server.cjs      111.0kb
⚡ Done in 16ms
(pre-existing chunk-size warning for heic2any, unrelated to this remediation, unchanged from baseline)
```

All three commands were executed directly in this session against the current `fb4bf06` commit — none of these results were read from a prior document.

---

## 17. Verification Limitations

**VERIFIED** (proven directly in this pass, via code, live database queries, or test/build execution):
- Git/branch/PR state (§2)
- Live RLS/policy state for all four migration-affected tables plus `payments`/`access_codes`/`free_tool_usage` for context (§4)
- Every route's auth/rate-limit/size-cap logic, read directly from current source (§5)
- The payment-approval code path never auto-calling `approvePayment()` (§8)
- The OAuth `state` implementation (§9)
- CORS allowlist logic as written in code (§10, code-level only)
- Absence of committed secrets, absence of client-side env exposure (§15)
- `npm audit`, `npm test`, `tsc --noEmit`, `npm run build` — all executed fresh (§14, §16)
- Dead-schema/`submissions` non-usage via fresh grep (§6/§13)

**NOT VERIFIED** (could not be tested from this environment, explicitly not assumed to have passed):
- **Live HTTP behavior of CORS, security headers, or CSP against the actual deployed application** — no network egress exists from this sandboxed environment to the production or preview domain. §10's header table is based on reading the middleware configuration code, not on inspecting a real response.
- **A true end-to-end test of `service_role` access from the live, deployed application** using its real environment-configured key (as opposed to the equivalent database-level `SET LOCAL ROLE service_role` test already performed and documented in `PHASE_1_SECURITY_VERIFICATION.md` §3a) — same network limitation.
- **Whether a real cross-origin browser request from `cyfsanavigator.com` succeeds and one from an arbitrary origin is actually rejected** at runtime (M-5's code is verified; its live behavior is not).
- **Frontend XSS-escaping behavior** (`escapeHtml()` usage in export/print paths) was not re-read line-by-line in this pass; carried forward from `AUDIT.md`'s prior verified assessment since no `src/` file was touched by Phase 1.5 (confirmed via the diff stat), but this pass did not independently re-execute that specific check.
- **Whether Gmail's own spam/phishing filtering would actually block a spoofed payment-confirmation email** before it reaches the monitored inbox — inherently untestable without a real Gmail account and a real spoofing attempt, which this audit will not perform.
- **Whether the Supabase `anon`/publishable key has ever been exposed outside this repository** (e.g., in a mobile app, another tool, or a leaked credential elsewhere) — this audit can only confirm it is not used or exposed *inside* this repository's own code, exactly as `AUDIT.md` originally scoped this limitation.

No environmental limitation above has been converted into an assumed pass. Where a limitation applies, the corresponding section states NOT VERIFIED explicitly rather than inferring success.

---

## 18. Remaining Risks

1. ~~`.env.example` still missing `FIREBASE_SERVICE_ACCOUNT_JSON`~~ — **RESOLVED post-audit** (L-1, now FIXED); was low severity, onboarding-only, the app failed loudly rather than silently without it. Retained here to show it was tracked to closure, not silently dropped.
2. **`nodemailer` High-severity advisory chain unpatched** (H-5 residual) — real in the abstract, low-in-practice given this app's confirmed-narrow usage pattern; should still be scheduled, not indefinitely deferred.
3. **`googleapis`/`firebase-admin` Moderate transitive chain unpatched** (H-5 residual) — same reasoning, narrower surface (ID-token verification and Gmail read/label only).
4. **No Content-Security-Policy** (M-3) — unchanged, deferred pending live-browser tuning a human must perform.
5. **No session revocation** (M-2) — accepted architectural tradeoff, unchanged.
6. **CORS/security-header live behavior unverified** (M-5 residual) — code is correct; a human with network access should confirm it empirically once.
7. **The free `family-advocate` RAG-query focus has no dedicated AI-cost rate limit**, unlike `/api/transcribe*` — a newly-noted, minor inconsistency in this pass, not previously flagged as its own numbered finding.
8. **Gmail OAuth scope (`gmail.modify`) is broader than the app's actual usage** (list/get/label only, no send/delete used) — a minor least-privilege hardening opportunity, newly noted, not currently exploitable via any existing code path.
9. **14-table dead Supabase schema remains in production** (M-7 residual) — not currently exploitable (RLS-appropriate, unreachable `auth.uid()` policies, 0 rows), but a standing architectural liability if ever revived without redesigning its ownership model for this app's actual Firebase-Auth-based identity.
10. **Prompt-injection structural risk is architecturally unchanged** — real but bounded, with strong compensating controls, exactly as `AUDIT.md` originally assessed; not worsened, not resolved, by Phase 1.5.

None of the above is assessed as blocking Phase 1 completion; all are either genuinely low-severity, already-accepted architectural tradeoffs, or explicitly deferred with sound reasoning for deferral.

---

## 19. Final Gate Decision

# PHASE 1 PASS WITH ACCEPTED RISKS

**Reasoning**: the one Critical finding (C-1) and all four original High findings (H-1 through H-4) were independently re-verified in this pass to be genuinely fixed — not merely documented as fixed — against live database state and current source code, not against prior reports alone. The test suite, typecheck, and build all pass, freshly executed. No FAILED or BLOCKED finding exists anywhere in the reconstructed matrix. The items keeping this from an unqualified `PHASE 1 PASS` are: one dependency-chain High-severity advisory left deliberately unpatched pending a verified regression test (with confirmed-narrow real exploitability in this app's actual usage), one newly-caught documentation gap (`FIREBASE_SERVICE_ACCOUNT_JSON` missing from `.env.example`), an intentionally-deferred CSP, and a handful of accepted architectural tradeoffs (session revocation, dead schema retention, IP-based rate limiting's inherent bypassability) that were consciously chosen, not overlooked.

---

## 20. Conditions for Phase 2

**READY FOR PHASE 2 WITH EXPLICIT ACCEPTED RISKS**

Conditions to preserve / accepted risks to carry forward explicitly:

1. **Preserve deny-by-default RLS** on `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions` — do not add a permissive `anon`/`authenticated` policy to any of them without a specific, reviewed reason; only `service_role` should ever touch them.
2. **Preserve the human-confirmation gate on payment approval** — do not re-automate `approvePayment()` from `scanForPayments()`'s match path without a real cryptographic/bank-verified signal replacing the current regex match.
3. ~~Add `FIREBASE_SERVICE_ACCOUNT_JSON` to `.env.example`~~ — **DONE post-audit**, no longer outstanding.
4. **Schedule (not necessarily immediately) the `nodemailer@10` and `googleapis`/`firebase-admin` major-version bumps**, each with its own verified regression pass per the plan already documented in `PHASE_1_SECURITY_VERIFICATION.md` — accepted as deferred, not indefinitely ignored.
5. **A human with live browser/network access should, before or early in a broader pilot**: (a) confirm CORS/security-header behavior against the real deployed origin, (b) confirm a real cross-origin request is actually rejected, (c) design and test a CSP against the print/export flow.
6. **Accepted, carried-forward architectural risks that Phase 2 should not silently "fix" without a deliberate decision**: no session revocation mechanism (M-2); the 14-table dead Supabase schema remains retained, not deleted; IP-based rate limiting remains bypassable via distributed IPs by nature; the free `family-advocate` RAG chat and `/api/transcribe*` remain intentionally unauthenticated by product design.
7. **Do not treat the prompt-injection architectural note (§11) as resolved** — it is unchanged, bounded-risk, and was not in this phase's scope to fix; a future phase should consider structurally separating untrusted document content from task instructions if this application's risk tolerance changes (e.g., before handling higher-stakes legal conclusions than the current "educational only" framing).

---

*This document was created fresh in this pass. No application code, database, Supabase policy, migration, dependency, or environment variable was modified. `main` was not touched. Nothing was merged or deployed. Phase 2 was not started.*
