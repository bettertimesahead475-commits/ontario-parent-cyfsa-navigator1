# Devin phase three — independent release qualification (2026-11-26)

Candidate assessed: `engineering/integration` @ `eaca5cf`. Branch: `engineering/devin-release-qualification`.
Statuses follow `RELEASE_ACCEPTANCE_FRAMEWORK.md` (only `VERIFIED` / `FAILED` / `BLOCKED` / `NOT TESTED`).
No production deployment, production database change, migration execution, paid inference or real customer data.

## 1. Baseline runs on `eaca5cf`

| Run | Result |
|---|---|
| `npm ci`, Node 22 | succeeded |
| `npx tsc --noEmit -p .` | exit 0 |
| Full vitest | 291 files passed, 13 skipped; 4,505 tests passed, 478 skipped |
| PostgreSQL suites on a disposable local PostgreSQL 14 cluster | 11 files, 370 tests passed (all normally skipped in CI) |
| `npm audit` | 0 vulnerabilities |

Changes reviewed since phase two: `00b6b43`, `0b5bcfc`, `846e90a`, `1ad0bc4`, `847c4e0`, `5993153`, `b8ca20a`, `b5e0d13`,
`b009b4c`, `8606a0b`, `de95991`, `88ac7be`, `eaca5cf`. No conflicting duplicate implementations found except §3 F-2.

## 2. Release-readiness assessment

