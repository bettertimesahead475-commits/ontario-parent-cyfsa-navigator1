# Document Analyzer: evidence-integrity correction report

Branch: `fix/analyzer-correction-integrity`, from production baseline `0130a96f75f417aa9d588c8103a42dc90a8dc2fa`.
Status legend: VERIFIED FIXED (defect reproduced before the fix and tested after), VERIFIED PASS (tested, no defect), PARTIALLY VERIFIED, BLOCKED, NOT TESTED.

## Verification gate

| Check | Runtime | Result |
|---|---|---|
| `tsc --noEmit` | Node 22 | exit 0 |
| Full Vitest suite | Node 22.22.0 | 177 files passed, 12 skipped; 3,385 tests passed, 467 skipped |
| Full Vitest suite | Node 24.22.1 | 177 files passed, 12 skipped; 3,385 tests passed, 467 skipped |
| `npm run build` | Node 22 | exit 0 |

Skipped suites need resources this environment does not have: `*.pg.test.ts` (live Postgres), `creditStaging.test.ts` (staging Supabase credentials), and the semantic-map suites that read real artifacts. Nothing skipped was run against customer data.

Baseline before changes: 170 files passed, 12 skipped; 3,324 passed, 467 skipped.

## Defects

| # | Defect | Status | Evidence |
|---|---|---|---|
| A | Failed audio transcription was replaced with placeholder text and analyzed as evidence | VERIFIED FIXED | Component tests fail on `0130a96f` and pass on the branch (`DocumentAnalyzerTab.evidenceIntegrity.test.tsx`). Helper tests in `analyzerUploadGuards.test.ts`. |
| B | Empty OCR output was treated as a blank page; partial pages were returned | VERIFIED FIXED | `pageSources.ocrIntegrity.test.ts`, `pageSources.test.ts`. A page is blank only on the explicit `[[BLANK_PAGE]]` marker. Empty output is retried (3 attempts) and then fails with `EXTRACTION_INCOMPLETE` naming the pages. |
| C | DOCX extraction used regex, dropped headers, footers, text boxes, footnotes, and table structure, and silently ignored images | VERIFIED FIXED | `docxExtractor.structure.test.ts` (15 tests). Parser is `fast-xml-parser` 5.11.1, now a direct dependency. |
| C2 | Every DOCX sent to `/api/extract-text` was rejected with 400 before extraction (`decodeSource` did not allow the DOCX MIME type) | VERIFIED FIXED | Reproduced on `0130a96f` (400). Positive route test added in `_server.test.ts`. |
| D | Page citations were never checked against the source | VERIFIED FIXED | `analyzerSections.pageCitation.test.ts` (8 tests). Extract route now labels PDF pages `[Page N]`. A wrong page is proposed as a correction with the original preserved (`locationAsReported`). Ambiguous citations are never relocated. |
| E | Extraction failure in `/api/analyze` continued with caller text alone | VERIFIED FIXED | Route test `does not analyze caller text when the supplied document type cannot be read` fails on `0130a96f` (analysis ran, 200) and passes on the branch (422, no model call). |
| F | An unlisted Forensic model could silently downgrade to Quick (Sonnet) | VERIFIED FIXED | `callClaude` refused an unlisted model by substituting Quick. It now refuses with `AI_PROVIDER_CONFIGURATION_ERROR`. Forensic with a misconfigured model fails with `FORENSIC_MODEL_UNAVAILABLE`. Tests in `analyzerModels.integrity.test.ts`. |
| F2 | Model identifiers not verified against provider metadata | NOT TESTED | `scripts/verify-analyzer-models.mjs` is read-only and calls the model-list endpoints only. No keys exist in this environment, so it exited 2 ("nothing verified"). Owner must run it with keys. |
| G | Malformed PDF could escape as an unclassified `TypeError` | VERIFIED FIXED | Load and page count share one guard. Test in `pageSources.ocrIntegrity.test.ts` expects `INVALID_SOURCE` 400. |
| G2 | PDF.js full-layout parsing fell back to the degraded path | VERIFIED FIXED (locally) | An empty `workerSrc` (falsy) disabled full-layout parsing, and the fallback was used. The branch sets the worker file path. Regression test `full-layout parsing does not fall back` fails with the old setting and passes with the fix. `vercel.json` includes the worker file. Production bundling NOT TESTED (no deployment). |
| G3 | Node 24 canvas warning | NOT TESTED | Not reproduced on Node 22 or 24. The Node 24 suites ran with no canvas output. |
| H | Credit finalization failed on a transient write and then released or lost a valid report | PARTIALLY VERIFIED | Finalize is idempotent in SQL (`consumed` maps to `consumed`), so retries cannot double-charge. The branch retries transient failures 3 times. Release only acts on `reservation:reserved*` markers (SQL checked), so a consumed reservation cannot be released. The report is still lost if finalize fails permanently. See "Open items". |
| I | Stale comments and provenance labels | VERIFIED FIXED | `analyzerModels.ts` header named `claude-3-opus-20240229` as Forensic. It now names the actual defaults. |

