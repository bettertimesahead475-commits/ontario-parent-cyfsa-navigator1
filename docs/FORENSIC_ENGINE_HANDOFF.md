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



---

## Review of the Antigravity commits (b97f9e86, 5f9dfb39)

Reviewed at 5f9dfb39. tsc is clean and the full suite passes: 198 files, 3,715 tests passed, 0 failed, 433 skipped.
The one results file (`eval/forensic/results/2026-10-28T22-02-32-356Z.json`) is `NOT_RUN`, so no billable benchmark ran.

- **Fixed: a concurrency regression in `knownLatest`.** The cache also skipped the re-read after the lease was
  taken. A concurrent continue could save the next step between this worker's save and its next lease. This worker
  then ran that model step again on stale state. The duplicate result was discarded, but the Opus call was paid for
  twice. The cache now only skips the read at the top of the loop. The state is always re-read after the lease.
  Regression test: "does not repeat a model step that another worker finished while this worker was between steps".
  It failed before the fix (2 investigation calls) and passes after it. The saving is now one storage round trip per
  step, not two.
- **Kept as is:**
  - The purge outage safety.
  - The citation cache.
  - The CRLF normalisation.
  - `evaluateTenDimensions`.
- **Hardened: Benchmark spending cap is now strictly fail-closed with pre-call worst-case cost estimation.**
  - `scripts/forensicBenchmark.ts`:
    - Implemented pre-call input token estimation (`estimateInputTokens`) with conservative ~3.5 chars/token + safety margin.
    - Implemented pre-call worst-case cost calculation (`estimateWorstCaseRequestCost`) bounding input tokens plus the request's `max_tokens` cap against `MODEL_PRICING`.
    - Implemented strict pre-call check: if `currentEstimatedSpend + worstCaseCostUsd > maxSpendUsd`, the request is rejected and aborted BEFORE initiating any stream or network call.
    - Added fail-closed protection against unpriced models: if a model is not registered in `MODEL_PRICING`, throws immediately rather than permitting unbudgeted spend.
    - Added provider usage reconciliation and validation (throws if usage tokens are missing).
    - Guarded CLI runner execution so `forensicBenchmark.ts` can be safely imported by unit tests.
  - `scripts/forensicBenchmark.test.ts`: Added 9 regression tests covering pre-call worst-case cost estimation, fail-closed unpriced models, budget breach abortion, and provider usage reconciliation.
  - `vitest.config.ts`: Updated include pattern to include `scripts/**/*.test.ts`.

- **Privacy & Confidentiality Status:**
  - `eval/forensic/MICHELLE_CLARK_AFFIDAVIT_PROTOCOL.md` defines standard evaluation anchors.
  - Confirmed: No raw case files, PDFs, or unredacted personal case materials are committed to the repository. Real test documents must remain in local, uncommitted staging. Any pseudonymization or git history rewriting requires explicit owner approval.


---

## Engineering pass, 2026-10-29 (commits c5e35311 to 61f84ac3)

Validation at 61f84ac3:
- `npx tsc --noEmit`: clean.
- Full Vitest: 201 files, 3,751 passed, 0 failed, 433 skipped, 79-90 s.
- `npm run build`: exit 0.
- No paid API call was made. Every measurement below is from mocked providers.

### Defects corrected

1. **Benchmark cap could be exceeded (c5e35311).**
   - The ledger was per system (engine and baseline each had their own), so a default run could spend 2× the cap.
   - Calls that failed after dispatch (timeout, dropped stream) were never counted, although they can be billed.
   - Concurrent calls all checked against the same balance.
   - The SDK's own retries (default 2, including timeouts) sent attempts the guard never saw.
   - Now: one `SpendLedger` per run. The worst case is reserved before dispatch, and a failed call keeps its worst case
     charged. The client and each request use `maxRetries: 0`. The output file records `spendLedger`.
   - Four regression tests fail against the previous guard and pass now.
