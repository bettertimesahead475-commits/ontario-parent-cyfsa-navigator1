# Stage 9 roadmap reconstruction and next-contract decision

Date: 2026-09-21. Task authority: user prompt 62518.
Repository: `bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`.
Code examined: `836f21469dd6a3d2248517c1fd0acf44cd9d545a`.

## Determination

**C. ROADMAP AMBIGUOUS — DOCUMENTATION DECISION REQUIRED**

Stage 9A, 9B and 9C are **FORMALLY CLOSED/FROZEN** at the SHA above, according to the independent closure result supplied by the user. This document does not reopen them. Closure of those defined milestones does not establish an undocumented Stage 9 completion criterion.

The repository documents Stage 9 as **Advanced Case-Wide Retrieval / RAG** (`HANDOFF.md`, §9), but does not define its overall acceptance criteria, required user workflow, search corpus, retrieval method, or whether generation is mandatory. Later 9A–9C entries establish authoritative-source, matter-research-candidate and citation-validation foundations. They do not assign the remaining retrieval/application integrations to 9D. The earlier Phase 2 plan makes broader retrieval conditional on usage and scale rather than an unconditional milestone requirement.

Consequently, there is insufficient evidence either to name one particular 9D as required or to declare Stage 9 complete and move to Stage 10. A missing feature is not, by itself, a documented requirement. No 9D or Stage 10 implementation contract is adopted by this document.

## Independent closure evidence and release boundary

Prompt 62518 supplies the authoritative independent audit result:

- 9A, 9B and 9C formally closed/frozen at `836f21469dd6a3d2248517c1fd0acf44cd9d545a`.
- Stage 9: 91/91 pass.
- Full project, one worker: 1,281 passed, 0 failed, 0 skipped.
- TypeScript and production build: pass.
- npm audit: 11 vulnerable packages/advisory baseline counts, 10 moderate and 1 high; this is not a vulnerability-free dependency report.
- All seven original trust-boundary regressions retained and passing; 13 added tests independently reviewed as meaningful; stored-text/replayed-digest repair retained.

This task records that supplied result; it did not perform a new independent audit or rerun the application gates. Earlier audit and remediation entries are retained as historical evidence, superseded only in milestone status.

**LIVE POSTGRES/RLS/FK/CONCURRENCY VALIDATION: DEFERRED TO RELEASE GATE.** Actual foreign keys, RLS, database constraints, concurrent/revocation races and other database behavior represented by mocked Supabase tests have not been established by the 1,281 passing tests. These are release conditions, not reasons to reopen 9A–9C. No database was accessed for this task.

## Evidence register

References below describe the inspected frozen tree; symbols and section names remain usable if documentation line numbers change.

