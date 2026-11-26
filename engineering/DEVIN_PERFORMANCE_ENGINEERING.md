# Devin — analyzer performance engineering (2026-11-26)

Baseline: `engineering/integration` @ `eaca5cf`. Branch: `engineering/devin-performance`.
No paid inference, no production requests, no database writes. Every number below is labelled
**MEASURED** (run on this branch, synthetic text, mocked or no model calls, Node 22 on the Devin VM;
Workers CPU will differ in absolute terms) or **PROJECTED** (arithmetic from the single-sample production
baseline in `PERFORMANCE_BASELINE.md`; not a measurement).

## 1. Where the time goes today

| Stage | Evidence | Time |
|---|---|---|
| Native PDF / DOCX extraction | baseline, 1 sample | 0.22 s / 0.17 s |
| Scanned PDF OCR | baseline, 1 sample | 4.2 s |
| Prompt build (`buildSectionPrompt`), 200 pages | MEASURED | 1.9 ms |
| SSE parsing, 8,000 output tokens | MEASURED | 13–29 ms |
| JSON section parse, 25 findings | MEASURED | < 0.2 ms |
| **Report guards (`applyReportGuards`), 25 findings, 50 pages** | MEASURED, before | **1,707 ms CPU** |
| **Report guards, 25 findings, 200 pages** | MEASURED, before | **7,893 ms CPU** |
| Quick Review, all model sections in parallel | baseline, 1 sample | 36.2 s end-to-end |
| Forensic executor (6 sections, 3 at a time, then verification) | baseline, 1 sample | 99.4 s |
| Forensic queue + polling overhead | baseline, 1 sample | 11.1 s (110.5 − 99.4) |
| Final Case Assessment | code: one Opus call, `max_tokens` 6,000, 75 s timeout | not measured |

Conclusion: model generation is more than 95% of wall-clock time. All non-model work is under 0.3 s
**except the report guards**, which were CPU-bound and grew with (findings × document size).

## 2. Implemented: DEVIN-PERF-01 — report guards prepare the document once

Root cause: `applyReportGuards` called `locateQuote(source, quote)` once per finding, and each call
re-canonicalized the whole document (page-marker stripping, code-point split, two canonical forms, page
lookup). A Forensic run calls the guards three times (verification subset, final report, `analyze.ts`).

Fix: `createQuoteLocator(source)` in `shared/quoteVerification.ts` prepares the document once (lazily for the
whitespace and variant forms) and returns a locator; `locateQuote` delegates to it; `applyReportGuards` uses
one locator per pass. An ASCII fast path in `canonicalize` produces identical output. No verification step,
match type, page mapping or severity rule changed.

| Guards, 25 findings | Before (MEASURED) | After (MEASURED) | Reduction |
|---|---|---|---|
| 5 pages (24 KB) | 135 ms | 13 ms | 90% |
| 50 pages (244 KB) | 1,707 ms | 128 ms | 92% |
| 200 pages (988 KB) | 7,893 ms | 606 ms | 92% |

Equivalence evidence:
- Differential fuzz against a frozen copy of the previous implementation: 32,000 synthetic cases
  (whitespace, NBSP, curly quotes, dashes, soft hyphens, zero-width marks, emoji, contractions, page markers
  including over-long ones, wrapped quotes, case changes): **0 mismatches**.
- `tests/devin/quote-locator-performance.test.ts`: same results as `locateQuote` for every match type;
  locators do not share state; a 25-finding guard pass costs < 5× a 1-finding pass (about 2.4 now; about 11
  with the per-finding re-scan, so the test fails if that returns).
- Full suite: 4,505 passed, 478 skipped (the existing PostgreSQL and live suites); `tsc` clean.

Production relevance (PROJECTED): the queue consumer sets no `limits.cpu_ms`, so the Workers default CPU limit
applies. Three guard passes on a 200-page document used about 24 s of CPU before this change (Node figures).
This is a plausible contributor to the recorded `exceededCpu` at six concurrent sections, which is the reason
Forensic runs three sections at a time. That link is a hypothesis until measured on staging.

