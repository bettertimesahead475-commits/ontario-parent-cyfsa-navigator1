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
