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

### Rigorous Evidentiary Taxonomy

To prevent subjective or ungrounded model inflation, the protocol strictly segregates issues into five distinct evidentiary categories:

1. **Established Documentary Facts**: Facts directly sworn, stamped, or admitted in the record with unambiguous source quotes (e.g. date of first CAS involvement, worker's professional title, attendance records).
2. **Verified Contradictions**: Two or more mutually irreconcilable statements within the affidavit or between the affidavit and exhibits (e.g. worker deposes that parent gave no reason for absence, but Exhibit A shows contemporaneous email from parent giving medical explanation).
3. **Investigative Hypotheses**: Inferences regarding potential unreliability, bias, or procedural gaps that require counsel inquiry but are *not* conclusively proven by the face of the document.
4. **Unresolved Legal Questions**: Statutory thresholds (e.g. CYFSA s. 74(2) "child in need of protection") or procedural timelines (e.g. 5-day temporary care hearing) that must be assessed by counsel and court, not declared as automatic violations by an AI.
5. **Unsupported Allegations**: Assertions in the source document made on information and belief without identifying the source, or third-party hearsay without corroboration.

---

### Critical Guardrails & Prohibited Scoring Deductions

The evaluation scorer MUST penalize hallucinations and over-reaching claims as severely as missed material evidence:

1. **Five-Day Hearing Issue (CYFSA s. 90)**:
   - *Rule*: Do NOT automatically classify a hearing date beyond 5 days as a proven statutory violation. Without the initial court record or endorsement showing whether the delay was on consent, court congestion, or emergency adjournment, this is an **Unresolved Legal Question / Investigative Lead**, NOT a proven violation.
   - *Forbidden*: Concluding as fact that the Society or Court committed an unlawful detention without examining the adjournment endorsements.

2. **Different Dates on Documents**:
   - *Rule*: Do NOT treat different dates across affidavit paragraphs, exhibits, and filing stamps as proof that the affidavit is "fraudulent" or "invalid". Affidavits routinely depose to historical events over multi-month periods. Only actual chronological impossibilities (e.g. deponent swearing they attended an event that occurred after the jurat date) constitute verified anomalies.

3. **Signature & Jurat OCR Omissions**:
   - *Rule*: Do NOT infer a "missing signature" or "forged affidavit" merely because OCR failed to capture a handwritten cursive signature on the jurat. Where visual verification is inconclusive or OCR output omits a signature line, the finding must be classified as **Inconclusive / Requires Physical Inspection**, not a definitive failure to swear.

4. **Home Conditions & Risk Characterizations**:
   - *Rule*: Do NOT invent contradictions concerning home conditions. Distinguish between *admitted physical facts* (e.g. food in fridge, clean home) and *worker's subjective assessment* of risk. Report the tension as a foundation issue (Class C/D), not as perjury.

5. **Penalizing Unsupported Claims**:
   - The benchmark framework (`evaluateTenDimensions`) explicitly counts `unsupportedAllegations` and penalizes any finding where source quotes cannot be verified by cryptographic offset against the text layer.

---

### Key Material Issues (Gold Anchors)

1. **Anonymous / Hearsay Foundation Issue**:
   - *Category*: Unsupported Allegations / Evidence Admissibility (Class A / Class C)
   - *Anchor*: "a community member who wished to remain anonymous"
   - *Expected Proposition*: The central supervision concern relies on an unidentified caller whose reliability cannot be evaluated from the four corners of the affidavit.
   - *Requirement*: Required.

2. **Worker First-Hand Observation vs Risk Deposition**:
   - *Category*: Verified Contradiction / Tension (Class A / Class C)
   - *Anchor*: "I have not personally observed the children without supervision." / "The home was clean and there was food in the refrigerator."
   - *Expected Proposition*: The worker's direct observations during the home visit contradict or fail to substantiate the anonymous caller's summary of immediate risk.
   - *Requirement*: Required.

3. **Exhibit A Email Timestamp vs Unexplained Absence Deposition**:
   - *Category*: Verified Contradiction across Documents (Class A)
   - *Anchor*: Exhibit A timestamp showing written notice from parent prior to scheduled visit.
   - *Expected Proposition*: Exhibit A proves the worker received advance notice, directly rebutting the sworn assertion that the parent failed to attend without notice or explanation.
   - *Requirement*: Required.

4. **Visual Attendance & Jurat Markings**:
   - *Category*: Established Documentary Facts / Visual Check (Class A)
   - *Anchor*: Attendance checkmarks (`[X]` vs `[ ]`) and commissioner jurat block.
   - *Expected Proposition*: Objective verification of which parties and counsel were marked present on the endorsement/form.
   - *Requirement*: Required.

5. **Statutory Threshold Substantiation (CYFSA s. 74(2))**:
   - *Category*: Unresolved Legal Question / Judicial Test (Class D)
   - *Anchor*: Deposition alleging protection grounds under s. 74(2).
   - *Expected Proposition*: Identifies that the factual foundation for protection must satisfy the s. 74(2) threshold and distinguishes housing instability from protection risk without asserting a definitive legal ruling.
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
