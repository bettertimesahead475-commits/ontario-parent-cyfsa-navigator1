# Stage 9A–9C independent closure audit — 2026-09-20

## Decision

**9A BLOCKED. 9B BLOCKED. 9C BLOCKED.** No frozen SHA is assigned. Stage 9D contract definition is deferred by the requested closure rule; there is no Stage 9D branch or documented contract. This audit did not change production services or schema.

The audit branch was created from repaired Stage 9C candidate `408bf8c78accc6af228d750c4592b0c623495a5f`. Its parent lineage is: Stage 8D `5d59632167d500479f77e7749147ecf2d7b82dbe` → Stage 9A candidate `180276dfca62dd224c768d2ba2b0cc854acc769b` → Stage 9B candidate `24fff685c76ed1a44b399a2fb59c59f4ad0872f6` → Stage 9C implementation `1ec2c2c` → remediation `539988d` → repaired candidate `408bf8c`. The source checkout and this isolated checkout differ: the source Stage 9C branch ends at `539988d`; this checkout includes the unpushed repair. No uncommitted Antigravity Stage 9D changes were found.

## Stage 9A — authoritative legal sources

| Contract element | Result | Evidence |
|---|---|---|
| Read persisted source, version, provision identities | PASS | `legalSources.ts` reads canonical legal corpus tables by UUID. |
| Deterministic date/version resolution | PASS for pure resolver | `resolveVersionForDate` reuses Stage 6 deterministic resolver; existing current, historic and gap tests pass. |
| Provision belongs to source/version | PASS | `getAuthorityCitation` checks source IDs and provision-version row. |
| Source provenance in citation | PASS | Title, official publisher, source URL, retrieval time and effective context are returned. |
| Content hashing primitive | PASS | SHA-256 over normalized provision text; mutation test rejects a changed string. |
| Verified authority boundary | **FAIL** | `getAuthorityCitation` returns an apparently authoritative citation for a source with `verification_state=UNVERIFIED`, without status or warning. New behavioral test proves it. Version and provision verification states are also not inspected here. Stage 6's older mapping explicitly downgrades unverified authority; Stage 9A bypasses that rule. |
| Real database and approved official-source integration | UNVERIFIED | Tests use a table mock; pending migration is unexecuted in production. |
| Prompt-injection and professional-review boundary | PARTIAL | No LLM call or document instruction execution exists in 9A, but citation metadata does not carry a mandatory review/trust state. |

Smallest remediation: keep raw retrieval possible for inspection, but make authoritative citation issuance require verified source, version and provision state, or return an explicit unverified result that downstream services cannot treat as validated. Add negative behavior tests for each state.

## Stage 9B — matter-to-law research candidates

| Contract element | Result | Evidence |
|---|---|---|
| Matter membership check and scoped list | PASS at mocked service boundary | Server account lookup and matter-members query precede build/save/list; list filters by matter ID. |
| Event belongs to matter and date resolves version | PASS for exercised cases | Event query filters ID and matter ID; unknown and crossing date ranges fail closed in existing tests. |
| Provision/version relation and provenance | PARTIAL | `getAuthorityCitation` checks provision-version association and supplies source URL, but its trust-state gap carries into 9B. |
| Evidence classification and matter lineage | **FAIL** | Builder accepts a caller-selected `FACT` and arbitrary evidence UUID without loading the evidence row or checking its matter and canonical classification. New behavioral test resolves instead of rejecting. The pending migration has independent evidence/event FKs, not a composite matter-scoped FK. |
| Verified authority selection | **FAIL** | An unverified legal source still becomes a research candidate; new test resolves instead of rejecting. |
| Trusted candidate persistence | **FAIL** | `saveMatterLegalResearchCandidate` accepts an arbitrary candidate object and writes caller-asserted `VERIFIED`, provenance URL and classification without rebuilding or validating them. The mock proves the service path; a real database FK might reject a nonexistent ID, but it would not validate these text/status fields or same-matter relationships. |
| Idempotence | PARTIAL | Upsert uses a unique text key; mocked duplicate test passes. Real constraint/concurrency and delimiter collision behavior are unverified. |
| Revocation at write boundary | UNVERIFIED | Membership check and write are separate calls, not one protected transaction. Same-session revocation race is untested. |
| Professional judgment and prompt injection | PARTIAL | `reasonForRelevance` passes a legal-language guard; `retrievalBasis` and candidate provenance are caller-controlled text. No direct LLM/document ingestion is wired into the service, but a caller could inject unsupported assertions into stored candidate fields. |

