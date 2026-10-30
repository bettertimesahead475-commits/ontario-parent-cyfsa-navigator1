# Phase 8: OCR and Analyzer Recovery Report

Date: 2026-10-30. Branch `migration/cloudflare-staging-20261029`, PR #115 (draft, not merged). Production untouched:
no change to cyfsanavigator.com, Vercel, production Supabase or DNS.

**Decision: NO-GO** (section 16). The code defects are fixed and deployed. Live provider-backed verification (real
Gemini OCR, real Quick Review, report save and reload, credit movement) could not be performed: every one of those
routes requires a signed-in Firebase user, and no test account was available.

## 1. Root causes found

| # | Defect | Effect |
|---|---|---|
| 1 | `extract-text.ts` and `transcribe.ts` hard-coded `gemini-2.0-flash`, which Google has retired | Every PDF/image OCR and every audio transcription failed with 404 |
| 2 | Gemini error bodies returned to the browser; the API key sent as a URL query parameter | Provider detail exposed to customers; key exposed to any URL logging |
| 3 | All extracted text labelled page 1 with `confidence: 1.0` | Wrong page citations for multi-page documents; an invented confidence |
| 4 | DOCX text pulled with a regex over the **compressed** ZIP bytes | DOCX text mostly missing or garbled; no structure |
| 5 | No file signature check; declared MIME type trusted | Any bytes could be sent to the OCR provider |
| 6 | Reports saved to storage bucket `analysis-jobs`; the bucket is `analysis_jobs` (verified on staging). The status was not checked | Every report save failed silently; no report could be recovered after a refresh |
| 7 | `/api/analyzer-usage` returned a constant 3 of 3 for free users and the full allowance for paid sessions | Credit display wrong on staging |
| 8 | The credit pill read `creditsRemaining`/`creditsLimit`, which free responses (Node and Cloudflare) don't have | "Free: of analyses remaining" with no numbers, on production too |
| 9 | Analyzer banner: intro block with no `flex-1`/`min-w-0` beside a non-wrapping four-group control row | Intro squeezed to **119 px / about 12 lines** at every width from 768 px |
| 10 | Analyze route returned `err.message` for unexpected errors | Possible internal detail to customers |

## 2. Files changed

- **New:**
  - `functions/api/_gemini.ts`
  - `functions/api/_document-extraction.ts`
  - `functions/api/_analysis-jobs.ts`
  - `functions/api/admin/gemini-models.ts`
  - `src/utils/creditBalance.ts`
  - Tests: `api/cloudflare-document-extraction.test.ts` (23), `api/cloudflare-credit-safety.test.ts` (7),
    `api/cloudflare-usage-counters.test.ts` (6)
  - Fixtures: `tests/fixtures/synthetic/*` (9 synthetic, fictional files)
- **Rewritten:** `functions/api/extract-text.ts`, `functions/api/analyzer-usage.ts`
- **Edited:**
  - `functions/api/transcribe.ts`, `functions/api/analyze.ts`, `functions/api/analyze/job/[jobId].ts`
  - `functions/api/_free-credit-reservation.ts` and `functions/api/_paid-credit-reservation.ts` (shared limits
    exported)
  - `src/components/DocumentAnalyzerTab.tsx`
  - Old tests updated to the new behaviour: `api/cloudflare-extract-text.test.ts`,
    `api/cloudflare-transcribe.test.ts`
- **Dependencies:** `unpdf@2.1.0` (pdf.js built for edge runtimes) and `fflate@0.8.3` (explicit; already present
  transitively). `pdf-lib` was already a dependency.

## 3. Gemini model

- **Routing:**
  - `GEMINI_OCR_MODEL` and `GEMINI_AUDIO_MODEL`, read in one place (`_gemini.ts`).
  - Default `gemini-3.6-flash`, the model production's Node server already calls (`api/_server.ts`).
  - No automatic fallback to other models; a malformed setting is refused.
- **Availability on the staging key: NOT VERIFIED.** No Gemini key is reachable from this session; the key exists
  only in Cloudflare.
  - **Verification route:** `GET /api/admin/gemini-models` with header `x-admin-secret`. It is deployed and returns
    401 without the secret. It calls Google's `models.list` with the configured key and reports
    `ocrModelAvailable`, `audioModelAvailable` and every Gemini model that supports `generateContent`.
  - **If the default is not available:** set `GEMINI_OCR_MODEL` (and `GEMINI_AUDIO_MODEL`) to a listed model. No
    code change or redeploy of code is needed.
