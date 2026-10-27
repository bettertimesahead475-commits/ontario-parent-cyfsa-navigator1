# Official court forms: fixture restore and production retrieval audit

Status: DRAFT. No production deployment, merge, or database migration. Written 2026-10-26 against commit `c2c481a`.

## 1. Fixture restore: what is blocked and why

- The owner's Google Drive folder `1zy2jwpp-lC3zT17AGWGVpnb-y3JYQNtB` contains the historical files. Drive metadata (sizes only) matches the historical pins in `scripts/official-forms/manifest.json` for all six historical PDFs: 35.1A 208594, 33C 224841, 33B.1 456688, 14A 150386, 8B 549760, and the unpinned `form_33b_2018.pdf` 276848 bytes.
- Sizes are not identity. SHA-256 verification needs the bytes on this machine.
- The bytes could not be transferred into this sandbox in this session. The Drive connector returns file contents as base64 text, about 1.9 MB across the six PDFs, which exceeds what can be handled safely in one session. A credential-based Drive download was refused by the sandbox's permission policy and was not pursued further.
- Files already on this machine:
  - `/var/tmp/official-download/` holds the five historical `.docx` files, which match their pins, and six PDFs that match the CURRENT pins (`current-manifest.json`), not the historical ones. Their names duplicate the historical names. They must not be used as historical fixtures.
  - `/root/.claude/uploads/f5b74824-...-current/` holds the same six current PDFs.
- Therefore the historical PDF tests (38) remain skipped until the six historical PDFs are placed in the fixture directory and verified.

### Cross-platform fixture directory (proposed, not implemented here)

- Default: `fixtures/official-forms/` at the repository root, gitignored. Binary official PDFs are not committed.
- Override: environment variable `OFFICIAL_FORMS_DIR` (absolute path).
- The 28 hardcoded `/root/.claude/uploads/...` references in 19 files, including 11 entries in the production module `api/services/officialFormSourceManifest.ts`, should be replaced by a single resolver. Production code must not depend on a sandbox path.
- Verification uses the existing `scripts/official-forms/verify.mjs`, which checks SHA-256 and length against `manifest.json` before any test runs. A file whose name is present but whose bytes differ must fail, not skip.

## 2. Historical versus current forms

| Set | Source | Files | Used for |
|---|---|---|---|
| Historical pins | `scripts/official-forms/manifest.json` | 11 entries: 5 `.docx` (present, match pins), 6 `.pdf` (missing) | Regression fixtures for the semantic maps and field inventories |
| Current | `scripts/official-forms/current-manifest.json`, retrieved 2026-10-26 | 6 `.pdf` with the same filenames but different bytes | Should drive production form provision; not yet a fixture |

Same filename, different bytes, for all six PDFs. The reason is not established in the repository. Possible explanations include the official site replacing the file under the same name, or an earlier copy. Only the official index can settle which bytes are the current version.

Provenance gap: `current-manifest.json` says the files were verified read-only on 2026-10-26, but the repository does not record who fetched them from the official site, from what URL, at what time, or with what response headers. That record is required before production use.

Observed index metadata (`officialFormSourceManifest.ts`): observed 2026-09-22 by the project lead outside the sandbox. It covers 8B, 33B.1, 33C, 35.1A, and 14A. The file marks its artifact-byte fields as null and states that byte verification has not occurred.

## 3. Production retrieval, as it exists

What runs:
- `api/_server.ts:1714` mounts `registerOfficialFormRoutes`. Routes such as `GET /api/official-forms` read Supabase tables through `api/services/officialFormRegistry.ts`.
- Tables read: `navigator_official_forms`, `navigator_official_form_sources`, `navigator_official_form_versions`, `navigator_official_form_templates`, `navigator_official_form_field_maps`.

What was measured:
- Staging (`nxfhvebzzobegubefcda`, read-only query): all five tables exist and have 0 rows.
- Production (`qboidsfpjuxeqtfotryj`): not queried. Its state is unknown from this session.

