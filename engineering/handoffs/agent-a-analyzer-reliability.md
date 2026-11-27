# Agent A handoff: analyzer accuracy, performance, reliability and queue recovery

Date: 2026-11-26/27 · Base: `devin/1795744800-exports-integration` (`8dc7a93`, PR #147) · No merge, deploy, migration,
Supabase binding, customer-record or balance change · Synthetic documents and mocked inference only (no paid AI calls).

## PRs

| PR | Branch | Code commit | Scope |
|---|---|---|---|
| #148 | `devin/1795744371-analyzer-compact-locator` | `11755a4bd3243f12419f9faeb298ec42224f47bd` | PR #142 compact quote locator ported onto the release-candidate quote rules; report cache carried over unwired |
| (this PR) | `devin/1795744614-analyzer-queue-heartbeat` | `eda49ed15aadf441fc8a202d7a461f0534b13d4f` | Queue Worker progress heartbeat no longer abandons a healthy run; claim and retry diagnostics |

### #148: compact quote locator (DEVIN-PERF-04)

- Replaces #142's conflicting `shared/quoteVerification.ts` with a port onto the base's quote rules (compound words,
  hyphen vs. dash, negating word, contractions, soft hyphen/zero-width, combining marks, surrogate pairs).
- Exactness gate: `tests/devin/quote-locator-rc-differential.test.ts` requires output identical to a frozen copy of the
  base locator (`tests/devin/fixtures/quoteVerificationRc147.ts`) over 48,000 seeded cases, the 12 release-candidate defect
  cases and a 200-page document. Deleting the dash/hyphen source-character check makes it fail.
- Measured locally (Node 22, 591k-character synthetic document): 56.8 MB → 12.4 MB retained per locator; 705 → 151 ms for
  3 locators × 25 variant quotes. Worker isolate memory is not measured.
- `functions/api/_report-cache.ts` is **not wired**; `supabase/migrations_pending_approval/*navigator_report_cache.sql` is
  **not applied** (PostgreSQL test skipped without `CREDIT_PG_URL`).
- #142's `src/utils/api.ts` change was not taken: the base already has its polling work and a 30-minute poll window.

### This PR: queue progress heartbeat

Defect (`workers/analyzer-queue-consumer.ts`): the Worker's `onProgress` callback awaited `persistJobUpdate`, which throws
on any ledger failure. `executeAnalysis` awaits `onProgress` at each section completion, so one transient Supabase RPC
failure (5xx, or the 8-second transport timeout) during a 3-minute Forensic run rejected the analysis: the run was
abandoned, the inference spent so far was wasted, and the job was redelivered from the start.

Fix:
- Transient write failure (RPC throws): logged as `[ANALYZER_PROGRESS_WRITE_FAILED]` (stage, error class, delivery
  attempt) and the analysis continues. This is safe: the `completed` write still requires this Worker's token, the report is
  persisted under the job ID before finalization, and finalization is idempotent.
- Write that matched no row (RPC returns `false`: lease expired and another Worker claimed it): throws `JOB_LEASE_LOST`
  (retryable), as before, so a second concurrent run is not continued. No credit is finalized or released.

Diagnostics for the 2026-11-26 incident's open question ("why the 14:51 run needed three redeliveries"):
- `[ANALYZER_JOB_CLAIMED]` `{mode, jobAttempt, deliveryAttempt, paid}` on every claim.
- `[ANALYZER_JOB_RETRY_SCHEDULED]` `{code, httpStatus, mode, jobAttempt, deliveryAttempt, delaySeconds}`. A retryable
  analyzer response (for example a section still truncated after its retry, `AI_RESPONSE_INVALID`) was previously retried
  with **no log line**; only consumer exceptions were logged.
- A claim line with no retry, failure or completion after it identifies a Worker stopped by Cloudflare (CPU, memory or
  wall time). No job ID, uid, document text or key is logged.

Tests: `tests/devin/queue-progress-heartbeat.test.ts` (4 tests; all 4 fail on the base, pass with the fix).

## Verification (this PR, `eda49ed`)

