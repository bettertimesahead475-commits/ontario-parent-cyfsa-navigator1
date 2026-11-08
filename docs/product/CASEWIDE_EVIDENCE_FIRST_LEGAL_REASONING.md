# Case-wide evidence-first legal reasoning — implementation contract

Status: APPROVED PRODUCT DIRECTION; NOT IMPLEMENTED OR DEPLOYED.
Branch: feature/casewide-evidence-explained-flags-20261108
Production safety: never change production deployment or payment entitlements as part of this specification without separate validation and authorization.

## Mission
Apply a consistent, plain-English (approximately grade 8–10) evidence-to-law explanation across every CYFSA Navigator experience: Quick Review, Forensic Review, individual document views, multi-document Master Case Report, legal education pages, case law, court preparation, print/export, and subsequent case updates.

## Standard flag display
Each flag has these mandatory expandable sections, in this order:
1. **Why We Flagged This**: identify the precise quoted or faithfully summarized source passage, the trigger, the source document, page, paragraph and date; distinguish document assertions from established facts.
2. **What the Law Says**: specific statute/provision, version applicable on event date, readable explanation and link to authoritative source; do not invent statutory language.
3. **What CAS Had to Prove**: enumerate the ELEMENTS of the exact statutory test for the procedural posture and statutory authority involved; do not conflate removal grounds, warrantless urgency, first hearing, temporary care, or adjournments.
4. **What the Evidence Shows**: for each element, show CAS's claim, supporting evidence, contrary evidence, missing evidence, exact citations and element-level outcome.
5. **What Judges Have Ruled**: one tab per verified judicial decision; court/year/citation, material facts, legal issue, holding, actual order, limits/distinctions and relevance; never promise an outcome because one case granted it.
6. **What This Means for You**: evidence-supported determination, legal consequences and expected process, options for relief, recommended next step, official court-form links and neutral professional filing guidance. Explicitly separate mandatory legal rules from discretionary judicial remedies.

Avoid labels such as 'potential remedy', 'legal finding and determination', or generic 'required steps' in parent-facing UI. Expand technical legal terms on demand; keep full legal citations accessible.

## Finding states
- Requirement met: each required element supported by verified record.
- Requirement not met: reliable evidence establishes the rule applies and a required element was not satisfied.
- Appears not met: strong record evidence but an essential fact or procedural document remains unverified.
- Not enough information: name the exact missing records and why they matter.
- Does not apply: explain why this legal test is inapplicable.
Never treat absence from uploaded files as proof of absence from the court record. Separate legal issue severity from evidentiary confidence. A flag is not a finding of guilt, misconduct, or a guaranteed remedy.

## Source linking and provenance
Every finding has a stable finding ID and references source document ID, immutable version, page, paragraph where present, quoted excerpt, text offsets and/or PDF bounding boxes, extraction confidence and OCR provenance. Clicking a flag navigates to the precise highlighted source. Clicking the source returns to the flag. Cross-document findings list ALL supporting, contradicting and qualifying passages. Never fabricate page/paragraph references or claim precise highlighting if extraction lacks offsets.

## Case workspace
- Case contains multiple versioned documents: CAS affidavits, parent's affidavits, orders, endorsements, exhibits, disclosure, correspondence.
- Each document has its own accordion analysis and traceable flags.
- Master Case Report synthesizes the entire case once: unified chronology, cross-document corroboration and contradictions, statute-by-statute legal tests, current standing, deadlines, and evidence gaps.
- Generate a single court-preparation/hearing brief at the END from the whole case; do not create a redundant brief for each document.
- Adding documents updates affected findings, shows why conclusions changed, preserves prior report snapshots, and avoids billing again for unchanged documents.
- Price estimate before batch processing: document count, readable pages, complexity, model costs, optional hearing preparation; obtain authorization before charging.

## Section 88 example — no over-generalization
For a removal to a place of safety covered by CYFSA s.88, determine which statutory removal power applies, exact trigger date, as-soon-as-practicable requirement, five-day limit and any legally applicable timing rules. Distinguish filing an application from bringing the matter before the court for a hearing. Check return of child or other permitted statutory outcomes, including qualifying agreements, with dated evidence. Identify removal criteria separately (including warrantless urgency where applicable), and the distinct legal test for temporary care/adjournment. Cite authoritative current and event-date statutes and verified relevant case law, including contrary/distinguishing rulings. Do not infer a confirmed breach from a 16-day first-recorded-hearing gap alone when records may be incomplete.

## Content and legal source quality
- Build a verified, date-versioned legal criteria library for each legal issue: elements, triggering conditions, exceptions, evidence required, governing law, relevant decisions, procedure, possible relief.
- Require citations to authoritative legislation and actual case decisions; case summaries distinguish holding from dicta.
- If sources unavailable or verification incomplete, fail visibly rather than present a fully verified report.
- Never invent cases, statutes, legal outcomes, quotations, documents, or OCR references.
- Present balanced evidence, including material facts against the parent's position; avoid assuming CAS is wrong.
- Keep language plain, neutral, professional, suitable for a self-represented parent; separate education from case-specific legal advice.

## Product-wide surfaces
Quick Review: concise expandable six-part findings and direct document links.
Forensic Review: all six sections, element-by-element analysis, cross-check and mandatory completed independent verification before marking report complete.
Individual Document: own expandable findings, citations and links to master.
Master Report: one case-wide synthesis with linked source flags and document tabs.
Law & Procedure / First 5 Days / Rights / Investigation / Charter / Detailed Guide: same criteria-first teaching structure, verified sources and case-law tabs.
Court Prep: one case-wide brief, evidence list, strengths/weaknesses, procedural options, official form links and detailed professional filling instructions; do NOT auto-populate court forms.
Exports: retain flag IDs, source references, law/case citations, uncertainty and document version.
Accessibility: keyboard navigation, readable type, descriptive links, mobile-friendly accordions.

## Engineering acceptance tests
1. A flagged sentence opens the exact original page/passage, and back navigation preserves context.
2. Each flag enumerates all elements of the applicable legal test and grades evidence separately.
3. Missing court records cannot yield a falsely confirmed deadline breach.
4. Filing date and first hearing date are not treated as interchangeable.
5. Case law tabs cite verified decisions, actual outcomes and distinguishing facts.
6. Cross-document contradictions link both passages; no fabricated quotes.
7. Master report reflects all included documents; final court brief generated only once.
8. Added evidence updates only affected analyses and preserves change history.
9. Forensic verification incomplete => report cannot be labelled completed.
10. All parent-facing text passes plain-language editorial review; technical citations remain available.
11. No production changes without tests, privacy review, migration plan and release approval.

## Implementation order
1. Inventory current analyzer schemas, report generators, routes, educational content and court prep.
2. Introduce typed legal-criteria and evidence-provenance contracts with backwards-compatible adapters.
3. Add element-level reasoning and verified source retrieval with validation tests.
4. Implement flag explanation and source-link UX.
5. Add case-wide document storage, master synthesis, versioning and court brief.
6. Refactor legal education and case-law tabs to share verified criteria data.
7. Update export, pricing, accessibility, regression tests and staging E2E.
8. Deploy to staging, run legal-content review and seek separate production approval.
