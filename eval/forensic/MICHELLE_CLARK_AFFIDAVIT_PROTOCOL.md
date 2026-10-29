# Real-World Evaluation Protocol: Michelle Clark Affidavit & Exhibits

## Overview & Confidentiality Notice

This protocol defines the standardized, reproducible evaluation methodology for testing CYFSA Navigator's Elite Forensic Intelligence Engine against the multi-page, multi-document **Michelle Clark** case record:
1. **Primary Document**: 9-page Child Protection Worker Affidavit (sworn by worker Michelle Clark).
2. **Exhibit A**: Email thread between CAS worker and parent regarding home visit scheduling, access supervision, and allegations.
3. **Exhibit B**: Email thread regarding disclosure requests, court dates, and representation notice.
4. **Visual Evidence**: Multi-page scanned PDF with handwritten notes, attendance checkmarks, date stamps, and signature blocks.

> [!IMPORTANT]
> **Privacy and Confidentiality Rule**:
> Unredacted personal court filings, real child names, real CAS file numbers, and identifiable personal data must **NEVER** be committed to the public Git repository. Real test files must be stored in secure, local-only staging or loaded via encrypted environment configurations with appropriate pseudonymization applied prior to repository inclusion.

---

## Evaluation Objectives

The objective is to rigorously measure the Forensic Intelligence Engine's performance against the legacy sectioned analyzer across 10 critical forensic intelligence dimensions, verifying whether the system prioritizes accurate, impartial, source-grounded findings over producing large volumes of superficial allegations.

---

## 10-Dimension Forensic Evaluation Framework

Every evaluation run on the Michelle Clark record must score and compare both engines against these 10 criteria:

| # | Dimension | Evaluation Method | Target Criterion |
|---|---|---|---|
| **1** | **Material findings discovered** | Machine-verified quotation overlap against gold issue anchors (`anchors` array) | Recall of required substantive issues >= 90% |
| **2** | **Material findings missed** | Explicit tracking of unaddressed gold issues (`missed` array) | 0 missed high-significance procedural or evidentiary issues |
| **3** | **Unsupported allegations** | Identification of findings where quotes are unverified or absent from the source text | Zero ungrounded allegations delivered as verified facts |
| **4** | **Source attribution accuracy** | Exact page-and-offset verification (`resolveEvidenceRef`) across all 9 affidavit pages + exhibits | 100% verified source quotes |
| **5** | **Legal citation accuracy** | CYFSA statute citation lookup against canonical repository (`classifyCitation` and `retrieveLegalAuthority`) | Zero phantom or misattributed CYFSA section citations |
| **6** | **Chronology accuracy** | Event sequence ordering, timeline consistency between affidavit text and email timestamps, detection of retroactive dating anomalies | Accurate detection of chronology anomalies between Exhibit A and sworn statements |
| **7** | **Visual evidence interpretation** | Multimodal inspection of page layout, checkbox marks (`[X]` vs `[ ]`), signature presence, and exhibit stamps | Correct determination of visual marks without hallucinated signatures or inverted checkmarks |
| **8** | **Duplicate findings** | Detection and suppression of redundant or repetitive allegations | Redundancy rate <= 5% (findings merged or cross-referenced) |
| **9** | **Adversarial review effectiveness** | Audit of findings challenged, revised, or moved to appendix by the adversarial reviewer pass (Claude Opus) | Measurable filtering of weak, ungrounded, or overstated inferences into Appendix |
| **10** | **Cost and latency** | Stage-by-stage token accounting (input/output) and wall-clock execution time | Predictable cost per case within safety budget; bounded per-step latency |

---

## Test Record Inventory & Synthetic Gold Reference

### Document Structure

```text
Case: michelle-clark-affidavit
├── Document 1: aff (9 pages, Scanned PDF + Text Layer)
│   ├── Pages 1-3: Introduction, qualifications, family background, hearsay reports
│   ├── Pages 4-6: Worker home attendance observations vs third-party allegations
│   ├── Pages 7-8: Statutory grounds asserted under CYFSA s. 74(2) / s. 87 / s. 94
│   └── Page 9: Jurat, signature block, exhibit identification
├── Document 2: exhibit-a (Exhibit A: Email Correspondence — Schedule & Access)
│   └── 3 pages: Worker-parent communications documenting prior notification
└── Document 3: exhibit-b (Exhibit B: Email Correspondence — Disclosure & Counsel)
    └── 2 pages: Correspondence confirming counsel involvement and disclosure requests
```

### Key Material Issues (Gold Anchors)

1. **Anonymous / Double Hearsay**:
   - *Anchor*: Allegations regarding home conditions derived from undisclosed third-party caller without first-hand verification by worker.
   - *Classification*: Class A (Admissibility / Hearsay) or Class C (Lack of Foundation).
   - *Requirement*: Required.

2. **First-hand Contradiction with Risk Claim**:
   - *Anchor*: Worker's own home inspection notes (Page 5) documenting clean conditions, adequate food, and stable children, contradicting the sworn summary asserting immediate risk.
   - *Classification*: Class A (Direct Contradiction).
   - *Requirement*: Required.

3. **Timeline Inconsistency Between Exhibit A and Affidavit**:
   - *Anchor*: Email timestamp in Exhibit A shows parent gave advance notice of absence, contradicting affidavit assertion of "unexplained failure to appear".
   - *Classification*: Class A / Class B.
   - *Requirement*: Required.

4. **Visual Evidence (Checkbox Marks & Signatures)**:
   - *Anchor*: Form attendance boxes and signature verification on jurat.
   - *Classification*: Class A / Visual.
   - *Requirement*: Required.

5. **Statutory Threshold Substantiation**:
   - *Anchor*: Analysis of whether facts deposed satisfy the strict threshold of CYFSA s. 74(2) without conflating poverty or housing strain with child protection risk.
   - *Classification*: Class B / Class D.
   - *Requirement*: Required.

---

## Execution Protocol

### Step 1: Pre-Flight Safety Verification
1. Ensure no production environment keys or production database connections are used.
2. Confirm test runner operates with an explicit spending cap (e.g., `--max-spend-usd=5.00`).
3. Verify pseudonymization of all case parties, locations, and dates.

### Step 2: Multi-Document Ingestion & Provenance Recording
1. Pass the 9-page affidavit as the primary document (`sourceFile` base64 included for visual verification).
2. Pass Exhibit A and Exhibit B in `additionalDocuments` (up to 9 additional documents supported).
3. Validate that `pageProvenance` extracts per-page OCR and text-layer methods accurately.

### Step 3: Resumable Execution Validation
1. Execute Step 1 (`extract:aff`, `extract:exhibit-a`, `extract:exhibit-b`).
2. Verify intermediate state is saved in `CheckpointStore` (`state/000000.json`, `state/000001.json`, etc.).
3. Interrupt runner intentionally after Step 2 (`build`).
4. Resume via `advanceEngineJob` and verify execution continues without re-running completed extraction steps.
5. Advance through `investigate`, `review`, `visual`, and `ground`.

### Step 4: Multi-Dimensional Scoring
1. Score the generated report using `evaluateTenDimensions`.
2. Compare the output against baseline sectioned analyzer (`runSectionedAnalysis`).
3. Record exact token usage and latency.

### Step 5: Archival of Benchmark Artifacts
- Save structured JSON output in `eval/forensic/results/<timestamp>-michelle-clark.json`.
- Do not check in any raw personal evidence.
