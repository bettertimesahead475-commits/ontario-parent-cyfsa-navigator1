# Acceptance Criteria and Register

Status values: **Verified complete** · **Implemented, awaiting verification** · **In progress** ·
**Failed acceptance** · **Externally blocked**. A blocked requirement is incomplete. No percentages.
Evidence must be reproducible (test name, command, deployment id, or harness output file).

| ID | Area | Requirement (measurable) | Status | Evidence |
|---|---|---|---|---|
| A-1 | Architecture | All production API traffic served by Pages Functions; Express (`api/_server.ts`) not in the execution path | Verified complete | `[[path]].ts` returns `404 API_ROUTE_NOT_FOUND` with no bridge configured; admin routes native (fc8b31c) |
| A-2 | Architecture | Every native route's methods match the route map | Verified complete | `api/cloudflare-native-api-routes.test.ts` |
| BE-1 | Backend | Duplicate submissions do not double-charge or double-run | Verified complete | analyze `ANALYSIS_IN_PROGRESS` / `409 ANALYSIS_ID_CONFLICT` tests; credit RPC advisory locks |
| BE-2 | Backend | Queue failures release reservations and surface retryable errors | Verified complete | `cloudflare-queue-producer`, `cloudflare-job-recovery` tests; production queued Forensic run 2026-11-25 |
| BE-3 | Backend | Dead-letter handling for poison queue messages | Verified complete | live queue list: DLQ has the relay consumer; max_retries 5 with exponential backoff; worker DLQ tests |
| AD-1 | Admin | Admin authorization = verified Firebase administrator; no browser-stored secret | Verified complete | 41 API + 3 UI tests; production a67747aa: owner session 200 on all 8 read endpoints; no token / bad token / old x-admin-secret → 401 |
| AD-2 | Admin | Unauthorized (401) and non-admin (403) requests read no data | Verified complete | tests assert zero database calls; production 401 checks 2026-11-25. Live 403 with a non-admin account blocked by B-2 (covered by tests) |
| AD-3 | Admin | Customer lookup returns only the exact customer | Implemented, awaiting verification | isolation test with LIKE-wildcard collision |
| AD-4 | Admin | Approve / refund / suspend / restore / revoke / credit restore / reissue exactly once under concurrency, audited | Implemented, awaiting verification | two independent reviews, 17 findings fixed with regression tests; live write actions not exercised (real customer data; needs synthetic records, B-2) |
| AD-5 | Admin | Revenue, usage, failed-job and audit reporting | Verified complete | production a67747aa: revenue, usage, jobs, audit, monitoring all 200 against the live schema |
| AN-1 | Analyzer | Quick Review completes with verbatim quotes, 25–40 s | Verified complete | production 2026-11: 36.2 s, 6/6 quotes verbatim |
| AN-2 | Analyzer | Forensic Deep Scan: all six sections, verification, persistence, reopen, 75–100 s | Verified complete (single sample) | production queued run 99.4 s executor / 110.5 s browser; more samples blocked by B-1 |
| AN-3 | Analyzer | Final Case Assessment end-to-end | Externally blocked | B-1 (budget) |
| AN-4 | Analyzer | Prompt-injection resistance (document tags neutralized; untrusted-data instruction) | Verified complete | `forensic-section-dispatch`, security-hardening tests |
| AN-5 | Analyzer | Synthetic evaluation of deterministic safeguards: quote and citation false acceptance/rejection, injection, unsupported-finding handling | Verified complete (deterministic layer) | `eval/analyzer-guards`: 26 quote + 15 citation + 5 injection cases, 0 FP / 0 FN enforced. Model-output accuracy evaluation needs paid runs (B-1) |
| EX-1 | Extraction | Native PDF, scanned PDF, DOCX, TXT, PNG, HEIC extract on production | Verified complete | harness `extract-only.mjs` results 2026-11-25 |
| PDF-1 | Exports | Forensic export produces a real PDF with headings, verbatim quotes, citations, no mojibake | Verified complete | `pdf-export-check.mjs` (CDP printToPDF + text parse) |
| PDF-2 | Exports | Quick, guide and template exports verified the same way | In progress (Antigravity) | |
| SEC-1 | Security | Enforced CSP without `unsafe-eval` / inline scripts | Verified complete | `public/_headers`; production headers; Google sign-in verified signed-out |
| SEC-2 | Security | No dependency advisories | Verified complete | `npm audit` 0 vulnerabilities after 002ba9a (fast-xml-parser low fixed) |
| SEC-3 | Security | Persistent cross-isolate rate limiting | Externally blocked | B-3 |
| SEC-4 | Security | Access-code redemption bound to purchaser | Verified complete | activate-code tests (`PURCHASE_REFERENCE_REQUIRED`) |
| SEC-5 | Security | Independent security review of all privileged code | In progress | admin review running; Codex workstream |
| DB-1 | Database | RLS/ownership/index audit (read-only) with reversible migrations prepared | In progress | |
| INF-1 | Infrastructure | Health endpoint, admin monitoring (DB latency, stuck jobs, failures) | Verified complete | `/api/health` 200; `/api/admin/monitoring/status` 200 live |
| INF-2 | Infrastructure | Release safeguards: automatic production promotion disabled; documented rollback | Verified complete | `production_deployments_enabled=false`; `MASTER_PLAN.md` rollback list |
| INF-3 | Infrastructure | Alerting on failures | In progress | |
| PERF-1 | Performance | OCR extraction < 5 s for ordinary documents | In progress | measure from harness timings |
| COM-1 | Commercial | Live purchase → approve → redeem → consume → refund with a non-owner account | Externally blocked | B-2 |
| FE-1 | Frontend | Visual regression baselines; no unintended visual change | In progress (Antigravity) | |
| A11Y-1 | Accessibility | WCAG 2.1 AA automated checks on key pages | In progress (Antigravity) | |
