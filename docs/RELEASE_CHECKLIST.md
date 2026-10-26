# PR #106 release checklist

Status key: FIXED (fixed and tested in this repository), VERIFIED (checked by running it), BLOCKED (cannot be done here;
the prerequisite is named), OPEN (work remains that needs a decision, a review, or more engineering).

The "47 outstanding items" figure does not match any list kept in this repository. Only items with evidence appear here.

## A. Skipped tests (44 at last full run)
| Group | Count | Status | Evidence and prerequisite |
|---|---|---|---|
| Historical PDF regression tests (`officialFormRealArtifactIntegration.test.ts`) | 38 | BLOCKED | Six original historical PDFs (pinned SHA-256 and length in `scripts/official-forms/manifest.json`) are not on this machine. Filesystem search and git history: none. Archive lookup (web.archive.org): connection reset by the egress proxy on every attempt (`recentRelayFailures`: ws_closed_mid_exchange). Owner supplies the originals, or an archived copy whose SHA-256 matches the pin. |
| Staging Supabase tests (`creditStaging.test.ts`) | 6 | BLOCKED | `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` are not set in this environment. Owner adds them as environment variables for the staging project only. The test refuses the production project. |

## B. Defects found and fixed (each has a regression test)
| ID | Defect | Status | Evidence |
|---|---|---|---|
| D1 | Upload path: base64 check overflowed the call stack on a 12 M character string. | FIXED | `pageSources.limits.test.ts`: fails on the old code (`RangeError`), passes now. |
| D2 | Analyzer: PDF content expansion unbounded (102 KB -> 50 MB, 7 s CPU measured). | FIXED | Bound at 64 MB before any PDF parser runs. |
| D3 | AcroForm route: same base64 overflow. | FIXED | `acroFormRoutes.test.ts`. |
| D4 | AcroForm: valid 9.5 MB PDF returned 500 (same cause). | FIXED | 10 MB boundary test. |
| D5 | AcroForm: four blank "Name of court" combo boxes withheld as unsupported. | FIXED | Real-file regressions for all six PDFs. |
| D6 | AcroForm: app-wide 100 MB JSON parser ran before the route's size check. | FIXED | Route parses its own 14 MB body; the global parser skips `/api/acroform/`. |
| D7 | AcroForm: flag checked after the body was parsed. | FIXED | Test: malformed body gets 404 while disabled. |
| D8 | AcroForm: expansion bomb accepted. | FIXED | Route returns 413. |
| D9 | AcroForm: unlimited concurrent reads. | FIXED | Limit of 2 per process (429 otherwise). |
| D10 | AcroForm: no per-user limit. | FIXED | 20 reads per user per 15 minutes, per process (see O5 for the shared version). |
| D11 | AcroForm: untrusted field text shown with control and bidi characters. | FIXED | `displayText` tests. |
| D12 | Analyzer text reader logged full error objects (could quote document text). | FIXED | Test: a secret string in a malformed PDF is not logged. |
| D13 | Dependencies: critical and high advisories (dompurify, proxy-addr, body-parser, compression, source-map-js, undici, vite). | FIXED | Targeted updates and `overrides`. |
| D14 | Nodemailer 6.10.1: two high advisories (unintended-domain delivery; SMTP command injection). | FIXED | Upgraded to 10.2.1. Email tests (`access`, `paymentActivation`, `paymentRequests`, `gmailAgent`): 76 of 76 pass. Typecheck passes. See O15 for the types residual. |
| D15 | Firebase admin chain: `@grpc/grpc-js` 1.9.16 and `@firebase/firestore` 4.16.0 (high advisories). | FIXED | Overrides to `@grpc/grpc-js` 1.14.6 and `@firebase/firestore` 4.19.0 (patched minor releases, not major upgrades). Tests and typecheck pass. |
| D16 | Analyzer and AcroForm: LZW and RunLength streams unbounded. | FIXED | Bounded decoders (`lzwDecodedLength`, `runLengthDecodedLength`). The LZW decoder is checked against a reference encoder with code-width growth; breaking the width rule fails the test. |
| D17 | Bound bypass: a Flate or LZW bomb hidden behind ASCII85 or ASCIIHex, or behind an indirect `/Filter` reference. | FIXED | Prefix decoders run first; combined content chains and unparseable filters are refused. Tests cover each case. |
| D18 | Readability of parent-facing wording unchecked. | FIXED (automated estimate) | `parentReadability.test.ts`: grade estimate at or below 8 and no legal conclusion words. Heuristic only (O7). |

## C. Measurements and decisions
| ID | Item | Status | Evidence |
|---|---|---|---|
| M1 | Analyzer 64 MB decompression limit: cost at the limit. | VERIFIED, limit kept | 63 MB expansion: text extraction 4.3 s, RSS +99 MB (`budget.json`, this session). 16 MB: 1.1 s, +43 MB. |
| M2 | Image codecs (DCT, JPX, JBIG2, CCITT) are not sized. | Stated boundary (O12) | Text and field readers do not decode image data, so these streams do not drive the memory cost measured above. |