## Insight and correction engine (Phase 3)

Connected to the live report path: quote verification (`verifyQuoteAgainstSource`), citation guards (`guardCitation`), and page citation checks (`verifyPageCitation`).

Present in the codebase but not in the parent-facing `/api/analyze` report: evidence classification (`CLASSIFICATIONS` in `pageSources.ts`), review states, contradiction and corroboration logic, and the evidence-gap model. They are referenced by the source pipeline, but I did not trace them to a user-visible result.

Not present in the codebase: due-process observations, rights observations, judicial-order analysis, professional-assessment classification, and a correction history with preserved versions.

Status: the citation and quotation checks are VERIFIED. The requested correction system (original finding, identified error, supporting source, proposed correction, review history) is NOT IMPLEMENTED. It needs its own design and approval.

## Performance (Phase 4), local only

Measured with the same harness as the earlier audit. Simulated OCR latency is not provider latency.

| Document | Baseline p50 / p95 (ms) | Branch p50 / p95 (ms) |
|---|---|---|
| Text PDF, 1 page | 6 / 15 (first call 1,300 cold) | 14 / 14 (cold 761) |
| Text PDF, 10 pages | 54 / 65 | 34 / 35 |
| Text PDF, 20 pages | 73 / 98 | 60 / 62 |
| Scanned PDF, 20 pages (OCR calls cost 0) | 24 / 31 | 17 / 20 |

Text-PDF timings are not directly comparable between the two runs. The branch runs with full-layout parsing active, the baseline's run timings are from a different run, and the 1-page cold figure reflects warm-up order. The first measured run on the branch (before the worker fix) showed much faster numbers, but that was the fallback path, and it was discarded.

Concurrency (local, 10-page text PDF, 3 extractions per simulated user, 4 vCPU):

| Users | Throughput (baseline) | Throughput (branch) | p95 (baseline) | p95 (branch) |
|---|---|---|---|---|
| 1 | 3.1/s | 3.3/s | 875 ms (includes cold start) | 843 ms |
| 5 | 38.2/s | 33.8/s | 158 ms | 173 ms |
| 10 | 41.9/s | 42.2/s | 276 ms | 271 ms |
| 25 | 43.2/s | 38.0/s | 605 ms | 733 ms |

Single runs. Variance is not characterized. At 25 users, the branch's full-layout parsing does more CPU work per extraction than the fallback, which it replaces. This is the correctness cost and is measured once, not confirmed.

Not measured: real model latency, Supabase, Firebase, Vercel cold starts, and first-verified-content timing. These need staging and an approved test budget.

## Credit accounting and recovery (Phase 5)

No database migration was made or applied. Finalize retries are safe because `paid_finalize_credit` returns `consumed` for an already-consumed reservation.

Remaining gap: if finalize fails permanently after a valid report is produced, the report is discarded and the reservation is released. The user is charged nothing and receives nothing. Preserving a validated report while billing is pending requires a new job status. That change touches the job store and, if it needs a new column, a migration. It is not implemented and needs approval.

## Security and privacy

- ZIP safety in `docxZipSafe.ts` is unchanged and still applies to the new parser.
- XML document type declarations are refused before parsing (entity-expansion defense).
- Non-text content (images, charts, embedded objects, tracked deletions) marks the extraction incomplete.
- Model refusal is stricter: no silent substitution for any model identifier.
- Provider outages keep their classification (retryable). Empty output is not classified as an outage.
- No new storage of extracted text. The page-extraction cache remains in-process only, as before.

## Parent and professional experience (Phase 6)

NOT IMPLEMENTED. The parent-language view and the professional view need product design and review by the owner. The analyzer already returns a single report; these are not separate views yet.

## Open items requiring approval

1. Owner decision on production deployment `dpl_65asc…`, which serves `0130a96f` (unchanged by this branch).
2. Run `scripts/verify-analyzer-models.mjs` with `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` set. Exit code 0 is required before changing any identifier.
3. Preview deployment of this branch to confirm `vercel.json` `includeFiles` bundles `pdf.worker.mjs` for `api/index.ts`. Not deployed here.
4. Decision on report preservation when billing fails (new job status, possible migration).
5. Real-model latency measurement under an approved test budget.
6. Correction system and due-process/rights/judicial-order modules: scope and design.
7. Parent and professional report views.

## Known limitations

- The DOCX reader does not read images, charts, or embedded objects. It reports them. Their content needs OCR or manual review.
- DOCX has no fixed pages. Page numbers are not used as citations for DOCX sources; the response marks the source `unpaginated`.
- Header and footer text is shown once, labelled, not once per page.
- Quote and page checks compare text. They do not verify that the model's interpretation of the text is correct.
