# STAGE 11 SCOPE CONTRACT: PROFESSIONAL WORKSPACE COMPLETION & PRODUCT CLOSEOUT

**Project**: CYFSA Navigator  
**Repository**: `bettertimesahead475-commits/ontario-parent-cyfsa-navigator1`  
**Document Reference**: `STAGE_11_SCOPE_CONTRACT.md`  
**Document Status**: FROZEN SCOPE CONTRACT  
**Freeze Tag**: `audit/stage-11-scope-contract-frozen`  
**Date**: September 26, 2026  

---

## 1. Authoritative Baseline & Status

Stage 10 development, database activation, and exact application verification are complete and closed. Stage 11 is the **final planned development stage** of the CYFSA Navigator program.

- **Stage 10 Development Status**: CLOSED
- **Stage 10 Frozen Commit SHA**: `d920c99ad549dcb045051c76b61a97be59f65680`
- **Stage 10 Closeout Record Commit**: `98a8d6563ba78c3325a6859ad2abd4c863bca1e5`
- **Production Web Application**: `https://cyfsanavigator.com`
- **Production Supabase Project**: `qboidsfpjuxeqtfotryj` (`cyfsa-parent-platform`)
- **Production Database Contract**: `navigator_matter_access_lifecycle_v4`
- **PR #35**: UNMERGED (remains unmerged)
- **Approved Privacy Notice Status**: CONTROLLED FOLLOW-UP REQUIRED (placement assigned to Stage 11 Slice 5)
- **Broader Security Hardening Status**: FOLLOW-UP REQUIRED (triaged in Stage 11 Slice 5)
- **Stage 11 Status**: NOT STARTED (Implementation begins only after scope freeze)

---

## 2. Final Planned Stage Declaration & Post-Launch Roadmap Rule

> [!IMPORTANT]
> **FINAL PLANNED DEVELOPMENT STAGE**: Stage 11 is the final planned development stage of the CYFSA Navigator development program. There is **NO PLANNED STAGE 12**.
>
> Any feature, enhancement, or speculative expansion requested after the freeze of Stage 11 that is not required to complete the Stage 11 acceptance criteria MUST be recorded as a **Post-Launch Roadmap Item** rather than creating another development stage.

---

## 3. Reuse of Existing Architecture

Stage 11 reuses, integrates, and hardens pre-existing architecture established across Stages 1–10 rather than introducing redundant infrastructure.

1. **Authorization & Access Control**:
   - Reuses Stage 10 recipient-bound invitation lifecycle (contract `navigator_matter_access_lifecycle_v4`).
   - Reuses `api/services/professionalMatterAccess.ts` and `api/matterAccessLifecycleRoutes.ts`.
   - Reuses per-account write limiter (`api/services/lifecycleWriteLimiter.ts`) and per-IP API limiter.
   - Enforces strict matter-level security boundary: professionals can access ONLY matters with an active, non-revoked `ACCEPTED` grant bound to their verified Firebase email.

2. **Professional Workspace API & Services**:
   - Reuses `api/professionalWorkspaceRoutes.ts` and `api/services/professionalWorkspace.ts`.
   - Reuses `api/services/professionalProfiles.ts`.

3. **Evidence Intelligence & Case Review**:
   - Reuses `api/services/evidenceReview.ts` and `api/evidenceReviewRoutes.ts` (document sources, extraction items, review states: `UNREVIEWED`, `ACCEPTED`, `FLAGGED`, `DISCARDED`).
   - Reuses `api/services/caseIntelligenceReview.ts` and `api/caseIntelligenceReviewRoutes.ts` (chronology, claims/allegation evolution, contradiction/corroboration relationships, evidence gaps, unanswered questions).
   - Reuses `api/services/pageSources.ts` for text extraction, OCR, and source provenance.

4. **Work Product & Exports**:
   - Reuses `api/services/litigationWorkProduct.ts` and `api/services/workProductVersions.ts`.
   - Reuses `src/components/CaseBriefViewer.tsx` for structured case brief presentation.
   - Reuses `api/officialFormRoutes.ts` and `api/services/officialForms.ts` for official court form field mapping.

5. **Access Auditing & Logging**:
   - Reuses `api/services/matterAccessAudit.ts`, `api/services/matterAccessEvent.ts`, and `api/services/matterAccessHistory.ts`.

---

## 4. Exactly Five Implementation Slices

Stage 11 is structured into **EXACTLY FIVE SLICES**. There is **NO SLICE 6**.

```
+-----------------------------------------------------------------------------------+
|                        STAGE 11 IMPLEMENTATION SLICES                             |
+-----------------------------------------------------------------------------------+
| Slice 1: Professional Matter Workspace                                            |
| Slice 2: Professional Review & Work Product                                       |
| Slice 3: Parent <-> Professional Collaboration                                   |
| Slice 4: Professional Outputs                                                     |
| Slice 5: Product Completion & Production Hardening                                |
+-----------------------------------------------------------------------------------+
```