## 3. Theoretical minimum under the current architecture

The critical path of a sectioned run is: extraction → slowest section (time to first token + output tokens ÷
output rate) → guards → [Forensic] verification of red flags → persistence → browser notices.

| Analyzer | Current critical path | Minimum with current models and prompts (PROJECTED) |
|---|---|---|
| Quick Review | longest of 4 parallel Sonnet sections | ≈ the longest section alone; the baseline 36.2 s already is this. Only shorter outputs, faster tokens or splitting the longest section can go lower. |
| Forensic | wave 1 (3 sections) → wave 2 (3 sections) → verification after redFlags + thresholds | max(longest section, redFlags + verification) if all 6 run at once. Removing the 3-at-a-time wave cannot beat redFlags + verification, which run in sequence. |
| Final Case Assessment | one Opus call up to 6,000 output tokens | the single call; only splitting it or a faster model can go lower |

So the requested 3–8 s Quick and 15–30 s Forensic / Final Case Assessment are **not reachable with the
current models and prompt shapes**: output generation alone exceeds them. Reaching them needs changes to how
output is produced, listed below with what each needs before it can ship.

## 4. Opportunities that need authorization (not implemented)

| # | Change | Expected effect (PROJECTED) | Accuracy risk | Cost effect | Needs |
|---|---|---|---|---|---|
| A | Run all 6 Forensic sections at once (after PERF-01) | removes the second wave; Forensic → roughly max(longest section, redFlags + verification) | none (same prompts) | none | 1 staging run checking `exceededCpu` at concurrency 6 |
| B | Pipeline verification: verify red flags in batches as they stream instead of after the whole section | removes most of the verification time from the critical path | low; same verifier, smaller batches | small (more, shorter verifier calls) | code change in Claude-owned `analyzerSections.ts` + paid comparison runs |
| C | Shard the longest sections (e.g. red flags by page range or category, merged and de-duplicated deterministically) | critical path ≈ the longest shard; the largest single reduction available | medium: cross-shard context, duplicates; must keep one-CRITICAL rule and verification | more input tokens (document sent per shard) unless cached (D) | paid accuracy study on a labelled synthetic corpus |
| D | Provider prompt caching of the shared `<document>` prefix (`cache_control`) | faster time to first token on later sections, retries and verification; cheaper repeated input | none | Forensic lower; Quick **higher** if 4 sections start together (each writes the cache) unless one section starts first | adapter change (`_analyzer-model-adapter.ts` currently joins content blocks into one string, so caching is impossible today) + verification prompt must share the exact prefix + paid measurement |
| E | Progressive delivery on the queued path | first findings visible when redFlags completes, not at the end | none if only guarded, verified findings are shown | none | job record already receives `onSectionComplete`; UI is Antigravity's |
| F | Faster job-status notification (poll cap 5 s → about 1 s near completion, or push) | about 2–4 s off browser-observed time | none | more status requests | `src/utils/api.ts` (Claude) |
| G | Start extraction on upload, before the user presses Analyze | hides 0.2 s (text PDFs) to 4.2 s (OCR) | none | OCR runs for documents never analyzed | upload flow change; OCR is paid (Gemini) |
| H | Account-scoped fingerprint cache (HMAC of normalized text + analyzer version + model + account) to return an existing report for an identical document | under 1 s for repeats | none if the key includes every input that affects output | lower | storage design and retention approval (stores derived data per account) |
| I | Faster models (e.g. Sonnet/Haiku for Forensic sections) | large | unknown until measured | lower | the approved-model rule requires an accuracy comparison; that needs paid runs |
| J | Queue consumer `max_concurrency` 2 | not latency for one user; queueing under load | none | none | load test |

Recommended order: A (one staging run), then E and F (no model cost), then D and B, then C and I only with a
paid accuracy study. Remaining inference budget in `SESSION_HANDOFF.md` is about $0.40, which is not enough for
the studies in B, C, D or I.

