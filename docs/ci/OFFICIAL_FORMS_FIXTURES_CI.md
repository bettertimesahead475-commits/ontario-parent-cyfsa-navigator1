# Providing the historical official-form fixtures to CI (design, not enabled)

Status: proposal. No workflow is enabled, no secret is added, and no fixture is committed. Needs a separate review before any step below is turned on.

## 1. What CI runs today

- `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It runs `npm ci`, `npm run lint`, `npm test`, and `npm run build`.
- It does not set `OFFICIAL_FORMS_DIR` or provide any fixture. Every historical real-artifact test therefore skips in CI.
- It does not configure PostgreSQL, so the 9 PostgreSQL-gated files skip there too.
- Measured at CI commit `d0b0d8a6` (3,614 passed, 0 failed, 523 skipped). Historical real-artifact coverage in CI is zero.

## 2. Options evaluated

| Option | Keeps binaries out of git | Access control | New secret | Verdict |
|---|---|---|---|---|
| A. Release asset on this repository, downloaded with the job's `GITHUB_TOKEN` (read-only) | yes | repository read access; the release is not public if the repository is private | no | Recommended. Needs the owner to create the release, and the repository's visibility must be confirmed first |
| B. Actions cache | yes | not tied to a reviewed approval; can be overwritten by a branch that can run workflows | no | Rejected |
| C. Commit the binaries to the repository | no | repository | no | Rejected (not permitted) |
| D. Private cloud bucket with OIDC federation | yes | bucket IAM | no static secret, but cloud setup needed | Viable later. Needs infrastructure approval |
| E. Manual, environment-protected job (like `staging-credit-verification.yml`) | depends on A or D | environment reviewers | depends | Recommended as the way to run it |

Recommended combination: A used through E. The job runs only on manual dispatch, after a reviewer approves the protected environment.

## 3. Fail-closed behaviour required

1. The download step fails if the release asset is missing.
2. `scripts/official-forms/verify.mjs` fails if any file's SHA-256 or length differs from `manifest.json`. A file is never accepted by name alone.
3. `REQUIRE_OFFICIAL_FORMS_FIXTURES=1` is set for the test step, so `api/services/officialFormFixtureRequirement.test.ts` runs. A missing or altered fixture fails the run instead of skipping.
4. The job never runs on pull requests, and it does not run with any secret.

## 4. Example workflow (NOT ACTIVE; kept as text, not in `.github/workflows/`)

```yaml
name: Official-form fixtures (protected, manual)
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  historical-fixtures:
    runs-on: ubuntu-latest
    environment: official-forms-fixtures   # reviewers required; created by the owner
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - name: Download the fixture release asset (fail closed)
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          gh release download official-forms-historical-v1 \
            --pattern official-forms-historical.zip --dir "$RUNNER_TEMP"
          python3 -c "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); \
            assert all('/' not in n and '..' not in n for n in z.namelist()), 'unsafe path'; \
            z.extractall(sys.argv[2])" "$RUNNER_TEMP/official-forms-historical.zip" fixtures/official-forms
      - name: Verify SHA-256 and length against the committed pins (fail closed)
        run: node scripts/official-forms/verify.mjs fixtures/official-forms
      - name: Test with fixtures required
        env:
          REQUIRE_OFFICIAL_FORMS_FIXTURES: "1"
        run: npm test
```

## 5. Remaining limitations after this design

- Pull-request CI still does not run the historical tests. Only the protected manual job does.
- The release asset does not exist yet. The owner must create it from the verified bytes. This session cannot create it.
- Repository visibility could not be confirmed from this session. The GitHub API rejects the environment and release calls it would need. If the repository is public, option A publishes the fixture PDFs, which are public government forms, but the owner must accept that.
- PostgreSQL suites and staging scenarios still need their own CI plan.