- **Errors:**
  - 404, or a 400 naming the model → `OCR_MODEL_UNAVAILABLE` (503)
  - 401/403, or a 400 `API_KEY_INVALID` → `OCR_SERVICE_UNAVAILABLE` (503)
  - 429 quota → `OCR_QUOTA_EXHAUSTED` (503)
  - 429 rate → `OCR_RATE_LIMITED` (429, with Retry-After)
  - 5xx → `OCR_PROVIDER_UNAVAILABLE` (502)
  - timeout → `OCR_TIMEOUT` (504)
  - unusable body → `OCR_INVALID_RESPONSE` (502)
  - safety block → `OCR_BLOCKED` (422)

  Each has a fixed message ending "Nothing was charged." The provider's text is never returned (tested), and the key
  never appears in the URL (tested).

## 4. OCR extraction results (synthetic fixtures; stand-in OCR, no paid calls)

Run **inside Cloudflare's runtime** (`workerd` through `wrangler dev`) and in Vitest:

| Fixture | Result |
|---|---|
| `03-digital-3-pages.pdf` | 3 pages, all `TEXT_LAYER`, 0 OCR calls |
| `04-scanned-3-pages.pdf` (no text layer) | 3 pages, all `OCR`, 3 calls (one per page) |
| `05-mixed-text-and-scan.pdf` | pages 1 and 3 `TEXT_LAYER`, page 2 `OCR`, 1 call |
| `06-image.png` | page 1 `OCR` |
| `08-large-60-pages.pdf` | 60 pages, each with its own text; nothing truncated |
| `07-malformed.pdf` | refused, `PDF_MALFORMED` (422), no outbound call |
| `09-encrypted.pdf` | refused, `PDF_ENCRYPTED` (422) |

Wall time in `workerd` was 1–98 ms per file.

## 5. DOCX extraction results

`02-paragraphs-tables.docx` (made with python-docx) extracts, in document order:
- `# Plan of Care Meeting Notes (fictional)`, the paragraph, `- ` list items and `## Attendance`;
- the table as `| Name | Role |` rows;
- the closing paragraph.

There is no XML or ZIP residue. XML entities and nested tables are tested. A legacy `.doc` or password-protected Office
file (OLE container) is refused with a clear message.

## 6. Page-attribution accuracy

- **Scanned pages.** The stand-in OCR identifies which original page's image each one-page request carries,
  comparing SHA-256 hashes of the embedded image streams. Each OCR result came from that page's image, and page N's
  text is returned as page N (`api/cloudflare-document-extraction.test.ts`).
- **Analyzer input.** `extractedText` carries `[Page N]` markers, the format the analyzer's quotation locator
  already uses.
- **DOCX and plain text.** These report `pageAttribution: "unavailable"` and `pageNumber: null`; no page is
  invented.
- **Confidence.** No confidence is reported: neither source yields a calibrated one.

## 7. Real provider-backed tests

**Not performed.** The routes require a verified Firebase ID token, and no staging test account was available. I did
not create one through the public sign-up API: that would add an account to what is likely your production Firebase
project, and it wasn't authorized. As a result:
- no real Gemini OCR call;
- no real Anthropic Quick Review;
- no report save or reload, and no credit movement, observed live.

## 8. Credit safety

- **Extraction never touches credits.** Tested for Gemini 404, 429, 500, a timeout and empty OCR: the only outbound
  call is to Gemini, with no credit RPC and no storage write. A malformed PDF makes no outbound call at all.
- **Analysis lifecycle (code and existing tests):**
  - reserve (request-keyed) → model → **finalize before delivery** → save;
  - release on any failure;
  - a retry with the same `X-Analysis-Id` joins the existing reservation, so it is not charged twice.
- **Usage display.** It now reads the same counters reservation enforces (6 tests): free `free_usage[uid]`, limit 3;
  paid one-time tiers `paid_session_<id>_total`; monthly tiers `paid_session_<id>_period_<start>`.
- **Remaining inconsistency, noted:** `request-access` pricing labels and the reservation limits for Community tiers
  (5) differ from the older display table (10 and 25). The display now follows reservation.

## 9. UI layout

Measured with Playwright against the real component (local harness, stubbed API):