What is missing:
1. No writer. A grep of `api/` and `scripts/` finds no insert, upsert, or update to any `navigator_official_form*` table outside tests.
2. No refresh job. `vercel.json` schedules no form-related cron.
3. Retrieval is unproven live. `officialFormRetrieval.ts` contains an SSRF-checked fetch with manual redirects, but the file itself states it has never run against the Ontario host. The sandbox cannot reach that host.
4. Migration status is unclear. `supabase/migrations_pending_approval/create_navigator_official_form_registry.sql` is in the pending folder, yet the tables exist on staging. How they were created is not recorded in this repository.
5. Runtime-visible hardcoded paths in `officialFormSourceManifest.ts`. Whether that module is imported at runtime, rather than only by tests, needs to be confirmed. If it is, the production build references sandbox paths.

Result: CYFSA Navigator cannot automatically provide the correct official forms today. The API returns an empty list, and no process fills it.

## 4. What must change for automatic, correct form provision

1. Choose the source of truth: the official index page at ontariocourtforms.on.ca, recorded with URL, response headers, retrieval time, and SHA-256 for each artifact.
2. Build an ingestion job:
   - fetch the index, resolve each form's PDF and DOCX links, and fetch each artifact through the existing SSRF-validated retrieval;
   - hash and size each artifact, then store the bytes in object storage with the hash as the key;
   - write `navigator_official_forms`, `_sources`, and `_versions` rows with a verification status;
   - never overwrite a verified version. A changed hash becomes a new version that is marked for review.
3. Schedule it with a `vercel.json` cron that calls an admin route guarded by a secret. The job must be idempotent and fail closed: on any error, the last verified version stays current and the failure is recorded.
4. Templates and field maps: only `VALIDATED` maps may drive output. A new version starts without a validated map and is withheld from output until one is reviewed.
5. Serve only versions that are both current and verified. Otherwise show "not yet verified" rather than an unverified file.
6. Tests: run retrieval and ingestion against recorded fixtures, never against the live site in CI. Pins change only through an approved change.

## 5. Approvals required before any of the above ships

- Permission to transfer the six historical PDFs into this sandbox, or confirmation that they are placed in the fixture directory by the owner.
- Approval of the source of truth in section 4.1 and the provenance record for the current files.
- Staging: writing rows and objects to the staging project, after a migration review.
- Production: applying any migration, enabling the cron, or writing to production tables. Each needs explicit approval.

## 6. Next recommended action

Place the six historical PDFs in `fixtures/official-forms/` (or set `OFFICIAL_FORMS_DIR`), then run `scripts/official-forms/verify.mjs`. Once every file passes, the 38 historical tests can run, and this document can be updated with the results.

## 7. Access check for the Windows fixture ZIP (2026-10-26, this session)

- `C:\Users\User\Downloads\cyfsa-historical-pdf-fixtures.zip`: not reachable. The sandbox has no Windows drive mount. `find /` for the ZIP name and for `*historical*fixture*` returned nothing.
- `/mnt/user-data/uploads`, `/mnt/user-data/working`, `/mnt/user-data/outputs`, and `/mnt/attach`: all empty.
- Google Drive connector (folder `1zy2jwpp-lC3zT17AGWGVpnb-y3JYQNtB`): the only tool that returns file bytes is `download_file_content`, which returns base64 text inside the chat. No tool writes a file to the workspace. Drive metadata for the six historical PDFs matches the pinned sizes (section 1), but the bytes were not transferred and no hash was checked.
- Result: the six historical PDFs are not in this environment. The 38 historical tests remain skipped. Nothing in `fixtures/official-forms/` was created, and no test was changed.

Simplest supported transfer: attach the ZIP (or the six PDFs) to the chat so it appears under `/mnt/user-data/uploads`. Alternatively, commit the six PDFs to a draft branch in a folder that the resolver will read, after the owner confirms that publishing them to the repository is acceptable.

