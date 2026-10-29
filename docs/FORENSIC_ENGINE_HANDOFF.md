# Forensic Engine — Handoff

For the next coding agent (Google Antigravity or other). Read this first; the investigation it records does not need
to be repeated.

## State

| Item | Value |
|---|---|
| Branch | `feat/forensic-engine` (pushed to `origin`) |
| Latest code commit described here | `d1efff3cf7b8a1b596e38d1dd6472c9aea6bc975` (this document is committed on top of it) |
| Draft PR | #111, base `fix/forensic-accuracy` (draft PR #110), which is based on `main` @ `e2bbc76f` (production) |
| Production | Unchanged. Nothing merged, nothing deployed. |
| Feature flag | `FORENSIC_ENGINE_ENABLED=true` (server env). **Off by default and not set in any environment.** With it off, Forensic In-Depth uses the existing analyzer exactly as before, and the multi-document picker is hidden. |
| Owner direction followed | Resumable, stage-by-stage execution instead of raising the Vercel timeout. |
| Approval needed for | Merging, deploying, setting the flag anywhere, applying any migration, billable benchmark runs (needs an explicit spending cap). |

Merge order: PR #110 first, then #111.

Usage allowance: this environment exposes no remaining-usage or reset information. No live API calls were made.
There are no measured API costs.

## Test results at `d1efff3c`

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 198 files passed, 3,712 tests passed, 0 failed, 433 skipped.
- `npm run build`: exit 0.
- Engine-specific: 107 tests in `api/services/forensic`, `src/components/ForensicEngineRecord.test.tsx`,
  `src/components/DocumentAnalyzerTab.engineExport.test.tsx`, `src/components/AdditionalDocumentsPicker.test.tsx`,
  `src/utils/continueForensicJob.test.tsx`; plus 17 engine route tests in `api/analyzerEndToEnd.test.ts` (64 in the file).
- All provider responses are mocked. **Live benchmark: NOT RUN** (no approved spending cap). No accuracy,
  false-positive, cost or latency figures exist. Do not quote any.

## Resumable execution (this session's main work)

### Design
- `api/services/forensic/pipeline.ts` — the engine is a sequence of serializable steps:
  `extract:<docId>` × n → `build` → `investigate` (or `investigate:<docId>` × n → `synthesize`) → `review` →
  `visual` → `ground`. `EngineState` is plain JSON; `runEngineStep(state, step, deps)` returns a new state.
  Original files and page images are kept out of the state (`EngineMedia`, stored once). In resumable mode a
  transient failure returns `RETRY_LATER` (counted, up to `MAX_STEP_ATTEMPTS` = 3) and a deadline stop is an
  interruption that is never counted. `runForensicInvestigation` still runs everything in one go.
- `api/services/forensic/checkpointStore.ts` — one primitive: create-if-absent (`putIfAbsent`). Supabase Storage
  gives it atomically (`upload` with `upsert: false` → 409 on conflict). Private bucket `forensic_engine_jobs`
  (refuses to write to a public bucket). Layout per job: `meta.json`, `media.json`, `state/<seq>.json`,
  `lease/<step>/<attempt>.json` (+ `.released`), `settled.json`. Versioned state means a stale worker can never
  overwrite newer state; attempt-numbered leases mean only one worker runs a step. Storage errors throw (no silent
  memory fallback). `purgeExpired` deletes whole jobs after retention.
- `api/services/forensic/resumableRunner.ts` — `advanceEngine` runs steps from the latest checkpoint under a lease;
  starts a model step only with `minModelStepMs` left; returns `COMPLETE | PENDING | BUSY | MISSING`.
- `api/services/forensic/engineJobs.ts` — route operations: `startEngineJob`, `advanceEngineJob` (adaptive thinking
  on Opus stages, corpus sources), `isFatal`, `engineRunShape`, `settleDelivered` (finalize; if the reservation
  lapsed, reserve again under the same id, then finalize; 402 withholds if the allowance is gone),
  `settleFailed` (release once), `RESUMABLE_LIMITS` (investigation 24k, review 12k, synthesis 16k output tokens;
  200 s step timeout), `STEP_MIN_MS` 200 s, `LEASE_TTL_MS` 260 s, `ENGINE_JOB_RETENTION_MS` 24 h.