- `npx tsc --noEmit -p .`: clean.
- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run`: **311 files passed, 14 skipped (325); 4,683 tests passed,
  506 skipped (5,189)**.
- #148 at `11755a4`: 312 files passed, 15 skipped (327); 4,690 tests passed, 512 skipped (5,202).
- CI: SonarCloud and the three Vercel checks also fail on PR #147 (base); Vercel is the known obsolete-integration noise
  in `engineering/BLOCKERS.md`.

## Reviewed, no defect found (no change made)

- Credit lifecycle in the queue: retryable failures keep the reservation (`release()` is skipped for `trustedJob`);
  permanent failures release only after the `failed` state is written; a release that cannot be confirmed leaves the job
  `failed` and the redelivery releases it (`!job` → `failed` → release → ack). Persisted-report recovery finalizes before
  `completed`; a reservation that expired (15-minute TTL) is delivered uncharged rather than retried forever.
- Claim/lease: `analyzer_claim_job` only claims `queued` or lease-expired `running` jobs; `analyzer_update_job` only
  writes with the matching token. A delivery that finds a live lease waits (30–240 s) without starting a second run.
- DLQ: live lease → wait; persisted report → finalize + complete; `attempt_count < 6` → requeue; otherwise fail + release.
- Ownership: `jobOwnerConflict` fails closed (anything other than `clear` is a conflict).
- Client polling (`src/utils/api.ts`): 30-minute window, in-flight read sharing, 404/pending never treated as failure,
  non-transient errors stop immediately.

## Open (needs access this session does not have)

- Cause of the 14:51 redeliveries: needs Workers logs (BLOCKERS). After this PR deploys, the new claim/retry lines answer
  it for the next occurrence.
- Staging validation of the locator's isolate memory and of a real Forensic run (needs approved inference budget).

## Follow-up 2026-11-26: Forensic overview-last budget and preview readiness

### 1. Can overview, dispatched last, exceed the Forensic budget? (evidence only, no code change)

Test: `api/forensic-budget-overview-last.test.ts` (mocked inference, fake timers; same model as
`api/forensic-budget-replay.test.ts`: incident section durations, chronology 1.5 s TTFT + 94 tok/s, 30 s verification,
178 s AI deadline; real dispatch order redFlags, thresholds, chronology, guidance, timeline, overview; concurrency 3).

| Scenario | Result |
| --- | --- |
| Production timings | Overview starts at 92.5 s (in the slot redFlags frees) with an 82.5 s timeout (178 − 92.5 − 3); needs 36.7 s. Run finishes ~45 s inside the budget. |
| Overview alone slower | Overview fails only at ≥ 2.25× its production duration (> 82.5 s). |
| Every section uniformly slower | First loss is **redFlags** at 1.20×: attempt 1 hits the 110 s `SECTION_TIMEOUT_MS.full`, its retry gets ~64 s. Overview still completes. |

Conclusion: at the recorded production timings overview-last cannot exceed the budget, and under a uniform slowdown it
is not the section that fails first. A last-section floor or duration-based dispatch would not change either result, so
no scheduling fix is made. The section most exposed is redFlags (92.5 s of a fixed 110 s timeout, 84 %); any change
there is a timeout-policy decision for the lead engineer, not part of this evidence PR.

### 2. Preview `/api/status` reports `analyzerReady:false`, `forensicQueueReady:false` (read-only; nothing changed)

`analyzerReady` = `ANALYZER_ENABLED === "true"` and `FIREBASE_PROJECT_ID`, `STAGING_SUPABASE_URL` set and
`STAGING_SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` in their public key formats (`providerKeyStatus` in
`functions/api/_status.ts`). `forensicQueueReady` = `analyzerReady` and the `ANALYZER_JOBS_QUEUE` producer binding.

Read-only Cloudflare API check of Pages project `cyfsa-navigator-git-staging`, preview environment (names and types
only; secret values are not readable):
- Present: `ANALYZER_ENABLED` (`"true"`), `FIREBASE_PROJECT_ID`, `STAGING_SUPABASE_URL` (both non-empty),
  secrets `ANTHROPIC_API_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `SESSION_SECRET`, queue producer
  `ANALYZER_JOBS_QUEUE`. The latest preview deployment (`a548d5f2`, commit `732c735`) was built with all of them.
- Not present in preview (present in production): `ADMIN_SECRET`, `GEMINI_OCR_MODEL`. Neither affects readiness.

No variable or binding is missing. Every non-secret condition passes, so `analyzerReady:false` means
`STAGING_SUPABASE_SERVICE_ROLE_KEY` and/or `ANTHROPIC_API_KEY` holds a value that is not a valid key, matching
BLOCKERS B-4 ("Preview environment secrets are placeholders"). `forensicQueueReady:false` follows from it; the queue
binding itself is present. This is expected for preview, not a code defect. Which of the two secrets it is appears in
the `[CONFIG_SECRET_UNUSABLE]` log line `/api/status` writes (Pages Functions logs), or in the admin diagnostics,
which need `ADMIN_SECRET` (not set in preview). Fix = B-4: set real test-scoped values for those secrets (owner approval).

### Verification (this follow-up)

- Test commit `c3021d4` on `devin/1795745198-analyzer-forensic-budget-evidence` (base `772eacf`, with #148 and #149
  merged): `npx tsc --noEmit -p .` clean; full Vitest **314 files passed, 15 skipped (329); 4,699 tests passed,
  512 skipped (5,211)**; the new file passes 3/3.
- No Cloudflare, Supabase, secret, binding or deployment change; Cloudflare access was GET-only.