| Width | Intro before | Intro after |
|---|---|---|
| 1440 px | 119 px, about 12 lines | 768 px, 2 lines |
| 1100 px | 119 px, about 12 lines | 768 px, 2 lines |
| 820 px | 119 px, about 12 lines | 768 px, 2 lines |
| 390 px | 358 px | 358 px |

There is no horizontal overflow at any width. The view tabs and session buttons now wrap instead of clipping or
breaking words.

Screenshots: `docs/phase8-screenshots/before-*.png` and `after-*.png` (desktop, laptop, tablet, mobile). The deployed
bundle `DocumentAnalyzerTab-D358FCNu.js` contains the new layout class and not the old one.

## 10. Security improvements

- **Gemini key and provider text:** the key is sent in a header, not the URL, and provider text never reaches
  customers.
- **File checks:**
  - type taken from the file signature, and a mismatched declared type or extension is refused;
  - strict base64 decoding;
  - limits: 20 MB, 200 pages, 30 OCR pages per request (the rest reported as not processed, never cut silently).
- **Error messages:** no raw `err.message` from the analyze route.
- **Constant-time secret checks:** on the job route and the admin model route.
- **Logs:** a failed report save is logged with the job id and status only, no content.
- **Audio:** sign-in is still checked before reading the body, and an audio MIME allowlist applies.

## 11. Test results

- `tsc --noEmit`: clean.
- Full Vitest without PostgreSQL: 4,191 total, 3,747 passed, **0 failed**, 444 skipped.
  - The PostgreSQL suites run in CI's PostgreSQL service.
  - In Phase 7 they passed locally against PostgreSQL 16.
- Cloudflare tests: 38 files, 155 passed.
- `npm run build`: exit 0.
- Every Pages function bundles for Workers. The extraction bundle is 731 KB gzipped. Its only `node:` reference is a
  `process.getBuiltinModule` call guarded by a Node check, with no static imports.

## 12. Git commits

- `8c107e92`: Phase 8 code
- this report (next commit)

## 13. Cloudflare deployment

`7847a422-44f5-4029-b508-ad6ed5943667`. GitHub check "Cloudflare Pages": success; `test` and four `verify` jobs
succeeded.

## 14. Live staging verification

Checked over HTTP after deploy:
- `GET /api/analyzer-usage` → 200 with the new `creditsRemaining` and `signedIn` fields.
- `GET /api/admin/gemini-models` → 401 without the secret.
- `POST /api/extract-text` and `/api/transcribe-audio` → 401 without sign-in.
- `GET /api/status` → `analyzerReady: true`.
- `GET /api/analyze/job/...` → 404 `JOB_NOT_FOUND` for an unknown job.

## 15. Remaining blockers

1. **A staging test account.** Create a Firebase email/password user for staging and make its credentials available
   to the session, for example as session environment variables. Then I can run the real OCR, Quick Review, save and
   reload, and credit checks on deployed staging, at roughly cents of provider cost.
2. **Gemini model confirmation.** Run, with your admin secret:
   `curl -H "x-admin-secret: <ADMIN_SECRET>" https://cyfsa-navigator-git-staging.pages.dev/api/admin/gemini-models`.
   If `ocrModelAvailable` is false, set `GEMINI_OCR_MODEL` (and `GEMINI_AUDIO_MODEL`) in the Pages Production
   environment to a listed model.
3. **Workers CPU limit.** PDF parsing runs in the function. Local `workerd` timings were up to about 100 ms wall time
   for 60 pages. On the Workers Free plan (10 ms CPU per request), large PDFs may exceed the limit. The account's
   plan was not visible to this session.

## 16. Decision

**NO-GO.** All four failing completion criteria wait on the blockers above, not on known code defects.

| Completion criterion | Status |
|---|---|
| Obsolete Gemini model error eliminated | **Code fixed and deployed.** The retired model is gone and the model is configurable; the live call is unverified |
| Real multi-page PDF extracts successfully | **Verified in Cloudflare's runtime** with synthetic PDFs (text layers real, OCR stand-in); **not live** |
| Page attribution accurate | **Verified by test**, including byte-level proof for scanned pages |
| Real Quick Review completes | **Not verified** (sign-in) |
| Report generated and saved | **Persistence bug fixed**; live save and reload **not verified** |
| Credits behave correctly | **Verified by tests**; live **not verified** |
| Interface displays properly | **Verified** (screenshots; the deployed bundle contains the fix) |
| Deployed staging verified | **Partly** (public and unauthenticated paths only) |
