# End-to-end analyzer performance test plan (2026-11-28)

Status: plan only. Steps marked PAID need owner authorisation and budget. Steps marked FREE run without spend.

## A. Free (no provider spend)

| Test | Purpose | Pass criterion |
|---|---|---|
| Vitest full suite (Node 22) | regression | 0 failures; skips listed |
| PostgreSQL 16 suites (`*.pg.test.ts`, CI service) | lease RPCs, report-cache migration, rate-limit migration | all pass on the PR |
| Mocked Forensic profile (`api/forensic-profile.test.ts`) | call count, transmitted text, non-provider CPU | sections = 6, verification = 1; non-provider CPU recorded |
| Lease safety suite (`tests/devin/queue-lease-safety.test.ts`) | 300 s run, duplicate delivery, ownership loss, DB failure | all pass; mutation checks recorded |
| Staging, no model calls: consumer with a stub analyzer | lease renewal against the real ledger RPCs | one claim per job; renewals every 60 s while running |
| CI: TypeScript, SonarCloud, CodeRabbit, Cloudflare build | static quality | green or justified |

## B. PAID (owner authorisation and budget required)

Use the staging deployment and synthetic documents only. Each run is one analysis.

| # | Test | Measures | Approx. cost (repository MODEL_PRICING, 10k-token document) |
|---|---|---|---|
| B1 | Quick, 10-page native-text synthetic document, 3 runs | browser-to-result time; provider latency per section; output tokens | about $0.66 |
| B2 | Forensic, 10-page native-text, 3 runs | same, plus verification latency | about $3.75 |
| B3 | Forensic, 200-page synthetic, 1 run at concurrency 3 | Worker CPU and isolate memory (the release blocker) | about $3.00 |
| B4 | Forensic with an artificially slowed section (over 240 s, via staging provider timeout setting or a test-only delay) | lease renewal under a real long run; no duplicate claim | about $1.25 |
| B5 | Duplicate delivery: re-send the same queue message during a running analysis | exactly one analysis; second delivery retried | about $1.25 |
| B6 | Accuracy: Quick and Forensic on 3 labelled synthetic documents before and after | findings, quotations, verdicts equal to the labelled set | about $6 |

Each run records: request id, claim count (`jobAttempt`), delivery count, every stage timestamp from
`[analyzer_stage]`, `[FORENSIC_SECTION_COMPLETED]` elapsedMs, Worker CPU (Cloudflare analytics) and memory, final
status, report hash, and browser-observed completion (client clock and server completion time).

Statistics: report median and worst case for every metric. Report p95 only when n ≥ 20. Label mocked versus measured
results separately.

## C. Acceptance

- Basic Quick: 25–40 s median on native text; no regression in section count, token budget or verdicts against B1 baseline.
- Forensic: 75–100 s median on native text; no section, citation or verification verdict lost against B2/B6.
- Duplicate analysis: zero jobs with more than one claim unless the first worker was terminated (lease expiry evidence).
- No saved report replaced after completion (check Storage object timestamp against completion).
- No credit consumed twice (finalization idempotent per request id).

## D. Not covered by this plan

- Real provider latency variance over days (needs repeated runs at different times).
- Customer browser behaviour on slow networks (Antigravity browser acceptance).