| ID | Repository evidence | What it establishes / does not establish |
|---|---|---|
| E1 | `HANDOFF.md`, §9 Future Roadmap, rows 8–11 | Stage 8: Litigation Work Product; Stage 9: Advanced Case-Wide Retrieval / RAG; Stage 10: Firm Collaboration / Permissions / Audit; Stage 11: Benchmarking / QA / Release Hardening. No Stage 9 acceptance matrix or 9D definition. |
| E2 | `HANDOFF.md`, Stage 9A Implementation and Narrow Remediation; commits `c407ace`, `56ed0ec`, `180276d`; `api/services/legalSources.ts` | Canonical source/version/provision access, temporal resolution, provenance, hashes, citation issuance; foundation for advanced legal research/RAG. No retrieval-query engine or application route introduced by these commits. |
| E3 | `HANDOFF.md`, Stage 9B Implementation/Remediation; commits `31c14f0`, `8b477f3`, `24fff68`; `api/services/matterLegalResearch.ts` | Build/save/list matter-bound research candidates from supplied legal-source/provision IDs and persisted evidence/event data. A caller-provided retrieval-basis string is metadata, not a ranking implementation. |
| E4 | `HANDOFF.md`, Stage 9C Implementation; commits `1ec2c2c`, `539988d`, `408bf8c`; `api/services/citationValidation.ts` | Structural citation and stored-text checks; explicit limitation that legal correctness, holdings, ratios and proposition support are not inferred. |
| E5 | `STAGE_9ABC_CLOSURE_AUDIT.md`, original roadmap position and subsequent remediation; commits `0e9bc76`, `289f02f`, `836f214` | No authoritative 9D contract had been found. Trust-boundary remediation and test evidence are specific to 9A–9C. |
| E6 | `PHASE_2_CYFSA_INTELLIGENCE_ARCHITECTURE.md`, §§2.9, 4, 6 and 25 (retrieval open question); `HANDOFF.md` §1/technical debt | Historical planning distinguishes legacy file chat from persisted case intelligence, prefers narrow verified statutory grounding, and defers broader retrieval/vector search until scale warrants it. It is not a current 9D specification. |
| E7 | `STAGE_6_M2A_LEGAL_CORPUS_VERSIONING.md`; `STAGE_6_M2B_LEGAL_CORPUS_INGESTION.md`; `STAGE_6_M2C_LEGAL_CORPUS_VALIDATION.md` | Versioned text, immutable snapshots, controlled ingestion/parser infrastructure and offline real-excerpt tests exist. Infrastructure does not establish a populated, complete, current production corpus. |
| E8 | `STAGE_6_M2D_DETERMINISTIC_LEGAL_RETRIEVAL.md`, §§1, 15, 17; `api/services/legalCorpusRetrieval.ts` | Deterministic lookup of a known citation and date, not selection of law from a fact pattern. Repository interface exists; no concrete adapter to that interface is supplied by this module. Stage 9 direct database reads are distinct from implementing this interface. |
| E9 | `STAGE_6_M2E_AMENDMENT_MONITORING.md`, §§1, 7, 17–18; `api/services/legalCorpusMonitoring.ts` | Pure change observations, no automatic verification/effective-date inference, no scheduler, persistence or live updater. |
| E10 | `api/_server.ts`, `/api/rag-query` handler | Scores request-supplied `files` using query-term overlap and filename weights, selects up to six files, then generates a response. It does not call the 9A–9C services or resolve a persisted matter corpus. |
| E11 | `api/services/professionalWorkspace.ts`, `getIntelligenceCategory`; `api/services/litigationWorkProduct.ts`, `generateCaseBrief` | Professional LEGAL findings and case-brief legal flags read `navigator_case_intelligence_snapshots`; they do not read Stage 9 research candidates or perform Stage 9C validation. |
| E12 | Pending SQL `create_navigator_stage9a_legal_source_extensions.sql`, `create_navigator_stage9b_matter_research.sql`, `create_navigator_legal_authority_foundation.sql`, `create_navigator_legal_corpus_versioning.sql` | Case metadata extensions, candidate persistence and corpus/source identity models. None defines a query/ranking/output contract for 9D. SQL text is not evidence of deployed behavior. |
| E13 | `legalSources.test.ts`, `matterLegalResearch.test.ts`, `citationValidation.test.ts` | Verified/unverified authority, date resolution, canonical evidence, save reconstruction, matter isolation, repeated-digest rejection, and composed citation→research→save→validation tests. No browser/API research discovery workflow is established by these tests. |

Searches covered tracked documentation, service and test files, routes/UI, pending migrations, Stage 9 commit history and available refs. Terms included Stage 9/9D/10, legal RAG/research, authority/citation, sources/versions/provisions, case law, effective dates, retrieval/ranking, provenance/verification, professional review, research gaps, TODO and deferred. Binary-text mode was necessary for historical `HANDOFF.md` sections containing NUL bytes. No authoritative Stage 9D design or backlog assignment was located. No GitHub issues or external roadmap were supplied or treated as repository requirements.

## Original objective and completed milestones

The strongest explicit overall objective is E1's roadmap label: **Advanced Case-Wide Retrieval / RAG**. E2 narrows the immediate groundwork to authoritative legal research/RAG. These are related descriptions, but do not resolve whether Stage 9 must search matter evidence, legal authority, or both, or produce a generated answer.