| Area | Status | Evidence / reason |
|---|---|---|
| Architecture | VERIFIED | Single Pages Functions API + queue worker; ownership boundaries and contracts match code; all suites pass on `eaca5cf`. |
| Backend engineering | FAILED | DEVIN-P3-01 reproduced on `eaca5cf` (fix in [PR #139](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/139), unmerged). |
| Frontend integration | NOT TESTED | Antigravity-owned; no browser-driven run in this phase. |
| Analyzer accuracy — deterministic guards | FAILED | DEVIN-P3-01. Everything else in the adversarial corpus (§4) holds. |
| Analyzer accuracy — live model output | BLOCKED | Needs paid inference (budget in `TEST_REGISTER.md`). |
| Legal verification | VERIFIED (deterministic) | Fabricated, wrong-Act, repealed, malformed and not-yet-in-force citations never verified (§4). Final Case Assessment validates source provenance only, not quotes/citations inside point text — observation O-1. |
| Cybersecurity | VERIFIED (mocked + mutation) / BLOCKED (live) | Create-once id claim, fail-closed ownership, JWKS caching/503, access-code ownership: mutations P01–P04, P10–P12 killed. Persistent rate limiting and live RLS: BLOCKED (deployed store / production data). |
| Database integrity | FAILED (pending migration) | PG suites pass locally; pending `create_navigator_page_evidence_foundation.sql` disagrees with the integrated TypeScript verifier (F-2). Not applied anywhere. |
| Financial integrity | VERIFIED (mocked + local PG) / BLOCKED (live) | Truncated audit → 503; nullable totals; shared references flagged; mutations P05–P08 killed. Live purchase/refund (COM-1): BLOCKED. |
| Infrastructure reliability | VERIFIED (mocked) / BLOCKED (alerting) | Stale `running` → `timed_out` (P09 killed); worker lease (phase-two M18). Alert delivery needs the deployed integration. |
| Performance | NOT TESTED | No load run; `PERFORMANCE_BASELINE.md` unchanged. Large-document quote search bounded (§4). |
| Scalability | NOT TESTED | No concurrent-user load run permitted without paid/live resources. |
| Maintainability | NOT TESTED | SonarCloud gate not re-run on `eaca5cf` (direct pushes have no PR analysis). |
| Automated test effectiveness | VERIFIED after this branch | 16 targeted mutations: 15 killed on `eaca5cf`; P14 survived and is killed by `tests/devin/final-case-assessment-sources.test.ts`. |
| Commercial readiness | BLOCKED | COM-1 live end-to-end purchase needs staging payment and owner approval. |

Gate decision (framework §2): **not promotable as `eaca5cf`** — DEVIN-P3-01 is `FAILED` until PR #139 or an equivalent fix is integrated.

## 3. Findings

### F-1 DEVIN-P3-01 — a second-review verdict could delete a different, verified finding (medium; fixed in PR #139)
- Reproduction (`eaca5cf`): two red flags, both quotes located `EXACT`; ids `["rf1","rf1"]` (model repeat) or
  `["rf2", <none → default rf2>]`. Verifier returns `UNSUPPORTED` for the second. Result: `redFlags=[]`, both removed.
- Root cause: `validateRedFlags` kept model ids without de-duplication; `mergeVerification` matches verdicts by id.
- Production exposure: any Quick Review / Forensic Deep Scan where the model repeats an id; a CRITICAL verbatim finding can disappear silently.
- Regression: `tests/devin/verification-finding-identity.test.ts` (3 of 4 fail before, 4 pass after). Mutations P15/P16 killed.

### F-2 Pending SQL quote counter disagrees with the integrated TypeScript verifier (medium if applied; not applied)
- `supabase/migrations_pending_approval/create_navigator_page_evidence_foundation.sql` `navigator_quote_hits` uses raw `strpos`.
  On local PostgreSQL 14: `"true that he struck"` in `"It is untrue that he struck the child."` → 1; `"She can"` in `"She can't attend."` → 1;
  one standalone + one inside-word occurrence → 2. The TypeScript verifier (`b5e0d13`) returns absent, absent, 1.
- Effect if applied: inside-word quotes counted as found in SQL, and valid unique quotes rejected as ambiguous.
- Owner: Claude (`supabase/**`). Not corrected here; the SQL must mirror the word-boundary and contraction rules before approval.

### O-1 Final Case Assessment point text is not quote/citation-verified (observation, design decision)
`validateAssessment` requires each point to cite loaded source ids, but statutory citations or quotations inside
the point text are not passed through `guardCitation`/`locateQuote`. Recorded for Claude; no change made.

### O-2 Abandoned direct-path placeholder (T-27, already recorded by Claude)
A claim written before a later session/entitlement refusal stays `running`; readers see `timed_out` after
`RUNNING_JOB_STALE_MS` (5 min) and the same owner can re-claim. No charge occurs. Confirmed, not duplicated.

## 4. Adversarial corpus (`tests/devin/adversarial-corpus.test.ts`, 21 cases with the FCA file)
Conflicting affidavits (both sides locatable, merged "admission" absent), incorrect date, duplicate evidence
(ambiguous, not CRITICAL), missing page, page gap, corrupted/empty documents, misleading heading with an unlocated
allegation (not CRITICAL, not corroborated), 20,000-line document (<2 s), fabricated section/clause, wrong Act,
repealed CFSA, provision cited before coming into force, prompt-injection document delimiters. All hold on `eaca5cf`.
Earlier corpora: `eval/analyzer-guards`, `tests/devin/dataset.ts` (phase two).

## 5. Mutation catalogue P01–P16 (harness kept outside the repo; each mutation restored by `git checkout`)

| Id | Mutation | Result on `eaca5cf` |
|---|---|---|
| P01 | claim `x-upsert: true` (overwrite) | killed |
| P02 | another owner's record treated as claimed | killed |
| P03 | direct-path claim refusal ignored | killed |
| P04 | queued-path claim refusal ignored | killed |
| P05 | truncated audit used for refund/settlement | killed |
| P06 | non-audit entries make cut-off listing look complete | killed |
| P07 | settlement totals shown when incomplete/shared | killed |
| P08 | totals shown from truncated payments | killed |
| P09 | stale running job never times out | killed |
| P10 | unknown-`kid` refetch not rate-limited | killed |
| P11 | legacy code redeemable without payment reference | killed |
| P12 | legacy code redeemable by another account | killed |
| P13 | analysis ids from `Math.random` | killed |
| P14 | FCA point may cite an unloaded page | **survived** → killed by new test |
| P15 | duplicate finding ids kept | killed (with PR #139 test) |
| P16 | shared-id verdict applied to several findings | killed (with PR #139 test) |

## 6. Pending migration review (not executed)
- `payments_reference_number_unique.sql`: read-only duplicate pre-check, partial unique index `CONCURRENTLY`, separate rollback; must run outside a transaction as its own statement. No defect found.
- `reconcile_skip_live_analyzer_jobs.sql`: `NOT EXISTS` guard for queued/running jobs updated in the last 2 h; transaction-wrapped function replacement plus separate concurrent index. Safe only after comparing with the live function definition and grants (file says so). A job running longer than 2 h without a heartbeat would lose its guard — acceptable given the worker deadline, recorded for Claude.
- `create_navigator_page_evidence_foundation.sql`: F-2.

## 7. Skipped tests
| Group | Files | Why skipped | Classification |
|---|---|---|---|
| PostgreSQL | 11 `*.pg.test.ts` | need a PostgreSQL URL | VERIFIED locally (370 pass) — CI never runs them; add a CI PostgreSQL service (Claude). |
| Official-form real artifacts | form 8B/14A/33C/35.1A field maps, `docxFieldInventoryRealArtifacts`, `officialFormRealArtifactIntegration` | licensed DOCX files not in the repo | BLOCKED (artifacts); synthetic-map tests in the same files run. |
| Staging credit | `creditStaging.test.ts` | staging Supabase credentials | BLOCKED (would touch staging; not permitted here). |

## 8. SonarCloud / CodeRabbit
Integrated commits since phase two were pushed directly, so no PR-level SonarCloud or CodeRabbit analysis exists for them;
findings on PRs #137/#138 were reproduced and resolved there. Status: NOT TESTED for `eaca5cf`.
