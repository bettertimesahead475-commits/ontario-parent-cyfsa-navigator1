# Release candidate: production recovery hotfix (2026-11-26)

Status: **free testing complete; live inference NOT authorized; deployment NOT authorized.** Readiness: **CONDITIONAL
PASS for free checks; BLOCKED for live acceptance and deployment** until the items in "Blockers" are resolved.

## Identifiers (verified 2026-11-26)

| Item | Identifier | Verified how |
|---|---|---|
| Production commit | `be46ad7` | Cloudflare Pages `7c144cf7` built from it |
| Live production deployment | `7c144cf7-82bf-47b0-928f-c03b2ca34fec` | `wrangler pages deployment list --environment production` |
| Protected rollback | `d5f2a3c9-a5c2-4b5a-9964-6f68b44d2ec2` (commit `cf67d8c`) | Same listing, still present |
| Hotfix head (PR base) | `8156f96` | `origin/hotfix/forensic-chronology-20261126` |
| Devin PR #143 (quotation boundaries) | `213e257` | `origin/engineering/devin-hotfix-quote-boundaries-20261126` |
| Devin PR #144 (replay and review docs) | `cf0a581` | `origin/engineering/devin-hotfix-review-20261126` |
| **Release candidate (this branch)** | **see `git log -1` on `release/candidate-20261126`** | Branch `release/candidate-20261126` (pushed) |

Both PRs contain `8156f96`, so reconciliation was a clean merge (no conflicts).

## Contents of the candidate versus production (`be46ad7`)

13 files, 1,201 insertions, 38 deletions. Verified by `git diff --name-only`:

- Quotation verification: `shared/quoteVerification.ts` (word, contraction, combining-mark, soft-hyphen and surrogate
  boundaries; from PR #143, plus the PR #141 locator performance change).
- Chronology: `api/services/analyzerSections.ts` (8,000-token Forensic chronology; dispatch
  `redFlags, thresholds, chronology, guidance, timeline, overview`).
- Browser job polling: `src/utils/api.ts` (30-minute wait, was 6).
- Tests and fixtures, and Devin's review records.

**Excluded, confirmed absent from the diff:** report caching, database migrations (including `pending_approval`),
Supabase bindings, Vercel references, PR #142's memory rewrite, experimental models, and integration-only work. No
conflict markers.

## Free test results (against the candidate)

| Check | Result |
|---|---|
| `tsc --noEmit -p .` | PASS |
| Full `vitest run` | PASS: 282 files, 4,322 tests; 13 files skipped (see below) |
| Quotation demonstration gate (`api/services/quotationDemoDefects.test.ts`) | PASS: 16 of 16 on the candidate. On the hotfix head without PR #143, **8 of 16 fail** (the four defect classes) and the 8 legitimacy checks pass on both |
| Forensic replay (Devin, PR #144) | PASS (inside the full suite) |
| Differential test against the integration-matching oracle (32,000 cases) | PASS (inside the full suite) |
| Chronology truncation and retry | PASS: cut-off responses never accepted; retry uses the shorter-answer instruction |
| Dispatch order | PASS |
| Browser poll window (30 min) | PASS: test fails with the old 6-minute limit, passes with the new one |
| Conflict markers / excluded-scope check | CLEAN |

### Skipped test files

13 files are skipped, as on production. 11 are PostgreSQL-gated and run only in CI with `CREDIT_PG_URL`
(`api/matterAccess*.pg.test.ts`, `api/services/*.pg.test.ts`). One needs staging credentials (`creditStaging`). One needs
real court-form artifacts that are not in the repository (`docxFieldInventoryRealArtifacts`). Release implication: the
PostgreSQL suites, including the credit functions, were **not run for this candidate**. Their results must come from CI.

### Chronology scheduling (modelled, not measured)

Scheduling model with synthetic durations (seconds; pool of 3; redFlags 88; thresholds 20; guidance 40; timeline 30;
overview 25; chronology 60; one cut-off attempt then a retry):

| Order | Chronology finishes (ok / cut-off) | Verification starts | Run ends (ok) |
|---|---|---|---|
| Production (`be46ad7`) | 110 s / 170 s | 88 s | 110 s |
| Candidate | 60 s / 120 s | 88 s | 90 s |

The candidate ordering completes chronology earlier and leaves verification's start unchanged. These durations are
assumptions, not production measurements.

## Verified-quotation policy (what this release guarantees and does not)

- A quotation verifies only when it matches whole words, whole contractions and whole characters. Legitimate quotations,
  curly and straight apostrophes, quotation marks around a quote, and page attribution still verify.
- **Not guaranteed:** text that differs in wording (paraphrase) is not verified. This is intended. Presenters should not
  describe paraphrase as a verbatim quotation.

## Frontend recovery (what the code provides; what was NOT browser-tested)

- Analysis job remembered in `localStorage`, so reload resumes it (`src/utils/analysisJobResume.ts`). Existing unit tests
  cover this path.
- Server deduplicates by analysis id, so a repeated submission is refused rather than charged twice. Covered by the
  server-side id tests.
- Preliminary material is labelled ("Analyzer preliminary read (not a legal finding)") in the report text.
- Poll window is 30 minutes; a job that never completes ends with a recovery message after that.
- **Not verified in a real browser:** refresh during a running job, navigation away and back, network interruption during
  polling. These need the browser steps in engineering/demo/LIVE_ACCEPTANCE_PROCEDURE.md (UI checks with mocked jobs need no paid inference).
  checks with mocked jobs).

## Infrastructure and data (verified and documented; NOT changed)

- Production runs Pages project `cyfsa-navigator-git-staging`, with a queue producer bound to `cyfsa-staging-analyzer-jobs`.
  That queue has one consumer, the staging relay, which calls executor `cyfsa-analyzer-queue-consumer` (deployed
  2026-11-24). The production consumer `cyfsa-analyzer-queue-consumer` config (`cyfsa-analyzer-jobs`) has no attached
  consumer.
- The analyzer's Supabase binding is the **staging** project (`nxfhvebzzobegubefcda`). Repository records say production's
  database is `qboidsfpjuxeqtfotryj` and must not be cross-connected. **Unresolved owner decision** (see below).
- No binding, secret or migration was changed.

## Chronology and CPU (Devin telemetry; not independently verified here)

- The 8,000-token chronology change is approved and included.
- The Cloudflare CPU termination at 280 ms reported CPU is **unresolved**. It cannot be checked from this environment, and
  the deployed Worker CPU limit was not read. Do not describe it as resolved.

## Blockers

1. **Devin's independent adversarial review of the candidate** (PR #143 and #144 were produced by Devin; the candidate
   merge still needs Devin's sign-off). Request: `engineering/handoffs/devin-hotfix-review-request-2026-11-26.md` (on the
   review branch).
