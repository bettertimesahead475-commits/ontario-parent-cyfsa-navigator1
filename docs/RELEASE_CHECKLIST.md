# PR #106 release checklist

Status key: FIXED (fixed and tested), BLOCKED (cannot be done here, precise prerequisite named), OPEN (work remains
that needs a decision or review), VERIFIED (checked by running it).

Note: the work-order figure of "47 outstanding items" does not match any list kept in this repository or session. The
items below are the ones with evidence. Nothing is padded to reach 47.

## A. Skipped tests (44 at last full run)
| Group | Count | Status | Prerequisite |
|---|---|---|---|
| Historical PDF-dependent regression tests (`officialFormRealArtifactIntegration.test.ts`) | 38 | BLOCKED | The six original historical PDFs (SHA-256 and byte length pinned in `scripts/official-forms/manifest.json`) are not on this machine. A filesystem search and git history found none. An archive lookup was rate-limited (HTTP 429). Owner must supply the original files, or an archived copy whose SHA-256 matches the pin. |
| Staging Supabase tests (`creditStaging.test.ts`) | 6 | BLOCKED | `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` are not set in this environment. Owner adds them as environment variables for the staging project only. Never production. |

## B. Defects found and fixed in this phase (each has a regression test)
| ID | Defect | Status | Evidence |
|---|---|---|---|
| D1 | Upload path: base64 validation overflowed the call stack on a 12 M character string (existing `pageSources.decodeSource`). Large uploads failed with a generic 500. | FIXED | `pageSources.limits.test.ts` fails on the old code (`RangeError`) and passes on the new code. |
| D2 | Analyzer: PDF content expanded without bound (measured 102 KB -> 50 MB, 7 s CPU). | FIXED | Bound of 64 MB before any parser runs (`ANALYZER_MAX_EXPANDED_BYTES`). Test refuses a 72 MB expansion. |
| D3 | AcroForm route: the same base64 overflow. | FIXED | `acroFormRoutes.test.ts` large invalid base64 -> 400. |
| D4 | AcroForm: a valid 9.5 MB PDF returned 500 (same cause as D3). | FIXED | 10 MB boundary test. |
| D5 | AcroForm: four blank "Name of court" combo boxes were withheld as unsupported. | FIXED | Real-file regressions for all six PDFs (zero withheld). |
| D6 | AcroForm: the app-wide 100 MB JSON parser ran before the route's size check. | FIXED | Route parses its own 14 MB body; global parser skips `/api/acroform/`. |
| D7 | AcroForm: the flag was checked after the body was parsed. | FIXED | Test: malformed body gets 404 when disabled. |
| D8 | AcroForm: expansion bomb accepted. | FIXED | Bound of 32 MB. Route returns 413. |
| D9 | AcroForm: unlimited concurrent reads. | FIXED | Limit of 2 (429 otherwise). |
| D10 | AcroForm: no per-user limit. | FIXED | 20 reads per user per 15 minutes; per-process. |
| D11 | AcroForm: untrusted field text shown with control and bidi characters. | FIXED | `displayText` tests. |
| D12 | Analyzer text reader wrote full error objects to the console (could quote document text). | FIXED | Logs error type only; test confirms a secret string in a malformed PDF is not logged. |
| D13 | Dependencies: 2 critical and several high advisories (dompurify, proxy-addr, body-parser, compression, source-map-js, undici, vite). | FIXED | Targeted, non-major updates plus `overrides`. Re-audit: 0 critical. Tests green after update. |

## C. Open items (not fixed, with reason)
| ID | Item | Status | Reason |
|---|---|---|---|
| O1 | `firebase-admin` chain: `@grpc/grpc-js` and `@firebase/firestore` (high advisories). | OPEN | Fix requires a major-version upgrade of the Firebase admin SDK. Needs compatibility review of auth code. Not applied. |
| O2 | `nodemailer` 6.10.1: two high advisories (unintended-domain delivery; SMTP command injection). | OPEN | Fix is in 10.x, a major upgrade. Email-sending code (`gmailAgent.ts`, `access.ts`, `_server.ts`) needs review. Not applied. |
| O3 | LZW and run-length stream decoders are not bounded (analyzer and AcroForm). Only Flate is bounded. | OPEN | Refusing these filters would reject valid older scans. Owner decision needed. |
| O4 | Analyzer 64 MB expansion bound may refuse large legitimate scanned PDFs. | OPEN (decision) | Product trade-off. Owner to confirm the limit. |
| O5 | Per-user read limit and concurrency limit are per process. | OPEN | Serverless instances do not share counts. A shared store is needed for a hard limit. |
| O6 | AcroForm field facts are not integrated into any report. | OPEN (by design) | Feature stays OFF. Integration plan in `ACROFORM_INTEGRATION_PLAN.md`. |
| O7 | Parent-facing wording: estimated grade level only (syllable heuristic). | OPEN (human review) | A plain-language reviewer must confirm. |
| O8 | Privacy and legal review of field facts and uploads. | OPEN (human review) | Required before activation. Not performed. |
| O9 | Table boundary detection and continuation tables. | OPEN | Not implemented. Row attribution gives 0 on the six real PDFs. |
| O10 | Mapping coverage: 61 of 483 fields confirmed (12.6%). | OPEN | Most fields have no printed-label evidence. Confirmation rules were not relaxed. |
| O11 | LZW/run-length, Firebase, and nodemailer advisories are listed in `npm audit`. | OPEN | See O1, O2, O3. |

## D. Verification
| ID | Check | Status |
|---|---|---|
| V1 | Node 22 and Node 24 full matrices with PostgreSQL | VERIFIED at commit 73f72a6: 4,076 passed, 0 failed, 44 skipped on each |
| V2 | TypeScript (`tsc --noEmit`) | VERIFIED: exit 0 on both Node versions |
| V3 | Production build | VERIFIED: exit 0 on both Node versions |
| V4 | Historical pins, fixtures, and regression assertions unchanged | VERIFIED by diff against the previous commit |
| V5 | Dependency audit | VERIFIED: 0 critical, 5 high (O1, O2), 13 moderate remain |
| V6 | GitHub CI on the final commit | Recorded in the final report |
| V7 | Vercel preview on the exact final commit | Recorded in the final report |

## Release readiness
PR #106 is **not ready for final release review**. Blockers: B-section items are fixed, but section A (44 skipped tests)
cannot run without owner-supplied prerequisites, and section C items O1, O2, O3, O4, O8, and O10 need owner decisions
or reviews.
