# SonarQube (SonarCloud) Register

Project: `bettertimesahead475-commits_ontario-parent-cyfsa-navigator1` (public, SonarCloud automatic analysis, free).
Data is read through SonarCloud's public read-only API. Per-issue inventory: `engineering/sonar/FINDINGS.md`
(regenerate with `node scripts/sonar-register.mjs <download-dir> <main-sha> <active-sha>`).

## 1. Baseline (2026-11-25)

The report supplied to us (28 security / 197 reliability / 34 maintainability, gate not computed) is the analysis of
`main` at `e2bbc76f`. **`main` is not the production code**: production (Pages branch
`migration/cloudflare-staging-20261029`) and `engineering/integration` are 386 commits ahead of it.

The correct baseline is SonarCloud's analysis of **PR #115** (`migration/cloudflare-staging-20261029` → `main`), which
SonarCloud re-analyses automatically on every push. At commit `be46ad7` (= production deployment `7c144cf7`):

| Measure (PR #115, new code vs main) | Value | Gate threshold | Status |
|---|---|---|---|
| Issues | 81 (15 bugs, 10 vulnerabilities, 56 code smells) | — | — |
| New reliability rating | D (4) | A | ERROR |
| New security rating | C (3) | A | ERROR |
| New maintainability rating | A | A | OK |
| New duplicated lines | 12.6 % | ≤ 3 % | ERROR |
| Security hotspots reviewed | 100 % (0 hotspots) | 100 % | OK |
| Coverage | not reported (automatic analysis cannot import coverage) | — | see §4 |

Main-branch issues on unchanged code are not part of a PR analysis, so they were matched against production:
212 of main's 227 issues still have their flagged line in production (14 are in deleted files, 1 line changed).
**Active inventory: 293 findings** (81 + 212).

## 2. Triage and status

Owner per `FILE_OWNERSHIP.md` (frontend `src/**` → Antigravity; everything else → Claude).

| Group | Count | Exposure | Owner | Status / evidence |
|---|---|---|---|---|
| S6505 CI lifecycle scripts / npx on-demand installs | 12 vuln | CI supply chain | Claude | **Fixed** 1f96186: `npm ci --ignore-scripts`, `npx --no-install` (pinned local tools; removed unpinned `wrangler@4` fetch). Clean `--ignore-scripts` install verified: build, tsc, 4,296 tests |
| S8689 / S8707 check-staging-results.mjs | 3 vuln | CI script | Claude | **Fixed** 1f96186: log values neutralised (workflow-command injection), report path confined. Verified with injected title and traversal path |
| S8703 / S5145 testDeployedPreviewLiveClaude.ts | 10 vuln | dev script | Claude | **Fixed** 1f96186: removed (unreferenced, targeted a decommissioned Vercel preview, paid inference) |
| S5145 / S2245 / S9383 api/_server.ts | 5 | legacy Express (not deployed) | Claude | **Fixed** d277a54 (no file names in logs, sanitised MIME, crypto.randomUUID, startup rejection handled) |
| S5728 api/_server.ts helmet CSP | 1 | legacy Express | Claude | **Accepted, documented**: production CSP is `public/_headers` (enforced, verified live); Express is not deployed |
| S2245 PricingTab.tsx Math.random | 1 | production frontend | Antigravity | Open (T-20) |
| S2871 sort without comparator | 22 | production/shared | Claude 21, Antigravity 1 | **Fixed (21)** 1f96186: explicit code-unit comparator; order intentionally unchanged (locale-independent fingerprints); `src/data/formRegistry.ts` open (T-20) |
| S7773 global NaN/isNaN/parseInt | 28 | production/shared | Claude 27, Antigravity 1 | **Fixed (27)** 1f96186 (every isNaN argument already numeric) |
| S8786 super-linear regex (ReDoS) | 63 | untrusted document & model text | Claude 54, Antigravity 9 | **In progress**: 54 backend in branch `engineering/claude-sonar-regex` (per-regex behaviour-pinning + adversarial timing tests); 9 frontend open (T-20) |
| S6544 Promise in condition | 3 | production analyzer | Claude | **Fixed** 5122f39 (explicit null checks; existence checks, no defect) |
| S3516 always-same return | 2 | legacy admin | Claude | **Fixed** 5122f39 (reported success without a database; now 503) |
| S1313 hard-coded IPs | 6 | SSRF blocklist | Claude | **Reviewed**: intended blocklist; review found a real gap (fe80::/10 matched only fe80) — **fixed** 5122f39 with test |
| S3923 identical branches | 1 | form map | Claude | **No change**: frozen, hash-checked artifact; value intentional |
| S4822 / S7688 | 2 | pdf polyfill / test script | Claude | **Fixed** d277a54 |
| S8625 PowerShell shadows cmdlets | 3 | offline test harness | Claude | **False positive, documented**: the shadowing *is* the offline test double (no network in tests) |
| S7739 / S7737 test support | 2 | tests | Claude | Open (low) |
| S6853 / S6848 / S9011 accessibility | 89 | production frontend | Antigravity | Open (T-20) |
| S9383 floating promises (frontend, sw.js) | ~35 | production frontend | Antigravity | Open (T-20) |
| other frontend smells (S6439, S6671, S5850, S4822) | 4 | production frontend | Antigravity | Open (T-20) |

## 3. Duplication (new code 12.6 %)

Largest contributors (PR #115): `shared/legalVerificationPipeline.ts` 1,931 of 3,061 new lines — entirely
**self-duplication** in the verified-authority registry (every entry repeats instrument, title, source URL,
consolidation period, dates). Plan: per-instrument entry factories, with a deep-equality proof that the generated
registry is identical (after the regex branch merges, to avoid concurrent edits). Then `src/utils/statuteReference.ts`
(Antigravity), `shared/casAccountabilityLibrary.ts`, test files and candidate SQL copies under `scripts/sql/`
(copies of migrations used by regression scripts).

## 4. Coverage

SonarCloud automatic analysis does not import coverage. Measured locally with `@vitest/coverage-v8` (see §6).

## 5. Rules for this work

No suppressions (`NOSONAR`), no exclusions of active production code, no metric manipulation. Frozen, hash-checked
artifacts are not edited. Behaviour-preserving changes are proven by tests that fail on the previous code where a
defect existed. Production deploys of these changes require owner approval (directive 2026-11-25).

## 6. Verification log

| Date | Commit | Evidence |
|---|---|---|
| 2026-11-25 | 1f96186, 5122f39, d277a54 | full suite 4,298 passed / 0 failed; tsc clean; new regression tests verified failing on previous code (S1313 link-local) |
