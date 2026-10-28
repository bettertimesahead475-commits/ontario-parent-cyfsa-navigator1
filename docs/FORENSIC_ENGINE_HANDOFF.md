# Forensic Engine — Handoff

For the next coding agent (Google Antigravity or other). Read this first; the investigation it records does not need
to be repeated.

## State

| Item | Value |
|---|---|
| Branch | `feat/forensic-engine` (pushed to `origin`) |
| Code commit described here | `ad8b7dc506d846dbf454f682b1761ddcff2232fd` (this document is committed on top of it) |
| Based on | `fix/forensic-accuracy` @ `43c765f7` (draft PR #110), which is based on `main` @ `e2bbc76f` (production) |
| Production | Unchanged. Nothing merged, nothing deployed. The engine is not wired to any route. |
| Approval needed for | Merging, deploying, wiring to a route, spending on live benchmark runs. |

Branch ancestry matters: this branch contains PR #110's statute corrections. Merge PR #110 first (or together); do
not merge this branch alone over a `main` without #110.

## Test results at `ad8b7dc5`

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 188 files passed, 3,622 tests passed, 0 failed, 433 skipped (the run before the manifest test was
  added; that test passes on its own, `api/services/forensic/bundledLegalSources.test.ts`).
- `npm run build`: exit 0.
- Forensic engine tests: 36 (grounding 15, pipeline 7, evaluation 13, provenance 1). Run:
  `npx vitest run api/services/forensic`.
- **Live benchmark: NOT RUN.** No `ANTHROPIC_API_KEY` in this environment. The runner wrote
  `eval/forensic/results/2026-10-28T22-02-32-356Z.json` with `status: NOT_RUN`. No accuracy, false-positive, cost or
  latency number exists yet. Do not quote any.

## What was built (all new files; no existing behaviour changed)

```
api/services/forensic/
  caseModel.ts          Case-level evidence model. EvidenceRef = documentId + verbatim quote + page + code-point span
                        + match status + extraction method + OCR confidence, located by code (shared/quoteVerification
                        locateQuote), never taken from model output. People, events (with dateSource: COURT_RECORD /
                        DOCUMENT_BODY / FILENAME / METADATA), claims (basis: FIRSTHAND / NAMED_SOURCE / UNNAMED_SOURCE /
                        OPINION), findings, hypotheses, stage records, report.
  documentIsolation.ts  Random-nonce document boundaries per call; instruction-like text detection (reported, never
                        followed).
  grounding.ts          Deterministic rules no model can override (numbered in the file header, one test each):
                        support required; review verdicts applied; E needs verbatim quote + UPHELD review else D;
                        A needs verbatim quote else C; class B never proves breach; visual findings uncertain until
                        image confirms, dropped if image contradicts; low OCR confidence raises uncertainty; citations
                        classified via shared/citationVerification; duplicates merged keeping all references.
  prompts.ts            Separate system prompts: EXTRACTION (auxiliary), INVESTIGATION (Opus, open hypotheses, no quota,
                        no cap), REVIEW (Opus, falsification mandate), VISUAL (page images; no tampering claims).
  pipeline.ts           runForensicInvestigation(): extraction per document -> case model -> investigation ->
                        adversarial review -> visual verification -> grounding. Call budget, per-document char cap,
                        per-stage token caps, deadline. Any failed stage => status PARTIAL with plain-language
                        `incompleteness`. Failed investigation => zero findings (never substitutes weaker output).
  evaluation.ts         Benchmark case type, scorer, adapter for the existing analyzer (fromLegacyReport).
  *.test.ts             Tests for all of the above.
shared/bundledLegalSources.ts   SHA-256-pinned provenance manifest for the bundled CYFSA text.
eval/forensic/cases/*.json      7 synthetic, author-annotated benchmark cases.
scripts/forensicBenchmark.ts    Live runner: engine vs existing analyzer, identical documents and scoring.
```

## Architecture decisions (and why)

1. **Separate pipeline, not a rewrite.** `api/services/analyzerSections.ts` still serves Quick Review and the current
   Forensic report. The engine reuses its `GenerateFn` contract and `parseJsonLenient`, so it can be wired to the same
   model client, credit accounting and job recovery without touching them.
2. **Opus does the investigation, not formatting.** The investigator prompt asks Opus to form and test its own
   hypotheses over the whole record, with supporting and contradicting evidence, alternatives and missing information.
   The auxiliary model only builds an index (the case model), which Opus is told to check against the documents.
3. **Adversarial review is a separate call with a separate prompt**, even on the same model id. The reviewer only
   sees proposed findings and the documents, and is told rejection is success.
4. **Safety lives in code, not prompts.** Every quotation is re-located deterministically; findings without surviving
   evidence go to `appendix` with reasons. Class E (confirmed noncompliance) cannot survive a failed or missing review.
5. **No quota, no cap** on material findings. Deduplication merges restatements instead of truncating.
6. **Honest evaluation.** Matching is through verified evidence quotations only. Unmatched predictions are reported
   as "unmatched (needs adjudication)", not as false positives; only forbidden-pattern hits are confirmed false
   positives. Cases are marked `independentlyReviewed: false`, and a test enforces that no case claims otherwise.
7. **Statute versioning by pinning.** The bundled text is pinned by SHA-256; currency against live e-Laws is recorded
   as not checked (`currencyCheckedAgainstELaws: false`).

## Known issues and limitations

- Not wired to any route, UI, job store, credit accounting or PDF report. No end-user can run it.
- Live benchmark not run (no API key here). Cost per case unknown; expect several Opus calls per case (1 extraction
  per document + investigation + review + optional visual).
- Gold annotations are by the engineering author, not an Ontario child protection lawyer. Independent review is a
  release requirement and has not happened.
- No comparable third-party system has been benchmarked.
- Page images: `CaseDocument.pageImages` is supported by the pipeline, but nothing yet renders PDF pages to images.
  Visual findings are therefore marked HIGH uncertainty in practice.
- Long cases: each document is capped at `maxCharsPerDocument` (300k chars) and the investigation receives all
  documents in one call. Very large multi-document files will hit context limits; chunked investigation is not built.
- Extraction drops items whose quotation is not verbatim (OCR noise can cause valid items to be dropped; the count is
  reported as `droppedUngrounded`).
- Duplicate merge is heuristic (shared span + token Jaccard >= 0.35, or Jaccard >= 0.8).
- Instruction detection is pattern-based; it reduces, but does not eliminate, prompt-injection risk. The structural
  defence is the nonce boundary plus code-side grounding.
- Citation verification covers only the 10 provisions in `shared/citationVerification.ts` `INTERNAL_CYFSA_SECTION_KEYS`;
  everything else is reported UNVERIFIED by design.
- The original two-page endorsement and generated Forensic PDF from the post-launch review are not in the repository.
  The `endorsement-attendance` case is a synthetic stand-in, not that record.
- Vercel previews for PR #110 report "Account is blocked" (account-level, not code). Previews will fail for this branch
  too until the account is unblocked.

## Exact next steps

1. **Get approval to spend**, then run the live benchmark with a non-production key:
   `ANTHROPIC_API_KEY=... npx tsx scripts/forensicBenchmark.ts` (or `--cases=affidavit-hearsay` for one case first).
   Commit the results file from `eval/forensic/results/`. Report engine vs baseline recall, forbidden hits,
   no-problem-case findings, unmatched counts, cost and latency exactly as produced.
2. **Read the unmatched findings by hand** and decide, case by case, whether each is a true issue the gold missed
   (update the case) or a false positive (add a forbidden pattern). Record decisions in the case `annotation.notes`.
3. **Add the real fixture** (the two-page endorsement and its Forensic PDF) once the owner provides it, as a new case
   with `pageImages`. Keep personal information out of the repository or redact it first.
4. **Page rendering for visual verification:** render PDF pages to PNG (pdfjs-dist is already a dependency of the
   upload path; check `api/_server.ts` PDF handling) and populate `CaseDocument.pageImages` for pages that findings cite.
5. **Wire behind a flag:** add `POST /api/analyze` mode `forensic_engine` (server-side flag, default off) that builds
   `CaseDocument[]` from the existing upload extraction and calls `runForensicInvestigation` with the existing Anthropic
   `GenerateFn` from `api/_server.ts`. Reuse the existing paid-credit reservation and job persistence
   (`api/services/analyzerStreaming.ts`, `api/services/creditAccounting.ts`) unchanged; persist `ForensicReport` as the
   job result. Do not change pricing or entitlements.
6. **Report rendering:** a findings view that shows, per finding, evidence class label, quotations with page numbers,
   review verdict, uncertainty, visual status and grounding notes, plus the `appendix` and `incompleteness` sections.
7. **Long and multi-document cases:** add a chunked investigation (per-document investigation, then a case-level pass
   over the case model and per-document findings) when total input exceeds a threshold; add benchmark cases over
   100 pages.
8. **Expand verified legal provisions** only by adding verbatim entries to `src/utils/statuteReference.ts` and keys to
   `shared/citationVerification.ts` (the verbatim test enforces accuracy). Consider integrating the existing Stage 6
   corpus (`api/services/legalCorpus*.ts`, `legalAuthority.ts`) for effective-date-aware retrieval.
9. **Independent review:** have an Ontario child protection lawyer review the benchmark gold and a sample of engine
   reports before any production recommendation. Then measure false-positive and missed-issue rates on that reviewed
   set, test privacy/access controls on the wired route, and document remaining limitations.

## Do not

- Merge or deploy without explicit owner approval.
- Claim the system is elite, production-ready or better than competitors on the basis of these tests.
- Mark any benchmark case as independently reviewed unless it has been.
- Change Quick Review, authentication, payments, pricing, model routing for existing modes, or the production
  Vercel project `cyfsanavigator` (prj_wbNOXbsCWbj7vyu7JjxlXwt4WQpR).
