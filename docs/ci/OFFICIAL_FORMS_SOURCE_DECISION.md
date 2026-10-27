# Official-form fixtures: distribution decision and CI design

Status: decision record, revised 2026-10-27. Draft branch only. No workflow is active, no fixture binary is published or
committed, and no infrastructure was created.

Labels used throughout:
- **[V] Verified**: checked by this project directly (a command, a test, or a fetch on the date shown).
- **[Q] Quoted**: wording taken from a published source. The quote is what the source says. It is not a legal conclusion.
- **[C] Counsel question**: an open interpretation. No conclusion is drawn here. Counsel must decide it.

Nothing marked [C] is a finding of this project. In particular, this record does not claim that a temporary download
during CI is exempt from the published terms.

## 1. Evidence

### 1.1 [V] The 17 fixtures contain no personal or case data
- Form fields (all 17 PDFs, 501 widgets per set): the only non-empty values are unchecked-checkbox states (`Off`) and
  two template strings, `Name of court` and `1.`. No case, party, or personal value is present.
- DOCX text-field defaults are `0` (checkboxes unchecked).
- Limit: values were checked by machine. Printed page text was not reviewed line by line.
- [V] DOCX `creator` and `lastModifiedBy` metadata name individual Ministry staff. The metadata is part of the official
  bytes and of the pinned SHA-256 values, so it cannot be stripped without breaking the pins.

### 1.2 Published terms
[Q] Source: `https://www.ontario.ca/page/copyright-information`, read 2026-10-27. Quoted in substance:
- "Unless otherwise indicated, the materials on this website are protected by Crown copyright, which is held by the
  King's Printer for Ontario."
- "If credit is given and Crown copyright is acknowledged, the materials may be reproduced for non-commercial purposes
  if no changes are made to the original content."
- "The materials may only be reproduced for commercial purposes under a licence from the King's Printer, with the
  exception of Government of Ontario legal materials (statutes, regulations and judicial decisions) and materials
  covered under the Open Government Licence – Ontario."
- The same page names a route for requesting a licence for commercial reproduction.

[V] The court-forms index (`https://ontariocourtforms.on.ca/en/family-law-rules-forms/`), read 2026-10-27, contains no
"Open Government" text. The forms are not statutes, regulations, or judicial decisions.

[C] Questions for counsel:
1. Whether these court forms, as published on that site, fall under Crown copyright as the Ontario page describes, and
   whether any notice on the court-forms site changes that.
2. Whether a copy made by a CI runner for automated testing is a "reproduction" under those terms.
3. Whether a copy that is never published and is deleted at the end of the run is "commercial" reproduction, given that
   CYFSA Navigator is a commercial product.
4. Whether any use of these files in the product, including the form-field analysis, needs a licence.
5. Whether a licence from the King's Printer is needed for any stored or commercial copy, and what it would cost.

Earlier drafts of this record said the approach was "consistent with the terms". That was too strong and is withdrawn.

### 1.3 [V] Whether the official site serves the same bytes (direct HTTP fetch, 2026-10-27)

| Set | Files | Served by the official site today | Pinned SHA-256 matches |
|---|---|---|---|
| Current PDFs | 6 | all six, HTTP 200 | 6 of 6 |
| Historical DOCX | 5 | all five, HTTP 200 | 5 of 5 |
| Historical PDFs | 6 | the same URLs serve different bytes | 0 of 6 (superseded) |

The six historical PDFs cannot be obtained from the official source. Their pinned bytes are superseded versions, and the
owner recorded their origin. No official source serves them now.

### 1.4 [V] Test-suite effect of each set (measured earlier on this branch, before the downloader tests were added)
- All fixtures present: 489 passed, 18 skipped. The 18 skips are the requirement tests, which are off by default.
- Only the 5 DOCX and 6 current PDFs present: 451 passed, 56 skipped. The 38 extra skips are the historical
  PDF-dependent tests.

The current totals for every verification mode are in `docs/review/OFFICIAL_FORMS_RETRIEVAL_AUDIT.md`, section 12.

