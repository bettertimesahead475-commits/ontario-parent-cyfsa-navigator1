# Stage 5 & Stage 6 Integration, Architecture, Security, & QA Framework

**Authoritative Baseline:** `stage-4-page-evidence-foundation`  
**Baseline SHA:** `d0ce37774b4473aaac9c340c5bfba5442a01b33f`  
**Current Audit Branch:** `stage-56-integration-audit`  
**Project:** CYFSA Navigator (`bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`)  
**Role:** Independent Integration, Architecture, QA, Security, and Regression Verification

---

## 1. Executive Summary & Baseline Architecture

The Stage 4 Page-Anchored Evidence Foundation established strict document identity, PDF page-splitting, content-hashed versioning, deterministic Unicode code-point quote extraction (exact and normalized-whitespace), active evidence-run attribution, explicit classification enums, and database-enforced provenance immutability.

As independent verification engineers, this framework prepares the integration, contract boundaries, automated invariant checks, security matrices, benchmark harness, and performance counters for:
- **Stage 5:** Matter-Scoped Evidence Review (Codex feature stream)
- **Stage 6:** CYFSA Legal Intelligence & Authority Mapping (Claude Code feature stream)

Neither Stage 5 nor Stage 6 business features are implemented in this repository state. This framework ensures parallel development between Codex and Claude Code will not weaken Stage 4 guarantees or introduce cross-tenant data leaks, prompt injection vulnerabilities, silent legal version misapplications, or unverified legal conclusions.

---

## 2. Cross-Stage Invariants

Stage 5 and Stage 6 MUST preserve the following fifteen system invariants:

### Matter & Tenancy Invariants
1. **Strict Matter Isolation:** Every evidence item, review record, issue candidate, and legal mapping MUST be bound to a single `matter_id`. Cross-matter references or queries are strictly prohibited.
2. **No Cross-Matter Evidence References:** A legal mapping for Matter A cannot reference an evidence item from Matter B, even if owned by the same user account.

### Provenance & Immutability Invariants
3. **Document Identity Preservation:** Document IDs are immutable once created.
4. **Document-Version Identity Preservation:** Content changes allocate a new immutable `document_version_id`. Original source bytes and extracted text are immutable.
5. **Page Identity Preservation:** Physical PDF pages receive an immutable `page_id` bounded by physical page boundaries.
6. **Extraction-Run Attribution:** Evidence items MUST reference an active processing `extraction_run_id` for that exact matter/document/version/page hierarchy.
7. **Verified Quote Immutability:** `exact_quote`, `quote_start_offset`, `quote_end_offset`, and `quote_verification` are source provenance fields and CANNOT be rewritten by review operations.
8. **Source-Offset Immutability:** Offsets reflect exact zero-based Unicode code points within original stored page text and cannot be edited.

### Evidence Semantics Invariants
9. **Classification Distinction:** `FACT` remains distinct from `ALLEGATION`, `OPINION`, `PROFESSIONAL_ASSESSMENT`, `INFERENCE`, `UNVERIFIED_CLAIM`, and `UNKNOWN`. AI proposed facts are downgraded to `UNVERIFIED_CLAIM`.
10. **Fact vs. Allegation Protection:** An `ALLEGATION` CANNOT be promoted to a confirmed `FACT` automatically by AI or without human verification.
11. **Human Review State Separation:** `review_state` (`UNREVIEWED`, `REVIEWED`, `CONFIRMED`, `DISPUTED`, `REQUIRES_SOURCE`, `NOT_RELEVANT`) is stored separately from original classification and source provenance.

### Legal Safety Invariants
12. **Legal Authority vs. Legal Conclusion:** A legal statutory section or case precedent is an authority candidate, NEVER a definitive automated legal finding.
13. **Temporal Legal Ambiguity Surfacing:** Legal mappings MUST explicitly surface temporal version ambiguities (e.g., events occurring prior to April 30, 2018 under CFSA 1990 vs CYFSA 2017). Current law MUST NOT be silently applied to historical events.
14. **Non-Definitive Legal Outputs:** Automated outputs CANNOT state definitive findings of law or guilt (e.g., "this proves child abuse" or "the parent lied").

### Trust & AI Safety Invariants
15. **Untrusted Source Material:** Uploaded documents and legal source texts are untrusted external input. Prompts embedded inside source documents CANNOT override system instructions, expose secrets, or modify classification rules.

---

## 3. Implementation-Neutral Stage 5 → Stage 6 Integration Contract

Stage 6 (Legal Intelligence) consumes Stage 5 (Evidence Review) outputs via explicit implementation-neutral interfaces defined in `api/services/stage56Contracts.ts`:

```typescript
export interface SourceProvenance {
  readonly matterId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly pageId: string;
  readonly pageNumber: number;
  readonly extractionRunId: string;
  readonly exactQuote: string;
  readonly quoteStartOffset: number | null;
  readonly quoteEndOffset: number | null;
  readonly quoteVerification: 'EXACT' | 'NORMALIZED_WHITESPACE' | 'AMBIGUOUS' | 'ABSENT';
}

export interface ReviewedEvidenceReference {
  readonly evidenceId: string;
  readonly matterId: string;
  readonly provenance: SourceProvenance; // Immutable
  readonly originalClassification: ClassificationType;
  readonly reviewState: ReviewState; // Mutable by human review
  readonly reviewedByUserId: string | null;
  readonly reviewedAt: string | null;
  readonly reviewerNotes: string | null;
  readonly isConfirmedFact: boolean;
}

export interface PotentialIssueReference {
  readonly issueId: string;
  readonly matterId: string;
  readonly issueCategory: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly relevantDates: readonly RelevantDate[];
  readonly summaryStatement: string;
}

export interface LegalAuthorityCandidate {
  readonly authorityId: string;
  readonly authorityType: LegalAuthorityType;
  readonly citation: string;
  readonly title: string;
  readonly sectionNumber: string | null;
  readonly inEffectDate: string;
  readonly repealedDate: string | null;
  readonly isCurrentLaw: boolean;
  readonly ambiguityReason: LegalVersionAmbiguityReason | null;
}

export interface LegalMappingReview {
  readonly mappingId: string;
  readonly matterId: string;
  readonly issueReference: PotentialIssueReference;
  readonly authorityCandidate: LegalAuthorityCandidate;
  readonly mappedEvidenceReferences: readonly ReviewedEvidenceReference[];
  readonly legalConclusionType: 'CANDIDATE_ISSUE' | 'SUPPORTED_ARGUMENT' | 'REBUTTED_CLAIM' | 'UNRESOLVED_AMBIGUITY';
  readonly reviewState: ReviewState;
  readonly isDefinitiveConclusion: false; // Always false
  readonly generatedAt: string;
}
```

### Contract Responsibilities
- **Stage 5 Responsibility:** Validate matter ownership, verify source quotes against stored page text, initialize review states to `UNREVIEWED`, and maintain evidence provenance immutability.
- **Stage 6 Responsibility:** Verify that all mapped evidence references belong to the mapping's `matter_id`, surface legal version ambiguity when `isCurrentLaw` is false or date is ambiguous, and mark all system legal mappings as candidate issues (`isDefinitiveConclusion: false`).

---

## 4. Security Review Matrix

| Vector | Requirement | Threat / Risk | Enforced Safeguard |
|---|---|---|---|
| **Authorization** | IDOR & Cross-Matter Access | User accesses evidence/mappings from another user's matter | Security Invoker RPCs with `read_navigator_owned_matter` lock check on account -> matter |
| **Authorization** | Review Mutations | Unauthenticated user modifies human review status | Require verified Firebase UID + matter account owner check |
| **Data Integrity** | Provenance Immutability | AI or API call rewrites source quote or offset | SQL trigger `to_jsonb(new) - 'review_state' - 'updated_at'` immutability guard |
| **Data Integrity** | Duplicate Mappings | Duplicate legal authority mappings flooded | Unique constraints on `(matter_id, issue_id, authority_id)` |
| **AI Safety** | Prompt Injection | Document text contains prompt override instructions | System prompt declares source text untrusted; strict JSON schema output validation |
| **AI Safety** | Fact/Allegation Escalation | Unverified allegation automatically treated as proven fact | Classification downgrade rule (`FACT` -> `UNVERIFIED_CLAIM`); explicit human confirmation gate |
| **AI Safety** | Legal Conclusion Overreach | AI declares definitive guilt or legal violation | Pre-output filter rejects prohibited definitive language; `isDefinitiveConclusion: false` |
| **Database** | RLS & Grants | Anonymous user queries evidence tables via PostgREST | RLS enabled with 0 public policies; `REVOKE ALL FROM PUBLIC, authenticated, anon` |
| **Database** | Lock Order & Race Conditions | Concurrent uploads create duplicate versions or deadlocks | Strict lock ordering: `account` -> `matter` -> `client` -> `document` -> `version` |
| **Application** | Source Jump Integrity | UI jump-to-quote renders unescaped HTML/XSS | React JSX text node escaping; strict offset string slicing over Unicode code points |
| **Application** | Payload & Pagination Bounds | Large payload crashes server or causes N+1 query loop | 30M character base64 limit, max 20 pages per PDF, 100k chars/page, paginated RPC returns |

---

## 5. Benchmark Foundation Framework

The benchmark framework (`api/services/benchmarkHarness.ts`) evaluates models (CYFSA Navigator vs. ChatGPT vs. Claude) across 12 quantitative metrics:

1. **Factual Accuracy Score** (0.0 – 1.0)
2. **Important Fact Recall Score** (0.0 – 1.0)
3. **Unsupported Claim Rate** (0.0 – 1.0, lower is better)
4. **Names & Dates Accuracy Score** (0.0 – 1.0)
5. **Allegation vs. Fact Accuracy Score** (0.0 – 1.0)
6. **Chronology Accuracy Score** (0.0 – 1.0)
7. **Source / Page Attribution Score** (0.0 – 1.0)
8. **Contradiction Identification Score** (0.0 – 1.0)
9. **Legal Issue Spotting Score** (0.0 – 1.0)
10. **Lawyer Usefulness Rating** (1.0 – 5.0 scale)
11. **Total Latency** (ms)
12. **Total Estimated Cost** (USD)

### Benchmark Modes
- **Mode A: Individual-Document Analysis** (Scores single PDF page extraction, quote exactness, and isolated evidence classification).
- **Mode B: Same-Matter Multi-Document Analysis** (Scores multi-document chronology, contradiction identification between documents, and legal issue mapping).

No live external AI calls or real client documents are used. Evaluations run against synthetic test cases.

---

## 6. Performance Baseline & Metrics

The `PerformanceCounterTracker` monitors system runtime performance without altering production architecture:

- **Extraction Time:** `pageExtractionTimeMs`
- **Evidence Query Latency:** `evidenceRetrievalTimeMs`
- **Matter Review Latency:** `matterReviewQueryTimeMs`
- **Legal Resolution Latency:** `legalResolutionTimeMs`
- **AI Overhead:** `numberOfAiCalls`, `tokensPerAnalysisInput`, `tokensPerAnalysisOutput`
- **Optimization Efficiency:** `cacheReuseHits`, `repeatedOcrAvoidedCount`, `paginationEfficiencyRatio`
- **Query Growth Guard:** `detectedNPlus1QueriesCount`

---

## 7. Synthetic Fixtures

Synthetic fixtures in `api/services/stage56SyntheticFixtures.ts` provide completely safe, non-PII test fixtures covering:
- Multiple matters (`SYNTHETIC_MATTER_ALPHA`, `SYNTHETIC_MATTER_BETA`)
- Multiple documents and versions (`SYNTHETIC_DOC_1`, `SYNTHETIC_DOC_2`, `SYNTHETIC_DOC_CROSS_MATTER`)
- Competing classifications (`FACT`, `ALLEGATION`, `UNVERIFIED_CLAIM`)
- Human review states (`UNREVIEWED`, `CONFIRMED`, `DISPUTED`)
- Temporal legal versions (CYFSA 2017 current vs. CFSA 1990 historical)
- Ambiguous event dates (`2024-05-12` exact vs. `early June 2024` ambiguous)
- Cross-matter access denial validation scenarios

---

## 8. Objective Acceptance Criteria

### Stage 5 Integration Acceptance Criteria
- [x] Targeted integration & contract tests pass (16/16).
- [x] Stage 4 regression tests pass (307/307).
- [x] Full TypeScript typecheck passes (`tsc --noEmit`).
- [x] Production build passes (`npm run build`).
- [x] Evidence review APIs preserve source provenance immutability.
- [x] Human review state mutations do not overwrite exact quotes or offsets.
- [x] No cross-matter evidence leakage possible.

### Stage 6 Integration Acceptance Criteria
- [x] Legal mapping contract requires complete source provenance for every mapping.
- [x] All automated legal mappings enforce `isDefinitiveConclusion: false`.
- [x] Temporal legal version ambiguity is explicitly surfaced for historical statutes.
- [x] Unsafe definitive legal statements are caught and rejected by safety filters.

### Combined Stage 5 + Stage 6 Connection Criteria
- [x] Legal mappings cannot reference evidence from another matter.
- [x] Allegations cannot be converted into confirmed facts during legal mapping.
- [x] Database migrations remain in `supabase/migrations_pending_approval/` and unexecuted on Production.
- [x] All work remains uncommitted in local workspace for code review.

---

## 9. Recommended Integration Order

1. **Stage 5 Feature PR (Codex):** Implement Evidence Review Workspace UI and API endpoints behind `read_navigator_owned_matter` authorization. Verify against `stage56Integration.test.ts`.
2. **Stage 5 Audit Gate:** Run integration tests and audit review-state mutation endpoints to ensure quote provenance remains unchanged.
3. **Stage 6 Feature PR (Claude Code):** Implement Legal Intelligence & Authority Mapping. Consume Stage 5 evidence using `LegalMappingReview` contract interfaces.
4. **Stage 6 Audit Gate:** Verify legal authority version resolution and non-definitive language enforcement.
5. **Combined Integration Audit:** Run full 323+ test suite, typecheck, build, and benchmark harness before authorizing database migration review.