## 8. Second access check (2026-10-26, after the owner reported the ZIP attached)

- `/mnt/user-data/uploads`, `/mnt/user-data/working`, `/mnt/user-data/outputs`, `/mnt/attach`: still empty. No ZIP is present in the sandbox.
- A filesystem search for `*fixture*.zip` and `cyfsa*.zip` found nothing.
- All 18 PDF and ZIP files of 50 KB to 2 MB were hashed. None matches a historical pin in `scripts/official-forms/manifest.json`.
- Result: the six historical PDFs are not in this environment. No fixture directory, resolver change, or test change was made. The 38 historical tests remain skipped.

## 9. Verified restoration (supersedes sections 1, 7, and 8)

Source: the owner's ZIP `cyfsa-historical-court-forms-all-11.zip`, uploaded to the sandbox. It holds exactly 11 flat files with no unsafe paths.

Verification:
- Each file was matched by SHA-256 against `scripts/official-forms/manifest.json`, then checked for byte length. Result: 11 of 11 match. The 6 historical PDFs and the 5 historical DOCX files all match their pins.
- Files were renamed to their manifest names (the ZIP names lack the hash prefixes), by hash, not by guessing.
- Current PDFs (`scripts/official-forms/current-manifest.json`) were copied to `fixtures/official-forms-current/` and verified 6 of 6. They are a separate set and are not historical fixtures.
- `node scripts/official-forms/verify.mjs` now reports 11/11 for the historical set. With `--manifest=current-manifest.json`, it reports 6/6.

Resolver:
- `api/testSupport/officialFormFixtures.ts` exports `OFFICIAL_FORMS_DIR` and `OFFICIAL_FORMS_CURRENT_DIR`. Each comes from its environment variable when set, and otherwise defaults to a gitignored folder inside the repository.
- The fixture folders are gitignored (`fixtures/`). Binary official PDFs are not committed.
- 13 test files and `officialFormSourceManifest.ts` use the resolver. The manifest now stores file names only. No code reads `suppliedFilePath` at runtime.

Restored results (after the change, no environment variables set except the PostgreSQL URL where noted):
- Historical integration file `officialFormRealArtifactIntegration.test.ts`: 77 of 77 tests pass, 0 skipped. This file previously had 38 skipped tests.
- All 13 fixture-dependent files: 488 of 488 pass.
- Full suite, Node 22, with PostgreSQL: 212 files passed, 1 file skipped; 4,155 passed, 0 failed, 6 skipped (staging only).
- Full suite, Node 24, with PostgreSQL: same result, 4,155 passed, 0 failed, 6 skipped.
- Full suite, Node 22, without PostgreSQL: 201 files passed, 12 skipped; 3,787 passed, 0 failed, 374 skipped (368 PostgreSQL-gated, 6 staging).
- Typecheck (`tsc --noEmit`): exit 0 on Node 22 and Node 24. Build: exit 0 on Node 22 and Node 24.
- Wrong-bytes check: a current PDF placed under a historical name makes 4 integrity tests fail. It does not skip them.

Remaining sandbox paths, on purpose:
- Seven files still contain the old sandbox path. All seven are frozen: their SHA-256 values are pinned in the test suite. Three are test files (`form8bAdminChildPartySemanticFieldMap.test.ts`, `form8bStructuralManifest.test.ts`, `form8bRequestedOrderSemanticFieldMap.test.ts`). Four are source files whose only sandbox reference is in a comment (`form14aSemanticFieldMap.ts`, `form33cSemanticFieldMap.ts`, `form351aSemanticFieldMap.ts`, `form8bAdminChildPartySemanticFieldMap.ts`). Editing any of them breaks the frozen-pin assertions. Those tests still pass in this sandbox because the same bytes exist at the old path. On another machine they would skip, not fail.
- Changing them needs an explicit decision: update the frozen pins through a reviewed change, or accept the old paths as documentation.

