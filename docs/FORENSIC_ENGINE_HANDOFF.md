# Forensic Engine — Handoff

For the next coding agent (Google Antigravity or other). Read this first; the investigation it records does not need
to be repeated.

## State

| Item | Value |
|---|---|
| Branch | `feat/forensic-engine` (pushed to `origin`) |
| Latest code commit described here | `0a02eccdc5f6b24df3b82aa6845a6a6cad03c9a5` (this document is committed on top of it) |
| Draft PR | #111, base `fix/forensic-accuracy` (draft PR #110), which is based on `main` @ `e2bbc76f` (production) |
| Production | Unchanged. Nothing merged, nothing deployed. |
| Feature flag | `FORENSIC_ENGINE_ENABLED=true` (server env). **Off by default and not set anywhere.** With it off, the route behaves exactly as before. |
| Approval needed for | Merging, deploying, setting the flag in any Vercel environment, live (billable) benchmark runs. |

Merge order: PR #110 first, then #111. This branch contains #110's statute corrections.

Usage allowance: this environment exposes no remaining-usage or reset information. No live API calls were made, so
there are no measured API costs.

## Test results at `0a02eccd`

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 191 files passed, 3,654 tests passed, 0 failed, 433 skipped.
  Engine-specific: `api/services/forensic` 55 tests, `src/components/ForensicEngineRecord.test.tsx` 4,
  `api/analyzerEndToEnd.test.ts` 8 engine route tests (55 in the file).
- `npm run build`: exit 0.
- **Live benchmark: NOT RUN** (no `ANTHROPIC_API_KEY` here; billable runs need owner approval). No accuracy,
  false-positive, cost or latency figures exist. Do not quote any.

## Completed

### Engine (`api/services/forensic/`)
- `caseModel.ts` — case-level evidence model. Every `EvidenceRef` (document, verbatim quote, page, code-point span,
  match status, extraction method, OCR confidence) is located by code, never taken from model output.
- `caseAnalysis.ts` — deterministic chronology; events dated after the document's own date (sworn/issued/endorsed);
  same-date and same-asserter conflict leads. Leads go to Opus as hints to verify; they are never findings.
- `documentIsolation.ts` — random-nonce boundaries per call; instruction-like text detected and reported, never followed.
- `grounding.ts` — nine deterministic rules (see file header); verbatim bundled statute text attached to verified
  citations (legal-source retrieval by lookup, not model judgement).
- `prompts.ts` — EXTRACTION (auxiliary), INVESTIGATION (Opus, open hypotheses, no quota/cap), SYNTHESIS (Opus,
  cross-document), REVIEW (Opus, falsification, checks legal characterisation against supplied statute text),
  VISUAL (page check; no tampering claims).
- `pipeline.ts` — extraction → case model → investigation (single pass, or per-document + synthesis above
  `singlePassMaxChars`) → adversarial review → visual verification (page images, or the original PDF as a
  `document` block, or the original image) → grounding + duplicate merge. Call budget, deadline, per-stage caps,
  progress callbacks, PARTIAL status with plain-language `incompleteness`.
- `integration.ts` — flag; `buildCaseDocuments` from the existing upload extraction (keeps the original PDF/image,
  ≤ 20 MB base64, for visual checks); `parseAdditionalDocuments` (≤ 9 `{title,text}`, else 400);
  `ROUTE_LIMITS` for the 300 s function; `toLegacyReport` (existing report shape + `forensicEngine` record, usage and
  model ids stripped); `runForensicEngineForRoute` (returns `runSectionedAnalysis`'s shape; throws retryable 503 if
  investigation, synthesis or review failed).
- `evaluation.ts` + `eval/forensic/cases/*.json` (7 author-annotated synthetic cases) + `scripts/forensicBenchmark.ts`.
- `shared/bundledLegalSources.ts` — bundled CYFSA text pinned by SHA-256.