Smallest remediation: load evidence and classification from a matter-scoped authoritative row; enforce matter-scoped relational integrity; require verified authority before candidate advancement; make save derive or revalidate trusted fields server-side, with authorization and write in one protected boundary. Add real database integration for constraints and concurrent revocation.

## Stage 9C — citation and authority validation

| Contract element | Result | Evidence |
|---|---|---|
| Candidate and membership scoped to matter | PASS at mocked service boundary | Both queries filter by matter ID; existing revoked/cross-matter tests pass. |
| Source/version/provision identity and relation | PASS for tested rows | Mismatch and missing source tests pass; provision-version row is checked. |
| Stored-text integrity independent of caller digest | PASS | `408bf8c` hashes stored `exact_text` against stored `text_sha256`. Repeating the stored digest after text mutation yields `FAILED`/`INVALID`. |
| Missing text or digest | PASS for status downgrade | New audit cases return a non-`VALIDATED` status. |
| Unverified authority state | **FAIL** | Changing source, version or provision `verification_state` to `UNVERIFIED` still returns `authorityValidationStatus=VALIDATED`. Three new behavioral cases fail. A valid digest proves bytes match storage, not that the legal source is authoritative. |
| Exact quote and caller pinpoint | PARTIAL | A changed quote is rejected; caller pinpoint remains unverified. Tests do not establish a legal proposition is supported by the quote. |
| Unsupported case holdings/propositions | PARTIAL | Limitations text says holdings and ratios are not inferred, but there is no proposition-support validation. |
| Malformed input and deterministic substantive repeat | PASS for new cases | Null input rejects; repeated unchanged input matches after excluding `validatedAt`. |
| Live corpus/DB authorization integration | UNVERIFIED | Tests are mocked; pending 9A/9B migrations have not been exercised together against an isolated database for this audit. |

The 408bf8c regression test closes the specific replayed-digest flaw. It does **not** prove the broader authoritative-status contract; source/version/provision trust checks are absent.

### Required Stage 9C case matrix

1. Correct stored text and digest: PASS in existing test.
2. Modified stored text: PASS, `FAILED`/`INVALID`.
3. Stale digest: PASS, mismatch is rejected or status invalid.
4. Repeated caller digest: PASS only when stored text is intact; mutation case rejects.
5. Mismatched source: PASS in existing source/version mismatch tests.
6. Mismatched authority/version: PASS in existing provision-version tests.
7. Missing text: PASS, non-validated.
8. Missing digest: PASS, non-validated.
9. Malformed input: PASS for null input; broader runtime-type fuzzing remains unverified.
10. Unsupported/unverified authority: **FAIL**, source/version/provision each yield `VALIDATED`.
11. Cross-matter private boundary: PASS at mock boundary; live DB integration unverified.
12. Deterministic repeat: PASS for substantive fields, excluding timestamp.

## Gates and environment

- Baseline targeted tests before adding audit cases: 9A 28/28, 9B 19/19, 9C 14/14.
- Targeted tests with audit cases: 9A 28 pass / 1 fail; 9B 19 pass / 3 fail; 9C 18 pass / 3 fail.
- Complete Stage 9: 65 pass / 7 fail across 3 files.
- Related security/integration selection: 215/215 across `access`, `firebaseAdmin`, `legalCorpusRetrieval`, `professionalWorkspace`, `stage7f`, `stage8dIntegration`.
- Full serial suite (`--maxWorkers=1`): 1,255 pass / 7 fail across 44 files. All seven failures are the new audit cases.
- TypeScript: PASS, zero errors.
- Production build: PASS; existing large-chunk warning.
- npm audit: 11 advisories (10 moderate, 1 high), matching recorded baseline. No dependency changes.
- Migrations: Stage 9A/9B SQL remains pending approval, not executed here or in production. No production action.