2. **Live acceptance** needs owner-approved spend (below).
3. **Owner decision: production database.** Confirm whether production should use `qboidsfpjuxeqtfotryj`, or whether the
   staging binding is intended. No change is made until this is decided.
4. **CPU termination** remains unexplained.
5. **Deployment** needs explicit owner authorization after items 1–3.

## Live acceptance plan and spend ceiling (NOT authorized)

Reconciled with the per-run estimates on record (`engineering/PERFORMANCE_BASELINE.md`): Quick $0.05–0.10; Forensic
$0.25–0.45. The remaining budget on record is about $0.40.

| Phase | Run | Devin's proposal | Recommended ceiling | Stop condition |
|---|---|---|---|---|
| A1 | Forensic, fictional case (files 01–04) | $1.25 | **$0.60** | Any run above $0.60, or any truncation |
| A2 | Quick, file 01 | $0.15 | **$0.15** | Any failure |
| A3 | Final Case Assessment, fictional set | $0.40 | **$0.40 (unmeasured: stop after the first run if its cost exceeds this)** | Cumulative phase A above $1.20 |
| B | 200-page synthetic CPU and memory stress | $3.00 | **Separate authorization; not part of this plan** | Only after A passes |

- **Phase A ceiling: $1.20 total.** Devin's full $4.80 is not recommended until A passes. The phase A total does not
  fit the $0.40 remaining, so the owner must set a top-up amount.
- Retries are limited: at most one repeat of a failed run, and no repeat of a run that completed.
- The owner must approve the first run in writing before any paid call.

## Deployment procedure (prepared, NOT executed)

1. Owner approves the candidate commit recorded above and the two blockers resolved.
2. Create a Pages preview deployment from the candidate branch; run the Browser acceptance and smoke tests on the preview
   (not on the production domain).