Not done in this change:
- No merge, no deployment, no production change, no migration.
- The `draft/official-forms-audit` branch is the only branch changed.

## 10. Historical fixture portability (applied)

Scope: the approved three-file patch, the checksum pins, and a fail-closed change to the structural test. Frozen comment-only source files are byte-identical to the previous commit.

### Changes
- `form8bAdminChildPartySemanticFieldMap.test.ts`, `form8bRequestedOrderSemanticFieldMap.test.ts`, `form8bStructuralManifest.test.ts`: the sandbox path is replaced by `officialFormFile("d39f83dd-form-8b-feb_1_2022-en.docx")`, with the required import.
- `form8bStructuralManifest.test.ts`: the `try/catch` that passed silently when the file was missing is replaced. The internal-consistency assertion now always runs as its own test. The real-bytes assertion is gated with `existsSync` and reports as skipped when absent. Its assertions are unchanged.
- `api/services/officialFormFixtureRequirement.test.ts` (new): fail-closed. Off unless `REQUIRE_OFFICIAL_FORMS_FIXTURES=1`. When on, every manifest file must exist with the pinned SHA-256 and length.
- Four comment-only source files left unchanged: `form14aSemanticFieldMap.ts`, `form33cSemanticFieldMap.ts`, `form351aSemanticFieldMap.ts`, `form8bAdminChildPartySemanticFieldMap.ts`.

### Checksum changes (frozen pins; test assertions unchanged)
The earlier investigation listed `ab2d7df4…` for the structural test. That value was superseded by the gating edit above.

| Pin location | Pinned file | Old SHA-256 | New SHA-256 |
|---|---|---|---|
| `form8bFinalSemanticFieldMap.test.ts` (FROZEN map) | `form8bStructuralManifest.test.ts` | `436413c2573c28cb2bd46df5525ecdf6ce84b961f9cebae8fc54d541ae8db7b8` | `7e3e2a3a5ddd13ac28de9ae94b1e7d34b6280921947e8afb9bc24e4244881f08` |
| `form8bFinalSemanticFieldMap.test.ts` (FROZEN map) | `form8bAdminChildPartySemanticFieldMap.test.ts` | `649716b6dbb48eed4d6dc2e88860490c84bb4d1ccdf430cc31235dff0a3d7509` | `a7b1645d031ab5a221a6b4e6dd5884e990241d5e2c523996b661c73f702fc2e2` |
| `form8bRequestedOrderSemanticFieldMap.test.ts` (`B4BI_TEST_SHA`) | `form8bAdminChildPartySemanticFieldMap.test.ts` | `649716b6dbb48eed4d6dc2e88860490c84bb4d1ccdf430cc31235dff0a3d7509` | `a7b1645d031ab5a221a6b4e6dd5884e990241d5e2c523996b661c73f702fc2e2` |
| `form8bFinalSemanticFieldMap.test.ts` (FROZEN map) | `form8bRequestedOrderSemanticFieldMap.test.ts` | `e162d39b526d33dca26a737ebd82868e553604894ccf7bb307b7ff14cde8eedb` | `213fe0cc198770b28dc620aa7551eb8d263dd079561724373194eed422e08633` |

All ten FROZEN-map entries were re-computed after the change and match their files (0 mismatches). Hashes use the tests' own normalization (UTF-8, CRLF converted to LF).

### Results (commit recorded in the final report)
Typecheck (`tsc --noEmit`): exit 0 on Node 22 and Node 24. Build: exit 0 on Node 22 and Node 24.

