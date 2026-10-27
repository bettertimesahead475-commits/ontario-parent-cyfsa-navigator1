# Static citation audit: src/data.ts and StatutoryBookmarkSidebar

Date: 2026-10-24. Source of truth for CYFSA text: `legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt`
(its header states a consolidation period from July 1, 2026; see the consolidation note below).

## Consolidation date: unresolved

- The bundled file's header says "From July 1, 2026 to the e-Laws currency date." The filename's `2026-06-24` is not explained by the file.
- Ontario e-Laws (`www.ontario.ca`, `www.e-laws.gov.on.ca`) could not be reached from the build environment: the egress proxy refused the tunnel (HTTP 403), and the WebFetch tool could not resolve the hosts. A web search with `ontario.ca` and `e-laws.gov.on.ca` restricted to those domains did not return the consolidated statute page or its currency date.
- Status: **unverified**. Confirm the consolidation period on the e-Laws currency page before citing a date. No date was changed on the basis of this audit.

## Verified against the bundled CYFSA text

| Citation in app | Claim in app | Result |
|---|---|---|
| s. 81(7) (sidebar, data.ts) | Warrantless apprehension: worker believes (a) in need of protection, (b) under 16, (c) substantial risk during time to get warrant or hearing | Verified. Wording "substantial risk to the child's health or safety" matches. Peace officers apply under s. 81(12). |
| s. 81(2) (data.ts) | Warrant: justice of the peace; under 16; in need of protection; less restrictive course not available or will not protect the child adequately | Verified. |
| s. 81(13) (data.ts) | No action for an act done in good faith under s. 81, or for an alleged neglect or default in good faith in that duty | Verified. Corrected: the earlier summary omitted the neglect-or-default clause and added a court-process claim the text does not contain. |
| s. 88 (sidebar, data.ts) | Five-day rule after place of safety; hearing, return (including under an extra-provincial order), temporary care agreement, or s. 77 agreement | Verified. The sidebar previously omitted the extra-provincial return in para. (c). |
| s. 74(2) (sidebar, data.ts) | Grounds in clauses (a) to (o) | Verified as to structure. The text lists family circumstances as grounds (e.g. clause (k), parent died or unavailable; clause (n), parent unable to care), so the sidebar now says only that poverty and housing on their own are not listed. The poverty-and-clutter sentence was not in the text (corrected). |
| s. 74(3) (sidebar, data.ts) | Best-interests factors: views and wishes, physical, mental and emotional needs, and other listed circumstances | Verified. The sidebar previously said "safety"; the text says "needs". |
| s. 94(1), 94(2) (data.ts) | 30-day adjournment; temporary care and custody during adjournment | Verified (also in the statute quotations). |
| s. 101(1) para. 1 (new citation) | Supervision order, at least 3 and not more than 12 months | Verified. The sidebar previously cited s. 102, which is the custody order (corrected). |
| s. 101(1) para. 4 (data.ts) | Consecutive interim care and supervision: total not exceeding 12 months | Verified. |
| s. 101(3) (new citation) | Court may not remove child unless less disruptive alternatives would be inadequate | Verified (corrected: the earlier "thoroughly tried and failed" wording is not in the text). |
| s. 1(2) para. 2 (new citation) | Least disruptive course of action that is available and appropriate 'should be considered' | Verified. The earlier 'should be used' wording was corrected. |
| s. 13 (data.ts) | Child's own plan of care within 30 days of admission | Verified. |
| s. 121(3) (data.ts) | 10-day stay on execution of a care-and-custody decision after notice of appeal | Verified. |
| s. 121(2.1) (data.ts appeal section) | Appeal to Superior Court (from OCJ) or Divisional Court (from Family Court) | Verified. |
| s. 123 (data.ts) | Order expires when child turns 18 or marries | Verified. |
| s. 3 (sidebar) | Children's rights list | Verified as to content. The sidebar also attributed counsel rights and an age-12 rule to s. 3, which are not there (corrected; counsel now cites s. 78). |
| s. 78 (data.ts, sidebar) | Legal representation; court considers desirability; s. 78(4) deems representation desirable in listed cases unless the court is satisfied, taking into account the child's views and wishes, given due weight in accordance with the child's age and maturity, that the child's interests are otherwise adequately protected | Verified. Corrected: the sidebar previously said nothing of the s. 78(4) presumption, and the qualifier is now stated in full. |
| s. 72 (sidebar) | Regular consultation with bands about matters including places of safety and residential placement | Verified. |
| s. 70 (sidebar code comment; data.ts) | Designation of a child and family service authority (not consultation) | Heading verified. Not a sidebar item; cited only in a code comment and data.ts. |

