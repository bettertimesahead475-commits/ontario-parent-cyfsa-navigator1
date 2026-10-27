# PR #106 release checklist

Status key: FIXED (fixed and tested in this repository), VERIFIED (checked by running it), BLOCKED (cannot be done here;
the prerequisite is named), OPEN (work remains that needs a decision, a review, or more engineering).

The "47 outstanding items" figure does not match any list kept in this repository. Only items with evidence appear here.

## A. Skipped tests (44 at last full run)
| Group | Count | Status | Evidence and prerequisite |
|---|---|---|---|
| Historical PDF regression tests (`officialFormRealArtifactIntegration.test.ts`: 14 in batch 1, 24 in batch 2) | 38 | BLOCKED | Measured 2026-10-26 by SHA-256 against `scripts/official-forms/manifest.json`. The five historical `.docx` originals are present and match their pins (their tests run). The six historical PDFs are missing: 35.1A `33f4ddb3-form-35-1a-en-dec20.pdf` (208594 bytes), 33C `89af8ff6-form_33c_2018.pdf` (224841), 33B.1 `90196879-form-33b-1-en-dec20.pdf` (456688), 14A `df9e829b-flr-14a-sept105-en-fil.pdf` (150386), 8B `4dcaaa3e-form-8b-feb-2022-en.pdf` (549760), and the unpinned `b43d35f7-form_33b_2018.pdf` (276848). Files with the same names in `-current` are different files (current official versions, verified against `current-manifest.json`) and must not be substituted. The gate checks only that a path exists; the integrity test checks SHA-256 and length, so a wrong file fails rather than passes. Owner supplies the original six, or an archived copy whose SHA-256 and length match. |
| Staging Supabase tests (`creditStaging.test.ts`) | 6 | BLOCKED | `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` are not set in this environment. Owner adds them as environment variables for the staging project only (ref `nxfhvebzzobegubefcda`). The test refuses the production project (`qboidsfpjuxeqtfotryj`). No staging access was used for this PR. |

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
| O5 | Shared rate limiting for serverless deployments. | PARTLY DONE; BLOCKED (owner approval to apply) | Code: `api/services/acroFormReadLimiter.ts` and the route switch. `ACROFORM_LIMIT_BACKEND=shared` calls `acroform_consume_read`; any error, missing function, or non-boolean answer returns 503 and never allows the read. Default stays per-process. Migration `supabase/migrations_pending_approval/acroform_shared_read_limit.sql` is NOT applied, and staging does not have the table or function (read-only catalog check, 2026-10-26). Fixed this session: the window was computed before argument validation, so `window = 0` gave "division by zero" instead of the validation message. Added: an index on `window_start` for the cleanup. Verified against a real PostgreSQL 16 server (scratch cluster, SCRAM auth): grants (service_role only), RLS on with no anon/authenticated privileges, refusal from anon and authenticated roles, the limit, 30 concurrent reads against a limit of 20 allow exactly 20, window cleanup, invalid arguments, and the index (`acroFormReadLimiter.pg.test.ts`, 9 cases). Still open: retention is lazy (see O8). |
| O7 | Parent-facing wording: plain-language review. | PREPARED; OPEN (human review) | Review package: `docs/review/O7_PLAIN_LANGUAGE_REVIEW.md`. Fixed this session: the limiter refusal text scored Grade 12.5 (heuristic) and now reads "We cannot read forms right now. Please try again later." (Grade 1.6). A route test enforces Grade 8 on that message. Other error messages are listed in the package and not yet measured. The automated estimate is a guard, not a certification. |
| O8 | Privacy and legal review of field facts and uploads. | PREPARED; OPEN (human review, required before activation) | Review package: `docs/review/O8_PRIVACY_LEGAL_REVIEW.md` (data flow, the only stored identifier, retention, claims to avoid, five questions). No legal determination is made. |
| O9 | Table boundary detection and continuation tables. | OPEN (decision needed) | Measured on the six current official PDFs: 0 of 501 widgets attributed. Only 67 widgets (13%) have printed text to their left, and row attribution requires that. These forms put labels above their fields. Recommended: do not build table detection for these layouts now. Evidence: `docs/review/O9_O10_MAPPING_EVIDENCE.md`. |
| O10 | Mapping coverage: 61 of 483 fields confirmed. | OPEN (decision needed); figure reproduced | Re-measured 2026-10-26: 61 of 483 confirmed (12.6%), 422 unresolved, 2 conflicting, 3 radio groups. No mapping rule, label phrase, or window was changed. Raising the number needs a person to review each new label phrase. Evidence: `docs/review/O9_O10_MAPPING_EVIDENCE.md`. |
| O11 | Remaining moderate advisories. | FIXED (commit d0b0d8a6) | Were 13 moderate: `ip-address` (override to 10.7.5), `uuid` (override to 11.1.1; Google libraries call only `uuid.v4()`), `vitest` and `@vitest/mocker` (4.1.12, dev only). The Firebase/Google findings were the same `uuid` chain. `npm audit`: 0 across all levels. |
| O12 | Image codecs are not bounded by size. | OPEN (boundary) | See M2. Revisit if a future feature decodes images. |
| O13 | AcroForm feature is off and not integrated into any report. | OPEN (by design) | Integration plan in `ACROFORM_INTEGRATION_PLAN.md`. Not activated. |
| O14 | Audit-level review of the AcroForm mapping for multi-page tables and radio groups. | OPEN | Radio groups are not confirmed (by design). Multi-page tables are not linked. |
| O15 | `@types/nodemailer` 6.x declarations are used with the Nodemailer 10.x runtime. | OPEN (residual) | Typecheck passes and the call surface is tested. Nodemailer 10 ships no declarations of its own. Replace the types package if a typed API mismatch appears. |

