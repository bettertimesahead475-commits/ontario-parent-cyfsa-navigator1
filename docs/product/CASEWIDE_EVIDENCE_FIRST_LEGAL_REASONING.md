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


## CAS Powers, Limits & Parents' Rights — compact topic-tag library
Add a prominent public educational hub under **Learn Your Rights**, distinct from the analyzer. Use a dense, readable tag/chip selector inspired by compact topic navigation rather than oversized stacked cards. Do not imitate third-party branding or assume unspecified features from named examples.

### Interface
- Desktop: searchable, wrap-to-fit topic chips under a single concise heading; mobile: horizontally scrollable chip row with accessible overflow and optional "All topics" dropdown. Selected chip visibly active; keyboard and screen-reader usable; preserve selection in URL/query state.
- Default view: a short 2–3 sentence plain-language answer. Below it, compact tabs **CAS Concern**, **Parent Rights**, **CAS Powers & Limits**, **Evidence**, **Court & Next Steps**. Within a tab use nested disclosure rows only for detail, not a page of cards. Cite exact law and dates beside each legal statement.
- Offer "Read more", "Official law", "Find a lawyer" and "Print topic" actions without persistent floating clutter. Provide a site-wide topic search. No false guarantees, legal advice masquerading as a court ruling, or automatically generated claims of wrongdoing.
- Share a common layout and legal-criteria data source with Rights, Charter, Investigation, Procedure, First Five Days, Defense Strategies and Detailed CYFSA Guide. Avoid duplicating whole articles across routes. Preserve SEO-friendly direct URLs for individual topics and redirects for old links.

### Mandatory topic tags
Mental Health; Drug & Alcohol Use; Physical Abuse; Sexual Abuse & Exploitation; Domestic Violence; Neglect & Supervision; Medical & Educational Needs; Disability & Accommodations; Emotional Harm; Housing & Poverty; Kinship & Alternative Care; Emergency Removal; Home Visits & Interviews; Safety Plans & Consent; Court Deadlines; Disclosure & Evidence; Complaints & Oversight; Other Statutory Grounds.

For every tag, explicitly show:
1. **Why CAS may intervene:** the particular alleged child impact, exact applicable CYFSA s.74(2) ground (if any), legal triggering conditions, and differences between a referral, investigation, court application and removal.
2. **Parent rights:** procedural participation, representation, notice, access/disclosure and ability to challenge evidence as applicable, plus any lawful exceptions; distinguish rights of alleged offender, protective/non-offending parent and child.
3. **CAS powers and limits:** statutory authority, warrant/consent requirements and exceptions where relevant, reasonable alternatives, privacy/confidentiality and applicable human-rights accommodation obligations. Never suggest CAS is powerless to act in urgent safety situations.
4. **Proof and missing evidence:** required statutory elements, supporting and contrary facts, contemporaneous records, corroboration, child-safety factors and precise missing information. No unsupported claim that a diagnosis, addiction, disability, poverty or allegation alone conclusively proves a child needs protection.
5. **Practical next steps:** child-safety-first guidance, neutral professional communication, documentation checklist, verified Ontario decisions, official statute and court-form links, and when urgent legal assistance is appropriate.

### Topic-specific safeguards
- **Mental health:** distinguish diagnosis/forensic history from current functional parenting capacity, symptoms, observed impact, supports and relevant accommodations.
- **Substance use:** distinguish historical or disclosed use from current impairment, unsafe storage, supervision deficits, treatment and practical protective arrangements.
- **Physical abuse:** avoid prejudging allegations; identify injuries, medical findings, alternative explanations, discipline law and risk to child.
- **Sexual abuse:** prioritize child safety, avoid coaching interviews or evidence contamination, distinguish alleged perpetrator and protective parent, explain limits of privacy and urgent protective action.
- **Domestic violence:** identify coercive control, exposure and actual perpetrator behavior; do not automatically blame a survivor for victimization; analyze realistic protective steps.
- **Neglect/housing/poverty:** separate resource shortages from actual failure to meet child needs; assess supports and realistic alternatives.
- **Disability:** use individualized functional evidence, not stereotypes, and assess accommodation and accessible services.
- **Court deadlines/removal:** keep s.88 and other statutory pathways separate; never assert the five-day rule applies to every CAS interaction.