---

### SLICE 1: PROFESSIONAL MATTER WORKSPACE

**Objective**: Complete the professional-facing workspace for matters to which the professional currently has authorized access.

**Included Scope**:
- Accessible-matter listing for authenticated professionals matching their verified Firebase email.
- Matter selection and client/matter context header.
- Document inventory and document navigation.
- Evidence-review items and page source viewing.
- Chronology and case-intelligence view for the authorized matter.
- Source jump-back from evidence/chronology items to exact page text.
- Matter-scoped data retrieval.
- Access status indicator (active, pending expiry, or revoked notice).
- Accessible empty, loading, and error UI states.

**Excluded Scope**:
- Creating new permission models or secondary RBAC systems.
- Listing matters belonging to other professionals or unauthorized parents.
- Direct database writes bypassing Stage 10 authorization RPCs.

**Security & Isolation**:
- Reuses Stage 10 v4 database functions exclusively.
- Revoked access terminates protected data retrieval immediately on the next request.
- Zero cross-matter or cross-account data leakage.

---

### SLICE 2: PROFESSIONAL REVIEW & WORK PRODUCT

**Objective**: Allow an authorized professional to review and organize existing case intelligence without confusing AI-generated analysis with professional work product.

**Included Scope**:
- Professional review state updates (`UNREVIEWED`, `ACCEPTED`, `FLAGGED`, `DISCARDED`).
- Professional notes and annotations on evidence items and findings where justified.
- Organization of key issues, chronology events, allegations, and evidence gaps.
- Review of contradiction and corroboration relationships.
- Source jump-back and provenance preservation.

**Interface Separation Requirement**:
- The UI MUST clearly and unambiguously visually distinguish:
  - **AI-GENERATED ANALYSIS** (automated extraction, machine inferences, draft summaries)
  - **PROFESSIONAL REVIEW / WORK PRODUCT** (human reviewer notes, accepted items, lawyer annotations)
- AI-generated analysis MUST NEVER be silently converted into or masqueraded as a professional legal conclusion.

---

### SLICE 3: PARENT ↔ PROFESSIONAL COLLABORATION

**Objective**: Complete the controlled collaboration loop between the parent matter owner and an authorized professional reviewer.

**Included Scope**:
- Parent visibility into professional review progress (e.g. summary count of reviewed/flagged items).
- Professional visibility strictly limited to currently granted matters.
- Explicit product rules for professional work product visibility to the parent.
- Revocation immediately removes future professional access and collapses workspace access.
- Isolation across multiple grants on the same matter or across different matters.
- Parent ownership remains primary and intact.

**Explicit Non-Goal**:
- Do NOT build a general chat system, social network, direct messaging platform, or notification center. Collaboration is structured strictly around matter evidence, review states, and shared case briefs.

---

### SLICE 4: PROFESSIONAL OUTPUTS

**Objective**: Produce professional-useful, review-ready outputs grounded deterministically in the matter's actual source material.

**Included Scope**:
- Generation and export of professional case briefs, chronologies, and evidence/issue summaries.
- Preservation of complete source traceability: `Document -> Page -> exactQuote / Offset -> Review / Analysis`.
- Export formatting suitable for professional litigation prep and official court form reference.
- Clear labeling of all AI-assisted content as draft/working material.

**Quotation & Provenance Invariants**:
- Quotations MUST NEVER be fabricated or hallucinated.
- Quotations MUST NOT be silently repaired using fuzzy matching.
- Enforces strict `exactQuote` rules:
  1. Deterministic exact substring match first.
  2. Declared whitespace normalization second.
  3. Unsupported or ambiguous quotation = flagged as "source review required" / null offsets.

---

### SLICE 5: PRODUCT COMPLETION & PRODUCTION HARDENING

**Objective**: Polish, harden, and finalize the complete CYFSA Navigator platform as one unified, secure, accessible Production product.

**Included Scope**:
- **End-to-End Workflow Verification**:
  - Complete Parent E2E journey.
  - Complete Professional E2E journey.
  - Invitation creation, recipient-bound acceptance, and revocation E2E.
- **Accessibility Gate**:
  - Full keyboard navigation and visible focus states across all workspaces.
  - WAI-ARIA roles, labels, `aria-expanded`, `aria-describedby`, and status/alert announcements.
  - Screen-reader compatibility for evidence review and access controls.
- **Usability & Design Polish**:
  - Responsive desktop and mobile layout usability.
  - Clean empty, loading, error, and rate-limit states.
