# Official-form fixture requirement tests: what each one checks, and why some are skipped

Date: 2026-10-27. Branch `draft/official-forms-audit`. File: `api/services/officialFormFixtureRequirement.test.ts`.
Every number below comes from vitest JSON reports (`/var/tmp/gate-*.json`, `/var/tmp/fd-*.json`) and the verify CLI. Nothing is estimated.

## 1. The 18 tests

Each test is one of:
- **Folder check** (1 test): both fixture folders exist.
- **Pin check** (17 tests): the file is present, its exact byte length matches, and its SHA-256 matches. These are the pins in `scripts/official-forms/manifest.json` (11) and `current-manifest.json` (6).

| Group | Files | Fixture source | Checked in `1` | Checked in `retrievable` | Why it is skipped in the other modes |
|---|---|---|---|---|---|
| Historical DOCX | 5 (`*.docx`) | Official URL (`sourceUrl`) | yes | yes | Not skipped in either mode |
| Historical PDF | 6 (`33f4…`, `89af…`, `9019…`, `df9e…`, `4dca…`, `b43d…`) | **No official source** (see section 3) | yes, only if the local bytes are present | **no**, labelled skip | Superseded: the official URL now serves different bytes |
| Current PDF | 6 | Official URL (`sourceUrl`) | yes | yes | Not skipped in either mode |
| Folder check | 1 | local folders | yes | yes | Not skipped when the mode is on |

Counts: mode `1` checks 18 of 18. Mode `retrievable` checks 12 of 18 and labels 6 as skips. The unset mode checks 0 of 18 and labels all 18.

## 2. Why the gate is off when the variable is unset

The gate fails the run when a fixture is missing or altered. A developer machine or a fork without fixtures must still be able to run `npm test`. So the unset mode reports these checks as skipped, and each skip name says why: `[skipped: REQUIRE_OFFICIAL_FORMS_FIXTURES is unset]`.

This is the same skip count as before, reported differently. Before this change, the unset run registered only 12 of the 18 (the six superseded PDFs were not registered at all). Now all 18 are registered and labelled, so the default run reports 6 more skips than before. These are not new skipped tests. They are the same 18 checks, now visible with a reason.

## 3. The six superseded historical PDFs

Finding (verified 2026-10-27, HTTP GET, hashes only, no file written):

| Historical file name | Served today at the official path | HTTP | Served bytes match historical pin | Served bytes match current pin |
|---|---|---|---|---|
| `33f4ddb3-form-35-1a-en-dec20.pdf` | `…/35_1a/form-35-1a-en-dec20.pdf` | 200 | no | yes |
| `89af8ff6-form_33c_2018.pdf` | `…/33c/form_33c_2018.pdf` | 200 | no | yes |
| `90196879-form-33b-1-en-dec20.pdf` | `…/33b_1/form-33b-1-en-dec20.pdf` | 200 | no | yes |
| `df9e829b-flr-14a-sept105-en-fil.pdf` | `…/14a/flr-14a-sept105-en-fil.pdf` | 200 | no | yes |
| `4dcaaa3e-form-8b-feb-2022-en.pdf` | `…/08b/form-8b-feb-2022-en.pdf` | 200 | no | yes |
| `b43d35f7-form_33b_2018.pdf` | `…/33b/form_33b_2018.pdf` | 200 | no | yes |

- The repository records **no original URL** for the superseded versions. The URLs above are the paths the site uses today for the same form names, taken from `current-manifest.json`.
- The site serves the current versions at those paths. The superseded bytes cannot be obtained from it.
- These six are **not** replaced with current forms. Doing so would make the historical tests exercise different documents.

## 4. The 38 PDF-dependent regression tests

- All 38 are in `api/services/officialFormRealArtifactIntegration.test.ts`. They are gated by file presence (`gateDescribe`/`gateIt` with `present(...)`), and they are **not** frozen. The file was not edited, so its test names are unchanged.
- Measured: with the six superseded PDFs removed from a copy of the fixtures (`/var/tmp/navnopdf`), the run reports exactly 38 skipped tests from this file and 0 failures.
- They **executed and passed** in full mode with the verified local fixtures present (617 of 617 fixture-dependent tests passed, 0 skipped). They cannot execute in CI retrievable mode, because the superseded bytes cannot be obtained there.
- Skipped tests in that file have no reason in their name. Their reason is file presence, as stated above. A future change could label them, but that would change test titles in an audited file, so it is not done here.

## 5. Results by mode (Node 22.22.0, repo fixtures present unless noted)

| Run | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|
| Requirement file, unset | 0 | 0 | 18 | All labelled, gate off |
| Requirement file, `retrievable` | 12 | 0 | 6 | The 6 labels are the superseded PDFs |
| Requirement file, `1` | 18 | 0 | 0 | All 17 pins plus the folder check |
| Gate (`assertFixtureGate.mjs`), `retrievable` | 12 | 0 | 6 | exit 0 |
| Gate, `1` | 18 | 0 | 0 | exit 0 |
| Fixture-dependent files (16), `retrievable` | 611 | 0 | 6 | the 6 are the labelled superseded PDF checks |
| Fixture-dependent files (16), `1` | 617 | 0 | 0 | all 38 PDF-dependent tests executed |
| Fixture-dependent files, superseded PDFs absent, `retrievable` | 573 | 0 | 44 | 38 file-presence skips + 6 labelled |
| Fixtures absent, default | 440 | 0 | 177 | expected |
| Fixtures absent, `1` | 440 | 18 | 159 | fails closed (intended) |
| Fixtures absent, `retrievable` | 440 | 12 | 165 | fails closed (intended) |
| Corrupted fixtures, default | 591 | 8 | 18 | real-artifact hash checks fail (intended) |
| Corrupted fixtures, `retrievable` | 601 | 10 | 6 | fails closed (intended) |

## 6. Checksum verification

`scripts/official-forms/verify.mjs` on repo fixtures:
- Historical manifest: 11 of 11 match SHA-256 and size.
- Current manifest: 6 of 6 match SHA-256 and size.
- Retrievable subset without the superseded PDFs: 5 of 5 DOCX match. The 6 superseded PDFs are reported `MISSING`, as expected.
