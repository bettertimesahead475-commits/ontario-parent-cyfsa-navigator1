# Performance Baseline (production, synthetic documents)

| Metric | Target | Measured | Samples | Date / evidence |
|---|---|---|---|---|
| Quick Review end-to-end | 25–40 s | 36.2 s | 1 | 2026-11, harness `drive.mjs quick` |
| Forensic Deep Scan executor time | 75–100 s | 99.4 s | 1 | 2026-11-25 queued run |
| Forensic Deep Scan browser end-to-end | 75–100 s | 110.5 s | 1 | same run (includes queue + polling) |
| OCR extraction (scanned PDF / PNG) | < 5 s | not yet tabulated | — | harness `extract-only.mjs` timings to be recorded |

Single samples only: no median or tail latency can be claimed until more paid runs are authorized (B-1).

## Known constraints

- Forensic sections run 3 at a time, longest first. Six concurrent sections exceeded the Worker CPU limit
  (`exceededCpu`). Verification starts early once redFlags and thresholds are done.
- Polling: exponential backoff with jitter, in-progress cap 5 s, which adds up to ~5 s to observed browser latency.