2. **Michelle Clark protocol anchors were not from the record (4b8f70fb).**
   - Anchors 1-2 were copied from the synthetic `affidavit-hearsay` case (deponent "Dana Reyes"). The Exhibit A medical
     explanation and the attendance checkmarks were invented. The five-day rule was attributed to s. 90; it is s. 88,
     triggered by a child being brought to a place of safety.
   - The protocol is rewritten: no verified facts, and the owner's date points (September 11, 17, 19, 25, 29/30) are
     unverified questions.
   - Real records go under the gitignored `eval/forensic/private/` (`--private`).
3. **Large cases failed after paying for their calls (d0146903).**
   - `RESUMABLE_LIMITS.maxCalls` was 16. A 10-document multi-pass case (the route accepts 1 + 9) investigated 6
     documents and then failed review for lack of budget. That is fatal, and the credit was released after about 16
     paid calls.
   - The cap is now derived from the largest plan plus retry headroom (30).
   - Test: all 10 documents are investigated (it failed with 16: 6 of 10).
4. **The review could not fit a large record (a0d7598d).**
   - The review sent every document in full in one Opus call, up to about 3M characters.
   - Above `reviewMaxChars` (400,000), the review reads every cited document, in full where its share allows, otherwise
     the ±2,500-character passages around each quotation. The report's incompleteness list says what it did not
     re-read.

### Forensic quality

- **Grounding rule 10.** Class E (confirmed noncompliance) also needs a cited provision whose text was checked (an
  internal reference match); otherwise it is D.
- **Prompts, all stages.**
  - A time limit runs from the event the provision names; a scheduled date, correspondence or a court adjournment is
    not on its own a missed limit.
  - Different dates on one document are not evidence of backdating.
  - An OCR gap is not a missing signature.
  - Clerical errors support a request for clarification, not a finding of misconduct.
- **Review prompt.**
  - It separates contradictions (both cannot be true) from wording differences.
  - It rejects only for lack of support, never because a finding is adverse to a party, and prefers QUALIFIED.
  - It does not summarise the case.
- `prompts.test.ts` pins these. Their effect on live output is **unmeasured** until a live benchmark runs.

### Performance (mocked; simulated provider latency, 1 ms = 1 s)

Per-document extraction, and per-document investigation in multi-pass runs, now run in batches of up to 4 parallel
calls (d0146903):
- The batch is replayed in plan order, so the saved state equals a one-at-a-time run (tested on 6 documents).
- Each step runs under its own lease, with one checkpoint per batch.

| Documents | Wall time before → after | Storage ops before → after | Model calls |
|---|---|---|---|
| 1 | 308 → 310 ms | 42 → 42 | 3 → 3 |
| 6 | 1,368 → 646 ms | 108 → 84 | 14 → 14 |
| 10 | 2,093 → 826 ms | 156 → 114 | 22 → 22 |

Assumed latencies:
- Sonnet extraction 30 s.
- Opus investigation 150 s, synthesis 150 s, review 120 s.

"Before" is 6ff682ca, run on the same in-memory store harness.

**Real Opus step durations are still unmeasured.** A single-document case (the common case) has no parallel work, and
its critical path is unchanged: extraction, investigation, review.

`[FORENSIC_ENGINE_ADVANCE]` is now logged once per invocation (61f84ac3). It records:
- status and steps done;
- model calls and retried attempts;
- storage reads, writes and lists;
- invocation time and job elapsed time.

It contains no document content.

### Report (a68bb0df)

The screen and the PDF use one order, which is tested to match:
1. Status and gaps.
2. A deterministic summary.
3. Findings established by the record (A, E).
4. Leads and questions for counsel (B, C, D). Each group is ranked by significance, then class, then uncertainty.
5. The quoted chronology, with the source of each date.
6. Document dates.
7. Each cited authority once, with the findings that rely on it.
8. Missing evidence to request in disclosure.
9. Next steps.

### Checked and not changed

- **Double settlement.** `paid_finalize_credit` is idempotent per (session, request) and serialized by an advisory
  lock. `recordPaidUse` is idempotent by job id. Two concurrent continues on a finished job charge once.
- **Test-runner worker timeout.** Not reproduced. The slowest file is `DocumentAnalyzerTab.completion.test.tsx`
  (13 s) and the slowest test 6.2 s. `maxWorkers: 2` is already set.

