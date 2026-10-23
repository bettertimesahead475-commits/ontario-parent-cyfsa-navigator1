# Analyzer Validation Matrix

**Purpose:** define representative test cases for Quick Review and Forensic Deep Scan, say what each case covers, and separate what runs offline from what needs a live model.

**Status:** matrix only. **No paid model call was made.** Live rows are marked, and none has been run.

## 1. What can run without paid calls

The repository tests mock the model provider (`mockCreateMessage`, `mockGenerateContent`). These tests exercise everything **after** the model returns: parsing, validation, section assembly, citation handling, classification, cost and credit accounting, and error paths. They do not show that the model produces good analysis.

| Layer | Testable offline? | Existing tests |
|---|---|---|
| Prompt construction | Not unit-tested. `analyzerPrompts.ts` has no test file. Prompt content is reviewed by hand. | None |
| Model response parsing and validation | Yes, with fixtures | `analyzerSections.test.ts`, `reportContract.test.ts` |
| Report assembly into 16 sections | Yes | `reportContract.test.ts` (36 cases), `reportSections.test.ts` (10) |
| Court-order and endorsement classification | Yes | `courtRecordClassification.test.ts` (11) |
| Customer metadata allowlist, cost redaction | Yes | `analyzerCustomerMetadata.test.ts` (3) |
| Quote and citation verification | Yes | `pageSources.test.ts` (24), `legalAuthority.test.ts` (61) |
| Credit accounting | Yes (ledger tests) | `creditAccounting.test.ts` (9) |
| Provider failure and recovery | Yes (mocked failure) | `analyzerErrors.providerFailure.test.ts` (7) |
| Route-level flow with real PDF bytes | Yes (provider mocked) | `analyzerRealPdfE2E.test.ts` (7), `analyzerEndToEnd.test.ts` (42) |
| **Output quality, citation accuracy, legal correctness** | **No** | Requires live model and human review |
| **Model-specific failures (refusals, format drift)** | **No** | Requires live model |

## 2. Report sections (contract)

From `shared/reportContract.ts`. Each section has a status (POPULATED, EMPTY, NOT_APPLICABLE, NOT_GENERATED).

| Section | Title | Source in current analyzer |
|---|---|---|
| S01 | Summary | Quick Review `overview`, Forensic |
| S02 | Document type and details | Analyzer metadata |
| S03 | Chronology | Quick Review `chronology` |
| S04 | Court record | `documentAuthority`, court-order classification |
| S05 | Rights and timeline items | `shared/reportSections.ts` (rights triggers) |
| S06 | Evidence strength and reliability | Heuristic score (not verified; labelled as such) |
| S07 | Contradictions | Forensic verification |
| S08 | Missing records | Analyzer `whatIsMissing` |
| S09 | Threshold checks | Not produced by Quick Review |
| S10 | Court decisions (case law) | **Not generated.** No verified case-law source is connected. |
| S11 | Other side's arguments | **Not generated.** |
| S12 | Questions for counsel | `whatToAskALawyer` |
| S13 | Items to verify | `whatToVerify` |
| S14 | Forms | **Not generated.** Needs legal-services review. |
| S15 | Deadlines | **Not generated.** Needs verified rules. |
| S16 | Sources and professional brief | `lawyerCaseBrief`, verification, sources |

Quick Review produces the `overview`, `redFlags`, `chronology`, and `guidance` sources. Forensic Deep Scan produces six sections plus a verification pass. Both map into the same 16-section contract.

## 3. Test cases

Columns: **Offline** = runs in the current test suite with mocks. **Live** = needs a real model call. **Budget** = needs owner approval before running live.

### Quick Review

| ID | Case | Input | Checks | Offline | Live (budget) |
|---|---|---|---|---|---|
| QR-01 | Ordinary affidavit | Synthetic affidavit with 3 red flags | S01, S03, S05, S06, S08, S12, S13 populated; S10/S11/S14/S15 NOT_GENERATED | Yes (`reportContract`) | Optional, small |
| QR-02 | Court endorsement | Endorsement text with judge's finding | S04 populated; S06 NOT_APPLICABLE; no evidence score | Yes (`courtRecordClassification`) | Optional |
| QR-03 | Empty document | Blank or unreadable page | Clear "no content" path; no fabricated findings | Yes (`reportContract` empty cases) | No |
| QR-04 | Referenced affidavit not provided | Endorsement references a missing affidavit | Missing-record finding in S08; not a procedural concern | Yes (`reportContract`) | No |
| QR-05 | Quotation present | Affidavit with an exact quote | Quote verified exact; citation to page | Yes (`pageSources`) | Optional |
| QR-06 | Quotation absent | Model returns a quote not in the page | Marked ABSENT, REQUIRES_SOURCE; no offsets | Yes (v1 evidence tests) | Optional |
| QR-07 | Provider failure | Provider error mid-run | Clean error, no charge, retryable | Yes (`providerFailure`) | No |
| QR-08 | Malformed model output | Invalid JSON from provider | Rejected, reported, no partial report | Yes (validation tests) | No |

### Forensic Deep Scan

| ID | Case | Input | Checks | Offline | Live (budget) |
|---|---|---|---|---|---|
| FD-01 | Contradictory evidence | Two passages that disagree on the same event | S07 finding with both passages; contradiction not called "verified" without two sources | Partly (`reportContract` contradictions) | Yes |
| FD-02 | Legal authority cited | Document citing a statute section | Authority verified against the local consolidation text, or marked unverified | Yes (`legalAuthority.test.ts`, `parentalRights.test.ts`) | Yes |
| FD-03 | Missing documents | Referenced exhibits absent | S08 entries; no invented exhibit | Yes | Yes |
| FD-04 | Verification pass disagreement | Verifier rejects a finding | Finding downgraded; verifier identity not exposed to customer | Yes (`analyzerCustomerMetadata`, `stripVerifierIdentity`) | Yes |
| FD-05 | Full 16-section report | Multi-page court file | All 16 sections present with correct status | Yes (`reportContract`) | Yes |
| FD-06 | Cost not exposed | Any run | No cost, token, or model field reaches the customer | Yes (`analyzerCustomerMetadata`) | Yes |

## 4. Coverage assessment

- **Offline coverage is broad for structure.** Every section status, classification, redaction, and error path has at least one test.
- **Offline coverage does not show analysis quality.** A passing test means the code handles whatever the model returns. It does not mean the model returns correct legal analysis.
- **No live model run has been performed in this audit.** No claim of live analyzer success is made.
- **S10, S11, S14, and S15 are not generated by design.** Tests check that they are marked NOT_GENERATED, not that they contain content.

## 5. What a live run requires

| Requirement | Owner action |
|---|---|
| Model API key for the staging environment | Provision a staging-only key with a spend cap |
| Budget per run and total | Approve a budget (see below) |
| Synthetic documents only | Confirm no real family-court documents are used |
| Human review of outputs | Assign a reviewer for each live result |
| Logging without content | Confirm logs record metadata only |

**Proposed initial budget (for approval, not spent):** at most 8 live runs (QR-01, QR-02, QR-05, FD-01, FD-02, FD-03, FD-05, and one repeat of QR-01 to measure variance). The owner sets the actual cap.

## 6. Approval requests

1. Approve a staging model key and spend cap.
2. Approve the initial live run list (section 5), or change it.
3. Confirm synthetic documents only.
4. Name a human reviewer for live outputs.