## 5. Reproduce

- Guard and stage timings: `npx tsx /home/ubuntu/audit/perf/stage-bench.mts` (script contents recorded in the PR).
- Equivalence: `tests/devin/quote-locator-performance.test.ts`; differential fuzz script recorded in the PR.

## 6. Phase two (authorized 2026-11-26 09:55)

### 6.1 Six concurrent Forensic sections — controlled test (MEASURED, mocked inference)

Harness: a full Forensic run (`runSectionedAnalysis`, mode `full`) through the **real** Anthropic adapter with a
synthetic SSE stream (6,000 output tokens per section, 2 s per section, no network), on documents of 5, 50 and 200
pages, at concurrency 3 and 6, before (`eaca5cf`) and after this branch; 2 samples each. Results: section 6.5.

Finding: total CPU per run is the sum of the same work whatever the concurrency, and wall-clock time is the same
at 3 and 6 because verification waits for red flags either way (`redFlags` → verification is the critical path;
production commit `68c98e8` recorded the same). Raising concurrency to 6 is therefore **not implemented**: it gives
no measured latency gain and the production `exceededCpu` at 6 is unexplained by CPU totals here. The
remaining hypothesis (peak memory or CPU bursts while six streams decode at once on a Worker) can only be checked
on staging (budget item S1).

### 6.2 Completion detection (DEVIN-PERF-02, implemented)

`pollAnalysisJob` now polls every `ACTIVE_JOB_POLL_MS` = 1 s (±10% jitter) while the job is running, instead of
backing off to a 5 s cap; pending/404 and error paths keep their backoff and every termination rule (sign-in, other
account, non-retryable, wait limit, cancel). Concurrent pollers of one job share one in-flight request.
Expected browser saving: up to 5 s per queued analysis, about 2.5 s on average (PROJECTED from the 5 s cap).
Request volume: about 1 status read per second per active analysis (about 100 for a 100 s Forensic run; Workers
paid plan includes 10 M requests per month).

SSE for the queued path: a Pages Function cannot be notified when the queue consumer writes the job record
without a Durable Object, so an SSE endpoint would poll storage server-side at the same rate and hold a connection
open for the whole run. Polling at 1 s gives the same latency with no new infrastructure. A Durable Object per job
(push on write) is the only design that beats it, and it is a new Cloudflare component needing Claude's review.

### 6.3 Progressive delivery

The server already writes each validated section to the job record (`onSection` → job `sections`,
`sectionsTotal`) and streams `section` events on the direct path. The browser does not render them before
completion. Rendering is Antigravity's UI. Rule for that work: show a section only after deterministic guards
(quote location, citation checks) and label red flags and thresholds "awaiting independent review" until
verification completes; the final report replaces them. No server change is required.

### 6.4 Report cache (DEVIN-PERF-03, implemented as library + pending migration; not wired)

`functions/api/_report-cache.ts` and `supabase/migrations_pending_approval/create_navigator_report_cache.sql`.
- Fingerprint: HMAC-SHA256 (server secret, at least 32 characters) over owner + text (line endings and NFC
  normalized only). The same document in two accounts gives unrelated fingerprints.
- Key: HMAC over key version, owner, fingerprint, mode, analyzer version, prompt version, primary and
  verification model, legal reference version and effective date. Any change is a miss.
- Policy (`evaluateCacheEntry`): owner match, key match, key version, not deleted, not expired, completed.
- A hit is returned as `delivery.source = "previously_completed"` with the original job id and completion time,
  `creditsCharged: 0`. It is never presented as a new analysis.
- Table stores no document text or report content (it points to the existing private `analysis_jobs` object), RLS
  on with no anon/authenticated access, owner-forget and expiry-purge functions.
- Before wiring: the codebase has no analyzer or prompt version constants; Claude must add them (bumped on every
  prompt or pipeline change), add `REPORT_CACHE_SECRET`, approve the migration, and decide retention.