### Release blockers found (read-only checks; nothing changed)

- **`CRON_SECRET` is not set** in any Vercel environment of `cyfsanavigator` (names listed; no values read). All cron
  routes, including `/api/admin/check-payments` and the new purge route, accept only `Bearer $CRON_SECRET` or the
  admin secret, so Vercel cron calls are unauthenticated and get 401.
  - Production logs show 24 `check-payments` log lines in 24 h, where a run every 2 minutes would give ~720. This
    needs the owner to check cron status in the Vercel dashboard; the cause is unconfirmed.
- **The `forensic_engine_jobs` bucket does not exist yet.** Only `analysis_jobs` (private) exists; the code creates
  it private on first use. Creating it ahead, with a file size limit, is optional.
- The paid credit functions (`paid_*`) are in production, executable only by `service_role`. Their SQL file still
  sits in `supabase/migrations_pending_approval/`.
- Vercel previews still fail with "Account is blocked".
- **Cost exposure per credit is unbounded by pricing review.** The worst case for a maximum case (10 × 300k
  characters, multi-pass) is roughly US$15-20 in token cost from `max_tokens` and input sizes. A typical 1-3 document
  case is a small fraction of that. This is an estimate, not measured; the owner should decide whether to cap
  document count or size for Forensic credits.

### Michelle Clark benchmark: state

It **cannot measure recall** until a person enters verified anchors from the original documents into
`eval/forensic/private/cases/`. It can measure fact-independent behaviour now: grounding, refusal to overstate, cost
and latency.

### Next action

With an owner-approved cap (US$2.50 proposed), run one controlled live smoke case:
`npx tsx scripts/forensicBenchmark.ts --case=affidavit-hearsay --engine-only --max-spend-usd=2.50`.

This measures real Opus step durations, which decide whether the 200 s step budget and the 265 s invocation are
right. The spend cap is an estimate from token prices and `max_tokens`. It is not a billing ceiling: input is
estimated from characters, and a failed call is assumed to cost its worst case.

---

## Engineering pass 2, 2026-10-29 (commits edd718d3 to 14b0db15)

Validation at 14b0db15: `tsc` clean; full Vitest 201 files, 3,757 passed, 0 failed, 433 skipped; `npm run build`
exit 0. No paid API call was made.

### Production automation: payment checking does not run (verified, read-only)

**Root cause: three configuration gaps, any one of which stops it.**
1. **`CRON_SECRET` is not set in any Vercel environment.** Checked by name; no values read.
   - Vercel attaches `Authorization: Bearer <CRON_SECRET>` to cron calls only when that variable exists.
   - The deployed route answers 401 to an unauthenticated GET (checked against cyfsanavigator.com).
   - Vercel does call it: requests to `/api/admin/check-payments` appear in production logs at 09:04, 10:58 and
     12:58 UTC. They are rejected before any code that logs.
2. **`GMAIL_REFRESH_TOKEN` and `GOOGLE_REDIRECT_URI` are not set.** Even when authenticated, `scanForPayments()`
   fails with 503 in `getGmailClient()`/`getOAuthClient()`. Without the redirect URI, the one-time
   `/api/admin/gmail-auth-url` flow that creates the refresh token also fails.
3. **`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` are not set.** `sendAdminAlert()` returns false, so the owner is never
   emailed about a match or a stale payment.

**Evidence in the production database:**
- `gmail_processed_messages` has 0 rows ever.
- `payments` has 2 rows, both `pending`, submitted 2026-10-10 03:27 and 2026-10-11 05:55 UTC. None was approved.
- `stale_payment_alerts` is empty. A run would have recorded alerts for both after 48 h, if SMTP worked.

**Two requests have waited about 18 days: check the inbox for them now.**

**Access cannot be granted by an email.**
- The Gmail agent only records `matched_pending_manual_approval`.
- The only grant path is `POST /api/admin/approve-payment`. It requires `x-admin-secret` and an amount at least the
  expected one, and claims the payment atomically (`status = 'pending'` scoped UPDATE).
- Minor: `approve-payment` and `check-payments` compare the secret with `!==`, not in constant time.

