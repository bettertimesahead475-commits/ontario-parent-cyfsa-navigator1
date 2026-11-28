# Analysis reuse across levels: baseline and design (2026-11-28)

Branch `engineering/perf-recovery-20261128-int`. Mocked provider only (no spend). Harness: `api/redundancy-baseline.test.ts`.
Synthetic document: 50 pages, 145,640 characters.

## 1. Current code: nothing is reused across requests

| # | Scenario | Provider calls | Verification calls | Characters sent | Reuse eliminated |
|---|---|---|---|---|---|
| 1 | Basic Review, fresh | 4 | 0 | 593,971 | — |
| 2 | Deep Scan, fresh | 7 | 1 | 1,041,282 | — |
| 3 | Deep Scan after completed Basic (same account) | 11 | 1 | 1,635,253 | 0 (Basic work is not reused) |
| 4 | Final Case Assessment, 3 raw sources | 1 | 0 | 8,824 | — |
| 5 | Repeated Basic, unchanged document | 4 | 0 | 593,971 | 0 (no cache wired) |

Extraction and OCR are not counted here: the analyzer receives text, and `/api/extract-text` runs once per upload, not
per analysis. Re-uploading an unchanged file repeats extraction and OCR. Not measured (needs the upload path).

## 2. What the code does today

- **Basic and Deep Scan** send the full document with every section and again with verification (about 7× the
  document per Deep Scan, 4× per Basic). They share no state.
- **Deep Scan verification** already re-checks red flags and thresholds with a second model pass. It does not reuse
  Basic findings as input.
- **Final Case Assessment** (`functions/api/final-case-assessment.ts`) does not consolidate completed document analyses.
  It concatenates the matter's stored page texts and makes one model call (max 6,000 output tokens). This re-reads
  raw material instead of consolidating verified analyses.
- **Report cache** (`functions/api/_report-cache.ts`, DEVIN-PERF-03) is account-isolated and tested, but not wired, and
  its migration is in `migrations_pending_approval`.

## 3. Historical evidence

- `shared/m2a-deterministic.ts`, `m2b-chronology.ts`, `m2c-claims.ts`, `m2d-relationships.ts`, `m2e-intelligence.ts`:
  a deterministic case-intelligence layer (fingerprints, date precision, claim classification, relationships, findings
  with a version constant `M2E_ALGORITHM_VERSION`). It has unit tests in `api/services/` and is not imported by the
  analyzer, the queue Worker or the UI. It is the closest existing foundation for reusing structured facts.
- Commit `197813b` (workspace discovery of cached reports without credits) and `5af6840` (cached report discovery
  tests) show that saved reports were meant to be found and reused without a new charge.
- Commits `77b4a21` and `969bb61` made retries reuse an analysis id so an uncertain outcome does not charge twice.

## 4. Why I did not implement the shared foundation in this pass

Each piece changes something the owner must decide:

1. **Entitlement.** A direct Deep Scan that builds a Basic foundation internally must not consume a Basic credit, and
   the owner must decide that rule. Today the Deep Scan reservation is one credit.
2. **Persistence.** Reusing extracted text, page maps and findings across requests means storing derived document data
   per account. That needs the report-cache migration approved, a retention decision and a secret (`REPORT_CACHE_SECRET`).
   Nothing was applied.
3. **Prompt change for "deepen, not regenerate".** Passing Basic findings into the Deep Scan prompt would change the
   model input. Its effect on findings, quotations and verdicts can only be checked with paid runs (budget items in
   `analyzer-e2e-performance-plan-20261128.md`).
4. **Final Case Assessment input.** Consolidating per-document analyses changes the report's sources. Needs the owner's
   decision on what the assessment may rely on (a verified analysis or the raw text).

## 5. Design (for approval)

- **Document identity.** SHA-256 of the extracted text (after line-ending and Unicode normalisation), plus the
  extraction method, page map version and OCR model if OCR ran. Stored per account with the HMAC scheme in
  `_report-cache.ts`; no cross-account lookup.
- **Foundation record.** Per (account, document identity): page map, source index (quote locator input), deterministic
  facts (dates, parties via `m2a`/`m2b`), and Basic findings each marked `preliminary`.
- **Reuse rules.** A Basic result is reused only when document identity, analyzer version, prompt version, model and
  legal-reference version all match. A Deep Scan may reuse the deterministic facts and page map. It must independently
  verify every red flag and threshold it reports (existing verification step), and it must cite the original text, not
  the Basic summary.
- **Invalidation.** Any change to the document identity, analyzer version, prompt version, model or legal-reference
  version invalidates the entry. Deletion removes the foundation with the account data.
- **Final Case Assessment.** Consume completed, verified analyses for each document; fall back to raw text only for
  documents without one, and label which is which.

## 6. Verified quotation reuse

Quote location is deterministic and already cheap (about 1 ms per guard pass at 200 pages on mocked data). Caching it
gives little. Reuse is worth doing for the page map and source index, not for the locator result.

## 7. Decisions needed from the owner

1. Entitlement rule for a direct Deep Scan (may it build the Basic foundation without a Basic charge?).
2. Approve the report-cache migration and choose retention for derived document data.
3. Whether Final Case Assessment may rely on Basic or Deep Scan analyses, or only on raw sources.
4. Authorise the paid comparison (provider calls with and without a Basic foundation) before any prompt change.

Measurements 1–3 and 5 above are mocked counts. Real token counts and latency need the paid plan in
`analyzer-e2e-performance-plan-20261128.md`.