### Route and UI integration
- `api/_server.ts`:
  - `generateContentWithFallback` now passes `image` and `document` message parts through unchanged (previously
    every non-text part was JSON-stringified). Text-only callers are unaffected.
  - In `/api/analyze`, one guarded branch: `isForensic && isForensicEngineEnabled()` → engine; else the existing
    `runSectionedAnalysis`. It runs after authentication, entitlement (`resolveServerAuthoritativeModel`) and credit
    reservation, and returns the same shape, so cost logging, `recordPaidUse`, `finalizeAnalysisCredit`,
    `completeAnalysisJobDurable` and free-scan settlement are unchanged.
  - Model routing: Claude Opus (`verificationModel || ANALYZER_MODELS.FORENSIC`, i.e. `claude-opus-5`) investigates
    and reviews with adaptive thinking; the mode's primary model (`claude-sonnet-5`) only extracts. No model or
    pricing change.
- `src/components/ForensicEngineRecord.tsx` + `src/utils/forensicEngineView.ts` — screen section and PDF-export HTML
  for the engine record: status, what the analysis did not do, injection warnings, findings with evidence class,
  review verdict, uncertainty, page check, quotations with document and page, contrary text, alternatives, missing
  information, citations with bundled statute text, grounding notes, set-aside findings, hypotheses.
- `src/components/DocumentAnalyzerTab.tsx` — renders the record on screen and in the export; a missing
  `completenessScore` shows as "Not scored"/"—" instead of 0 or "undefined" (the engine does not invent a score).

### Verified by tests (mocked provider, production-like credit DB)
- Opus routing and adaptive thinking on investigation/review; Sonnet extraction; no legacy section calls.
- Credit: `paid_reserve_credit` + `paid_finalize_credit` on success; `paid_release_credit` (no finalize) when review fails.
- Retry of a completed engine job returns the saved report: no new model calls, no second reservation.
- Quick Review unaffected with the flag on; Forensic uses the existing analyzer with the flag off; unpaid users still get
  403 before any model call; malformed `additionalDocuments` → 400, nothing charged.
- Multi-document requests reach Opus together; case model lists every document.
- Grounding rules, isolation, chronology anomalies, conflict leads, synthesis, PDF document blocks, statute text to
  the reviewer, report adapter, view escaping, redacted export omitting the engine record.

## Incomplete / not built

1. **Live evaluation.** Benchmark never run against real models. No measured accuracy, false-positive or missed-issue
   rates, cost or latency.
2. **Independent review** of benchmark gold and sample reports by an Ontario child protection lawyer.
3. **Execution time — OWNER DECISION NEEDED.** The route runs inside a 300 s function with a 265 s AI deadline. Extraction + Opus
   investigation (12k output cap) + Opus review (6k) + visual may not fit for long documents; when the deadline is hit
   the run throws a retryable 503 and releases the credit, so it fails safe but may fail often on large files.
   Two options, both needing owner approval: (a) raise `functions["api/index.ts"].maxDuration` in `vercel.json`
   (hosting cost and plan limits apply; production value was never verified), or (b) build resumable execution:
   run one engine stage per invocation, persist the intermediate state in the job record, and continue on the
   client's next poll, reserving the credit once and finalizing or releasing it at the end. (b) touches the job
   state machine and credit flow and needs its own design review. Neither is built.
4. **UI for multiple documents.** The server accepts `additionalDocuments`; the upload screen still sends one file.
5. **Page images.** Not rendered. Visual checks use the original PDF/image (`document`/`image` blocks). PDFs over
   ~20 MB base64 or over the provider's page limit get no visual check (findings stay HIGH uncertainty).
6. **OCR confidence.** Extraction (`api/services/pageSources.ts` `extractPages`) reports `confidence: null`, so rule 7
   never fires on live uploads. Page markers are fine: extraction emits `[Page N]` per PDF page, and the per-page
   method (text layer vs OCR) is recorded in provenance (`pageExtractionMethods`, read from the extraction cache
   without re-running OCR). PDFs are limited to 20 pages by the existing extractor.