**Smallest safe correction (owner approval required; production credentials):**
1. Add `CRON_SECRET` (a random 32+ byte value, Sensitive) to Production.
2. Add `GOOGLE_REDIRECT_URI` (must match the OAuth client's authorised redirect).
3. Redeploy production, so the variables take effect.
4. Run the `/api/admin/gmail-auth-url` flow once and store `GMAIL_REFRESH_TOKEN`.
5. Add the SMTP variables and redeploy.

Turning on `CRON_SECRET` also authenticates the monitoring cron and the marketing scheduler. The marketing tables do
not exist in production, and publishing needs human-approved posts, so it cannot post externally.

### Forensic engine defects fixed

- **The partial adversarial review was silent per finding (edd718d3).**
  - When the record exceeded `reviewMaxChars`, only the report-wide gap list said so. Each finding still read
    "Upheld by adversarial review", and an E finding could stand.
  - Now `review.partialRecord` names the documents not read in full, and the screen and PDF label every such finding.
  - Grounding rule 11: on a partial review, E becomes D and uncertainty rises.
- **Report status said "Complete" with reduced coverage (edd718d3).** It is now PARTIAL when a document was truncated,
  the call budget ran out, or the review was partial. It used to be PARTIAL only on a failed stage.
- **Synthesis truncation was not disclosed (ce4de93b).** The case-level synthesis reads each document cut to
  `singlePassMaxChars / documents`; the report now says so. The note is not repeated on retry.
- **The benchmark did not measure production (14b0db15).**
  - The engine ran with library defaults (32k investigation output, no resumable runner).
  - Thinking was requested on every call, including Sonnet extraction and the whole baseline.
  - The baseline ran Opus/Opus with a 15-minute deadline.
  - Both systems now run with the route's limits, models, thinking settings and 265 s invocations; the engine goes
    through `startEngineJob`/`advanceEngineJob`.

### Performance (simulated clock; 30/150/120 s provider latency, 265 s invocations) — 808637a1

- **Steps with no model call get a fresh window no longer.** `stepNeedsModel()` stops the runner from giving a
  no-model step (a visual check with nothing to check, a review or synthesis with nothing to do) a fresh 200 s
  window.
- **`media.json` is downloaded only when needed.** It holds the original PDF, up to about 20 MB as base64, and is now
  downloaded only for a visual step that has work.

| One-document case | Before | After |
|---|---|---|
| Invocations, no page check needed | 3 | 2 |
| `media.json` downloads, no page check | 3 | 0 |
| `media.json` downloads, with a page check | 3 | 1 |

### Benchmark readiness (`affidavit-hearsay`)

- **Case contents.** One synthetic affidavit (727 characters). It has 2 required findings and 1 optional, and 2
  forbidden patterns (bad faith or lying; neglect stated as established). Every anchor is word for word in the
  document (tested). Annotated by the engineering author only (`independentlyReviewed: false`).
- **Dry run.** `npx tsx scripts/forensicBenchmark.ts --case=affidavit-hearsay --engine-only --dry-run` makes no API
  call. It prices the engine at most **US$0.99**: Sonnet extraction 6k, Opus investigation 24k, Opus review 12k output
  tokens. All 7 cases come to US$6.97.
- **Retries and the US$2.50 cap.** A transient failure retries a step up to 3 times. Each attempt is reserved
  against the ledger first, and a failed attempt stays charged at its worst case. The cap therefore stops the run
  before a fourth expensive call; it does not let one through.
- **Limits of the cap.** It is an estimate from list prices: input is estimated from characters, and output is
  bounded by `max_tokens`. It is not a billing ceiling.

### Release checks covered by tests

- **No duplicate charges:**
  - `engineJobs.test.ts` (settle once, re-reserve under the same id);
  - route tests in `analyzerEndToEnd.test.ts`;
  - `paid_finalize_credit` is idempotent under an advisory lock.
- **No lost checkpoints:** `resumableRunner.test.ts` (storage outage, stale worker, lease takeover, concurrent
  continue).
- **No missing documents:** the 10-document case is investigated in full (`engineJobs.test.ts`).
- **No unsupported legal conclusions as verified:** grounding rules 3, 10 and 11, plus the citation status labels.
- **Quick Review, authentication and payment access:** the full suite (unchanged code paths) passes.

### Remaining blockers (owner)

1. The production cron and payment configuration above, and the 2 pending payments.
2. Approve the US$2.50 live smoke run, which is expected to cost at most US$0.99.
3. The Vercel account block.
4. The cost cap for maximum-size Forensic cases.
5. The Michelle Clark verified anchors and the deponent-name decision.
6. Merge approval: #110, then #111.

---

## Production recovery findings, 2026-10-29 (read-only)

### Payments

- **Pending requests.** `PS-FFXXJ` (Pro, $149.00, 2026-10-10 03:27 UTC) and `PS-AUEWJ` (Pro, $149.00, 2026-10-11
  05:55 UTC). Both have a parent contact on file; neither has been approved.
- **The scan cannot find them.** It searches `from:(interac.ca OR payments.interac.ca) newer_than:7d`, so even once
  configured it will never find Interac notifications from October 10-11. These two must be checked by hand.
- **Mailbox.** E-transfers go to `chris@cyfsanavigator.com`. The domain's MX records point to ImprovMX (mail
  forwarding), so the notifications land in whatever mailbox ImprovMX forwards to. `GMAIL_REFRESH_TOKEN` must be issued
  while signed in to that mailbox.
