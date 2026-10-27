# AcroForm field ingestion: measured resource limits

Measured on the sandbox (Node 22, single process) with `ingestAcroFormPdf`. Times are wall clock; memory is the change in
resident memory around one call, so it is approximate (garbage collection can move it). Recorded 2026-10-26 on commit
`93f79f6a` plus the Phase 2 fixes in this change.

| Case | File bytes | Base64 chars | Outcome | Time | RSS change |
|---|---|---|---|---|---|
| Near the 10 MB limit: 1 page, 9.5 MB attachment | 9,503,699 | 12.67 M | read, 0 fields | 101 ms | +27 MB |
| Over the size limit: 11 MB | 11,538,664 | 15.38 M | refused, PDF_TOO_LARGE | 10 ms | 0 |
| Maximum pages: 20, 20 fields | 9,079 | 12,108 | read, 20 fields | 57 ms | about 0 |
| Maximum widgets: 2000 on one page | 784,952 | 1.05 M | read, 2000 fields | 612 ms | +48 MB |
| Over the widget limit: 2001 | 785,329 | 1.05 M | refused, TOO_MANY_WIDGETS | 497 ms | +2 MB |
| Over the page limit: 21 | 738 | 984 | refused, UNSUPPORTED_PAGE_COUNT | 10 ms | 0 |
| Expansion within budget: 5 MB content | 10,882 | 14.5 k | read | 1,135 ms | +55 MB |
| Expansion over budget: 40 MB content | 82,115 | 109 k | refused, EXPANDED_CONTENT_TOO_LARGE | 50 ms | 0 |
| Expansion over budget: 200 MB content | 407,798 | 544 k | refused, EXPANDED_CONTENT_TOO_LARGE | 29 ms | 0 |

Before the expansion fix, a 50 MB expansion (102 KB file) was read in full: 7,033 ms and +57 MB RSS. The analyzer's existing
text extraction took 3,500 ms on the same file.

## Limits set in code
- File size: 10 MB decoded (`ACROFORM_MAX_BYTES`). Route body: 14 MB (`ACROFORM_JSON_LIMIT`).
- Pages: 1 to 20 (`ACROFORM_MAX_PAGES`).
- Widgets: 2000 (`ACROFORM_MAX_WIDGETS`). The count is enforced during extraction, so up to 2000 widgets are processed
  before a file over the limit is refused.
- Entered value: 2000 characters (`ACROFORM_MAX_VALUE_CHARS`). Longer values are withheld and counted.
- Expanded content: 32 MB across all Flate streams (`ACROFORM_MAX_EXPANDED_BYTES`).
- Concurrent reads: 2 per process (`ACROFORM_MAX_CONCURRENT`).

## Denial-of-service risks that remain
- A maximal widget file (2000 widgets) cost 0.6 s and +48 MB in one measurement. Many requests across many IPs are not
  bounded in total by the per-IP limit.
- Expansion just under the 32 MB bound was not measured directly. A 5 MB expansion took 1.1 s and +55 MB, so the bound
  is the cost ceiling to re-measure before activation.
- Non-Flate compression (LZW, run-length) is not bounded (see the security audit).
- No per-request time budget. A pathological file that the parser handles slowly is not stopped by time.
- The measurements are from one sandbox. Production CPU and memory differ. Re-measure before activation.
