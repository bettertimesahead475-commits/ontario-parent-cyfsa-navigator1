# Synthetic Ontario child-protection case (demonstration only)

**Every person, agency, place, date and document in this folder is fictional.** It contains no customer information and
was written for the Business Centre demonstration. Do not upload real client documents to a demonstration.

- Fictional agency: "Lakeshore Valley Children's Aid Society (SYN)". Not a real organization.
- Fictional family: Parent A (mother), Parent B (father), Child A (age 6), Child B (age 3).
- Fictional file number: SYN-2026-0417.

## Files (upload as plain text; each is one document)

| File | What it demonstrates |
|---|---|
| 01-investigation-summary.txt | Chronology with dates, findings, and quotable statements for quotation verification |
| 02-plan-of-care-excerpt.txt | Service-plan timeline, which tests deadline and section-citation checks |
| 03-court-order-excerpt.txt | A court-order paragraph and a deliberately misapplied statutory claim for the legal-citation checks |
| 04-parent-statement.txt | A parent's statement with a contradiction between its own sentences, for contextual verification |

## Expected behaviour (for the presenter; these are design expectations, not observed results)

- Quick Document Review: summary, the chronology, and quotations that verify EXACT or NORMALIZED_WHITESPACE.
- Forensic Deep Scan: red flags with verbatim quotes, threshold analysis, and the misapplied citation in file 03 flagged
  as unverified or inapplicable rather than accepted.
- Final Case Assessment: a case-level synthesis that marks each finding as verified or unverified.
- Legal citations: statutory references are checked against the bundled registry. A reference the registry cannot confirm
  must appear as unverified. The presenter should check the live output before the appointment, not rely on this note.