| Milestone | Completed capability at frozen SHA | Boundary |
|---|---|---|
| 9A | Read canonical authority identities, resolve source versions, verify source/version/provision trust on citation issuance, retain source provenance, expose deterministic hash checks. | Raw unverified retrieval can remain inspectable; authoritative citation issuance cannot silently promote it. Not corpus discovery or legal interpretation. |
| 9B | Construct, persist and list matter-to-law research candidates; derive evidence classification and event dates from persisted matter rows; reconstruct sensitive fields before save. | Candidate relevance remains a proposal; chosen authority IDs and relevance text are input, not automatically discovered or professionally confirmed law. |
| 9C | Validate candidate authority-chain identities/trust, stored text/hash, exact quotes and citation metadata; retain unverified pinpoint and limitation states. | VALIDATED is not a determination of legal proposition support, controlling law or legal correctness. |

## Capability gap analysis

COMPLETE means the described code-level capability exists within its established contract; it never means production readiness. PARTIAL/MISSING describes broader capability coverage, not a regression or reopening of frozen milestones. Where assignment is unknown, it is stated explicitly rather than silently assigned to 9D.

| Capability | Classification | Evidence and remaining scope |
|---|---|---|
| Source, source-version and provision identity model | COMPLETE | E2/E7/E12: canonical identities and relationships represented. |
| Controlled authoritative ingestion | PARTIAL | E7: bounded retrieval/parser/snapshot candidates; no proven complete curated corpus or operating ingestion workflow. Whether further product ingestion belongs in Stage 9 is unspecified. |
| Production corpus population/currentness | DEFERRED TO RELEASE | Runtime corpus coverage must be verified for an approved release scope; no seeding or completeness claim here. |
| Source-version and effective-date resolution | COMPLETE | E2/E3/E8: deterministic historical/current selection and unresolved outcomes. Unknown dates do not authorize guessing current law. |
| Versioned statutory provisions/text | COMPLETE | E7/E8/E12: provision-version text and integrity infrastructure; this is model/resolver completeness, not statute-wide content coverage. |
| Case-law source metadata | COMPLETE | E2/E4/E12: court, decision date, docket and source metadata supported. |
| Case-law ingestion, treatment/precedent and holdings research | MISSING | E4 expressly excludes holdings/ratios inference; E7 does not establish a case-law ingestion workflow. No evidence makes these mandatory Stage 9 deliverables. |
| Known-ID/citation authority retrieval | COMPLETE | E2/E8: specific authority lookup and date resolution. |
| Matter-wide query-driven discovery/ranking of evidence and law | MISSING | E3/E8/E10: no composition over persisted matter records and verified law. Legacy file scoring does not implement it. Required algorithm and relevance contract are unspecified. |
| Matter-aware legal research candidates | COMPLETE | E3/E13: build/save/list and persisted evidence/date boundaries. |
| End-user research API/UI | MISSING | Production reference search finds Stage 9 services consumed by services/tests, not a research route or UI. Audience and workflow not assigned. |
| Citation provenance and validation | COMPLETE | E2/E4/E13: canonical metadata, textual/structural checks and explicit limitations. |
| Authority verification gates | COMPLETE | E2–E4/E13: trust checks separate from integrity, no caller-asserted promotion. |
| Staleness/supersession handling | PARTIAL | E7/E9: version status, lineage and pure change observations; no integrated monitor/revalidation notification workflow. Scheduling/product obligations unspecified. |
| Legal proposition support | MISSING | E4 explicitly disclaims automated legal correctness; textual match is not entailment. No requirement authorizes automated proposition adjudication. |
| Professional verification/review | PARTIAL | Stage 6 human review transitions and Stage 7 reviewer-scoped findings exist; E11 does not integrate Stage 9 candidate validation with a dedicated professional research workflow. |
| Research persistence | COMPLETE | E3/E12: service and pending candidate schema; deployed constraints are a separate release gate. |
| Source traceability | PARTIAL | E2/E3/E7 preserve canonical IDs, provenance and stored-text links. A joined user-facing path from research result to authority and underlying matter evidence is not established by E11. |
| Research-gap output | PARTIAL | E3/E4 return unresolved/UNVERIFIED/REQUIRES_RESEARCH findings; no dedicated persisted legal-research gap workflow. Stage 5 evidence gaps are not automatically legal research gaps. |
| Research output/work-product integration | MISSING | E11 uses case-intelligence snapshots, not Stage 9 candidates/validation. No approved choice of live versus immutable research output. |
| Actual FK/RLS/constraint/concurrency/revocation semantics | DEFERRED TO RELEASE | User-supplied closure limitation; mocked tests are not live Postgres validation. |
| Network transport hardening and dependency remediation | DEFERRED TO RELEASE | E7's DNS/connection-pinning limitation and known dependency baseline; not an inferred 9D feature. |
| Firm/team collaboration, shared permissions and audit workflows | BELONGS TO LATER STAGE | E1 Stage 10. Existing single-matter authorization still applies to any earlier feature. |
| Benchmarking, scale evaluation and release hardening programme | BELONGS TO LATER STAGE | E1 Stage 11; ordinary feature correctness/security tests remain required in every milestone. |