| Condition | Node | Files | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Fixtures present, PostgreSQL on | 22 | 212 pass, 2 skip | 4,156 | 0 | 18 (6 staging, 12 requirement tests off) |
| Fixtures present, PostgreSQL on | 24 | 212 pass, 2 skip | 4,156 | 0 | 18 |
| Fixtures present, PostgreSQL off | 22 | 201 pass, 13 skip | 3,788 | 0 | 386 (374 + 12 requirement tests off) |
| Fixtures present, `REQUIRE_OFFICIAL_FORMS_FIXTURES=1`, PostgreSQL off | 22 | 202 pass, 12 skip | 3,800 | 0 | 374 |
| Fixtures ABSENT, PostgreSQL off (clean machine) | 22 | 200 pass, 14 skip | 3,629 | 0 | 545 |
| Four frozen Form 8B files, fixtures present | 22 | 4 | 171 | 0 | 0 |
| Four frozen Form 8B files, fixtures absent | 22 | 4 | 163 | 0 | 8 (real-bytes checks reported as skipped, not passed) |
| All 11 fixtures corrupted (one byte flipped each), nine fixture-dependent files | 22 | 9 | 354 | 62 | — |
| Requirement test, fixtures corrupted | 22 | 1 | 1 | 11 | — |

Interpretation of the corrupted run: every test that recomputes fixture bytes fails. Passing tests on corrupted fixtures check only repository-stored hashes or synthetic inputs, which do not read the fixture files. `verify.mjs` on the corrupted folder reports 0 of 11 and exits 1.

### Local verification versus CI coverage
- Local: all 11 historical fixtures verify (SHA-256 and length) in `fixtures/official-forms/`, and all 6 current PDFs verify in `fixtures/official-forms-current/`. Both folders are gitignored.
- CI today (`.github/workflows/ci.yml`): no fixtures, no PostgreSQL. The historical real-artifact tests skip there. Nothing in CI verifies the historical bytes.
- Proposed (not enabled): see `docs/ci/OFFICIAL_FORMS_FIXTURES_CI.md`. A protected, manual job that downloads a release asset, verifies each file against the committed pins, and runs with `REQUIRE_OFFICIAL_FORMS_FIXTURES=1`.

### Remaining limits
- No historical real-artifact test runs in pull-request CI.
- The release asset does not exist yet. Creating it, and confirming the repository's visibility, is an owner action. This session's GitHub access cannot check either.
- The structural test's internal-consistency assertion still passes without any file. That is intended, and it is labelled as internal consistency, not artifact verification.

## 11. CI fixture provisioning (prepared, not enabled)

### Verified facts
- Repository visibility: **public** (`GET /repos/…` returns `private: false`).
- Actions settings, environments, and releases are not readable from this session (HTTP 403 through the proxy). The GitHub connector failed to connect. Their state is unknown here.
- `ci.yml` provides no fixtures and no PostgreSQL. Pull-request CI runs zero historical real-artifact tests.

### What changed
- `scripts/official-forms/fetch-fixtures.mjs`: takes one source folder per set (the two sets share six file names with different bytes, so one folder cannot serve both). Verifies every pinned file in both manifests before writing anything; stages and re-verifies both sets; then moves them into place. Any missing, altered, or unsafe file writes nothing. Output names only the manifest names.
- `api/services/officialFormFixtureFetch.test.ts` (8 tests): all-or-nothing behaviour, a missing file, a corrupted file in each set, unrelated files ignored, and command-line exit codes. Uses temporary folders only.
- `api/services/officialFormFixtureRequirement.test.ts`: now covers 18 checks (folder check, 11 historical, 6 current). Off unless `REQUIRE_OFFICIAL_FORMS_FIXTURES=1`.
- `docs/ci/OFFICIAL_FORMS_FIXTURES_CI.md`: rewritten. The earlier release-asset option is withdrawn, because the repository is public.
- `docs/ci/official-forms-fixtures.workflow.template.yml`: an inactive template outside `.github/workflows/`. It uses OIDC to Google Cloud, no stored key, `persist-credentials: false`, and `workflow_dispatch` only. Its environment must be restricted to `main` with required reviewers.
- Not changed: `ci.yml`, all frozen files, and the four comment-only source files.

