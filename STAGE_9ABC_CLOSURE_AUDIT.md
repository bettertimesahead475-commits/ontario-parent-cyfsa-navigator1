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