## Why neither a new numbered milestone nor Stage 10 can be asserted

1. The roadmap label suggests work beyond the implemented service foundations, so 9A–9C closure alone is insufficient evidence that Stage 9 is complete.
2. The missing paths above demonstrate implementation gaps but not a specific required next feature, audience, algorithm or completion boundary.
3. Historical usage-dependent retrieval deferral has not been replaced by a concrete Stage 9 retrieval requirement in the examined documents.
4. Stage 10 has a documented objective, **Firm Collaboration / Permissions / Audit**, but no first-milestone contract. Defining its tenant/team model now would introduce new product decisions rather than derive them from a completed Stage 9 contract.

## Next action contract: documentation scope decision

**Name:** Stage 9 completion-boundary decision.

**Purpose:** Turn the broad roadmap objective into a bounded, traceable implementation contract without reopening frozen work or moving Stage 10/11 scope backward.

**Dependencies:** Frozen SHA, supplied independent closure evidence, E1–E13, and a product-owner decision on the boundary below.

**In scope:** Decide the user-visible workflow, retrieval corpus, required outputs, Stage 9 completion criteria and explicit exclusions. Map each accepted requirement to existing services and a testable outcome.

**Out of scope:** Application changes, new SQL/migrations, database execution, live corpus ingestion, deployment, provider calls, secret/environment changes, or claiming new code closure.

### Concrete decision to record

The recommended interpretation is to retain Stage 9 as a persisted **single-matter retrieval** objective rather than silently redefining it as completed service infrastructure. This is a recommendation, not a recovered requirement or adopted 9D contract. Record these four decisions together:

| Decision | Recommended starting boundary | Why owner selection remains necessary |
|---|---|---|
| User and workflow | Authorized professional reviewing one matter; retrieve persisted evidence and inspect linked saved research candidates. | Existing Stage 7 workspace is the closest integration point, but Stage 9 never specifies professional-only versus parent-facing access. |
| What retrieval must discover | Explicitly choose between lookup of saved research candidates and query-driven discovery of new potentially relevant authorities. | These are materially different products; 9B supplies only the first foundation. A list endpoint cannot honestly satisfy a requirement to discover new law. |
| Required output | Deterministic evidence/source references and fresh 9C findings first; no generated legal conclusions. Decide whether UI and case-brief integration are required to close Stage 9. | No approved query/result schema, ranking rule, output surface or snapshot policy exists. |
| Completion boundary | Assign accepted gaps to the next Stage 9 increment; explicitly defer or exclude every other gap. | No evidence proves one read-only integration increment would complete all of Stage 9. Number it 9D only after this assignment. |

If the owner instead intends service foundations alone to complete Stage 9, record that explicit roadmap amendment and assign the unresolved retrieval/product integrations elsewhere before defining Stage 10's first milestone. This document does not adopt that alternative.