7. **Live progress sections.** The engine reports stage progress over SSE but does not stream partial findings.
8. **Corpus integration.** Statute retrieval uses the 10 bundled verified provisions only; the Stage 6 corpus
   (`api/services/legalCorpus*.ts`, `legalAuthority.ts`) is not connected.
9. **Comparable systems** not benchmarked.

## Architecture decisions

1. Separate pipeline, existing route contract. The engine returns `runSectionedAnalysis`'s shape so no billing,
   persistence or settlement code changed.
2. Opus investigates (open-ended hypotheses over the whole record); an auxiliary model only indexes. Deterministic
   leads are hints, explicitly not findings, so no hard-coded checklist constrains Opus.
3. Adversarial review is a separate call with its own prompt and the verbatim statute text.
4. Safety in code: quotations re-located; unsupported findings to the appendix; E requires verbatim support and an
   upheld review; absence never proves breach; visual findings uncertain until the page confirms.
5. Fail closed on what the product promises: no completed investigation or review → no report, credit released.
   Missing visual checks or extraction degrade to PARTIAL with explicit statements, not failure.
6. Customer copy carries no tokens, costs or model ids (existing test regex enforced on the engine route).
7. Redaction: the existing recursive redactor removes the engine record's schema marker, so redacted exports omit
   the record entirely rather than showing half-redacted text.

## Security and privacy notes

- Uploaded documents are wrapped in nonce boundaries and treated as evidence; instruction-like text is reported.
  Pattern-based detection is not complete; the structural defences are the boundary and code-side grounding.
- The original PDF/image is sent to Anthropic for the visual stage (as the extracted text already is). It is not
  stored in the report or job record.
- `additionalDocuments` is validated (count, type, size) and only read on the engine path.
- The engine record in the saved report contains quotations from the documents, like the existing report.
- No new endpoints, no new secrets, no database schema changes.

## Exact next steps for Google Antigravity

1. `git fetch origin && git checkout feat/forensic-engine` (head is this document's commit on top of `0a02eccd`).
2. `npm ci && npx tsc --noEmit && npx vitest run && npm run build` — expect all green as above.
3. With owner approval and a **non-production** key: `ANTHROPIC_API_KEY=... npx tsx scripts/forensicBenchmark.ts --cases=affidavit-hearsay`,
   then the full set. Commit `eval/forensic/results/*.json`. Record cost and latency per case honestly.
4. Get the owner's decision on execution time (Incomplete item 3). Then measure route timing on a preview with the flag on (owner approval to set `FORENSIC_ENGINE_ENABLED=true` on a
   **preview** environment only; never production) using a 2-page and a 30-page document. If runs exceed ~240 s,
   implement background execution (step 5) before anything else.
5. Background execution: create the job as now, run `runForensicEngineForRoute` in a worker that writes the result
   with `completeAnalysisJobDurable`, and let the client poll the existing job endpoint. Reuse credit reservation
   and release exactly as the route does.
6. Multi-document upload UI in `DocumentAnalyzerTab.tsx`: send extra files' extracted text as `additionalDocuments`.
7. Report OCR confidence from the extraction step (`PageSource.confidence`) so low-confidence pages are flagged.
8. Connect Stage 6 corpus retrieval for effective-date-aware statute text; keep the verbatim test for every entry.
9. Lawyer review of benchmark gold; add the real two-page endorsement fixture (redacted) when the owner supplies it.
10. Only then prepare a release recommendation, with measured false-positive and missed-issue rates.

## Do not

- Merge, deploy, or set `FORENSIC_ENGINE_ENABLED` in production without explicit owner approval.
- Claim the engine is elite, production-ready, or better than competitors on the basis of these tests.
- Mark any benchmark case as independently reviewed unless it has been.
- Change Quick Review, authentication, payments, pricing, existing model routing, or the production Vercel project
  `cyfsanavigator` (prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR).