### Route behaviour (`api/_server.ts`)
- `POST /api/analyze`, Forensic In-Depth with the flag on: after auth, entitlement and the existing credit
  reservation, starts the engine job (meta stores uid, billing, session, tier, reservation id, billing cycle) and
  advances it within the 265 s AI deadline. Complete → the existing delivery path (finalize, persist, settle marker).
  Not complete → job marked `resumable`, response `202 ANALYSIS_CONTINUING` (or a streamed `continue` event); the
  credit stays reserved. Investigation/synthesis/review failed → settle marker RELEASED, the existing catch
  releases the credit. A resubmission of the same id returns 202 (never restarts); an id whose job failed is never
  run again (409, non-retryable).
- `POST /api/analyze/job/:jobId/continue`: Firebase identity must own the job (else 404); paid jobs require the same
  paid session, bound to the identity (else 403); admin jobs require the site owner. Responses: 200 report (charged
  exactly once; repeat continues return the saved report without charging or running anything), 202 progress saved,
  409 another call holds the step, 410 failed and released once, 402 allowance gone at delivery (report withheld,
  stays saved). Any error inside a call releases nothing; the next call resumes from the last checkpoint. An
  abandoned job's reservation lapses after 15 minutes (existing reconciliation), so nobody pays for unfinished work.
- `GET /api/analyze/capabilities` → `{ forensicEngine, maxAdditionalDocuments: 9 }`.
- `GET /api/admin/forensic-engine/purge` (CRON_SECRET or ADMIN_SECRET, constant-time): deletes engine jobs older
  than 24 h. Scheduled hourly in `vercel.json` (`17 * * * *`) — this takes effect only on merge and deploy.
- `generateContentWithFallback` passes `image` and `document` parts through; text callers unchanged.