## Roadmap position and next work

HANDOFF's latest unambiguous formal closure statement is Stage 7; Stage 8D is implemented at `5d59632` but its entry does not explicitly declare an independent formal freeze. Stage 9A–9C remain candidates. The next work is narrow remediation of the seven demonstrated Stage 9 defects, followed by behavioral and isolated database re-audit. The Stage 9D contract must be derived only after 9A–9C resolve, as required by this audit request. Do not start 9D from this state.

## Narrow remediation after audit — 2026-09-20

This section records a remediation candidate, **not independent closure**. The seven audit regressions remain intact and pass. Stage 9A, 9B and 9C are **REMEDIATED — AWAITING INDEPENDENT CLOSURE AUDIT**.

| Audit defect | Root cause | Narrow correction | Regression result |
|---|---|---|---|
| 9A unverified source receives authoritative citation | `getAuthorityCitation` loaded trust state but did not enforce it. | Citation issuance now requires `VERIFIED` source, and when supplied, `VERIFIED` version and provision. Raw `getSource` remains available for inspection of unverified material. | Preserved 9A audit test passes; new missing, malformed and transition tests pass. |
| 9B foreign/caller-classified evidence | Builder accepted evidence UUID and classification without reading the evidence row. | Builder fetches the evidence row by both ID and matter ID, derives canonical classification, and rejects mismatched or classification-only assertions. | Preserved foreign-evidence audit test passes; valid FACT/ALLEGATION tests now use persisted fixtures; additional cross-matter test passes. |
| 9B unverified authority research | Builder called 9A citation without a trust gate. | The 9A verified-chain gate now applies to builder and save reconstruction. | Preserved unverified-authority audit test and uploaded-instruction test pass. |
| 9B forged save fields | Save wrote a caller-provided candidate directly after membership check. | Save rebuilds against persisted evidence, event, source, version and provision records, compares trusted fields, verifies stored legal text/hash when available, rejects inconsistency, and writes only reconstructed values. | Preserved forged-save audit test and added valid/forged integrity, provenance, version, classification and retrieval-time tests pass. |
| 9C unverified source/version/provision yields `VALIDATED` | Citation validator checked identity and hash but ignored each trust state. | It now marks the authority `UNVERIFIED` and records a finding for every unverified/missing state. The 408bf8c stored-text hash check remains unchanged. | Three preserved authority-chain audit cases pass; replayed-digest regression remains green. |

The older provision-version and historic-version test fixtures omitted verification states while expecting a verified-authority path. The FACT and ALLEGATION tests supplied classifications without evidence rows. Those fixtures were made representative of the verified persisted records the tests intended to exercise; their assertions and all seven audit regressions were preserved. No timeout or assertion was weakened.

### Cross-milestone checks

A. Unverified source is rejected by 9A citation, 9B research, and is `UNVERIFIED` in 9C.
B–D. Save reconstructs verification-sensitive fields, rejects forged provenance/integrity/version/classification; 9C hashes stored text independently of caller digest.
E. Verified authority and valid save still pass.
F. Evidence query is matter-scoped; foreign evidence is rejected; prior membership/cross-matter tests remain green.
G. Replayed-digest test introduced in 408bf8c remains green.
H. Uploaded instruction text cannot change the persisted legal source verification state.

### Sequential gates

- Seven preserved regressions: **7 passed / 0 failed** (71 other tests skipped by the focused filter only).
- Stage 9A: **32 passed / 0 failed**.
- Stage 9B: **25 passed / 0 failed**.
- Stage 9C: **21 passed / 0 failed**.
- Complete Stage 9: **78 passed / 0 failed**, 3 files.
- Related security/integration: **215 passed / 0 failed**, 6 files.
- Full project, one worker: **1,268 passed / 0 failed / 0 skipped**, 44 files.
- TypeScript: PASS, zero errors.
- Production build: PASS, existing large-chunk warning.
- npm audit: **11 advisories** (10 moderate, 1 high), unchanged baseline; no automatic fix.