## D. Open items
| ID | Item | Status | Reason and next step |
|---|---|---|---|
| O4 | Analyzer 64 MB bound may refuse large scanned PDFs whose images are raw Flate. | OPEN (owner decision) | Most scanner output is DCT, which is not sized (M2). Owner to confirm the limit after real-world uploads. |
| O5 | Shared rate limiting for serverless deployments. | PARTLY DONE; BLOCKED (owner approval) | Code is written and tested: `api/services/acroFormReadLimiter.ts` and the route switch. `ACROFORM_LIMIT_BACKEND=shared` calls `acroform_consume_read`; any error, missing function, or non-boolean answer returns 503 (`LIMITER_UNAVAILABLE`) and never allows the read. Default is still the per-process limiter. The migration (`supabase/migrations_pending_approval/acroform_shared_read_limit.sql`) is NOT applied. Applying it is a production database change and needs your authorization. Tests: `acroFormReadLimiter.test.ts` (11 cases including grants), `acroFormReadLimiterRoute.test.ts` (503 end to end, no PDF read). Not exercised against a real database yet. |
| O9 | Table boundary detection and continuation tables. | OPEN | Not implemented. Row attribution is 0 on all six real PDFs. Next step: detect column bands from widget geometry and repeated headers, with tests on synthetic tables. |
| O10 | Mapping coverage: 61 of 483 fields confirmed. | OPEN | Most fields lack printed-label evidence. Rules were not relaxed to raise this number. |
| O7 | Parent-facing wording: plain-language review. | OPEN (human) | The automated estimate (D18) is a guard, not a certification. |
| O8 | Privacy and legal review of field facts and uploads. | OPEN (human) | Required before any activation. |
| O11 | Remaining moderate advisories. | FIXED (commit d0b0d8a6) | Were 13 moderate: `ip-address` (override to 10.7.5), `uuid` (override to 11.1.1; Google libraries call only `uuid.v4()`), `vitest` and `@vitest/mocker` (4.1.12, dev only). The Firebase/Google findings were the same `uuid` chain. `npm audit`: 0 across all levels. |
| O12 | Image codecs are not bounded by size. | OPEN (boundary) | See M2. Revisit if a future feature decodes images. |
| O13 | AcroForm feature is off and not integrated into any report. | OPEN (by design) | Integration plan in `ACROFORM_INTEGRATION_PLAN.md`. Not activated. |
| O14 | Audit-level review of the AcroForm mapping for multi-page tables and radio groups. | OPEN | Radio groups are not confirmed (by design). Multi-page tables are not linked. |
| O15 | `@types/nodemailer` 6.x declarations are used with the Nodemailer 10.x runtime. | OPEN (residual) | Typecheck passes and the call surface is tested. Nodemailer 10 ships no declarations of its own. Replace the types package if a typed API mismatch appears. |

## E. Verification
| ID | Check | Status |
|---|---|---|
| V1 | Node 22 and Node 24 full matrices | PARTLY VERIFIED on the current tree (d0b0d8a6 plus the shared-limiter change). Without PostgreSQL: Node 22 and Node 24 each 3,748 passed, 0 failed, 403 skipped (201 of 212 files run). With PostgreSQL: NOT RUN. The local cluster is up, but the `.pg.test.ts` suites need password or trusted TCP auth on 127.0.0.1, and the sandbox refused a change to `pg_hba.conf` to allow it. Those suites fail to connect here (10 files). The earlier 4,093 figure was from a run with PostgreSQL and is not reproduced. |
| V2 | TypeScript (`tsc --noEmit`) | VERIFIED: exit 0 on Node 22 and Node 24 (current tree) |
| V3 | Production build | VERIFIED: exit 0 on Node 22 and Node 24 (current tree) |
| V4 | Historical pins, fixtures, and regression assertions unchanged | VERIFIED: `scripts/official-forms` pins and the six real-file tests are not edited in this change |
| V5 | Dependency audit | VERIFIED: 0 critical, 0 high, 0 moderate, 0 low, 0 total (`npm audit --json`, Node 22) |
| V6 | GitHub CI on the final commit | Recorded in the final report |
| V7 | Vercel preview on the exact final commit | Recorded in the final report |

## Release readiness
PR #106 is **not ready for final release review**. Blocking items:
- Section A: 44 skipped tests need the historical originals (38) and staging credentials (6).
- PostgreSQL suites (10 files): not run in this environment. They need a password or trusted TCP auth for 127.0.0.1,
  and the sandbox refused a change to allow it. Run them in an environment you control with
  `NAVIGATOR_PG_TEST_ADMIN_URL` set to a disposable local database.
- O5: applying the pending migration (needs your approval).
- Human reviews O7 and O8.
- V6 and V7: CI and Vercel preview on the final commit, to be recorded after the push.

Counts at this commit (no PostgreSQL): 3,748 passed, 0 failed, 403 skipped, on Node 22 and Node 24.
Open engineering items (not started or not complete): O9 table detection, O10 mapping coverage, O12 image codecs, O14
multi-page tables and radio groups, O15 Nodemailer types residual.