## E. Verification
| ID | Check | Status |
|---|---|---|
| V1 | Full test matrix, Node 22 and Node 24, WITH PostgreSQL | VERIFIED on the working tree after this change (`cc8e9e9` plus the limiter-migration fixes in this commit). Both versions: 213 files, 212 passed, 1 skipped file; 4,117 tests passed, 0 failed, 44 skipped. The PostgreSQL-gated suites (9 files, 368 tests, all passing) ran against a disposable PostgreSQL 16 cluster this session, started on 127.0.0.1:5433 with SCRAM-SHA-256 and a random password held only in an environment variable. The 44 skips are exactly A: 38 historical fixture tests and 6 staging tests. |
| V1a | Same matrix WITHOUT PostgreSQL (CI-equivalent) | Node 22 on the working tree after this change: 201 of 213 files passed, 12 skipped files; 3,749 passed, 0 failed, 412 skipped. (Before the fixes in this commit: 3,748 passed, 403 skipped.) Of the 412 skipped, 44 are the group A tests and 368 are PostgreSQL-gated tests (they need `NAVIGATOR_PG_TEST_ADMIN_URL` and `CREDIT_PG_URL`; with both set, all 368 pass, see V1). Node 24 without PostgreSQL: not re-run on this tree. |
| V2 | TypeScript (`tsc --noEmit`) | VERIFIED: exit 0 on Node 22 and Node 24 (working tree after this change) |
| V3 | Production build | VERIFIED: exit 0 on Node 22 and Node 24 (working tree after this change) |
| V4 | Historical pins, fixtures, and regression assertions unchanged | VERIFIED: no file under `scripts/official-forms/`, no pin, and no existing test was edited in this commit. Pin SHA-256 and length were not changed. |
| V5 | Dependency audit | VERIFIED: 0 critical, 0 high, 0 moderate, 0 low, 0 total (`npm audit --json`, Node 22) |
| V6 | GitHub CI (Actions, `CI`) | PASSED on `d0b0d8a6`, `7d11222d`, and `cc8e9e9` (success on each). CI does not configure PostgreSQL, so the `.pg.test.ts` suites are skipped there. Result for the commit that contains this checklist update: recorded in the final report. |
| V7 | Vercel preview on the exact commit | `cc8e9e9`: READY (`dpl_9gT4SyhZoEsPSrjV6ZCM2ktXaAki`). `309ae47`: READY (`dpl_7qqBmtBqFKD9Cdgm2yibrMTuJRdX`). `7d11222d` and `d0b0d8a6`: CANCELED by Vercel (superseded by later pushes on the same branch), so no preview of their own. |
| V8 | Supabase staging, read only | Catalog check on staging (`nxfhvebzzobegubefcda`): O5 table and function absent; security advisor run: 43 INFO (RLS enabled, no policies, intended for server-only tables) and 8 WARN (mutable `search_path` on the existing `paid_*` functions). No write was made to any Supabase project. Production (`qboidsfpjuxeqtfotryj`) was not queried. |

## Release readiness
PR #106 is **not ready for final release review**. Mandatory gates not yet satisfied:
- A. 44 skipped tests: 38 need the six historical PDFs (the five historical `.docx` pass); 6 need staging credentials.
- O5. Owner approval to apply the migration. The migration itself is fixed and tested on a real PostgreSQL server.
- O7 and O8. Human reviews. Packages are in `docs/review/`.
- V7. The `cc8e9e9` preview is READY. Any later commit needs its own preview check.

Engineering decisions still open: O9 (recommended: do not build table detection for these layouts), O10 (12.6% stays the honest figure unless each label phrase is reviewed), O12 image codecs, O14 multi-page tables and radio groups, O15 Nodemailer types residual, O4 owner decision on the 64 MB limit, O13 integration (not activated).

Staging advisor WARN (8 `paid_*` functions with mutable `search_path`) is outside this PR's changes. It exists on staging already and needs its own approved migration.