3. Confirm Worker versions and bindings unchanged: `wrangler deployments list` for `cyfsa-analyzer-queue-consumer` and
   `cyfsa-staging-analyzer-queue-consumer`; queue `cyfsa-staging-analyzer-jobs` consumer unchanged.
4. Create the production deployment from the approved commit, following `engineering/RELEASE_CHECKLIST.md` (manual
   creation; automatic production deployments are disabled).
5. Smoke tests on `https://cyfsanavigator.com`: `/api/health` 200; `/api/status` `analyzerReady` true; home page; CSP header;
   sign-in popup; an admin endpoint returns 401 without a token. No paid inference in smoke tests.
6. Record the new deployment id in `SESSION_HANDOFF.md`.

**Rollback triggers:** any failed smoke test; any truncated or incomplete section marked complete; any quotation that
verifies incorrectly (a demonstration defect); any charge on a failed run; any browser job shown as failed while
completing server-side.

**Rollback:** redeploy `d5f2a3c9-a5c2-4b5a-9964-6f68b44d2ec2` (commit `cf67d8c`) as production, the same Pages procedure
used on 2026-11-25. Verify its availability before the release (it is listed as Production today).

## Owner decisions still required

1. Approve a top-up amount and the phase A ceiling ($1.20 total).
2. Confirm the production database (`qboidsfpjuxeqtfotryj` versus the staging binding).
3. Authorize deployment after the blockers are resolved.
4. Decide whether the 200-page stress test (phase B, $3.00) is needed for the demonstration.

---

## Update: final accuracy round (2026-11-26)

### Identifiers
- Candidate head: `c044c35` (documentation on top of `ba9c029`). Code head for review: `ba9c029`.
- PR #145 integrated as merge `4e514d2` (CI #887 green on its head `289e92d`, which the merge contains; the merge differs only by the handoff file).
- Production unchanged: `7c144cf7` (`be46ad7`). Rollback `d5f2a3c9` (`cf67d8c`), still listed as Production.

### Quotation accuracy
- PR #145 (`289e92d`): hyphen compounds only when a real hyphen joins two letters; full-width apostrophe U+FF07; Unicode hyphens U+2010/U+2011. Verified by the adversarial suite.
- `ba9c029`: a quotation starting right after a negating word (not, no, nor, never, without, non) is not counted. "guilty" from "Not guilty", "evidence was found" from "No evidence was found", OCR-split "non - violent" and "non-<newline>violent" are reported NOT_LOCATED (kept, unverified). Whole negated quotations still verify.
- Adversarial suite: 27 cases (`api/services/quotationAdversarial.test.ts`). Before `ba9c029`, 4 of 27 failed; after, 27 of 27 pass. Legitimate-quotation cases pass.
- Known limitation: a quotation that starts or ends inside a hyphenated compound is not verified (intended, the safe direction).

### Database evidence (Devin, local PostgreSQL 14)
- 11 PostgreSQL-gated files, 370 of 370 tests passed (credit reservation, finalize, release, matter access). Reported by Devin in `engineering/reviews/devin-release-qualification-20261126.md` (PR #145 branch). Commit of that run: requested in the handoff. CI run #887 (on `289e92d`) also completed successfully with the PostgreSQL service container.
- No migration applied. No production database or binding changed.

### Cloudflare CPU incident
- Request `6a0ca69881503da9a2838b6383a71921`. Support case drafted at `engineering/incidents/cloudflare-support-case-6a0ca698-draft.md`. Not submitted by Claude. Cause NOT established.

### Staging preview
- Preview `a0ef44c4`: analyzerReady false, forensicQueueReady false. Missing plain variables on Preview: ANALYZER_ENABLED, FIREBASE_PROJECT_ID, STAGING_SUPABASE_URL (and the queue producer, unverified). Owner steps and a database-choice decision are in `engineering/incidents/staging-preview-configuration-2026-11-26.md`.

### Still open before live acceptance or deployment
1. CI run on `ba9c029` (needs a pull request; requested from Devin).
2. Devin's independent final recommendation (requested in `engineering/handoffs/devin-final-acceptance-request-2026-11-26.md`).
3. Browser acceptance with mocked inference (refresh, navigation, network interruption, duplicate prevention, report persistence, PDF export): requested from Devin; not yet run.
4. Staging preview variables and the choice of database for the preview (owner decision).
5. Owner approval of the $1.20 phase A spend (no paid inference has been run).
6. Owner approval to deploy after 1–5.