### Client
- `src/utils/api.ts`: `continueForensicJob` (loop until report; waits on 202/409/5xx; stops on 410/403/401/404
  with the server's code), `isContinuation`, SSE `continue` event, and `pollAnalysisJob` continues a resumable job
  instead of polling one nothing advances.
- `DocumentAnalyzerTab.tsx`: continues after a 202 or `continue` event; multi-document picker
  (`AdditionalDocumentsPicker.tsx`, `src/utils/caseDocumentsSelection.ts`) in Forensic mode when the engine is on,
  offering only case files whose text has been read (never raw upload data), up to 9.

### Verified by tests (mocked provider, production-like credit DB, in-memory object store)
- Interrupted after every step and resumed to the same result as a single run, each model step run once.
- Credit reserved once and finalized once across invocations; a resubmission continues; a repeat continue on a
  delivered job neither charges nor runs anything.
- Two simultaneous continue calls: one runs the step, the other gets 409 and makes no model call.
- Expired lease taken over; stale worker's result discarded; storage outage before and after the model call
  (the lost step re-runs; the job is still delivered once).
- Review failing on every attempt: retried 3 times across invocations, then 410 with the credit released once;
  the id is never re-run.
- Reservation lapsed mid-run: re-reserved under the same id at delivery and charged once.
- Access: another account → 404; no paid session → 403; signed out → 401; no model call in any of them.
- Streamed start ends with a `continue` event, not an error.

## Other gaps closed this session

1. **Multi-document upload interface** — see Client above. The server already accepted `additionalDocuments`.
2. **OCR confidence and provenance** — `api/services/pageSources.ts`: OCR functions may return
   `{ text, confidence }`; `ocrSingleSourceWithGemini` reports `exp(candidates[0].avgLogprobs)` per OCR page (null if
   absent; out-of-range values dropped). It is the model's token certainty, **not verified accuracy**. Text-layer
   pages have null confidence (not applicable). `pageProvenance` (in `integration.ts`) reads per-page method and
   confidence from the extraction cache without re-running OCR; grounding rule 7 (confidence < 0.8 raises
   uncertainty) now applies to live uploads. The 0.8 threshold is a heuristic, not calibrated.
3. **Legal corpus** — `api/services/forensic/legalCorpusAdapter.ts` implements the Stage 6 `LegalCorpusRepository`:
   `BundledCyfsaRepository` (bundled, SHA-pinned text as `COMMITTED_INSPECTION` — checked word-for-word by test,
   never person-verified, so Stage 6 always reports `requiresResearch`) and `SupabaseLegalCorpusRepository` for the
   pending `navigator_legal_provision(_versions)` tables (used only when `FORENSIC_CORPUS_CYFSA_SOURCE_ID` is set;
   missing tables fall back to the bundled text). The corpus tables do **not** exist in production (checked
   read-only). Grounding looks up each single-section CYFSA citation for the case date (`caseDateFor`: latest date a
   document states for itself, else latest court-record date; never filename dates) and notes a case date before
   the held consolidation (from 2026-07-01).
4. **End-to-end interrupted/resumed tests** — see "Verified by tests" above.
5. **Partial-failure report and exports** — the summary log states the engine status and every gap; the print export
   shows the full record; redacted copies keep only the status (complete/partial and how many parts did not
   complete), which identifies no one. Tested by driving the real engine to a PARTIAL report.
6. **Retention** — engine jobs, including documents and original files, are deleted after 24 h (see purge route).

## Known issues and limitations

- **Not run against real models.** Prompt quality, Opus latency per step, and real cost are unmeasured.
- **Step timing:** a model step starts only with 200 s left in an invocation, so most model steps get their own
  invocation (5–6 invocations for a single document). Whether 200 s suffices for a 24k-token Opus investigation is
  unmeasured; a step that times out is retried up to 3 times and then recorded as failed (release).
- **Retention of existing analysis jobs:** the pre-existing `analysis_jobs` bucket's 24 h retention only clears
  memory; stored job records are never deleted. Pre-existing, not changed here; flag for the owner.
- **Supabase Storage atomicity** is relied on for `upsert: false` (documented behaviour, unique object name). Not
  tested against a live project here.
- **Lease timing:** `LEASE_TTL_MS` (260 s) must exceed the longest step; a function killed mid-step holds the lease
  until it expires, delaying (not breaking) the next continue.
- **Provider cost on lost saves:** if a step's result cannot be saved after the model answered, that step re-runs
  (provider cost twice, customer charged once).
- **Corpus:** only the 10 bundled provisions; none person-verified. Stage 6 tables pending approval.
- **OCR confidence** is model certainty, not accuracy; Gemini may omit `avgLogprobs` for some models.
- **Multi-document picker** depends on other files' text having been extracted (e.g. by a Quick Review); there is no
  in-picker extraction. The analyzer-tab wiring of the picker payload is covered by unit tests of the payload
  builder, not by a full component test of the click-to-analyze flow.
- Benchmark gold is author-annotated, not reviewed by counsel. Vercel previews show "Account is blocked"
  (account-level, not code).

## Exact next steps for Google Antigravity

1. `git fetch origin && git checkout feat/forensic-engine` (head is this document's commit on top of `d1efff3c`).
2. `npm ci && npx tsc --noEmit && npx vitest run && npm run build` — expect all green as above.
3. Owner approval and a spending cap, then a **non-production** key:
   `ANTHROPIC_API_KEY=... npx tsx scripts/forensicBenchmark.ts --cases=affidavit-hearsay`, then all cases. Note that
   the benchmark runner uses the single-invocation path (`runForensicInvestigation`, offline limits); record cost and
   latency per stage from the results file.
4. With owner approval, set `FORENSIC_ENGINE_ENABLED=true` on a **preview** environment only (never production) and
   run a 2-page and a 20-page PDF through the UI: count invocations, measure each step's duration, confirm one
   reservation and one finalize in the credit tables, confirm `forensic_engine_jobs` is private and purged.
5. Tune `RESUMABLE_LIMITS` / `STEP_MIN_MS` from step 4's measurements.
6. Decide (owner) on deleting stored `analysis_jobs` records after retention (pre-existing gap).
7. Apply the Stage 6 corpus migrations (owner approval), load person-verified CYFSA versions, set
   `FORENSIC_CORPUS_CYFSA_SOURCE_ID`; citations then resolve as VERIFIED for the case date.
8. Lawyer review of benchmark gold; add the real two-page endorsement (redacted) as a case when supplied.
9. Only then a release recommendation, with measured false-positive and missed-issue rates.

## Do not

- Merge, deploy, apply migrations, or set `FORENSIC_ENGINE_ENABLED` in production without explicit owner approval.
- Run billable benchmarks without an approved spending cap.
- Claim the engine is elite, production-ready, or better than competitors on the basis of these tests.
- Mark benchmark cases or corpus versions as verified unless a person has verified them.
- Change Quick Review, authentication, payments, pricing, existing model routing, or the production Vercel project
  `cyfsanavigator` (prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR).

---

## Google Antigravity Autonomous Validation & Hardening Session

### Baseline Verification (Phase 1)
- `npm ci`: Clean install, dependencies verified.
- `npx tsc --noEmit`: Clean (zero errors).
- `npx vitest run`: 197 files passed, 3,681 passed tests, 0 failures, 467 skipped.
- `npm run build`: Production build cleanly generates Vite bundle and `dist/server.cjs`.

### Hardening & Fixes Applied (Phase 2 & 3)
1. **Windows CRLF Line-Ending Normalization**:
   - `api/services/forensic/bundledLegalSources.test.ts`: Normalized text before SHA-256 calculation so git's `core.autocrlf` on Windows environments does not falsify statutory text hash verification.
2. **Checkpoint Store Retention Outage Safety**:
   - `api/services/forensic/checkpointStore.ts`: Fixed critical vulnerability where a transient storage read error during `purgeExpired` would treat an active job as unreadable and delete customer files. Now skips unconfirmed jobs on storage read errors and validates `latest.state.startedAt` before any deletion.
   - `api/services/forensic/checkpointStore.test.ts`: Added read outage and missing meta regression tests.

### Evaluation & Protocol Hardening (Phase 4)
1. **10-Dimension Comparison Framework**:
   - Implemented `evaluateTenDimensions` and `ForensicDimensionEvaluation` in `api/services/forensic/evaluation.ts` covering:
     1) Material findings discovered
     2) Material findings missed
     3) Unsupported allegations
     4) Source attribution accuracy
     5) Legal citation accuracy
     6) Chronology accuracy
     7) Visual evidence interpretation
     8) Duplicate findings
     9) Adversarial review effectiveness
     10) Cost and latency
   - Verified via unit test suite in `api/services/forensic/evaluation.test.ts`.
