# Official-form fixtures: distribution decision and recommended CI design

Status: decision record. No file is published, no workflow is enabled, and no infrastructure is created. Legal conclusions below are a factual summary for counsel to confirm, not legal advice.

## 1. Evidence gathered (2026-10-27)

### 1.1 The 17 fixtures are blank forms with no personal or case data
- Form fields (all 17 PDFs, 501 widgets per set): the only non-empty values are unchecked-checkbox states (`Off`) and two template strings, `Name of court` and `1.`. No case, party, or personal value is present.
- DOCX text-field defaults are `0` (checkboxes unchecked).
- PDF document information (decrypted): no author. Several PDFs were last written by `iLovePDF`, a web converter. The site's own current PDFs carry the same producer (see 1.3), so this is how the publisher produced them.
- DOCX `creator` and `lastModifiedBy` name individual Ministry staff. These are in the official files and in the pinned bytes, so they cannot be stripped without breaking the SHA-256 pins. This is a reason not to republish the DOCX files.
- Limit: field values were checked by machine. Printed page text was not reviewed line by line.

### 1.2 Source terms (`https://www.ontario.ca/page/copyright-information`, read 2026-10-27)
- Content is protected by Crown copyright held by the King's Printer for Ontario.
- Non-commercial reproduction is permitted if credit is given, Crown copyright is acknowledged, and no changes are made.
- Commercial reproduction requires a licence from the King's Printer. The exception covers statutes, regulations, judicial decisions, and material labelled under the Open Government Licence.
- The court-forms index page contains no Open Government Licence label, so the exception is not shown to apply.
- The copyright page gives a route to request a licence. CYFSA Navigator is a commercial product.

### 1.3 Whether the official site serves the same bytes (direct HTTP fetch, 2026-10-27)

| Set | Files | Served by the official site today | Pinned SHA-256 matches |
|---|---|---|---|
| Current PDFs | 6 | all six, HTTP 200 | 6 of 6 |
| Historical DOCX | 5 | all five, HTTP 200 | 5 of 5 |
| Historical PDFs | 6 | the same URLs serve different bytes | 0 of 6 (superseded) |

The six historical PDFs are not available from the official source. Their pinned bytes are superseded versions that the site no longer publishes.

### 1.4 What each set unlocks in the test suite (measured)
- All fixtures present: 489 passed, 18 skipped (the 18 skips are the requirement tests, which are off by default).
- Only the 5 DOCX and 6 current PDFs present: 451 passed, 56 skipped. The 38 extra skips are exactly the historical PDF-dependent tests.

## 2. Options evaluated

| Option | Lawful? | Complexity | Security posture | Verdict |
|---|---|---|---|---|
| Public GitHub release asset | No. Public redistribution of Crown copyright material by a commercial entity without a licence. The repository is public. | Low | Public | Rejected |
| Private GCS bucket with OIDC | Storing a copy for commercial use still needs a licence. It is not needed for retrievable files, because the source serves them. | High (cloud project, IAM, WIF, environment, variables) | Good, but it adds an unnecessary copy | Rejected for these files |
| Actions cache or artifacts | Same copy problem; artifacts are not access-controlled on a public repository | Low | Weak | Rejected |
| Fetch from the official source at run time, verified by pinned SHA-256 and length | Consistent with the terms: no copy is stored or published; CI reads the public site and keeps the copy only for the run | Low | No secret, no cloud identity, fail-closed on any hash change | **Recommended** |
| Obtain a King's Printer licence for the superseded PDFs | Could legally permit storing them | Business and legal process | Depends | Owner decision, optional |

## 3. Recommendation

Fetch the 11 retrievable files directly from the official source in CI, verify each against its pinned SHA-256 and length before any test runs, and keep the six superseded historical PDFs local-only. Do not store, publish, or cache copies. The workflow needs no secret, no cloud identity, and no environment, and it reads only public URLs.

Why this is the simplest defensible design:
- It matches the terms: no commercial copy is stored or published.
- It needs no infrastructure, and no recurring upload.
- It is fail-closed: any byte change makes the job fail, and the pins are the control.
- It covers all current-form tests and every DOCX-based historical test: 451 of 507 tests.
- The only gap is the 38 PDF tests for superseded forms, which no source can supply.

## 4. Security and maintenance implications

- Third-party dependency: a site outage fails CI. Mitigation: bounded retries and a clear message. It does not weaken integrity.
- Pins are the integrity control. Anyone who can change `manifest.json` can change the expected hash. Mitigation: CODEOWNERS or required review on `scripts/official-forms/**`, and the fetch step accepts only the host `ontariocourtforms.on.ca` (HTTPS), with a size limit and no redirects to other hosts.
- Form revisions: when the government changes a form, the hash differs and CI fails. The maintainer then reviews the new file and updates the pin. This is an intended currency signal. Expected load is small: 11 files.
- No secrets: pull-request runs, including forks, can run the fetch step. A malicious pull request can already run arbitrary test code, so the fetch adds no new exposure.
- The 38 superseded-PDF tests stay skipped in CI and are reported as such.

## 5. Exact implementation steps (not executed)

1. Add `sourceUrl` to the five historical DOCX entries in `scripts/official-forms/manifest.json`, and add `retrievable: true`. Add `retrievable: false` to the six historical PDF entries. Do not change any `sha256` or `byteLength`. First check that no frozen-pin map hashes `manifest.json`.
2. Create `scripts/official-forms/fetch-official.mjs`:
   - allowlist: `ontariocourtforms.on.ca` only, HTTPS only, no redirect to another host, 10 MB cap per file, 60 s timeout, three attempts;
   - download each `retrievable` entry to an empty temporary folder;
   - verify with `verifyDirectory` (SHA-256 and length), and write nothing if any file fails;
   - move the verified files into `fixtures/official-forms` and `fixtures/official-forms-current` with the existing staging logic.
3. Extend `api/services/officialFormFixtureRequirement.test.ts` so `REQUIRE_OFFICIAL_FORMS_FIXTURES=retrievable` checks only `retrievable: true` entries. `=1` keeps checking all 17.
4. Add tests for the downloader: a non-allowlisted host is refused, a redirect to another host is refused, an oversize response is refused, and a hash mismatch writes nothing. Use a local test server with the allowlist injected only in tests.
5. In `.github/workflows/ci.yml`, add a step after `npm ci`: `node scripts/official-forms/fetch-official.mjs`, then run `npm test` with `REQUIRE_OFFICIAL_FORMS_FIXTURES=retrievable`. Keep `permissions: contents: read`. Add no secret.
6. Add a CODEOWNERS entry requiring review for `scripts/official-forms/**`.
7. Verify: a clean CI run downloads 11 files, all pass, and 451 tests pass with 38 documented skips. Confirm the fetch is reachable from GitHub-hosted runners, which this session could not test.
8. Owner decisions, separate from this design: whether to request a King's Printer licence for the superseded PDFs, and whether the 38 PDF-dependent tests should stay local-only.

## 6. Limits of this evidence

- Reachability of the official host from GitHub-hosted runners was not tested. It was tested only through this session's proxy.
- The terms reading is a summary of the government's published pages on the date above. Counsel should confirm it.
- The historical PDFs' origin is recorded by the owner, not by an official source. Their hashes match the pins, but no official source serves them now.