### Results (current tree)
Typecheck and build: exit 0 on Node 22 and Node 24.

| Condition | Node | Files | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Fixtures present, PostgreSQL on | 22 | 213 pass, 2 skip | 4,164 | 0 | 24 (6 staging, 18 requirement off) |
| Fixtures present, PostgreSQL on | 24 | 213 pass, 2 skip | 4,164 | 0 | 24 |
| Fixtures present, PostgreSQL off | 22 | 202 pass, 13 skip | 3,796 | 0 | 392 (374 + 18 requirement off) |
| Fixtures present, `REQUIRE_OFFICIAL_FORMS_FIXTURES=1`, PostgreSQL off | 22 | 203 pass, 12 skip | 3,814 | 0 | 374 |
| Fixtures ABSENT, requirement off (clean machine) | 22 | 200 pass, 15 skip | 3,629 | 0 | 559 |
| Fixtures ABSENT, requirement ON | 22 | requirement file | 0 | 18 | — (fails closed) |
| Current fixtures corrupted, requirement ON | 22 | requirement file | 12 | 6 | — (fails closed) |
| Historical + current fixtures present, fetch script run via tests | 22 | 8 tests | 8 | 0 | 0 |

Checksum pins: no pin changed in this step. All 10 frozen-map pins were re-verified against their files.

### Local verification versus CI coverage
- Local: all 11 historical and all 6 current fixtures verify against their pins (SHA-256 and byte length) in gitignored folders.
- CI today: none of these are present. The historical and current real-artifact tests skip. Nothing in CI verifies the historical or current bytes.
- Proposed CI: the protected manual job in the template. It provides verification only once the owner has created the cloud storage and approved the environment.

### Remaining blockers (owner actions; none performed here)
1. Confirm the repository's Actions settings and create the `official-forms-fixtures` environment: required reviewers, and deployment branches restricted to `main`.
2. Create a private Google Cloud bucket and a reader service account (`storage.objectViewer` on the bucket only), and a Workload Identity provider limited to this repository and environment.
3. Upload the 17 verified files once, under `historical/` and `current/`. This is a one-time upload, not a recurring step.
4. Set three repository or environment variables (not secrets): `OFFICIAL_FORMS_BUCKET`, `OFFICIAL_FORMS_WIF_PROVIDER`, `OFFICIAL_FORMS_READER_SA`.
5. Review and copy the template into `.github/workflows/` in a separate change, then run it once from `main`.

### Residual risks
- After the auth step, repository code runs with a token that can read the bucket. Restricting the environment to `main` is what limits this. The job must never be dispatched from a branch.
- Pull-request CI still does not run the historical tests.
- The fixtures are public government forms. The private bucket is an access-control choice, not a confidentiality guarantee.

## 12. Official-source downloader (implemented, workflow inactive)

### What changed
- `scripts/official-forms/fetch-official.mjs`: downloads the 11 `retrievable: true` entries from their official URLs and verifies each against its pinned SHA-256 and length. Writes only when every retrievable file passes. Writes never delete other files.
- Safeguards, each with a test: HTTPS only; exact allowlisted host (`ontariocourtforms.on.ca`); no credentials; no non-default port; **no redirects at all** (a redirect means the pinned URL is stale, so it is reported for review); declared-length and streamed size limit (5 MB per file); timeout (60 s); bounded retries (3 attempts, backoff 1 s and 3 s) for transport failures only (network error, timeout, truncated body, 429, 5xx).
- Changed content (complete response, different bytes or length) is reported as `CHANGED_UPSTREAM`. It is not retried, not written, and the bytes are not kept. Exit code 2. **No pin is ever updated automatically.**
- `--report <file>` writes statuses, attempt counts, observed hashes, and transport codes. It contains no file content.
- `manifest.json` and `current-manifest.json`: added `sourceUrl` (historical DOCX) and `retrievable` on every entry. Every `sha256` and `byteLength` is unchanged (checked against the previous commit).
- The six superseded historical PDFs: `retrievable: false`. They stay in `fixtures/official-forms/` and are not touched by the downloader. Their 38 integration tests are unchanged.
- `api/services/officialFormFixtureRequirement.test.ts`: `REQUIRE_OFFICIAL_FORMS_FIXTURES=1` still checks all 17 pins. `=retrievable` checks only the 11 retrievable pins.
- `api/services/officialFormCurrentPdfs.test.ts`: corrected a defect from an earlier commit. It built paths from the manifest's relative `uploadDirectory` and skipped silently when a file was missing. It now uses the fixture resolver.
- `api/services/officialFormDownloader.test.ts` (26 tests): no network. A fake `fetch` covers every listed failure class.
- Workflow: NOT ACTIVE. `ci.yml` is unchanged. The template is `docs/ci/official-forms-fetch.workflow.template.yml`.

