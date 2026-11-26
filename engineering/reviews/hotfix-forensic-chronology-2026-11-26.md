# Production hotfix candidate: Forensic chronology and quotation performance (2026-11-26)

Status: **prepared, reviewed by one independent subagent (see below), NOT deployed.** Deployment needs owner approval and a
controlled acceptance run.

## Base and branch

- Production commit (verified from Cloudflare Pages): `be46ad7`, deployment `7c144cf7`.
- Rollback deployment (preserved): `d5f2a3c9`, commit `cf67d8c`.
- Hotfix branch: `hotfix/forensic-chronology-20261126` (pushed), head `9c75884`, based on `be46ad7`.
- Not included: `engineering/integration`, report caching (`e940ef4`, `fa136fe`), database migrations, PR #142's
  compact locator (`508946c`), and all other unfinished work.

## Changes

| Change | Where | Behaviour change |
|---|---|---|
| Forensic chronology output ceiling 5,000 → 8,000 tokens | `api/services/analyzerSections.ts` (chronology spec, full mode) | Quick unchanged (3,500). Cost rises only when a response actually uses the extra tokens (billed per generated token). |
| Forensic dispatch: chronology starts right after redFlags | `api/services/analyzerSections.ts` (`FORENSIC_DISPATCH_ORDER`) | Chronology now starts earlier; overview starts later |
| PR #141 quotation locator (performance), adapted to production matching rules | `shared/quoteVerification.ts` | None intended: matches production on 32,000 synthetic cases (`api/services/quoteLocatorProductionDifferential.test.ts`) |
| Regression tests | `api/hotfix-chronology.test.ts`, `api/forensic-section-dispatch.test.ts` (one expectation updated for the new order) | — |

**Deliberately excluded from the hotfix:** the word-boundary quotation rule (DEVIN-P2-01, `77cc009`). It is on the integration
branch and changes which quotations verify. It is a separate, reviewed release decision for the owner.

## Verified (mocked inference only; no paid run)

- Full `vitest run` on the hotfix branch: 279 test files passed, 13 skipped, 4,305 tests passed. The 13 skipped files are
  PostgreSQL-gated or environment-gated, as on production (see `engineering/SKIPPED_TESTS.md` on the integration branch).
- `tsc --noEmit -p .`: passes.
- Chronology regression tests: 8,000-token request; a cut-off response is never accepted; a retry after a cut-off uses the
  shorter-answer instruction; dispatch order.

## Not verified

- **Devin's root cause** (chronology exceeded 5,000 output tokens and retries exhausted the 180 s budget) is reported from
  Cloudflare telemetry that this session cannot see. The code path that makes it possible is confirmed on `be46ad7`
  (`analyzerSections.ts`: chronology full-mode ceiling 5,000; a cut-off response triggers a retry at the same ceiling). The
  claim itself is not independently verified.
- **Effective ceiling:** for models where thinking cannot be disabled, `functions/api/_analyzer-model-adapter.ts` adds 8,000
  headroom tokens. Which model produced the cut-off is not in any record available here.
- **CPU termination at 280 ms reported CPU:** not reproduced. The reported figure may be a per-section counter. The
  synchronous guard pass (per-finding canonicalization of the whole document, removed by the PR #141 locator) is a plausible
  CPU cost, but it is not proven to be the cause.
- **Efficiency without loss:** not implemented. The chronology prompt is unchanged, because any prompt change could alter
  dates, attribution or contradictions and must be validated against live output first.
- **Completed-section preservation on job retry:** not implemented. Production keeps no partial sections across a job
  retry, so a failed run restarts all sections. Storing partial sections changes the job-storage path and belongs in the next
  release.

## Independent review

- Reviewer: one fresh subagent of the same model family (not a different vendor). Its findings are recorded below when
  received. Devin's independent adversarial review of this branch is still required before the owner approves deployment.

## Rollback

1. Production stays on `7c144cf7` until approval.
2. If the hotfix is deployed and fails acceptance, roll back to `d5f2a3c9` (the recorded rollback target) with the same Pages
   rollback procedure used on 2026-11-25. Record the deployment id in `SESSION_HANDOFF.md`.

## Live acceptance (requires owner approval for spend)

See `engineering/demo/LIVE_ACCEPTANCE_PROCEDURE.md`. The $4.80 plan referenced by the owner is not reproduced here: the
per-run estimates on record are Quick $0.05–0.10 and Forensic $0.25–0.45. Devin must provide the $4.80 breakdown before
approval.