## Corrected in this change

1. **Sidebar, "Supervision Order":** cited `CYFSA s. 102` (custody order). Now `s. 101(1), para. 1`, with the 3-to-12-month period from the text. Unsupported "usually with counselling conditions" is now labelled as practice, not statute.
2. **Sidebar, "Child's Right to be Heard & Counsel":** attributed legal counsel through the Office of the Children's Lawyer and an age-12 rule to s. 3. Neither appears in the bundled text. Now cites s. 3 for rights and s. 78 for representation.
3. **Sidebar, s. 81(7):** "children's aid worker" replaced with the statutory term "child protection worker", with the peace-officer power stated as s. 136(5). An earlier draft cited s. 81(12), which is Crown liability; that citation was wrong and is removed.
4. **Sidebar, s. 74(2):** "General concerns like home clutter or poverty do not meet this legal standard" replaced. Poverty and housing are not listed grounds; the sentence no longer states a legal conclusion the text does not contain.
5. **Sidebar, "Least Intrusive Course":** replaced "CAS must prove … thoroughly tried and failed" with the s. 101(3) test and the s. 1(2) para. 2 purpose ("should be considered").
6. **data.ts, s. 81(13):** good-faith immunity now includes the neglect-or-default clause; the unsupported court-process sentence was removed.

## Not verifiable from the repository (external sources needed)

These are not in `legal-reference/`. Each needs its primary text added to the repo, or counsel confirmation, before it is treated as verified.

- **Children's Law Reform Act, s. 8** (data.ts `clra-parentage-300-days`, sidebar `clra-8`): presumption of parentage and the 300-day window. The summary matches the general structure, but the statute text is not bundled. The sidebar's statement that "CAS must notify and assess both presumed parents" has no source in the repo.
- **Ontario Evidence Act, s. 35** (sidebar): business-records exception and hearsay within records. Legal interpretation; needs source text and counsel review.
- **Family Law Rules, r. 14 and r. 17** (sidebar): r. 17 states a Form 17B conference brief due 7 days before. data.ts also states "7 days before" for the same form. No rule text in repo.
- **Mental Health Act, ss. 15, 20, 38, 39** (data.ts, MHA section): certificate detention periods and review timelines. Not bundled.
- **Charter, s. 8** (data.ts link): well-known wording, but not checked against a source file in this environment.
- **Timeline estimate "usually scheduled within 30-45 days"** (data.ts `timelineLimit`): no source; a practice estimate and should be labelled as such.

## Checked at heading level only (not clause by clause)

s. 10, 12, 14, 15, 16, 20, 22, 33, 38, 39, 41, 48, 68, 71, 73, 75, 77, 79, 90, 98, 100, 104, 109, 110, 114, 116. Each heading exists in the bundled table of contents and matches the topic the app describes, but the app's specific obligations for these have not each been read against the section text. These are the next audit tranche.

## How the citation checks work

`src/utils/legalReferenceAudit.test.tsx` holds a hand-maintained table, `EXPECTED`, that lists the provisions each CYFSA item in the statutory sidebar relies on. Each entry is checked against the bundled text: the section exists, the subsection, clause or paragraph exists inside it, and a verbatim quote of the wording the sidebar relies on appears in the cited subsection (or section). The item scope is set by the names CYFSA and Child, Youth and Family Services Act. A completeness test fails if a CYFSA item has no entry.

The table does not list every provision the sidebar's prose mentions. It covers the provisions that carry each item's stated claims, as reviewed on 2026-10-24. A new claim in a sidebar item needs a new entry.

An earlier version parsed citation strings with a regular expression. Review found several forms it misread (ranges, subsection and clause continuations, paragraphs under the wrong section), so the parser was removed. The table does not cover subclauses (for example 74(2)(c)(i)).
