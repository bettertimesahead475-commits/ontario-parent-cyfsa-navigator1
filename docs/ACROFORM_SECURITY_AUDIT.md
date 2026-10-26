# AcroForm field ingestion: security and privacy audit

Scope: `POST /api/acroform/ingest` and the modules it uses (`acroFormRoutes.ts`, `acroFormExtractor.ts`,
`acroFormIngestion.ts`, `acroFormIdentity.ts`, `formFieldFacts.ts`, `featureFlags.ts`). The feature stays OFF.

## Fixed in this phase
| Finding | Severity | Fix | Test |
|---|---|---|---|
| Base64 validation regex overflowed the call stack on a 12 MB string, so a request could make the route throw. | High (denial of service) | Linear check: character class, length multiple of four, decode-and-re-encode round trip. | `answers a large base64 string with one bad character with a clean 400` |
| A small Flate file expanded to 50 MB (measured 102 KB -> 50 MB, 7 s CPU). A 10 MB file could expand to gigabytes. | High (memory and CPU) | Bounded pre-check: inflate each Flate stream with `maxOutputLength`; refuse past 32 MB total before any parser runs. | `refuses a small file that expands past the budget`, route 413 test |
| The app-wide JSON parser (100 MB) ran before this route's own size check, so an oversized body was read in full. | Medium (memory) | The route has its own parser (14 MB), and the global parser skips `/api/acroform/`. | `refuses an oversize body at the route's own limit with a JSON 413` |
| The flag was checked after parsing, so a disabled route still read request bodies. | Low | Flag gate runs first. | `refuses before parsing the body` |
| Unbounded concurrency: many simultaneous reads could exhaust memory. | Medium | At most 2 concurrent reads; the next gets 429. | `holds at most ACROFORM_MAX_CONCURRENT reads at once` |
| Field names, labels, and values from the PDF were displayed as-is (control and bidi characters, unbounded length). | Medium (display spoofing) | Control and bidi characters removed; whitespace collapsed; capped at 300 characters. | `displayText` tests |
| Blank combo boxes (empty selection) were withheld as "unsupported". | Correctness | Empty selection read as blank (`null`). Multi-select still withheld. | Real-file regressions for all six PDFs |

## Checked, no defect found
- **Authentication:** `verifyFirebaseToken` is required after the flag gate. Missing or invalid tokens get 401 (tested).
- **Authorization and data isolation:** the route stores nothing and reads only the uploaded bytes. Two users' results do
  not mix (tested). There is no per-document owner check because no document is stored.
- **Prototype pollution:** a JSON `__proto__` key does not change the process (tested). A PDF field named `__proto__`
  is kept as ordinary data (tested). The mapper uses `Map`, not plain-object lookups, for field names.
- **Untrusted metadata:** PDF Info dictionary, XMP, and document properties are never read or returned. The response
  keys are fixed and tested.
- **Logging:** the route and the extractor write nothing to the console. A test spies on every console method and
  confirms that a field value does not appear, on success or on failure. The request middleware captures no bodies.
- **Telemetry and caches:** the route uses no page-extraction cache and no telemetry call.
- **Error responses:** every error message is a fixed string. Errors never include a value, document text, or the input.
  Unexpected exceptions return a generic 500 (tested with a value that appears in the input).
- **Malicious PDFs:** the reader does not run PDF JavaScript and does not follow links. Fuzzing (60 seeded mutations)
  and truncation (5 cut points) produce only classified errors or normal reads (tested).
- **Rate limit:** the existing global `/api` limiter (100 requests per 15 minutes per IP) applies to this route.

## Residual risks (must be resolved before activation)
1. **Existing upload path (`api/services/pageSources.ts`, `decodeSource`, line 200).** The same backtracking base64 regex is
   used on uploads of up to 30 MB. Measured: it throws a stack overflow at about 12 million characters (roughly 9 MB of
   file). The throw is a `RangeError`, so `documentRoutes` returns a generic 500. Large uploads may fail in production
   today. **Not changed here**, because it is part of the existing upload pipeline. The same linear check as
   `acroFormRoutes.ts` fixes it. Needs owner approval.
2. **Existing analyzer text extraction is not expansion-bounded.** `extractTextFromPdfBuffer` (pdf-parse) inflates a
   bomb without a limit (measured: 50 MB of content took 3.5 s). The new route is protected because the bounded check runs
   first. The analyzer's own upload path is not. Needs owner approval to add the same bound.
3. **Non-Flate compression is not bounded.** LZW and run-length streams are not checked by the pre-check. Only Flate is.
4. **Rate limit is per IP.** The 100-per-15-minute limit is shared by IP, not by user. A user with many IPs gets more
   reads. A per-user limit should be added before activation.
5. **Concurrency limit is per process.** Serverless instances each have their own counter.
6. **Analyzer logging.** `extractTextFromPdfBuffer` logs the error object when pdf-parse fails. The error is not expected
   to contain document text, but this was not verified against every failure mode.
7. **Privacy review.** Uploaded court documents contain children's and families' personal information. Activation needs
   a privacy review of processing, retention (none in this route), and error reporting. Not performed here.
