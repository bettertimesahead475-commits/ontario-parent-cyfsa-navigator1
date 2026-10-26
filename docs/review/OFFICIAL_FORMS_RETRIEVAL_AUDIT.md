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