### QA and publication requirements
- Verify every statutory citation against official Ontario legislation, including the version applicable at the incident date; link directly to authoritative text. Verify case holdings and procedural guidance before publishing.
- Add routing and visual regression tests for all tags and deep links, keyboard/touch interaction, mobile overflow, source citations, legal exceptions, privacy, and the public hub. No fabricated legal quotations or cases.
- Existing analyzer, credit charging, authentication and production deployment remain untouched until tested and separately released.


## Mandatory legal citation and judicial authority coverage for CAS topic tags
**Publication gate:** The compact CAS Powers, Limits & Parents' Rights page is currently a high-level educational prototype. Do not describe its topic text as individually statute-cited, case-law verified, legally complete, or production ready until the requirements below are implemented and checked by legal-content review.

Every topic (mental health, substance use, physical abuse, sexual abuse, domestic violence, neglect, disability, emotional harm, housing/poverty, medical/educational needs, kinship, removal, investigation, safety plans, court deadlines, and other statutory grounds) must have a source-backed authority record:
- Exact jurisdiction, statute, title, section and subsection; official Ontario e-Laws or Justice Laws URL; date-effective version and date verified. Quote only verified wording.
- Precise child-protection ground (if applicable) and the distinct legal test for investigation, warrant, emergency removal, court application, temporary care, disposition or review; identify burden/standard and exceptions for the relevant procedural posture.
- Applicable procedural rights and their limits: notice, service, participation, disclosure, legal representation, evidence challenges, child rights and privacy; Ontario Human Rights Code and Charter rights only where actually engaged. Do not imply all Charter protections apply to all private or CAS actions.
- Relevant reported Canadian judgments with verified neutral citation, court, year, paragraph pinpoint, public link (CanLII or court source), facts, issue, holding, actual outcome, whether binding or persuasive, subsequent treatment if verified, and important distinctions or contrary authority.
- Official Ontario court rules and forms when pertinent, with form title, form number, official link and instructions for professional completion; do not prefill forms.
- Evidence checklist with supporting, contradicting and missing records; identify that absent uploaded material is not proof it does not exist.
- Source provenance, editorial review status and last-checked date; if authorities are unavailable or unverified, display a transparent 'legal sources being verified' state instead of fabricated citations.

Use **CYFSA 2017, s.74(2)** as a starting index for Ontario child-protection grounds, not as a blanket citation proving every concern. Cross-reference other applicable CYFSA sections, Ontario court rules, Human Rights Code, Criminal Code, Charter, and relevant judgments only where genuinely applicable. Distinguish criminal charges from child-protection findings, and avoid conflating a parent's diagnosis, past addiction, poverty or disability with proven danger. Sexual-abuse guidance must prioritize safety and avoid interview coaching or evidence contamination.

Acceptance: every displayed legal assertion has a working authoritative source or a clearly marked unsourced/general-education status; every cited judgment exists and supports the precise proposition; all 18+ topic tags have legally reviewed coverage; automated link checks and human legal review pass before production.


## Compact citation hyperlinks — final UX rule
Keep citations inline as small accessible text links or compact source chips, not long legal quotation blocks or duplicated citation cards. A statute citation (e.g., `CYFSA s. 74(2)`) must link to the official Ontario e-Laws statute and preferably a verified deep-link anchor for the specific section/subsection; if an anchor cannot be verified, link to the statute and do not falsely claim it opens at the subsection. Ontario court forms and rules link to their official Ontario Courts/ontariocourtforms source. A judgment citation (e.g., `2024 ONSC 1234, para. 20`) must link to the exact verified published decision on the court website or CanLII, ideally with a verified paragraph anchor. Do not substitute a generic CanLII search/results page for a case citation. Federal laws link to official Justice Laws, when applicable.

Source metadata should contain `label`, `authorityType`, `verifiedUrl`, `pinpoint`, `dateChecked` and `verified`. Only show clickable case citations for verified judgments. If an exact source is missing, show 'Source not yet verified' without a fabricated hyperlink. Open external sources in a new tab with `rel="noopener noreferrer"`, retain keyboard focus visibility and clear link names, and provide a subtle external-link indicator. Keep explanatory text short with expandable details. Validate link destinations and legal pinpoint references before publishing.
