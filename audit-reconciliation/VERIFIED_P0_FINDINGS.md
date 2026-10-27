# Verified P0 Findings: Antigravity audit (2026-10-27) reconciliation

Scope: read-only. No deploys, merges, migrations, or production data changes were made.
Comparison points: `origin/main` = `0130a96f`; `fix/audit-model-ids-and-payment-guard` = `0d8156cd`.
Live database: Supabase project `qboidsfpjuxeqtfotryj` (cyfsa-navigator live), read-only SELECTs and rolled-back probes.

Status key: **CONFIRMED** (reproduced now) · **NOT REPRODUCED** · **STALE** (fixed or superseded) · **HYPOTHESIS** (plausible, unproven) · **UNVERIFIED** (could not check here)

## Summary

| # | Audit claim | Status | Where it actually stands |
|---|---|---|---|
| P0-1 | Job route allows anonymous or cross-user read (BOLA) | NOT REPRODUCED on main | Ownership check present on main. Anonymous path returns 401. |
| P0-2 | `SavedDocumentsTab.tsx` TS2305 breaks the build | NOT REPRODUCED; file is gone from main history | Deleted by `18fe4843`. Only exists on two agent branches, which typecheck clean. |
| P0-3 | Five-day deadline cited as s.94(1); should be s.88 | STALE in code; external check UNVERIFIED | Shipped strings already distinguish s.88 (five-day) from s.94(1) (30-day). e-Laws was unreachable from this environment. |
| P0-4 | 38 pending migrations; RLS disabled, anon can write | PARTLY STALE, CONFIRMED drift | 45 pending files. RLS is enabled on live, but anon grants remain. Several "pending" files are already applied. |
| P0-5 | Gmail/Interac email can grant paid access | CONFIRMED on fix branch only; NOT on main | Main: alert only. `0d8156cd`: calls `activateTrustBasedPayment` when `ENABLE_EMAIL_TRUST_GRANT=true`. |

## P0-1: Job route authorization

- `origin/main` `api/_server.ts` (GET `/api/analyze/job/:jobId`): the handler returns 401 `SIGN_IN_REQUIRED` when there is no identity, no paid session, and no admin. For a signed-in caller it returns 403 unless `job.uid === identity.uid` or the caller is admin.
- Probed with synthetic jobs: owner read succeeded, non-owner got 403. Probe artifacts deleted.
- Storage: `api/services/analyzerStreaming.ts` writes job JSON to a private bucket (`public: false` enforced by `ensureBucket`). Reports are retained indefinitely (see Phase 2, item 10). Retention is a separate issue, not an access bypass.
- **Verdict:** NOT CONFIRMED on main. If the audit saw an anonymous read, it was on a different revision. Ask Antigravity for the exact SHA it tested.

## P0-2: SavedDocumentsTab TS2305

- `src/components/SavedDocumentsTab.tsx` was removed by `18fe4843` ("Remove Google Drive/Gmail/Photos import and Firestore cloud-save"). The previous version imported `{ db, auth } from "../firebase"`. `src/firebase.ts` exports `db`; `src/utils/firebase.ts` never did.
- `npx tsc --noEmit` exits 0 on `18fe4843^` and on the vercel-agent tip.
- **Verdict:** NOT REPRODUCED. The cited error does not occur on main. It only matters if someone revives that file on a branch.

## P0-3: Five-day citation

- Bundled reference `legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt`: s.88 contains the five-day lead-in and s.88(a) the court-hearing condition. s.94(1) says the court shall not adjourn for more than 30 days.
- `src/components/VoiceAssistantTab.tsx` (comment around L30–35) already says the five-day rule is s.88, not s.94. `src/data.ts` (around L642) cites both correctly as separate rules. `src/components/LegalTerminologyDrawer.tsx` (around L87) marks the section reference unverified.
- Citation logic (`shared/citationVerification.ts`) never labels a match as verified against e-Laws. Tests in `api/services/citationVerification.test.ts` enforce this.
- **Verdict:** Code is consistent with the bundled text. Official verification is **UNVERIFIED**: `ontario.ca` and `canlii.org` failed DNS from this environment. The bundled file's own README says its date is unverified. A human must check s.88 and s.94(1) on e-Laws before launch copy relies on them.

## P0-4: Database state (live vs repo)

Confirmed on live (read-only):
- `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions`, `free_tool_usage`, `access_codes`, `cyfsa_300rule_access_codes`: `rls_enabled = true`, `policy_count = 0`. Non-owner roles see zero rows. This is deny-by-default, so the "anon can write" premise is **STALE**.
- Those same tables still hold full `anon` and `authenticated` table grants. Grants are not exposed data, but they are a defence-in-depth gap. Probe: `SET LOCAL ROLE anon; SELECT count(*) FROM public.free_usage` returned 0 rows (rolled back).
- Applied migration `20260909144539` (the `enable_rls_free_usage_gmail_stale` content) is already on live. The repo's pending folder still lists it as blocked.
- Policies on other tables (`payments`, `users`, `cases`, `documents`, etc.) are keyed to `auth.uid()`. Anonymous callers get no rows.
- One exception to review: `document_walkthroughs` has `walkthroughs_public` (SELECT, `qual = true`). That may be intentional public content; confirm.
- **Correction (2026-10-27, release baseline pass):** the earlier note that `payment_requests_request_key_unique.sql` targets a missing table was wrong. The file alters and indexes `public.payments`, which exists on live. Live has `payments.request_key`, `payments.firebase_uid` and unique index `payments_firebase_uid_request_key_uidx`, and migration history records `payment_requests_request_key_unique` (20261023024505) as applied. Live has no `payment_requests` table, but nothing in the app or the migration needs one.

## P0-5: Email-driven payment activation

Main `0130a96f`, `api/services/gmailAgent.ts` (around L357–372):
- A match calls `sendAdminAlert` and appends to `matchedPendingApproval`. The code states "No automatic activation." `activateTrustBasedPayment` is not imported by `gmailAgent.ts` on main.
- Access is granted only by the admin-secret-gated `POST /api/admin/approve-payment`, after the owner confirms the bank deposit.

Fix branch `0d8156cd`, `api/services/gmailAgent.ts`:
- Line 39 imports `activateTrustBasedPayment`.
- Lines 363–368: `if (process.env.ENABLE_EMAIL_TRUST_GRANT !== "true") throw …`; otherwise it calls `activateTrustBasedPayment(referenceNumber, amount, { messageId })`, which grants credits and access.
- The gate is a default-off environment flag. Setting one variable in Vercel turns on automatic email-only activation. The code's own comment says email text is attacker-controllable.

**Verdict:** CONFIRMED risk on `0d8156cd`. Do not merge it, and do not set `ENABLE_EMAIL_TRUST_GRANT` anywhere. Main is not affected. Recommended fix: remove the trust-grant call on that branch and keep alert-only, or require a second independent confirmation.

## Not verified in this pass

- Test baselines and the 25 npm vulnerabilities (see `BRANCH_AND_TEST_RECONCILIATION.md`).
- PR #107 content beyond the earlier scope check (see `PR107_MERGE_SAFETY.md`).
- Whether `payments.reference_number` has a unique index on live. Not queried in this pass.
