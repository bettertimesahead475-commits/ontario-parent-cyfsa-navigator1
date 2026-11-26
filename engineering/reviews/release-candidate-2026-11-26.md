# Release candidate record: engineering/integration @ 1c56ca2 (2026-11-26)

Status: **integration-verified locally; NOT deployed; NOT production-ready.** Production remains `be46ad7` until the
release checklist is run and approved.

## Integrated

- `engineering/integration` = `1c56ca2`, a merge of `engineering/claude-review`, which contains:
  - 847c4e0 corrections (review record in `engineering/reviews/claude-review-2026-11-26.md`)
  - PR #141 DEVIN-PERF-01 (`engineering/reviews/pr141-devin-perf-01.md`)
  - Fail-closed identifier randomness, UNVERIFIED for incomplete proposition checks, windowed long-document checks
  - Infrastructure directive records (CLAUDE.md, MASTER_PLAN, RELEASE_CHECKLIST, BLOCKERS B-12)

## Verification (local)

- `tsc --noEmit -p .`: passes (in the integration worktree, using the project's TypeScript).
- Full `vitest run`: 294 files passed, 14 skipped, 4,538 tests passed, 506 skipped.
- Skipped files: 14 = 12 PostgreSQL-gated (run in CI), 1 staging-credential suite, 1 real-artifact suite. See
  `engineering/SKIPPED_TESTS.md`. The earlier "12 of 13" gap was a miscount: there are 11 PostgreSQL files, not 10.
  The new parity test makes the total 14.
- Not run here: PostgreSQL parity (`navigatorQuoteHits.pg.test.ts`), CI. Not verified.

## Not verified / not done

- **PR #139 and #140:** not located. Remote branches `engineering/devin-p3-finding-identity` and
  `engineering/devin-release-qualification` look related but are not mapped to PR numbers, and PR metadata is not
  readable without `gh` or an authenticated GitHub connector. Not reviewed, not integrated.
- **CI results** for any commit: not readable.
- **SonarCloud, coverage, mutation testing:** not run in this pass. No SonarCloud numbers were obtained.
- **Cloudflare CPU limit (three simultaneous Forensic sections):** not investigated with controlled tests. DEVIN-PERF-01
  changes only the quotation guard; it does not address the CPU or concurrency limit. The claim that it does is not
  supported by evidence.
- **Database hardening, RLS audit, persistent rate limiting, ReDoS, statute deduplication, indexed settlement
  retrieval, abandoned-job cleanup, alerts, commercial-integrity review:** not started in this pass.
- **Length-limit audit items L-3 to L-5** (quotes cut to 2,000 characters, findings cut to 6): open; release blocker
  for any claim of complete evidence verification.
- **Open reviewer nit:** page-marker regex mismatch between `withoutPageMarkers` and `pageMarkerEnds` (PR #141 review
  item 5). Unrealistic input; open.

## Production read-only check (2026-11-26, no inference, no writes)

| Check | Result |
|---|---|
| `https://cyfsanavigator.com/` | HTTP 200; Cloudflare edge (`server: cloudflare`); CSP header present |
| `/api/health` | 200, `platform: cloudflare-pages` |
| `/api/status` | 200, `analyzerReady: true`, `forensicQueueReady: true`, **but `service: cyfsa-navigator-cloudflare-staging` and `environment: "staging"`** |

**Finding:** the production domain reports a staging identity. Either the domain is serving the staging Pages deployment,
or the status label is wrong. This must be resolved before any release claim. No redeploy was performed. Possible cause
to check: which deployment the production domain is attached to, against the recorded rollback point `d5f2a3c9` and
production `be46ad7`. Read-only verification in the Cloudflare dashboard by the owner is needed.

Service availability is not end-to-end analyzer function. The status endpoint reports readiness flags, not a completed
analysis. A synthetic end-to-end run would consume inference and was not performed (budget ≈ $0.40).

## Infrastructure

- Cloudflare is the designated platform. Vercel is not used by this release.
- **Blocker B-12 remains:** the Vercel cron jobs (`check-payments`, `marketing/run-scheduler`, `monitoring/run`) have no
  verified Cloudflare replacement. The Vercel integration must not be disconnected until one is in place.
- Vercel GitHub-app status checks (B-11) still fail on PRs. Owner action in the GitHub or Vercel dashboard is required.
  No Vercel product was repaired, funded or deployed to.

## Minimum paid-inference testing before any release that changes analyzer output

- One live Quick run and one live Forensic run on synthetic documents, at about $0.05–0.10 and $0.25–0.45. Budget
  remaining ≈ $0.40 (blocker B-1). Owner approval required before spending.
