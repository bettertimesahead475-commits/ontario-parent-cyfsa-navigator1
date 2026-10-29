# Evaluation Protocol: Michelle Clark Affidavit Record

Status: **PROTOCOL ONLY. No source document has been read, and nothing in this file is a verified fact.**

## 1. Correction notice (2026-10-29)

The previous version of this file (commits b97f9e86 and 5f9dfb39) presented five "gold anchors". None of them came from
the Michelle Clark record:

| Former anchor | Actual origin | Action |
|---|---|---|
| "a community member who wished to remain anonymous" | Copied from the synthetic case `eval/forensic/cases/affidavit-hearsay.json` (deponent "Dana Reyes") | Removed |
| "I have not personally observed the children without supervision." / "The home was clean and there was food in the refrigerator." | Same synthetic case | Removed |
| An Exhibit A email showing a medical explanation for an absence | No source; invented | Removed |
| Attendance checkmarks `[X]` / `[ ]` on an endorsement | No source; invented | Removed |
| CYFSA s. 74(2) threshold, attributed to pages 7-8 | Page location and content unverified | Kept as a question (section 4) |

The former page outline (nine pages, the content of pages 1-9) and the exhibit page counts were also unsourced, and
have been removed. Scoring the engine against those anchors would have rewarded findings that are not in the record.

The former text also attributed the five-day hearing rule to s. 90. The five-day period is in **s. 88**. The hearing it
refers to is held *under* s. 90(1). Section 4 has the text.

## 2. Confidentiality

- The record (affidavit, exhibits, endorsements, correspondence) is never committed. This repository is public.
- Real case files go under `eval/forensic/private/`, which `.gitignore` excludes. Run with
  `npx tsx scripts/forensicBenchmark.ts --private --max-spend-usd=<cap>`. Cases are then read from
  `eval/forensic/private/cases/` and results written to `eval/forensic/private/results/`. Results contain quotations
  from the documents.
- This file should hold no quotation from the record and no names except the deponent's, which the owner already used.
  **Owner decision pending:** this file, and its git history, name the deponent. If the name should not be public,
  rename the file and rewrite the history. A rewrite needs owner approval.

## 3. How anchors become verified

An item moves from UNVERIFIED to VERIFIED only when a person has:

1. read it in the original document (not in OCR output),
2. recorded the document, page and exact wording in the private case file (`eval/forensic/private/cases/<id>.json`, in
   the `BenchmarkCase` format used by `eval/forensic/cases/`), and
3. set `independentlyReviewed` to true only if someone other than the annotator checked it.

Until then, the benchmark can measure only behaviour that does not depend on the facts: grounding, refusals to
overstate, and cost and latency. It cannot measure recall of material findings.

## 4. Questions the record must answer (all UNVERIFIED)

These are the date points the owner identified. Each row says which category it belongs to *before* the documents are
read, and what would change that.

| # | Date point (owner's description) | Category until verified | What must be read to classify it |
|---|---|---|---|
| Q1 | September 11 correspondence | Investigative lead | Who wrote it, to whom, what it says, and whether it is an exhibit to the affidavit |
| Q2 | September 17 court-document issuance | Investigative lead | The document, its issuing stamp or date, and which proceeding it belongs to |
| Q3 | September 19 service and scheduling correspondence | Investigative lead | What was served, on whom, by what method, and what date it proposes |
| Q4 | September 25 hearing date | Unresolved legal question | Whether a hearing was held or only scheduled, and the endorsement for that date |
| Q5 | September 29 / September 30 affidavit dates | Investigative lead | Where each date appears (jurat, header, body, filing stamp, filename) and what each one records |
| Q6 | The five-day hearing question | Unresolved legal question | See below |

### Q6: the five-day hearing question

The provision (bundled consolidation, s. 88) reads: "As soon as practicable, but in any event within five days after
a child is brought to a place of safety under section 81, subclause 83 (1) (a) (ii) or subsection 136 (5), (a) the
matter shall be brought before a court for a hearing under subsection 90 (1) ...". It then gives other ways of meeting
the duty: (b) returning the child, (c) returning a child under an extra-provincial order, (d) a temporary care
agreement, or (e) an agreement with a 16- or 17-year-old.

So the five-day period runs from **the day a child was brought to a place of safety** under one of the listed
provisions. It does not run from correspondence, issuance, service, or the swearing of an affidavit. The engine may not
treat any of Q1-Q5 as the trigger. To conclude anything, it needs:

1. a document establishing that, and when, a child was brought to a place of safety, and under which provision;
2. the first court attendance, from the endorsement or the court record, not from a scheduling email;
3. whether one of the alternatives in s. 88(b)-(e) applied.

Without (1) and (2), the correct output is an investigative lead naming the documents to request. A hearing date more
than five days after some other event is not, on its own, a statutory breach. An adjournment by the court, on consent
or otherwise, is a court scheduling decision. It is not a proven violation by the Society. The engine also does not
presume who controlled the scheduling.

The bundled consolidation has not been checked against live e-Laws. The version in force on the relevant dates also
has to be confirmed (see `legal-reference/`).

## 5. Rules the scorer applies (fact-independent)

These can be scored now. A violation counts as an unsupported allegation (`evaluateTenDimensions`, dimension 3), the
same weight as a missed finding.

1. **Five-day rule.** A finding that states a s. 88 breach without a sourced place-of-safety date and a sourced first
   court attendance is a violation.
2. **Different dates.** Different dates across the jurat, the body, exhibits, filing stamps or the filename are not
   evidence of fraud, backdating or invalidity. Only a chronological impossibility counts as an anomaly, for example a
   deponent swearing to an event dated after the jurat. Even then, both dates must be quoted. Filename dates never
   count (`caseDateFor`).
3. **Signatures.** OCR that does not capture a handwritten signature or commissioner's stamp is not evidence of a
   missing signature. The only acceptable conclusions are "visually verified present", "visually verified absent" (from
   the page image), or "inconclusive / requires inspection of the original".
4. **Clerical inconsistency.** A typo, a mislabelled exhibit or a date discrepancy does not support a finding of
   misconduct or bad faith without further evidence. It may support a request for clarification.
5. **Legal conclusions.** Whether s. 74(2) grounds are made out is for the court. The engine may identify which facts
   the Society relies on, and which of them are firsthand, hearsay, or unsourced.

## 6. Running it

1. Pre-flight: no production keys or database connections are used. An explicit `--max-spend-usd` cap is required.
   The cap is an estimate from token prices, not a billing limit (see `docs/FORENSIC_ENGINE_HANDOFF.md`). The run is
   **not authorised** until the owner approves a cap. The proposed cap is US$2.50.
2. Put the record and the verified annotations in `eval/forensic/private/cases/`. Unverified items stay out of
   `expected` and are listed in `description` only.
3. Score with `evaluateTenDimensions`, and compare against the legacy analyzer (the benchmark runs both by default).
4. Report recall only for verified anchors. State the number of unverified items next to it.
