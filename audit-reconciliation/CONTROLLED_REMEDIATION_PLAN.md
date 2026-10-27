# Controlled Remediation Plan

Nothing here has been implemented. Each step is ordered by risk. Steps marked **approval** change production or an outward-facing system and need your explicit go-ahead.

## Immediate (no production change)

1. **Freeze the fix branch's payment path.** Do not merge `0d8156cd`, and do not set `ENABLE_EMAIL_TRUST_GRANT` in any environment. Confirm it is unset in Vercel production and preview. *Verify with the Vercel environment listing (read-only).*
2. **Remove the trust-grant call on the fix branch.** On a new branch from `0d8156cd`, make `gmailAgent.ts` alert-only, matching main. Add a test that asserts `activateTrustBasedPayment` is never called from the Gmail path. Branch work only; no merge without approval.
3. **Re-run tests with recorded SHAs.** On `0130a96f` and the fixed branch, run `npm test`, `npx tsc --noEmit`, `npm run build`. Record counts and failing test names. Resolves the 444 vs 433 disagreement.
4. **`npm audit --omit=dev`** and a reachability review. Only runtime findings block release.
5. **Verify s.88 and s.94(1) on e-Laws.** A human must do this in a browser. The bundled text date is unverified.

## Requires approval (production or external)

6. **Revoke anon/authenticated grants** on the seven tables listed in `DATABASE_MIGRATION_DECISION_MATRIX.md`. Write as a new, reviewed migration. Test on a Supabase branch first. Expected impact: none on RLS-protected reads; server code uses the service role.
7. **Retire `payment_requests_request_key_unique`** after confirming `payments.reference_number` uniqueness on live. Do not apply the file as-is.
8. **Reconcile repo migration history** with live (mark applied items, add the five missing ones). No SQL execution.
9. **Confirm `document_walkthroughs` public read** is intended.
10. **Split PR #107** into reviewable pieces. Payment and entitlement changes reviewed separately. Owner approves each merge.

## Deferred (safe to defer, track)

- Analysis report retention. Job JSON is stored in a private bucket with no expiry. Define a retention period with counsel; do not assume one. The CYFSA s.87 publication restriction does not by itself set a universal period.
- Job route authorization is correct on main. Keep the existing 403 test as a regression guard.
- SavedDocumentsTab: no action unless the file is revived.

## Exact next step

Approve step 1 (confirm the email trust-grant flag is unset in Vercel) and step 3 (I re-run the tests on the two SHAs and record the outputs). Both are read-only or branch-only. Then decide on steps 6 and 7, which touch production.
