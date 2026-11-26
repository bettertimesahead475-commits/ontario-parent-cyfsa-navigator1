# Devin: final acceptance requests for release/candidate-20261126 (2026-11-26)

Candidate head: `ba9c029` (negation-boundary fix on top of PR #145 merge `4e514d2`). Production stays `7c144cf7` (`be46ad7`);
rollback `d5f2a3c9` (`cf67d8c`). No deployment, migration, production binding or customer-record change is requested.

## 1. CI for ba9c029
`ci.yml` runs only on pull requests. Please open a PR from `release/candidate-20261126` (or push the head to the open
PR #145 branch if you prefer) so CI runs the PostgreSQL suites on `ba9c029`. Report the run URL and conclusion.

## 2. Independent review of ba9c029
- `shared/quoteVerification.ts`: `NEGATORS` and `precedingWord`, and the `cutsNegation` rule in `occurrences`.
- Oracle fixture `tests/devin/fixtures/quoteVerificationIntegration.ts` mirrors the rule.
- `api/services/quotationAdversarial.test.ts` (27 cases). Please add any case you consider missing: negation words
  (non-compliant, non-abusive, non-threatening, unsubstantiated, not guilty, no evidence, never, without), Unicode hyphens
  and apostrophes, OCR punctuation, and legitimate quotations that must still verify.
- Expected trade-off: a quotation that starts after a negating word is reported NOT_LOCATED (kept as an unverified
  finding). Tell us any legitimate quotation this rejects.

## 3. PostgreSQL evidence
You reported 370/370 PostgreSQL tests locally (PostgreSQL 14). Please state the exact commit that run used. If it was
before `ba9c029`, the CI run from item 1 is the verification for the final commit; no local re-run is needed unless the
credit or ownership code changed (it did not in ba9c029).

## 4. Browser acceptance with mocked inference (no paid inference)
Please complete and report, with commit and build identifiers:
- Document upload; active progress; refresh recovery during a running job; navigation away and back; temporary network
  interruption during polling (the job must keep being followed, not shown as failed); duplicate submission prevention
  (the same analysis id is reused; no second charge); completed report retrieval after refresh; PDF export of the report.
- Failed analysis recovery: a failed job shows recovery instructions and the Retry path reuses the analysis id.

## 5. Staging preview configuration
The preview `a0ef44c4` reports analyzerReady false and forensicQueueReady false. The owner steps and the database caution
are in `engineering/incidents/staging-preview-configuration-2026-11-26.md`. Please perform steps 1–6 for the Preview
environment only, and report the `/api/status` result. Do not change Production.

## 6. Cloudflare CPU case
The draft support case is `engineering/incidents/cloudflare-support-case-6a0ca698-draft.md`. Please check the figures against
the telemetry you hold and send any corrections. The cause is not established; do not describe it as resolved.

## 7. Final recommendation
Please reply with PASS, FAIL or BLOCKED for `ba9c029`, the evidence for each, and any change required before the owner
approves the $1.20 phase A live acceptance (`engineering/reviews/release-candidate-20261126.md`).