- **Cross-check not done.** The Gmail connector in this session needs re-authorisation, and it is connected to a
  different address, so the requests were not cross-referenced against the inbox.
- **Production variables.** Set: `ADMIN_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_*`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`. Missing: `CRON_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`,
  `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (and optional `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, `ADMIN_ALERT_EMAIL`).
  Whether the existing Google OAuth client has the Gmail API enabled and the callback URI authorised is not verified.
- **Approval without SMTP still works.** `POST /api/admin/approve-payment` (admin secret) marks the payment approved,
  creates the code and returns it with `emailSent: false`. The code is shown only in that response. Delivering it is
  then a manual message to the parent.

### Vercel

- **Production is serving.** `cyfsanavigator.com` returns 200 from deployment `dpl_Em7UfuVacRQ6meNobdKnTYsgH7P2`
  (main `e2bbc76f`, READY). Functions still run: the cron requests are still arriving.
- **The block covers new deployments in every project.** The last deployment in each of the three projects connected
  to this repository is 2026-10-28 11:32:57 UTC. Since then GitHub only receives "Account is blocked" from all three.
  Whether a promote or rollback of an existing deployment would also be refused is unverified.
- **Billing.** The team is on the Pro plan. Billed per day (UTC days starting 07:00): Oct 24 US$15.36, Oct 25 US$6.34,
  Oct 26 US$16.78, Oct 27 US$22.75, Oct 28 US$1.35, Oct 29 US$0.67. Build CPU minutes make up US$14.67, 5.66, 16.10,
  22.06 and 0.67 of those.
  - Every push built in all three projects: 36, 9, 20, 30 and 5 deployments per project on Oct 24-28.
  - The block began right after the heaviest build day.
  - The exact reason (spend-management limit, failed payment, or an account review) is shown only on the Vercel
    dashboard, which this session cannot read. vercel.com is also outside this session's network allowlist.
  - Assumption, unverified: a spend limit or payment problem.
- **Cost fix.** Draft PR #112 (`chore/vercel-build-guard`, based on main) adds an ignored build step:
  - The duplicate projects never build.
  - `main` always builds.
  - Other branches build only if they are `release/*`, `preview/*` or listed in `VERCEL_PREVIEW_BRANCHES`, and not
    for documentation-only commits.

### Benchmark dry run (`--case=affidavit-hearsay --engine-only --max-spend-usd=2.50 --dry-run`)

The worst case is US$0.987 over 3 requests: Sonnet 5 extraction (6k max output, US$0.064), Opus 5 investigation (24k,
US$0.612) and Opus 5 review (12k, US$0.311), in 1 invocation. This session has no `ANTHROPIC_API_KEY`, so the paid
run must be started where a key is available.