### Invariants that the subsequent implementation contract must preserve

- Server-authenticated identity; no caller-supplied UID, reviewer identity or claim of membership as authorization.
- Matter scope applied to every private record and relationship. Public authority does not make linked matter evidence public. Shared cache/index designs must not leak across matters or reviewers.
- Evidence classifications remain canonical; allegations never become facts through ranking, retrieval or generated prose.
- Integrity, authority verification, date applicability, legal proposition support and professional review remain separate states. Reuse existing status vocabularies; never infer VERIFIED/VALIDATED from a score, URL, quote match or digest alone.
- Resolve source/version/provision and evidence provenance from persisted records. Carry IDs, source URL/publisher, effective-date context, retrieval/validation times and explicit limitations. Uploaded text and caller fields cannot manufacture authority relationships.
- Preserve half-open date semantics, unknown-date and ambiguous-range failures. Never substitute upload/retrieval time for event time or silently replace historical law with current law.
- Preserve 9C stored-text hashing and replayed-digest checks. Revalidate trust for a live result; label immutable snapshots as historical observations rather than fresh validation.
- Professional confirmation is an explicit authorized human action, not a consequence of retrieval, model output, candidate persistence or citation validation. Reviewer-private notes must remain private.
- Source text, legal text and uploaded instructions are data. No text can change permissions, trust status, tool policy or verification state.
- No-match, missing authority, ambiguous date, unavailable text, unverified authority and integrity failure must remain distinguishable; no fallback to fabricated citations or unsupported legal conclusions.

### Required deliverable after the scope decision

The implementation-ready contract must specify all of: name/purpose/necessity; dependencies; exact in/out scope; data-model/service/API/UI changes (explicitly "none" where appropriate); authorization and matter isolation; trust/provenance/version/date/citation semantics; professional-review and injection boundaries; failure behavior; deterministic ranking/ordering and validation; behavioral/adversarial/integration test matrices; migration requirements; definition of done; closure gates; and deferred release gates.

The following test obligations are already justified, but query-specific examples cannot be finalized until the retrieval/output decision is made:

| Matrix | Required cases |
|---|---|
| Behavioral | Valid verified chain; historical date; unknown date; no match; stable ordering for identical persisted inputs; source traceability; classification preservation; explicit unverified/partial results where inspection is allowed. |
| Adversarial | Cross-matter IDs; revoked/absent access; another reviewer's notes; forged provenance/classification/trust/digests; source/version/provision mismatch; changed text plus replayed digest; source-state downgrade; uploaded instructions attempting promotion. |
| Integration | Authenticated route to persisted matter resolution to 9B/9C to chosen output surface; fresh validation versus historical snapshots; no legacy caller-file fallback; no work-product mutation on read; all seven original regressions and 13 reviewed additions retained. |
| Release | Isolated live Postgres FK/RLS/constraints and concurrent/revocation behavior, corpus coverage/verification, and deployment readiness assessed separately; never execute against production for contract definition. |

**Definition of done for this documentation decision:** owner selects the four boundaries; one numbered next milestone is assigned with a finite acceptance matrix; remaining capabilities are explicitly assigned/deferred; frozen closure and live-DB limitation remain prominent. Only then is an implementation-ready engineering contract authoritative. No production-code or migration changes are needed to make the decision.

**Closure gates for the future implementation:** preserve frozen regressions, add selected workflow's behavior/security/integration tests, run Stage 9 and related suites sequentially, full project with one worker, typecheck, production build, dependency audit with baseline comparison, and independent milestone closure review. These are prospective requirements, not tests executed in this documentation task.

## Changes and verification in this task

Documentation only: this decision record, current-status notice in `HANDOFF.md`, and a superseding status notice in `STAGE_9ABC_CLOSURE_AUDIT.md`. Application services, tests, dependency files and migrations remain byte-for-byte unchanged from the frozen SHA. Validate with Git diff scope and whitespace checks; no application test rerun is needed for prose-only changes. No push is included in this task; the earlier push authorization was limited to `836f214`.