## 2. Options evaluated

| Option | Stores or publishes a copy? | Relevant question | Complexity | Verdict |
|---|---|---|---|---|
| Public GitHub release asset | Yes, public distribution | [C] Q1, Q4, Q5 | Low | Rejected: publishing needs counsel's view first |
| Private GCS bucket with OIDC | Yes, stored copy | [C] Q1, Q4, Q5 | High (cloud project, IAM, environment) | Rejected for these files |
| Actions cache or artifacts | Yes, stored copy | [C] Q1, Q4, Q5 | Low, but weak access control on a public repository | Rejected |
| Run-time fetch from the official source, verified against pinned SHA-256 and length | Temporary copy in the run only | [C] Q2, Q3 | Low | Proposed. Counsel must decide whether the temporary copy is permitted before it is enabled |
| King's Printer licence | Would cover a stored or commercial copy | [C] Q5 | Business and legal process | Owner decision |

## 3. Recommendation

Fetch the 11 retrievable files from the official source in CI, verify each one against its pinned SHA-256 and byte length
before any test runs, and keep the six superseded historical PDFs local-only.

What this design does and does not do:
- [V] It stores and publishes no copy beyond the run. Nothing is cached or uploaded. `fixtures/` is gitignored, and no
  fixture binary is tracked in git.
- [C] It does **not** establish that the temporary run copy is permitted. That is counsel's question (section 1.2, Q2
  and Q3). Until counsel answers, the workflow stays inactive.
- [V] It needs no secret, no cloud identity, and no environment.
- [V] It is fail-closed: any byte change is a hard failure, and the pins are the control.
- [V] It covers 451 of the 507 tests on the measured branch state. The 38 superseded-PDF tests cannot be supplied from any
  current source.

## 4. Implementation status (draft branch, not activated)

| Item | Status |
|---|---|
| `scripts/official-forms/manifest.json`: `retrievable` on every entry, `sourceUrl` on the 5 DOCX entries | [V] Done. No `sha256` or `byteLength` changed |
| `scripts/official-forms/fetch-official.mjs`: HTTPS only, host allowlist, path prefix, every redirect refused, 10 MB cap, 60 s timeout, 3 attempts, staged install with rollback | [V] Done. Unit tests cover each refusal (`api/services/officialFormDownloader.test.ts`, 52 tests) |
| Pins are never updated automatically; a changed upstream file is reported as `CHANGED_UPSTREAM` and nothing is installed | [V] Done and tested |
| `REQUIRE_OFFICIAL_FORMS_FIXTURES=retrievable` checks only the 11 retrievable entries; `=1` checks all 17 | [V] Done and tested |
| `docs/ci/official-forms-fetch.workflow.template.yml` | [V] Template only. It sits outside `.github/workflows` and is not active |
| Reachability of `ontariocourtforms.on.ca` from GitHub-hosted runners | [V] Not tested. Only tested through this session's sandbox proxy |
| Counsel review of section 1.2 | [C] Open |
| CODEOWNERS review rule for `scripts/official-forms/**` | Not added. Owner decision |

## 5. Security and maintenance

- Third-party dependency: a site outage fails CI. Bounded retries and a plain-language message make the failure clear. An
  outage never weakens integrity.
- Pins are the integrity control. Whoever can change `manifest.json` can change the expected hash. Mitigation: a
  required review on `scripts/official-forms/**` before the workflow is enabled.
- Form revisions: when the government changes a form, the hash differs and the run reports `CHANGED_UPSTREAM`. The
  maintainer reviews the new file and updates the pin by hand. The downloader never updates a pin.
- Pull requests, including forks, can run the fetch step once the workflow is enabled. Any PR can already run arbitrary
  test code, so the fetch adds no new exposure. The workflow must keep `permissions: contents: read` and no secrets.

## 6. Limits of this evidence
- Reachability from GitHub-hosted runners is untested (section 4).
- The Ontario terms reading is a summary of the published pages on the date above. Counsel must confirm it.
- The historical PDFs' origin is recorded by the owner, not by an official source.
