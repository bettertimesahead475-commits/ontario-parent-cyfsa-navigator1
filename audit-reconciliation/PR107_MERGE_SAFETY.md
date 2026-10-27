# PR #107 Merge Safety

Recommendation: **do not merge PR #107 as a single unit.** No changes were made to the PR.

## Why

- Scope from the earlier check: 125 files, about 29,400 insertions. It mixes unrelated work: billing, analyzer, dependency changes, and more.
- A broad merge makes it impossible to review or roll back the payment-related changes separately from the analyzer work.
- The Antigravity recommendation to merge does not state which commit it reviewed, and it does not account for the payment-activation issue in `0d8156cd` (see `VERIFIED_P0_FINDINGS.md`, P0-5). Before merging anything, confirm PR #107's head does not include the `ENABLE_EMAIL_TRUST_GRANT` call. **Not verified in this pass.**

## Gate before any merge

1. Record PR #107's head SHA and diff against `origin/main` (`0130a96f`).
2. Check the diff for: `activateTrustBasedPayment` calls, `ENABLE_EMAIL_TRUST_GRANT`, changes to `payments` writes, changes to `api/_server.ts` auth on `/api/analyze/job/*`.
3. Split the PR. Payment and entitlement changes are a separate PR, reviewed by the owner.
4. Run the test and build commands from `BRANCH_AND_TEST_RECONCILIATION.md` on the split branches.
5. Owner approval before any merge. Merging is outward-facing and needs your sign-off.