2. **Michelle Clark Affidavit Real-World Protocol**:
   - Created `eval/forensic/MICHELLE_CLARK_AFFIDAVIT_PROTOCOL.md` specifying ground truth anchors, multi-document test structure (9-page affidavit + 2 email exhibits + visual marks), and strict confidentiality protection (no unredacted PII committed to repo).

### Deployment Hardening & Preview Checklist (Phase 5)
- Created `docs/PREVIEW_TESTING_CHECKLIST.md` detailing owner authorization gates, Vercel cron plan prerequisites (Pro account required for 4 scheduled crons in `vercel.json`), pre-flight checks, and end-to-end testing protocol.

### Performance Profiling & Optimization (Part II)
1. **Checkpoint Store Read Optimization**:
   - `api/services/forensic/resumableRunner.ts`: Added local `knownLatest` state caching across loop iterations in `advanceEngine`. Eliminates 2 redundant Supabase Storage network roundtrips (`list` + `get`) per step within an active invocation.
2. **Legal Citation Lookup Caching**:
   - `api/services/forensic/pipeline.ts`: Added in-memory `citationCache` in the `ground` step so repeated citations across findings (e.g. CYFSA s. 74(2), s. 87, s. 94) in the same matter are looked up exactly once.

### Controlled Benchmark & Protocol Hardening (Part III & IV)
1. **Benchmark Runner Budget & Smoke Test Hardening**:
   - `scripts/forensicBenchmark.ts`:
     - Added `--case=<id>` single-case smoke testing flag.
     - Added fail-closed spending cap `--max-spend-usd=<amount>`. Without explicit cap, refuses to execute billable calls.
     - Tracks stage-level latency, input/output token consumption, and outputs the full 10-dimension evaluation metrics.
     - Clearly labels costs as estimated token-rate calculations rather than actual invoice charges.
2. **Michelle Clark Protocol Evidentiary Rigour**:
   - `eval/forensic/MICHELLE_CLARK_AFFIDAVIT_PROTOCOL.md`: Refined to enforce 5 strict evidentiary categories (Established Documentary Facts, Verified Contradictions, Investigative Hypotheses, Unresolved Legal Questions, Unsupported Allegations) and explicit guardrails prohibiting false deductions (e.g. not treating 5-day hearing intervals as proven violations, not inferring forgery from OCR cursive signature omissions).


