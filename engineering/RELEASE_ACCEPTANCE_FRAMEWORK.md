# Release acceptance framework (reusable before every production promotion)

Owner of the framework: independent QA (Devin). Owner of promotion: Claude Code (`RELEASE_CHECKLIST.md`).
This framework decides **whether** a candidate commit on `engineering/integration` may be promoted; `RELEASE_CHECKLIST.md`
describes **how** to promote and roll back. It does not replace `ACCEPTANCE_CRITERIA.md` (feature acceptance).

## 1. Status vocabulary (use only these four)

| Status | Meaning | Evidence required |
|---|---|---|
| `VERIFIED` | The requirement was exercised against the candidate commit and held. | Command, commit SHA, result (counts), and where the log/test lives. |
| `FAILED` | The requirement was exercised and a defect was reproduced. | Reproduction, root cause, severity, production exposure, fail-before test. |
| `BLOCKED` | It cannot be exercised with permitted resources (credentials, paid inference, live data, owner approval). | The named blocker (`BLOCKERS.md` id) and what would unblock it. |
| `NOT TESTED` | It could be exercised but was not in this run. | Why, and the planned owner/run. |

No quality percentages, scores or rankings. A requirement verified only by mocks says so in its evidence column.
A `FAILED` requirement fixed on an unmerged branch stays `FAILED` for the candidate until the fix is on it.

## 2. Gate: promotion is allowed only when

1. No requirement in sections 4.1–4.6 is `FAILED`.
2. Every `BLOCKED` item has an owner-accepted risk entry in `BLOCKERS.md` (the user, not an agent, accepts it).
3. Every `NOT TESTED` item in 4.1–4.6 has been explicitly waived by the user for this release.
4. The candidate SHA in the assessment equals the SHA being promoted (re-run section 3 if anything was pushed).

## 3. Mandatory reproducible runs (record SHA, command, counts)

| # | Run | Command |
|---|---|---|
| R1 | Install from lockfile | `npm ci` (Node from `.nvmrc`) |
| R2 | Type check | `npx tsc --noEmit -p .` |
| R3 | Full unit/integration suite | `NODE_OPTIONS=--no-experimental-webstorage npx vitest run` |
| R4 | PostgreSQL suites against a disposable local cluster (never staging/production) | `CREDIT_PG_URL=… NAVIGATOR_PG_TEST_ADMIN_URL=… NODE_OPTIONS=--no-experimental-webstorage npx vitest run $(ls api/services/*.pg.test.ts api/*.pg.test.ts)` |
| R5 | Dependency audit | `npm audit` |
| R6 | Skipped-test inventory | list every skipped file; each must map to section 6 with a reason. A new unexplained skip is `FAILED`. |
| R7 | Targeted mutation run | re-run the mutation catalogue (section 5); any surviving mutant in a security/financial/ownership check is `FAILED` for "automated test effectiveness". |
| R8 | CI on the candidate | CI, SonarCloud quality gate, CodeRabbit; Vercel checks are known-blocked (`BLOCKERS.md`). |

## 4. Requirements catalogue

### 4.1 Security and ownership
- Analysis ids are generated with `crypto.getRandomValues`; client-supplied ids are claimed create-once (`x-upsert: false`) before any credit is reserved (direct path) or after the ledger job (queued path), and an unconfirmable claim fails closed (503, no charge).
- Stored reports and ledger jobs are readable only by their owner (or an administrator).
- Google signing keys: cached per `max-age`; key-service outage answers 503, never 401; unknown-`kid` refetch rate-limited.
- Access codes: ownership enforced server-side before redemption (email binding + payment reference).
- Paid sessions: revoked, expired, or another user's session refused.
- Admin endpoints: allowlist + verified token; audit entries written for every mutation.
- Persistent rate limiting and alert delivery (`SECURITY_REGISTER.md` S-items) — live check needs the deployed store.

### 4.2 Financial integrity
- One deduction per analysis; reservation released on every failure path; duplicate queue delivery cannot double-charge.
- Refund/suspension refuses when audit history is truncated (503) and never double-refunds.
- Revenue totals are `null`/flagged, never silently understated, when payments are truncated, settlement history incomplete, or a payment reference is shared.
- Pending migrations reviewed (section 7) before any are applied.

### 4.3 Analyzer accuracy (deterministic guards; model quality is separate)
- Quotes: exact, word-bounded, page-aware; absent/ambiguous quotes cannot be CRITICAL or "corroborated".
- Citations: whole-pinpoint parsing; fabricated, wrong-Act, repealed and not-yet-in-force provisions never verified.
- Second-review verdicts apply only to their own finding (DEVIN-P3-01).
- Final Case Assessment points cite only loaded source pages.
- Adversarial corpus (`tests/devin/adversarial-corpus.test.ts`, `eval/analyzer-guards`) passes.

### 4.4 Reliability and recovery
- Abandoned `running` records read as `timed_out` after `RUNNING_JOB_STALE_MS`; retry is offered, no charge.
- Live worker lease prevents duplicate execution; expired lease allows recovery.
- Provider unavailability, database failure, expired authentication: request fails closed with a retryable error and no charge.
- Browser refresh resumes from the stored job record.

### 4.5 Data and migrations
- Local PostgreSQL suites pass (R4). Pending migrations: transaction scope, `CONCURRENTLY` statements run separately, pre-checks, rollback file, parity with the TypeScript implementation they mirror.

### 4.6 Commercial
- Pricing, tiers and entitlements match `API_CONTRACTS.md`; one live purchase→redemption→analysis→refund on staging (`ACCEPTANCE_CRITERIA.md` COM-1).

### 4.7 Non-gating (recorded, user decides)
Performance baseline (`PERFORMANCE_BASELINE.md`), scalability/load, maintainability (SonarCloud), frontend integration (Antigravity), live model output quality (paid inference budget).

## 5. Mutation catalogue
Harnesses (run locally, each mutation restored with `git checkout -- <file>`): phase two M01–M19
(`DEVIN_PHASE2_AUDIT_REGISTER.md`), phase three P01–P16 (`DEVIN_PHASE3_RELEASE_READINESS.md` §5). Add a mutation
for every new security, financial, entitlement, queue-lease or verification check.

## 6. Skipped-test policy
A skipped suite is acceptable only if it needs (a) a local PostgreSQL cluster — then R4 must run it, (b) licensed
official-form artifacts not stored in the repository, or (c) staging credentials. Each release records which were run.

## 7. Migration review checklist
1. Applies inside one transaction, except statements that cannot (`CREATE/DROP INDEX CONCURRENTLY`), which are listed to run separately.
2. Read-only pre-check that aborts on data that would violate the new constraint.
3. Rollback file exists and was read.
4. Function replacements compared with the live definition first (no silent drop of grants or `security definer` settings).
5. Behavioural parity with any TypeScript implementation it mirrors (run both on the same inputs).
6. Never applied by an agent to production; owner approval recorded.

## 8. Recording a run
Create `engineering/handoffs/release-acceptance-<date>.md` with: candidate SHA, R1–R8 results, the section 4 table
with one status per requirement, open defects, and the gate decision (section 2).