- **Hardening & Security Review**:
  - Authentication and matter isolation boundary checks.
  - Document Analyzer functionality regression check (zero regressions).
  - Telemetry token scrub verification (`invitationFragment` memory capture + `telemetrySanitizer` backstop).
  - Production log review (zero unhandled exceptions).
- **Approved Privacy Notice Publication**:
  - Embed / mount the approved Stage 10 Privacy Notice (`STAGE_10_PRIVACY_NOTICE_DRAFT.md`) into the public product UI footer / privacy route (`/privacy`).
- **Broader Security Hardening Triage**:
  - Perform risk assessment on pre-existing Supabase security advisor findings (e.g. GraphQL visibility warnings on legacy tables). Ensure application dependencies and RLS policies are preserved safely without breaking live functionality.
- **Cleanup**: Remove dead/unfinished UI code or orphan debug components.

---

## 5. System Invariants

### 5.1 Legal & Evidence Integrity Invariants
1. **Untrusted Input**: All uploaded document files are treated as untrusted data; document text is never executed as system prompts.
2. **Reviewable Conclusions**: Automated AI outputs are informational/educational only; legal conclusions remain reviewable by qualified counsel.
3. **Traceable Provenance**: Every extraction and assertion must link back to its source document and page.
4. **Deterministic exactQuote**: No fuzzy-matched or hallucinated quotations.

### 5.2 Stage 10 Security Invariants
1. **Recipient Binding**: Grants are strictly bound to canonical recipient email addresses.
2. **Token Security**: Tokens travel via browser URL fragments (`#t=`), captured immediately into module memory, and scrubbed from history before DOM/analytics mount.
3. **Zero Plaintext Storage**: Only SHA-256 digests of invitation tokens are persisted.
4. **No Telemetry Leak**: Tokens are filtered out of all logs, analytics, and error reporting.
5. **Rate Limiting**: Per-IP API rate limiting and per-account write rate limiting remain active.
6. **Least Privilege**: Database operations executed strictly via SECURITY DEFINER functions with service_role privileges.

---

## 6. Explicit Non-Goals

The following items are **EXPRESSLY EXCLUDED** from Stage 11:
- Implementing a new authentication system or custom identity provider.
- Creating a secondary permission or RBAC architecture.
- Law-firm or Law Society credentials automated verification.
- Building a general chat, direct messaging, or social networking platform.
- Billing system overhaul or payment gateway redesign.
- Unrelated marketing, homepage, or narrator redesigns.
- Speculative AI agents or ungrounded generative features.
- Creating Stage 12.

---

## 7. Known Follow-Up Placement & Triage

1. **Approved Privacy Notice Publication**: Assigned to **Stage 11 Slice 5**. The approved privacy text will be integrated into the public application UI (`/privacy` route/footer).
2. **Broader Supabase Security Hardening**: Assigned to **Stage 11 Slice 5**. Legacy table GraphQL/REST access advisor warnings will be evaluated and hardened without altering core Stage 10 RLS or breaking application functionality.

---

## 8. Acceptance Criteria & Testing Requirements

Every slice must satisfy strict verification criteria before proceeding:
- **Unit & Integration Tests**: All unit test suites (Vitest) must pass.
- **Database Suite**: Real PostgreSQL tests must pass against contract `v4`.
- **Security & Privacy Gate**: Token leak tests and mutation suites must maintain 100% kill rate on security points.
- **Accessibility Gate**: Keyboard and ARIA assertions must pass clean.
- **E2E Smoke Tests**: Complete parent and professional journeys must function seamlessly.

---

## 9. Scope Change Procedure & Roadmap Classification

After this contract is frozen:
1. No silent scope expansion is permitted.
2. Any proposed modification must be explicitly classified as:
   - **Type A**: Required Stage 11 correction (bug fix or defect remediation within existing slice scope).
   - **Type B**: Approved Stage 11 scope amendment (formal written change request approved by project owner).
   - **Type C**: Post-Launch Roadmap item (deferred to post-launch product backlog; does NOT create Stage 12).
   - **Type D**: Urgent Production / Security remediation (immediate critical security patch).

---

## 10. Final Project Closeout Criteria

The CYFSA Navigator development program reaches final closeout when:
1. All five Stage 11 slices pass their defined acceptance criteria.
2. Complete Parent E2E and Professional E2E workflows are verified.
3. Document Analyzer functions with zero regressions.
4. Approved Privacy Notice is published on the live application.
5. Stage 10 security invariants and source provenance chains are 100% verified.
6. Production deployment on Vercel (`https://cyfsanavigator.com`) and Supabase (`qboidsfpjuxeqtfotryj`) passes final smoke testing.
7. Final Project Closeout Record is committed and frozen.