All tests above are mocked or local behavioral gates. Pending Stage 9A/9B migrations were not executed in this task, and no live database transaction or production boundary is claimed as validated. An independent closure audit must inspect these limits and the final diff. No Stage 9D contract or implementation was started.

## Remediation continuation — 2026-09-21

The checkout was already clean at remediation commit `289f02f0a14a1a2b20512ebe3c940165239ea173`; the GitHub remediation branch also contained that commit. Both the original audit `0e9bc76` and stored-text repair `408bf8c` remain ancestors. This continuation retains the production fixes and all seven audit regression bodies unchanged, and adds 13 behavioral tests.

### Preserved regression / boundary mapping

| Stage / preserved test | Violated invariant and production path | Boundary and corrected behavior |
|---|---|---|
| 9A: unverified source cannot be issued as an authoritative citation | `legalSources.getAuthorityCitation` previously omitted source trust enforcement. | Persisted source to authoritative presentation: reject any state other than VERIFIED; raw retrieval remains available. |
| 9B: evidence must belong to the authorized matter and classification must be canonical | `buildMatterLegalResearchCandidate` previously accepted caller evidence/classification. | Caller to matter evidence: resolve by evidence ID and matter ID, derive classification, reject inconsistent assertions. |
| 9B: unverified legal source cannot become a research candidate | Builder previously inherited 9A's missing trust gate. | Legal corpus to research: require persisted verified authority via 9A citation issuance. |
| 9B: save must reject a fabricated candidate with caller asserted integrity | `saveMatterLegalResearchCandidate` previously persisted asserted provenance/integrity. | Request to persistence: reconstruct from persisted records, compare sensitive fields, reject unverifiable assertions. |
| 9C: unverified source cannot validate authority | `validateCandidateCitation` previously checked integrity without source trust. | Persisted source to VALIDATED: return UNVERIFIED even when integrity is VERIFIED. |
| 9C: unverified version cannot validate authority | Validator previously omitted version trust. | Source version to VALIDATED: require VERIFIED version independently of hash. |
| 9C: unverified provision cannot validate authority | Validator previously omitted provision trust. | Provision to VALIDATED: require VERIFIED provision independently of hash. |

Additional tests exercise real service composition over mocked persisted tables: 9A citation → 9B research → save → 9C validation, followed by source trust downgrade. Save tests independently remove the source, downgrade version/provision trust, mismatch source or provision/version, move evidence to another matter, and tamper with stored text. Caller verification fields cannot override persisted authority. Missing/unknown trust states and a mismatched provision-version link are explicitly covered in 9C. These extend coverage without changing production code or weakening existing assertions.

### Replayed gates (sequential, 2026-09-21)

| Gate | Result |
|---|---|
| Seven preserved regressions, filter `audit: (unverified\|evidence\|save)` | 7 passed, 0 failed; 71 unrelated cases excluded by the focused filter before additions |
| Stage 9A | 32 passed, 0 failed |
| Stage 9B | 34 passed, 0 failed |
| Stage 9C | 25 passed, 0 failed |
| Complete Stage 9 | 91 passed, 0 failed, 0 skipped, 3 files |
| Related security/integration (same six files as original audit) | 215 passed, 0 failed, 0 skipped |
| Full project, `vitest run --maxWorkers=1` | 1,281 passed, 0 failed, 0 skipped, 44 files |
| `tsc --noEmit` | PASS, zero errors |
| `npm run build` | PASS; existing large-chunk warning |
| `npm audit --json` | Completed, exit 1: 11 vulnerable packages (10 moderate, 1 high), matching baseline counts; not a clean vulnerability audit |

Initial sandboxed Node startup attempts failed with EPERM resolving the existing dependency junction. Authorized execution outside that sandbox completed the gates above. No timeout changes or dependency changes were made. The focused regression gate passed before the added coverage, and all seven also passed in the final complete suites.

Stage 9A, 9B and 9C remain **REMEDIATED — AWAITING INDEPENDENT CLOSURE AUDIT**, not formally closed. Live database constraints, transaction/revocation races, and pending migration integration remain unverified by these mocked service tests. Production, deployments, migrations, secrets, main, and Stage 9D were untouched. Next action: independent Stage 9A–9C closure audit.