- Expected effect (PROJECTED): a repeat of an identical document returns in one owner-scoped database read plus
  one storage read, under 1 s, with no AI cost.

### 6.5 Measured results

See the table appended below by the benchmark run.

### 6.6 Pipelined and parallel verification (design; mocked)

Today: verification is one call over all red flags and thresholds after both sections finish (production: red
flags about 88 s, then verification about 31 s). Pipelining: verify red flags in batches of about 5 as they
complete in the stream, with a final cross-finding pass that sees every finding (needed for duplicates, the
one-CRITICAL rule and contradictions). Critical path becomes red flags + one small batch + final pass
(PROJECTED about 88 + 8 + 10 s instead of 88 + 31 s). It needs incremental JSON parsing of the red-flag stream and
an accuracy comparison against single-pass verification (budget item S2). Parallel verification of independent
batches is safe only with the final cross-finding pass; without it, cross-finding checks would be lost.

### 6.7 Splitting the longest stage

Red flags could be generated by page range (each shard sees its pages plus a shared document summary), merged,
de-duplicated by quote location, then guarded and verified as today. Risks: cross-page reasoning
(contradictions, chronology) is lost unless chronology stays a whole-document section, which it does today.
Critical path would become the slowest shard (PROJECTED about 30–45 s for 3 shards). Requires a paid accuracy
study (S3).

### 6.8 Prompt caching and cost (PROJECTED, repository `MODEL_PRICING`, 10,000-token document)

| Analyzer | Approx. cost now | With document-prefix caching |
|---|---|---|
| Quick (Sonnet, 4 sections) | about $0.22 | +$0.02 if all 4 start together (4 cache writes at 1.25×); about −$0.05 if one section starts first, but the other 3 then start about 1–2 s later |
| Forensic (Opus, 6 sections + verification) | about $1.25 | about −$0.14 (3 writes + 4 reads instead of 7 full inputs) and faster time-to-first-token for wave 2 and verification |
| Final Case Assessment (Opus, 1 call) | about $0.30 | none (single call) |

Cache-hit savings are 90% of the cached input; a cache miss costs 25% more than no caching. Caching requires the
adapter to stop joining content blocks into one string and verification to share the exact document prefix.

### 6.9 Faster models

Repository pricing: Sonnet 5 $2/$10, Opus 5 $5/$25, Haiku 5.5 $0.10/$0.50 per million input/output tokens.
Time to first token, throughput, accuracy and structured-output reliability for this workload have not been
measured and cannot be without paid runs; no model was changed. Context capacity and concurrency limits come from
the provider account and were not checked. Deterministic work already done in code (no AI): quote location, citation
parsing and verification, historical-law effective dates, severity ceilings, Evidence Strength Index arithmetic,
compliance matrix. Candidates to move from AI to code next: date extraction and chronology candidates (offer the
model a pre-extracted, page-cited date list) and document metadata.

### 6.10 Staged paid-testing budget (not spent)

| Allocation | Runs (approx.) | Verifies |
|---|---|---|
| $5 | S1: 2 Forensic at concurrency 3 vs 6 on staging (about $2.50); 4 Quick (about $0.90); 2 Final Case Assessment (about $0.60); 1 Forensic repeat for polling end-to-end | CPU/memory at 6 on a real Worker; PERF-01 CPU effect; 1 s completion detection end-to-end; first real Final Case Assessment timing |
| $10 | $5 set + S2: 4 Forensic with document-prefix caching vs 4 without would exceed it, so 2 + 2 (about $5) | measured cache-hit rate, time-to-first-token and cost delta on Forensic |
| $20 | $10 set + S3/S4: pipelined verification vs single pass on 3 synthetic labelled documents (about $4) and Sonnet vs Opus Forensic sections on the same 3 (about $5) | whether pipelining or a faster model keeps findings, citations and verification verdicts equal; numbers too small for statistics, enough to decide whether a larger study is worthwhile |
