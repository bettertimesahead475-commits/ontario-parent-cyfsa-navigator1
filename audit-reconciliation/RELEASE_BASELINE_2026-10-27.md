# CYFSA Navigator release baseline, 2026-10-27

Read-only. No production change, migration, merge, Facebook post, or customer-data change was made.
Unverified items are marked UNVERIFIED.

## 1. Verified commits

| Ref | SHA | Notes |
|---|---|---|
| `origin/main` | `0130a96f75f417aa9d588c8103a42dc90a8dc2fa` | Merge of PR #103 |
| Production `cyfsanavigator.com` | `0130a96f75f417aa9d588c8103a42dc90a8dc2fa` | Deployment `dpl_65ascLewK5AowJVifiZxAtpgo4vF`, `READY`, target `production`, alias `cyfsanavigator.com`, `source: git`, `githubCommitRef: main` |
| `origin/fix/analyzer-audit-findings` | `16377fe3f0ec394eda79fec8e205a96fb358f1ed` | 3 commits ahead of main, 0 behind |
| `origin/fix/audit-model-ids-and-payment-guard` | `0d8156cd7f4dce91334e7f12fc129b15f6658318` | 1 commit ahead of main, 65 behind |
| `origin/draft/official-forms-audit` (PR #107 head) | `f545844c2d4bcdb0bcd9f176500d01c02578bc35` | Draft |
| `feat/payment-identity-rebased` (primary checkout, PR #108) | `9aa312531b49df412e353dc81c1b3b863c07ed06` | Contains audit reports only |

Production equals main. There are no main-only security, billing, or analyzer changes waiting to be deployed.

## 2. Build and test results

| Target | `tsc --noEmit` | `npm run build` | Vitest total / passed / failed / pending |
|---|---|---|---|
| main `0130a96f` | exit 0 | exit 0 | 3,791 / 3,358 / 0 / 433 |
| analyzer `16377fe3` | exit 0 | exit 0 | 3,918 / 3,485 / 0 / 433 |

Correction to earlier notes: main's passed count is 3,358, not 3,368.

Limitations:
- Node v22.22.0 was used. Vercel's project is set to Node 24.x. Not re-run on Node 24.
- The 433 pending tests were not broken down by cause (skipped suites versus environment-gated suites). UNVERIFIED.
- Installs used `npm ci` from the committed lockfile.

## 3. Analysis-job authorization (step 5)

Main, `api/_server.ts`:
- `:2566` route `GET /api/analyze/job/:jobId`
- `:2576` 401 `SIGN_IN_REQUIRED` when there is no Firebase identity, no paid session, and no admin
- `:2607` `if (!isAdmin && (!job.uid || job.uid !== callerUid))` returns 403 `FORBIDDEN`

Existing tests pass on main (`api/analyzerStreamingIntegration.test.ts`, 7 passed, 2 skipped): 401 unauthenticated, 403 cross-user, 200 owner. Anonymous and cross-user reads are not reproducible.

**CONFIRMED defect (synthetic probe, main):** a caller holding only a paid-session token (no Firebase identity) cannot read back a job whose `uid` is null. The probe returned `403 FORBIDDEN`.
- Cause: a job's `uid` is `identity ? identity.uid : (uid || null)` (`api/_server.ts:2259`), and on the paid-session path `uid` stays null (`:1972`). The 403 check at `:2607` then rejects every non-admin caller for a null-uid job.
- Impact: a paying user who lost the streaming connection and has no Firebase sign-in in that browser cannot recover the report.
- The end-to-end creation of such a job was inferred from the code, not run through the full analyze route.
- The probe was a temporary test file, removed afterwards. Working tree is clean.

## 4. Payment activation paths (step 6)

On main, the only automatic process is the cron.
- `vercel.json` schedules `GET /api/admin/check-payments` every 2 minutes. `_server.ts:1125` requires `ADMIN_SECRET` or `CRON_SECRET`, then calls `scanForPayments()`.
- `scanForPayments()` (`api/services/gmailAgent.ts:316`, `:330`, `:357`) never grants access. Its matches call `sendAdminAlert` and say "No automatic activation."
- `activateTrustBasedPayment` is not called from main's Gmail code. It is defined in `access.ts:692` and reached only from tests.
- Access is granted only by `POST /api/admin/approve-payment` (`_server.ts:780`, `ADMIN_SECRET`), which calls `approvePayment` (`access.ts:879`). That claims the payment atomically (`status = 'pending'` to `approved`), checks `amountReceived >= expected` (`:891`), and issues the code.
- `POST /api/admin/payments/confirm-bank` (`_server.ts:915`) sets `bank_settlement_status` and writes an audit row. It grants nothing.

Verdict: main has no email-only grant path. CONFIRMED.

## 5. ESI composite (step 7)

Consistent across the prompt, validator, and UI.
- Eight components with maxima summing to 100 (`api/services/analyzerSections.ts:86-95`: 20+15+15+15+10+10+10+5).
- Prompt maxima match (`api/services/analyzerPrompts.ts:104-111`).
- `validateOverview` (`analyzerSections.ts:141`) clamps each component to its max (`clampInt`, `:112`) and sets `score = sum` (`:176`), discarding any model-supplied total.
- The UI reads the stored score and does not recompute it.
- Test: `api/analyzerSections.test.ts:66` expects 60 for the sample components.

Caveat: the components are scored by a model. Arithmetic is correct; the validity of the scores is a separate question.

## 6. Dependency vulnerabilities (step 8)

`npm audit`: 25 total (2 critical, 10 high, 13 moderate). Production only (`--omit=dev`): 22 (2 critical, 9 high, 11 moderate).

Reachability, by package:

| Package (severity) | Path | Reachability in production |
|---|---|---|
| dompurify (critical) | via `jspdf@4.2.1`, client bundle | UNVERIFIED. Exploitable only if jsPDF's HTML path gets untrusted input. Not checked. |
| proxy-addr (critical) | via `express@4.22.2` | Advisory concerns subnet trust. `app.set("trust proxy", 1)` (`_server.ts:569`) uses hop count, so likely not reachable. UNVERIFIED. |
| compression (high, direct) | `_server.ts:652`, every response | Reachable. DoS advisory. Upgrade to 1.8.2+. |
| body-parser (high) | Express request parsing | Reachable. DoS advisory. Upgrade. |
| nodemailer (high, direct) | `access.ts:852`, `_server.ts:3485` | Reachable. Recipient addresses come from requests, so the address-parser advisories matter. Fix is a major version (10.x); needs its own change. |
| firebase / @firebase/firestore / @grpc/grpc-js (high) | client SDK and admin | UNVERIFIED whether Firestore code paths are used. |
| source-map-js (high) | transitive | Build-time. Low. |
| vite (high, listed as production) | dev server | Dev-server advisories. Not reached by the production server. |

Recommendation: upgrade compression and body-parser (minor-version fixes); plan nodemailer as a separate change with tests.

## 7. Marketing agent and Facebook (steps 12–13)

Verified from code and read-only Vercel metadata. No Facebook call, no post, no Meta change.

| Requirement | Status |
|---|---|
| `FACEBOOK_PAGE_ID` in production env | **Missing** (names listed, `hiddenProductionEnvCount: 0`) |
| `FACEBOOK_PAGE_ACCESS_TOKEN` in production env | **Missing** |
| `META_APP_ID`, `META_APP_SECRET` | Present (production) |
| Meta App Review for `pages_manage_posts` | Required by the adapter's own comment. Status with Meta UNVERIFIED. |
| `marketing_posts` and related tables on the live project | **Missing** (`information_schema`, `supabase_migrations.schema_migrations`). Repo migration `supabase/migrations/20261005_marketing_agent.sql` is not applied. |
| Human approval gate | Present. `publisher.ts:43-58` publishes only `approved`/`scheduled`/`failed` posts with `approved_by`. |
| Kill switch | None found in code. |

Classification:
- Missing tokens: yes (Page ID and Page access token).
- Missing permissions: App Review required; UNVERIFIED with Meta.
- Disabled publishing: effectively disabled by the missing credentials, not by a flag.
- Application code failures: none found by reading. The live store read would fail first, since the marketing tables do not exist on the live project. Whether production's `SUPABASE_URL` points to that project is UNVERIFIED (the value is secret), but the earlier audit identified it as `qboidsfpjuxeqtfotryj`.

The Data Deletion page (`src/components/DataDeletionPage.tsx:40-41`, `:79`) says publishing is "Not active" and no Page is connected. That matches the environment.

## 8. Branch comparison (Phase 3)

**Analyzer branch `fix/analyzer-audit-findings` (`16377fe3`)**
- Commits: `762c5a23` (citation and quotation accuracy), `a9bdaac6` (refuse unlisted analyzer models instead of substituting Sonnet), `16377fe3` (unified retry handling across Quick, Forensic, bulk and Deep Scan).
- Merges into main with no conflicts (`git merge-tree`).
- Typecheck, build and full suite pass (section 2).
- Citation and quote improvements ready for integration: `shared/citationVerification.ts`, `shared/quoteVerification.ts`, `shared/analyzerRetryPolicy.ts`, `api/services/citationVerification.test.ts`, `api/services/quoteVerification.test.ts`, `api/services/analyzerRetryPolicy.test.ts`. The citation tests enforce that a match is never labelled as verified against e-Laws.
- Not verified: the statute text itself (e-Laws not reachable from this environment).

**Payment-guard branch `fix/audit-model-ids-and-payment-guard` (`0d8156cd`)**
- One unique commit. It is 65 commits behind main.
- The `gmailAgent.ts` change (`+7` lines, around `:363-368`) adds an automatic activation path that behind `ENABLE_EMAIL_TRUST_GRANT=true` calls `activateTrustBasedPayment`. Main has no such path. This adds risk; it is not a security fix.
- The model-ID change is useful: defaults move from `claude-sonnet-5`/`claude-opus-5` to `claude-sonnet-5-5`/`claude-opus-5-5`. Whether those IDs are live at Anthropic is UNVERIFIED.
- Verdict: do not merge the branch. Cherry-pick only the model-ID change, after confirming the IDs.

**PR #107 (`f545844c`)**
- Draft, base `main`, 125 files, +29,406 / −449, GitHub reports `mergeable_state: clean` against main.
- Conflicts with the analyzer branch in 5 files: `api/_server.ts`, `api/services/analyzerSections.ts`, `src/components/DocumentAnalyzerTab.tsx`, `src/types.ts`, `src/utils/parentReportView.ts` (`git merge-tree`).
- Contents, grouped:
  - Billing and credit (highest risk): `api/_server.ts` (+439/−56: billing hold, finalize retry, `BILLING_SESSION_REQUIRED`), `api/services/analyzerStreaming.ts`, `creditAccounting.ts`, `usage` tests, `api/testSupport/productionLikeCreditDb.ts`.
  - Official forms and AcroForm: `api/acroFormRoutes.ts`, `api/services/acroForm*.ts`, `officialForm*.ts`, `formFieldFacts.ts`, `pdfResourceLimits.ts`, `scripts/official-forms/`, form fixtures, and the `*SemanticFieldMap` tests.
  - Analyzer citation and page map: `sourcePageMap.ts`, `quoteProvenance.test.ts`, `analyzerSections.pageCitation.test.ts`, `analyzerModels.ts`, `analyzerModels.integrity.test.ts`. These overlap with the analyzer branch.
  - Documents and CI: `docs/` (ACROFORM, OFFICIAL_FORMS, RELEASE_CHECKLIST, review notes), `docs/ci/*.yml` (proposed workflows).
  - Dependencies: `package.json` (+16/−5) and `package-lock.json`. The API did not return the patch, so the exact dependency changes are UNVERIFIED.
- Separable PRs, in order:
  1. Docs and CI (no runtime code).
  2. Official-forms and AcroForm subsystem (new routes; check `pdfPolyfill.ts` and `pageSources.ts` for shared changes first).
  3. Analyzer page-citation map, rebased onto the analyzer branch.
  4. Billing hold and credit finalize, last, with separate review: this is payment logic and needs your approval.

## 9. Confirmed defects

**Security**
- None confirmed on main for the job route (section 3). Anonymous read and cross-user read are not reproducible.
- Defence-in-depth gap, CONFIRMED on live: `anon` and `authenticated` hold table grants on `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions`, `free_tool_usage`, `access_codes`, `cyfsa_300rule_access_codes`. RLS is on and no policies exist, so non-owner roles get zero rows. Not exposed through RLS, but grants should be revoked (migration, needs approval).
- Vulnerable dependencies (section 6), with server-side reachable items: compression, body-parser, nodemailer.

**Legal analysis**
- No confirmed defect in shipped s.88 / s.94(1) text (section 8, `citationVerification` tests).
- UNVERIFIED: official e-Laws text. Not reachable from this environment.

**Payment**
- CONFIRMED (synthetic probe, main): paid-session-only callers get `403 FORBIDDEN` reading their own uid-less analysis job (section 3). Read-authorization defect, not an entitlement change.
- CONFIRMED on `0d8156cd`: email-triggered automatic activation path behind an environment flag (section 8). Not on main.
- Correction: `payment_requests_request_key_unique` was applied on 2026-10-23 and targets `public.payments`. The earlier note that it targeted a missing table was wrong. Corrected in `VERIFIED_P0_FINDINGS.md`, `DATABASE_MIGRATION_DECISION_MATRIX.md` and `CONTROLLED_REMEDIATION_PLAN.md`.

**Marketing**: blockers in section 7.

**Model IDs**: main's analyzer defaults are `claude-sonnet-5` / `claude-opus-5` (`api/services/analyzerModels.ts:15-16`). Whether these still resolve at Anthropic is UNVERIFIED. A read-only `GET /v1/models` with the production key would settle it.

## 10. Already fixed on other branches

- Citation and quotation accuracy, retry unification, unlisted-model refusal: `fix/analyzer-audit-findings` (`762c5a23`, `16377fe3`, `a9bdaac6`).
- Model-ID update: `0d8156cd`.
- Email trust-grant gate: `0d8156cd` adds a gate on a path that main does not have.

## 11. Changes requiring migration or deployment

- Marketing: `supabase/migrations/20261005_marketing_agent.sql` must be reviewed and applied before any marketing feature is turned on. Not applied on live.
- Grant revocation: a new reviewed migration (section 9).
- Repo bookkeeping: move `payment_requests_request_key_unique` out of the pending folder. Five applied migrations are missing from the repo's applied folder (earlier finding).
- Dependency upgrades: compression, body-parser (minor); nodemailer (major, separate).
- Paid-session job read fix: a code change, no migration.

## 12. Recommended merge order

1. This branch: the corrected audit reports (docs only).
2. `fix/analyzer-audit-findings` (`16377fe3`) into main, through a PR, after you review the citation wording. It merges cleanly and its tests pass.
3. PR #107, split as in section 8. Docs and CI first, then the official-forms subsystem, then the analyzer page map rebased onto step 2, then billing last.
4. Cherry-pick the model-ID change from `0d8156cd` once the IDs are confirmed. Do not merge `0d8156cd` as a branch.

## 13. Go / no-go

- **Current production (`0130a96f`): conditional GO** for the existing functionality. Conditions: the paid-session job read defect is documented to affect paying users without Firebase sign-in; no new payment or billing code ships before its fix; the marketing feature stays off.
- **PR #107 as one merge: NO-GO.**
- **`0d8156cd` as a branch merge: NO-GO.**
- **`fix/analyzer-audit-findings`: GO after your review of citation wording** (e-Laws check still required before launch copy relies on the wording).
- **Marketing / Facebook publishing: NO-GO** until credentials, App Review, and the migration are done.

## 14. Single highest-priority implementation task

**Make a paid-session analysis job readable by the paid session that created it, and add a regression test.**
- Store the creating session's `jti` on the job when the `uid` is null (`api/_server.ts:2259`), and allow the read at `:2607` when the presented paid session matches. Do not change grant or entitlement logic.
- Add the probe from section 3 as a permanent test in `api/analyzerStreamingIntegration.test.ts`, with the expected status changed to 200 for the owning session and 403 for any other session.
- Branch: create `fix/paid-job-recovery` from `origin/main` (`0130a96f`). Do not start from `feat/payment-identity-rebased` or the analyzer branch.
- Needs your approval before implementation: it changes an authorization rule on a production path.