### Live verification (this sandbox, via the documented proxy setting)
- The first live attempt returned `NETWORK_ERROR` for all 11 files. The sandbox routes HTTPS through a proxy, and Node's built-in `fetch` ignores it unless `NODE_USE_ENV_PROXY=1` is set (the sandbox's documented setting for Node 22.21 and later). With that setting: 11 of 11 `PASS`, exit 0, 5 historical DOCX and 6 current PDFs written to temporary folders.
- This proves connectivity from this sandbox only. GitHub-hosted runners are not tested.

### Test results (current tree)
- Typecheck (`tsc --noEmit`): exit 0 on Node 22 and Node 24. Build: exit 0 on both.
- Fixture-dependent tests (15 files, Node 22): 565 passed, 0 failed, 12 skipped (the requirement tests, which are off by default).
- Full suite, Node 22, PostgreSQL on, fixtures present: 4,190 passed, 0 failed, 18 skipped (6 staging, 12 requirement tests off).
- Full suite, Node 24, PostgreSQL on, fixtures present: 4,190 passed, 0 failed, 18 skipped (same).
- Full suite, Node 22, PostgreSQL off, fixtures present: 3,822 passed, 0 failed, 386 skipped (368 PostgreSQL-gated, 6 staging, 12 requirement off).
- Requirement mode `1`, fixtures present: 18 of 18 pass. Mode `retrievable`, fixtures present: 12 of 12 pass.
- Negative: mode `retrievable` with the current set corrupted: 6 fail, 6 pass (exit 1). Mode `retrievable` with the fixtures folder absent: 12 fail (exit 1).
- Clean machine (fixtures absent, requirement off, no PostgreSQL): 3,654 passed, 0 failed, 554 skipped.

### Exact remaining skips
- Always skipped in this environment without staging credentials: 6 `creditStaging.test.ts` tests.
- Skipped unless `REQUIRE_OFFICIAL_FORMS_FIXTURES` is set: 12 requirement tests in default mode, 18 in mode `1`.
- Skipped without PostgreSQL: 368 PostgreSQL-gated tests.
- Skipped when fixtures are absent: the fixture-dependent tests.
- Skipped in every CI run: the 38 superseded-PDF integration tests, because no official source serves those bytes. They run locally only.

### Remaining blockers before the workflow may be enabled
1. Independent review of the downloader and its tests. Not yet performed.
2. GitHub-hosted runner connectivity to `ontariocourtforms.on.ca`. Not yet demonstrated. Demonstrate it in a manual run on a non-`main` branch before enabling anything.
3. Counsel's review of the temporary-copy question in `docs/ci/OFFICIAL_FORMS_SOURCE_DECISION.md` section 1.2. Not yet obtained.
4. CODEOWNERS (or branch protection with required review) for `scripts/official-forms/**`, so a pull request cannot change a pin or a URL without review. Requires the owner's repository settings.
5. Owner decision on the 38 superseded-PDF tests: keep them local-only, or pursue a King's Printer licence.
