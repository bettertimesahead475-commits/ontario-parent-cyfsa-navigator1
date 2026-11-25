# Performance Baseline (production, synthetic documents)

| Metric | Target | Measured | Samples | Date / evidence |
|---|---|---|---|---|
| Quick Review end-to-end | 25–40 s | 36.2 s | 1 | 2026-11, harness `drive.mjs quick` |
| Forensic Deep Scan executor time | 75–100 s | 99.4 s | 1 | 2026-11-25 queued run |
| Forensic Deep Scan browser end-to-end | 75–100 s | 110.5 s | 1 | same run (includes queue + polling) |
| Extraction, native PDF (text layer) | < 5 s | 0.22 s | 1 | 2026-11-25, production d5f2a3c9, upload → response wall time |
| Extraction, DOCX | < 5 s | 0.17 s | 1 | same |
| OCR extraction, scanned PDF (1 page, Gemini) | < 5 s | 4.2 s (server 3.4 s) | 1 | same; text recall stable at 0.656 vs. the 3-page source (the scan holds 1 page) |
| OCR extraction, PNG | < 5 s | not re-measured | — | owner workspace at its 20-file cap from earlier harness runs (synthetic files); clear them, then re-run |

Single samples only: no median or tail latency can be claimed until more paid runs are authorized (B-1).

## Known constraints

- Forensic sections run 3 at a time, longest first. Six concurrent sections exceeded the Worker CPU limit
  (`exceededCpu`). Verification starts early once redFlags and thresholds are done.
- Polling: exponential backoff with jitter, in-progress cap 5 s, which adds up to ~5 s to observed browser latency.
