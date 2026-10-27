> **Superseded in part.** The current design is in `docs/ci/OFFICIAL_FORMS_SOURCE_DECISION.md` (fetch from the official source; no storage). The cloud-bucket option below is no longer recommended.

# CI provisioning of the official-form fixtures (design, not enabled)

Status: design and an inactive template. Nothing is enabled, no secret or variable is created, no fixture is uploaded or committed. Sections 6 and 7 list the owner actions required.

## 1. Verified repository facts (this session)

- `GET /repos/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1` returns `private: false, visibility: "public"`. The repository is **public**.
- The Actions permissions endpoint and the environments and releases endpoints return HTTP 403 through this session's proxy. The GitHub connector failed to connect. So this session cannot read Actions settings, environments, or branch-protection rules. Their state is unknown here and must be checked in the GitHub settings UI by the owner.
- `.github/workflows/ci.yml` runs `npm test` on pull requests and on pushes to `main`. It provides no fixtures and no PostgreSQL. Historical real-artifact coverage in that CI is zero.

## 2. Consequence of the repository being public

- A GitHub release asset on this repository is publicly downloadable. It is not an access-controlled source. **The release-asset option in the earlier draft of this document is withdrawn.**
- Workflow artifacts of a public repository are also not access-controlled, so the design must not pass fixtures between jobs as artifacts.
- Fixtures must therefore come from storage with its own access control, read by the workflow with a short-lived identity.

## 3. Options

| Option | Access control | Stored secret | Verdict |
|---|---|---|---|
| Release asset on this public repository | none (public) | no | Rejected |
| Actions cache | not reviewed; writable by runs | no | Rejected |
| Commit binaries | public | no | Rejected |
| Actions secret holding the archive | secret store | yes; 48 KB limit is below the ~2 MB archive | Rejected |
| Private Google Cloud Storage bucket, read through Workload Identity Federation (OIDC) | bucket IAM, restricted to one service account, one repository, one environment | no (OIDC, no key) | **Recommended** |
| Private repository holding fixtures, read by a deploy key or GitHub App token | repository access | yes | Viable, but needs a stored credential; not recommended |

Recommended: a private bucket, one reader service account with `roles/storage.objectViewer` on the bucket only, and a Workload Identity Federation provider whose attribute condition is limited to this repository and the `official-forms-fixtures` environment.

## 4. Fail-closed chain

1. The download copies the two prefixes (`historical/`, `current/`) into empty folders. A missing object is a job failure.
2. `scripts/official-forms/fetch-fixtures.mjs` checks every pinned file in both manifests, by SHA-256 and byte length, before writing anything. Any missing or altered file makes the job fail and writes nothing. The two sets are all-or-nothing (verified by `api/services/officialFormFixtureFetch.test.ts`).
3. `REQUIRE_OFFICIAL_FORMS_FIXTURES=1` runs `api/services/officialFormFixtureRequirement.test.ts`, which re-checks every pin. A skip cannot pass silently in this job.
4. `persist-credentials: false` keeps the repository token out of the checkout.

## 5. Residual risks (stated, not hidden)

- **Code runs with the cloud identity.** After the auth step, `npm test` runs repository code with a token that can read the bucket. This is why the environment must restrict deployment to `main` and require reviewers. Anyone who can change `main` controls what runs. The job must not be triggered on a branch.
- Pull-request CI does not run the historical tests. The protected job runs them only when a reviewer dispatches it.
- The fixture contents are public government forms, but the owner chose a private store; that choice does not make the content confidential.

## 6. Owner actions required before enabling (not performed here)

1. Confirm the GitHub settings: repository visibility (public, per section 1), Actions settings, and the `official-forms-fixtures` environment with required reviewers and "deployment branches: main only".
2. In a Google Cloud project the owner controls: create a private bucket (uniform access, public access prevention enforced); upload `historical/*` (the 11 files verified in this session) and `current/*` (the 6 current PDFs) once; create a reader service account with `storage.objectViewer` on the bucket only; create a Workload Identity pool and provider whose condition limits it to this repository and environment.
3. Set environment variables (not secrets): `OFFICIAL_FORMS_BUCKET`, `OFFICIAL_FORMS_WIF_PROVIDER`, `OFFICIAL_FORMS_READER_SA`.
4. Copy `docs/ci/official-forms-fixtures.workflow.template.yml` to `.github/workflows/official-forms-fixtures.yml` in a reviewed change.
5. Run the workflow once from `main` and confirm the job passes and the historical tests are not skipped.

## 7. What is automated versus what the owner must do

- Automated (done in this change): the verified fetch and install script, its tests, the fixture requirement test, the inactive workflow template, and this design.
- Owner-only: the cloud project, bucket, identities, environment, and variables. These need the owner's authorization and cannot be created from this session.

## 8. Current CI coverage (unchanged by this change)

No change to `ci.yml`. Pull-request CI: historical real-artifact tests skipped; PostgreSQL suites skipped; staging suites skipped.
