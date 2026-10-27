# Official-form fixtures: CI activation readiness

Status: 2026-10-27, draft branch `draft/official-forms-audit`. Recommendation: **NOT READY FOR CI ACTIVATION** (section 5).
Nothing here is active. `.github/workflows/ci.yml` is unchanged.

Labels: **[V]** verified by this project, with the evidence named. **[C]** a legal question for counsel. Nothing marked [C]
is a finding of this project, and this document does not claim that temporary CI copies are exempt from copyright terms.

## 1. What was verified [V]

| Item | Evidence |
|---|---|
| All 17 pins (11 historical, 6 current) are byte-identical to commit `739c8646` | `diff` of both manifests against `739c8646` |
| The 11 retrievable entries are the 5 historical DOCX and the 6 current PDFs; the 6 superseded historical PDFs are not retrievable | `api/services/officialFormDownloader.test.ts`, manifest-shape tests |
| GitHub-hosted runner can download and verify all 11 | Run `40499435116` (workflow `Official-form connectivity check (temporary)`, commit `c7dab049`, `ubuntu-latest`, Node 22): `PASS` for all 11, `{"ok":true,"written":11,"rows":11,"counts":{"PASS":11}}`, conclusion `success` |
| Downloader tests | 60 passed, 0 failed (`officialFormDownloader.test.ts`) |
| No fixture binary is tracked | `git ls-files fixtures` returns 0 files |

Connectivity result scope: one successful run on GitHub-hosted `ubuntu-latest`. It shows the official host and the pinned paths were reachable and served the pinned bytes on that date. It does not show the official site will stay reachable.

## 2. Defects found in review and fixed [V]

Each fix has a regression test in `officialFormDownloader.test.ts` (the "Phase 1 regressions" block).

1. **Partial stage write left a file behind.** The stage path was recorded after the write, so a write that failed midway was not cleaned up. Fix: record before writing. Test: `removes a partially written staged file...`.
2. **An interrupted install could be silently continued.** A crash between the backup step and the swap leaves a `.backup` file and possibly no destination. Fix: the downloader refuses to start while `.stage-` or `.backup-` files exist, and says how to restore. Test: `refuses to start when an interrupted install left...`. Plus a test that ordinary names are not flagged.
3. **A 200 response with no body was reported as CHANGED_UPSTREAM**, which would tell the operator the government changed a form when the connection had actually failed. Fix: `PARTIAL_DOWNLOAD`. Test: `reports PARTIAL_DOWNLOAD, not a changed source...`.
4. **A compressed response could be compared on the wrong length.** Node decodes gzip, so a declared (compressed) length would not match the decoded bytes, producing a false truncation. Fix: request `accept-encoding: identity` and refuse any other encoding. Tests: `asks for identity encoding...` and `refuses a compressed response...`.
5. **Programming errors were reported as network errors.** Fix: only `DownloadError` is a download outcome; anything else is rethrown. Covered by the existing failure-class tests.

Backup-failure rollback (a failure moving the first or second existing file to its backup) was tested and already behaved correctly. Those two tests were added as regression coverage, not as fixes.

## 3. Known limits, stated plainly [V]

- **Crash or power loss mid-install is not rolled back automatically.** Nothing is journaled. Rollback covers failures the process can observe (write, rename, remove). If the process dies between moving a destination to its backup and placing the new file, the destination is missing until someone restores it from the `.backup` file. The next run refuses to start until that is done (fix 2).
- **Rollback can itself fail.** The result then reports `rolledBack: false` and names the files. The downloader does not retry it.
- **Upstream truncation without a declared length is ambiguous.** If the server closes a connection cleanly with fewer bytes than the real file and sends no Content-Length, the bytes fail the pin and are reported as CHANGED_UPSTREAM rather than PARTIAL_DOWNLOAD. The result is fail-closed, but the label can be wrong.
- **Total time is not capped.** Each request has a 60 s timeout and up to 3 attempts, so one file can take up to about 3 minutes, and 11 files up to about 33 minutes. The proposed job's 30-minute `timeout-minutes` bounds it in CI.
- **Hosted-runner reachability was tested once.** It is not a guarantee.

## 4. CI design (proposed, not active) [V]

File: `docs/ci/ci.workflow.proposed.yml`. The changes from the current `ci.yml`:
- Adds `permissions: contents: read`. The current file has no `permissions` block, so it inherits the repository default token scope.
- Adds `persist-credentials: false` to checkout.
- Adds a separate `official-forms` job. It downloads and verifies the 11 files, then runs `npm test` with `REQUIRE_OFFICIAL_FORMS_FIXTURES=retrievable`.
- Keeps the existing `test` job unchanged in behaviour, so an official-site outage cannot fail it.

Why a separate job: the official site becomes a dependency of that one job only. The alternative (one job with the download step) makes every PR depend on an external site.

Artifact, cache, and log exposure review [V unless marked]:
- **Artifacts:** none uploaded by the proposed workflow. The temporary check uploads none.
- **Caches:** `setup-node` caches the npm package cache only. No fixture path is cached.
- **Logs:** the downloader prints statuses and file names only. The `--report` JSON holds statuses, attempt counts, and SHA-256 values, never file content. A grep of the test files for whole-buffer assertions found none.
- **Fork pull requests:** the job needs no secret and reads only public URLs. Fork PRs receive a read-only token.
- **Residual risk [V, by design]:** the downloaded bytes exist on the hosted runner's disk for the duration of the job, in `$RUNNER_TEMP` or the checkout's `fixtures/`. Nothing uploads them. Hosted runners are ephemeral by design. This document does not verify GitHub's retention behaviour.
- **Future risk:** a test that later prints a fixture's contents in a failure message would put them in logs. Keep assertions to lengths and hashes.

## 5. Recommendation: NOT READY FOR CI ACTIVATION

Engineering is in good shape: the downloader is tested, the defects above are fixed, and hosted-runner connectivity was observed. These items block activation:

1. **[C] Counsel review of the temporary-copy question** (`OFFICIAL_FORMS_SOURCE_DECISION.md` section 1.2). Downloading to a CI runner may or may not be a permitted reproduction under the Ontario terms. This project has not decided it and does not claim an exemption. Owner decision.
2. **Independent human code review** of `fetch-official.mjs` and its tests. This session cannot provide an independent reviewer.
3. **CODEOWNERS or required review** for `scripts/official-forms/**` and `.github/workflows/**`, so a pull request cannot change a pin, a URL, or the workflow without review. This needs repository settings.
4. **Owner approval** to change `.github/workflows/ci.yml` (or to add the separate job). Production CI is not changed without it.
5. **Remove the temporary connectivity workflow** from the branch before merge. It stays only as evidence of the run above.

Once items 1 to 4 are done, the proposed file can be copied into `.github/workflows/ci.yml` in a reviewed pull request, after confirming the `official-forms` job passes on that branch.
