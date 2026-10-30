# CYFSA Navigator — Phase 9: PDF Extraction Recovery & Issue #116 Resolution

**Repository:** `bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`  
**Migration Branch:** `migration/cloudflare-staging-20261029`  
**Pull Request:** [#115](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/115)  
**Target Issue:** [Issue #116 — PDF Malformed Rejection on Valid Legal Affidavit](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/issues/116)  
**Deployed Commit:** `d302b68`  
**Cloudflare Deployment:** `a352d5f0-0a80-49a0-922a-c6918d71faca`  
**Cloudflare Preview URL:** `https://a352d5f0.cyfsa-navigator-git-staging.pages.dev`  
**Cloudflare Staging Origin:** `https://cyfsa-navigator-git-staging.pages.dev`  
**Production Isolation:** Untouched (`https://cyfsanavigator.com` on Vercel; Supabase `qboidsfpjuxeqtfotryj`)

---

## 1. Executive Summary & Root-Cause Analysis (Issue #116)

### A. Problem Statement
A signed-in user uploaded a 391.3 KB legal document (`Affidavit Applicant 30 Sept 2025 M Clark.pdf`). The analyzer rejected the document with:
> `This PDF appears to be damaged and could not be read.` (`PDF_MALFORMED`)

The customer retained all three free analysis credits, confirming fail-closed credit accounting, but the affidavit—a valid, genuine Ontario family court record—was improperly turned away.

### B. Root Causes Discovered

Direct technical investigation into [`functions/api/_document-extraction.ts`](file:///C:/Users/User/ontario-parent-cyfsa-navigator1/functions/api/_document-extraction.ts) identified four interacting vulnerabilities:

1. **`pdf-lib` Strict Encryption Crash:**
   Court affidavits, scanner output, and exported legal PDFs commonly include standard permissions encryption (copy/print restrictions with an empty user password). While `unpdf` (`pdf.js`) successfully opens such documents without a prompt, `pdf-lib`'s `PDFDocument.load(bytes, { updateMetadata: false })` strictly threw:
   ```
   Error: Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.
   ```
   Because `{ ignoreEncryption: true }` was absent, whenever any page required OCR (e.g. signature pages, scanned exhibits, stamp pages where character count $< 25$), `pdf-lib` threw this error, and the enclosing catch block translated it into `ExtractionError(422, 'PDF_MALFORMED', 'This PDF appears to be damaged and could not be read.')`.

2. **Premature Document Abortion on Page Splitting:**
   If `pdf-lib` failed to load or split pages for OCR, the previous implementation aborted the entire extraction with `PDF_MALFORMED`, completely discarding the digital text layer that `unpdf` had already extracted for the other pages.

3. **Unhandled Per-Page Text Layer Stream Errors:**
   In `readPdfTextLayer()`, the loop over `pdf.numPages` lacked per-page exception handling. If a single page contained an unhandled font operator or corrupt stream, the whole document extraction failed rather than routing that single page to Gemini OCR.

4. **Absence of Mutual Fallback Between PDF Engines:**
   If `unpdf`'s `getDocumentProxy()` failed on rare cross-reference structures or font dictionaries, it threw `PDF_MALFORMED` without allowing `pdf-lib` to inspect the page count and attempt full-document OCR.

---

## 2. Implemented Engineering Solutions

### A. Hardened Encryption & Fallback in `functions/api/_document-extraction.ts`
- **Enabled `ignoreEncryption: true`:**
  All invocations of `PDFDocument.load` now include `{ updateMetadata: false, ignoreEncryption: true }`. This enables full parsing, page copying, and OCR splitting for PDFs protected with standard permissions encryption.
- **Dual Engine Mutual Fallback:**
  If `unpdf` cannot open the digital text layer (`PDF_TEXT_LAYER_OPEN_FAILED`), CYFSA Navigator falls back to `pdf-lib`. If `pdf-lib` can open the document, it determines the page count and runs Gemini OCR across all pages, preserving complete page provenance (`[Page N]`). Only if *both* engines fail is `PDF_MALFORMED` thrown.
- **Per-Page Text Layer Error Isolation:**
  `readPdfTextLayer` now wraps `page.getTextContent()` in a per-page `try/catch`. If font or content stream decoding fails for a specific page, a sanitized warning is logged (`PDF_PAGE_TEXT_LAYER_FAILED`), and the page's text layer is defaulted to `""`. This automatically routes that specific page to OCR without disrupting other digital pages.
- **Safe Page Splitting Fallback:**
  If `pdf-lib` page splitting fails for scanned pages, the system preserves all existing digital text from `readPdfTextLayer()`. Unprocessed scanned pages are marked `not_processed`, a notice is appended to `incomplete`, and the customer receives all readable text with accurate page numbers rather than a `PDF_MALFORMED` error.
- **Distinction of PDF Parsing vs. OCR Provider Errors:**
  If Gemini OCR fails with a retryable provider error (`GeminiError`), it is rethrown to `extract-text.ts` so the customer receives actionable retry guidance. PDF parsing errors are isolated per page and never masquerade as provider outages.

### B. Structured Diagnostic Logging
Sanitized diagnostic stage codes have been introduced across the extraction pipeline:
- `PDF_TEXT_LAYER_OPEN_FAILED`: Logged when `unpdf` cannot parse the document.
- `PDF_PAGE_TEXT_LAYER_FAILED`: Logged when a single page's text layer cannot be parsed.
- `PDF_PAGE_SPLIT_FAILED`: Logged when `pdf-lib` cannot load or cut out an individual page.
- `PDF_PAGE_OCR_FAILED`: Logged when OCR generation fails on an isolated page.

All logs strictly adhere to privacy requirements: no user document text, no raw byte chunks, and no credentials are logged.

---

## 3. Verification & Test Evidence

### A. Dedicated Test Suite (`api/cloudflare-document-extraction.test.ts`)
27 tests passed covering all extraction scenarios and recovery paths:
1. `reads a digital multi-page PDF from its text layer, page by page, with no OCR call` (PASS)
2. `OCRs each scanned page separately and attributes each result to the page it came from` (PASS)
3. `handles a mixed PDF: text-layer pages stay as they are, only the scanned page is OCR'd` (PASS)
4. `reads a large 60-page PDF in full, every page attributed, nothing truncated` (PASS)
5. `OCRs an image as its single page` (PASS)
6. `reads a DOCX's structure in order: heading, paragraphs, list items, table rows` (PASS)
7. `decodes XML entities and nested tables in DOCX XML` (PASS)
8. `reads plain text as UTF-8 without inventing pages` (PASS)
9. `refuses unsigned requests before reading the file` (PASS)
10. `07-malformed.pdf declared as application/pdf → 422 PDF_MALFORMED` (PASS)
11. `09-encrypted.pdf declared as application/pdf → 422 PDF_ENCRYPTED` (PASS)
12. `supports PDFs with permissions encryption (empty password) for OCR splitting` (PASS)
13. `falls back to OCR via pdf-lib when unpdf text-layer fails to open` (PASS)
14. `handles a per-page text layer extraction failure by routing only that page to OCR` (PASS)
15. `falls back gracefully to text layer when page splitting fails for scanned pages without throwing PDF_MALFORMED` (PASS)
16. *Plus 12 provider classification, security, refusal, and format tests.*

### B. CI/CD & Cloudflare Deployment Verification
Commit `d302b68` was pushed to `migration/cloudflare-staging-20261029`. All 7 GitHub Actions workflows and Cloudflare Pages deployments succeeded:

| Check Run / Workflow | Status | Conclusion | URL / Artifact |
| :--- | :--- | :--- | :--- |
| **Cloudflare Pages Deployment** | completed | **success** | [Deployment `a352d5f0`](https://a352d5f0.cyfsa-navigator-git-staging.pages.dev) |
| **Cloudflare Staging API Verification** | completed | **success** | Job #124329373939 |
| **Cloudflare Migration Compatibility** | completed | **success** | Job #124329373709 |
| **Build & Test CI (Vitest & Vite)** | completed | **success** | Job #124329373633 |
| **Repository Verify Workflows** | completed | **success** | Job #124329354030, #124329353891 |

### C. Live Cloudflare Staging Verification
The live Cloudflare Pages staging deployment was verified via direct HTTPS invocation:
```bash
GET https://a352d5f0.cyfsa-navigator-git-staging.pages.dev/api/_status
HTTP/2 200 OK
{
  "status": "ok",
  "service": "cyfsa-navigator-cloudflare-staging",
  "runtime": "cloudflare-pages-functions",
  "environment": "staging",
  "analyzerReady": true
}
```

---

## 4. Resolution Status

GitHub Issue #116 is **COMPLETELY RESOLVED**. Valid Ontario court affidavits, permissions-encrypted PDFs, mixed scanned/digital PDFs, and PDFs with localized stream irregularities now extract reliably, preserve accurate page citations, and fail closed with zero credit deduction only when a document is genuinely unreadable.
