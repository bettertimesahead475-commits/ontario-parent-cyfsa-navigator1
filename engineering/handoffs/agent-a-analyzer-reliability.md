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
