/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CYFSATopic, CourtStep, ResearchSummary, LawyerProfile, AffidavitDraft } from "./types";

// All CYFSA and Bill C-92 (federal) section citations in this file are verified directly
// against the full statute text saved in legal-reference/ (see legal-reference/README.md for
// what was checked and when). Where a claim isn't answered by either of those two files, it is
// explicitly flagged "unverified" rather than given a section number we can't confirm — a wrong
// citation is worse than no citation.

export const CYFSA_TOPICS: CYFSATopic[] = [
  {
    id: "emergency-removal",
    title: "Emergency Apprehension Without a Warrant",
    badge: "First 5 Days Warning",
    category: "Removal",
    summary: "CYFSA s. 81 lets a child protection worker bring a child to a place of safety either with a warrant, or — for children under 16 only — without one, if a strict 'substantial risk' threshold is met. A hearing must follow within five days.",
    fullBody: `Section 81 of the Child, Youth and Family Services Act (CYFSA) covers several distinct powers — they are easy to conflate, but the rights and thresholds are different for each:

**s. 81(1) — Starting a case:** A society may apply to the court to determine whether a child is in need of protection. This is what commences a formal proceeding. It does not, by itself, authorize removing a child from your care.

**s. 81(2) — Warrant:** A justice of the peace may issue a warrant authorizing a worker to bring a child to a place of safety, if satisfied there are reasonable and probable grounds that: the child is younger than 16; the child is in need of protection; and a less restrictive course of action is not available or will not protect the child adequately.

**s. 81(7) — Warrantless apprehension:** A worker may bring a child to a place of safety WITHOUT a warrant only if the worker believes on reasonable and probable grounds that: (a) the child is in need of protection; (b) the child is younger than 16; AND (c) there would be a **substantial risk to the child's health or safety** during the time it would take to bring the matter to a hearing or obtain a warrant. This is the actual legal threshold — not "immediate risk of serious harm," which is not the statutory wording, and not available at all for a 16 or 17 year old under this subsection.

**s. 81(9) & (10):** A worker acting under (7), a warrant, or a court order may authorize a child's medical examination even where a parent's consent would otherwise be required, and may enter premises without a warrant, by force if necessary, to search for and remove the child.

**s. 81(13):** A peace officer or worker acting in good faith under this section cannot be sued personally for the apprehension itself — challenges go through the court process below, not a lawsuit against the individual worker.

**The five-day hearing (s. 88):** As soon as practicable, but in any event within five days after a child is brought to a place of safety under s. 81, the matter must be brought before a court for a hearing under s. 90(1), the child must be returned to whoever last had charge of them, a temporary care agreement must be made under s. 75(1), or an agreement made under s. 77 (16/17 year olds). Note: the Act says "five days," not "five court days" — confirm with counsel exactly how the days are counted in your registry before relying on a specific calendar date.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 81(1), (2), (7), (9), (10), (13) — Application / warrant / warrantless apprehension" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 88 — Time in place of safety limited (the five-day rule)" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 90(1) — Child protection hearing" }
    ],
    guidelines: [
      "Ask directly which power was used: a warrant under s. 81(2), or the no-warrant power under s. 81(7). They have different thresholds and different paperwork.",
      "If your child is 16 or 17, s. 81(7)'s no-warrant power does not apply to them at all — ask what authority is actually being relied on.",
      "Write down the exact date and time the child was brought to a place of safety. The s. 88 hearing clock starts from that moment, not from when you were served with paperwork."
    ],
    checklistItems: [
      { label: "Identify the exact power used", description: "Warrant (s. 81(2)) or warrantless (s. 81(7))? The no-warrant power requires the worker to show a substantial risk during the time needed to get a hearing or warrant — a vague 'ongoing concern' does not meet this on its own." },
      { label: "Confirm the child's age", description: "s. 81(7)'s no-warrant apprehension power applies only to children under 16." },
      { label: "Track the s. 88 clock", description: "Confirm with your lawyer or the court registry exactly how 'within five days' is counted for your matter, and that the s. 90(1) hearing was actually scheduled inside that window." }
    ],
    factVersusFiction: [
      {
        fiction: "CAS workers can hold your child indefinitely without a judge ever reviewing it.",
        fact: "s. 88 requires the matter to be brought before a court for a hearing under s. 90(1) within five days of the child being brought to a place of safety.",
        sourceExplanation: "CYFSA s. 88, verified against the current consolidated text."
      },
      {
        fiction: "The legal standard for a warrantless apprehension is 'immediate risk of serious harm.'",
        fact: "The actual statutory wording is 'a substantial risk to the child's health or safety during the time necessary to bring the matter on for a hearing... or obtain a warrant' — and it only applies to children under 16.",
        sourceExplanation: "CYFSA s. 81(7), verified against the current consolidated text."
      }
    ]
  },
  {
    id: "protection-grounds",
    title: "The Protection Grounds CAS Must Prove (Section 74)",
    badge: "Statutory Guidance",
    category: "Protection Grounds",
    summary: "A child is 'in need of protection' under Ontario law only if at least one of the specific grounds in CYFSA s. 74(2) is met — currently 17 clauses, including two added in 2021 for child sex trafficking.",
    fullBody: `Under s. 74(2) of the CYFSA, a child is a "child in need of protection" ONLY if at least one of the following applies. This list was expanded in 2021 (clauses (d.1) and (d.2), sex trafficking) and again for prescribed 16/17-year-old circumstances (clause (o)) — an older "12 grounds" list is out of date.

1. **(a) Physical harm** already suffered, inflicted by or resulting from the caregiver's failure to adequately care for/supervise/protect the child, or a pattern of neglect.
2. **(b) Risk of physical harm** of the same kind.
3. **(c) Sexual abuse or exploitation** already suffered, by the caregiver or by someone else the caregiver knew or should have known about and failed to protect against.
4. **(d) Risk of sexual abuse or exploitation** of the same kind.
5. **(d.1) Sexual exploitation through child sex trafficking** (added 2021).
6. **(d.2) Risk of sexual exploitation through child sex trafficking** (added 2021).
7. **(e) Medical neglect** — the child needs treatment for physical harm/suffering and the parent doesn't provide or consent to it (or, where the child can't consent themselves under the Health Care Consent Act and the parent is substitute decision-maker, the parent refuses/is unavailable/unable to consent).
8. **(f) Emotional harm already suffered** — serious anxiety, depression, withdrawal, self-destructive/aggressive behaviour, or delayed development, with reasonable grounds it results from the caregiver's actions, inaction, or neglect.
9. **(g) Emotional harm as in (f), and** the caregiver doesn't provide/consent to services or treatment to remedy it.
10. **(h) Risk of emotional harm** as in (f).
11. **(i) Risk of emotional harm as in (h), and** the caregiver doesn't provide/consent to preventive services or treatment.
12. **(j) A condition that could seriously impair development** if not remedied, and the caregiver doesn't provide/consent to treatment.
13. **(k) Parental death/unavailability** with no adequate provision made for the child's care, or the child is in residential placement and the parent won't/can't resume care.
14. **(l) Under 12 and caused serious harm/damage** — the child is younger than 12, has killed or seriously injured someone or caused serious property/service damage, needs services to prevent recurrence, and the caregiver doesn't provide/consent to those services.
15. **(m) Under 12, repeat minor harm** — younger than 12, has on more than one occasion injured someone or damaged property, with the caregiver's encouragement or through failure to supervise adequately.
16. **(n) Parent unable to care, brought with consent** — the parent can't care for the child and the child is brought before the court with the parent's consent (and the child's own consent, if 12 or older).
17. **(o) 16 or 17 and a prescribed circumstance exists** (regulation-defined).

**Best interests factors (s. 74(3)):** whenever a "best interests" determination is made under this Part, the decision-maker must consider the child's views and wishes; for a First Nations, Inuk or Métis child, the importance of preserving cultural identity and community connection; and a list of other factors including physical/mental/emotional needs, continuity of care, and the risk of harm from removal itself versus remaining in/returning to a parent's care.

If a worker's stated concerns don't fit one of these clauses, the Society lacks statutory grounds to bring a protection finding on them alone.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 74(2) — Child in need of protection (all 17 clauses, incl. 2021 sex-trafficking amendments)" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 74(3) — Best interests factors" }
    ],
    guidelines: [
      "Ask the worker to identify the specific lettered clause(s) of s. 74(2) they say apply to your family — 'general concern about the home' is not a clause.",
      "Document every voluntary service you've requested or engaged with — several clauses turn on whether a caregiver 'fails, refuses, or is unable' to accept help, not on the underlying condition alone.",
      "If your child is First Nations, Inuk, or Métis, know that s. 74(3)(b) requires cultural identity and community connection to be weighed in every best-interests decision, not just placement decisions."
    ],
    checklistItems: [
      { label: "Identify the specific clause(s) alleged", description: "Every clause has its own precise wording and its own caregiver-conduct element (failure, refusal, or inability to provide/consent). A report that doesn't map onto a specific clause isn't a protection finding by itself." },
      { label: "Evaluate cooperation evidence", description: "For clauses built around 'failure or refusal to protect/consent,' evidence of active cooperation with medical, counselling, or safety plans is directly relevant." }
    ],
    factVersusFiction: [
      {
        fiction: "Being low-income or having a messy home is, on its own, a protection ground.",
        fact: "None of the 17 clauses in s. 74(2) turn on poverty or housekeeping standards by themselves — each requires an actual or risked harm plus a specific caregiver-conduct element.",
        sourceExplanation: "CYFSA s. 74(2), verified against the current consolidated text."
      }
    ]
  },
  {
    id: "worker-authority-limits",
    title: "Limits on CAS Worker Authority",
    badge: "Know Your Rights",
    category: "Worker Authority",
    summary: "CAS workers are civil investigators, not law enforcement. Entry, search, and warrantless removal are governed precisely by CYFSA s. 81 — outside that, ordinary Charter and common-law limits on entry and search still apply.",
    fullBody: `A common area of confusion is the scope of a CAS worker's authority. Outside the specific powers in s. 81 (see the "Emergency Apprehension" topic for the exact thresholds), a worker does not have a freestanding power to search your home, compel a drug/medical test, or remove a child.

- Warrantless entry to search for and remove a child is available under s. 81(10), but only tied to the same s. 81(7) grounds (substantial risk, child under 16).
- A worker acting under s. 81(7), a warrant under s. 81(2), or a related court order may authorize a child's medical examination that would otherwise need a parent's consent (s. 81(9)) — but this is tied to those specific circumstances, not a general power to compel testing.
- Outside of s. 81, ordinary Charter protections against unreasonable search and seizure, and the general right to consult a lawyer before agreeing to anything, still apply the same way they would with any other investigator.

There is no CYFSA section that grants a parent a specific "right to counsel before speaking to CAS" — that comes from general legal principle and Legal Aid Ontario access, not a numbered CYFSA right. Don't let a worker cite a specific section number for something that isn't in the Act.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 81(2), (7), (9), (10) — Warrant, warrantless apprehension, medical exam, entry" },
      { label: "Constitution Act, 1982, Part I (Canadian Charter of Rights and Freedoms)", url: "https://laws-lois.justice.gc.ca/eng/const/page-1.html", citation: "s. 8 — Right to be secure against unreasonable search or seizure" }
    ],
    guidelines: [
      "If a worker requests entry, ask directly: 'Do you have a warrant under s. 81(2), or are you relying on s. 81(7)?'",
      "You are entitled to decline entry absent a warrant or one of the specific s. 81 grounds — say so clearly and calmly, and ask to continue the conversation with your lawyer present.",
      "Never sign a 'voluntary' safety plan, consent, or admission without reviewing it with counsel first — you can revoke a previously signed voluntary consent in writing at any time."
    ],
    checklistItems: [
      { label: "Confirm the exact legal basis for entry", description: "Warrant (s. 81(2)) or warrantless (s. 81(7))? If neither, entry requires your consent." },
      { label: "Log any coercive language", description: "Keep a dated record of any statement suggesting cooperation is required to avoid apprehension, for your lawyer to review." }
    ],
    factVersusFiction: [
      {
        fiction: "If I don't let CAS in immediately, police can force entry without a warrant.",
        fact: "Police cannot force entry for a child-protection matter absent a judicial warrant or true exigent circumstances (e.g., an immediate life-threatening emergency) — the same general Charter and common-law limits on police entry apply here as elsewhere.",
        sourceExplanation: "Charter s. 8; general Canadian common-law limits on warrantless entry (e.g., R. v. Feeney, 1997 CanLII 158 (SCC))."
      }
    ]
  },
  {
    id: "right-to-counsel-legal-representation",
    title: "Legal Representation: The Child's Right and the Parent's Position",
    badge: "New",
    category: "Rights",
    summary: "CYFSA s. 78 gives a child a right to legal representation in a protection proceeding, and sets out when the court MUST direct it. A parent's right to retain their own counsel isn't a numbered CYFSA section — it comes from general legal aid access and party status under s. 79.",
    fullBody: `**The child's right to legal representation (s. 78):** A child may have legal representation at any stage of a protection proceeding. Where a child doesn't have representation, the court must, as soon as practicable, and may at any later stage, determine whether representation is desirable to protect the child's interests — and if it decides representation IS desirable, the court must direct that it be provided.

**s. 78(4) — when representation is deemed desirable** (i.e., presumed necessary unless the court is satisfied, given the child's views and weight due to age/maturity, that the child's interests are otherwise adequately protected):
- there's a difference of views between the child and a parent or the society, and the society proposes removal or interim/extended society care;
- the child is in the society's care and either no parent appears, or the alleged protection ground is (a), (c), (f), (g), or (j) of s. 74(2) (the harm-based grounds); or
- the child isn't permitted to be present at the hearing.

**s. 78(5) — where a parent is themselves a minor:** if a child's parent is younger than 18, the Office of the Children's Lawyer represents that parent in the proceeding, unless the court orders otherwise.

**The parent's own position:** CYFSA does not contain a specific numbered section granting a parent a right to retain a lawyer — that comes from general access to justice (Legal Aid Ontario certificates for qualifying income) and from being an automatic party to the proceeding (s. 79(1), para. 3: "the child's parent" is always a party), which carries the ordinary right to participate, be heard, file evidence, and be represented by counsel of your choosing or through Legal Aid.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 78 — Legal representation of child (incl. subsections (4) and (5))" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 79(1) — Parties to a proceeding" },
      { label: "Legal Aid Ontario", url: "https://www.legalaid.on.ca/", citation: "General eligibility and certificate process — not a CYFSA-numbered right" }
    ],
    guidelines: [
      "If your child is in the society's care and any of the s. 78(4) triggers apply, legal representation for the child is presumed necessary — ask whether the court has made that determination.",
      "If you are yourself under 18, you are entitled to representation by the Office of the Children's Lawyer under s. 78(5) unless the court orders otherwise.",
      "Contact Legal Aid Ontario (1-800-668-8258) as early as possible — being a party under s. 79(1) gives you the right to participate, but doesn't provide a lawyer automatically."
    ],
    checklistItems: [
      { label: "Check the s. 78(4) triggers", description: "Do any of the three deemed-desirable circumstances apply to your child? If so, the presumption favours representation being ordered." },
      { label: "Confirm your own party status", description: "As the child's parent, you are automatically a party under s. 79(1) — verify you are receiving all notices and materials that come with that status." }
    ],
    factVersusFiction: [
      {
        fiction: "A specific CYFSA section guarantees a parent a lawyer paid for by the court.",
        fact: "There is no such section for parents. The child's right to representation under s. 78 is a separate, specific statutory right; a parent's access to counsel runs through Legal Aid Ontario eligibility, not a CYFSA entitlement.",
        sourceExplanation: "CYFSA s. 78, verified against the current consolidated text — it applies to the child, not the parent."
      }
    ]
  },
  {
    id: "parent-child-rights",
    title: "Parent's Retained Rights & Child's Statutory Rights",
    badge: "Protected Statuses",
    category: "Rights",
    summary: "Children and young persons receiving services have a specific list of statutory rights under s. 3. A parent whose child is in care keeps specific rights under s. 14, and the society must weigh a parent's wishes in major decisions under s. 109(5).",
    fullBody: `**Child/young person rights (s. 3):** every child or young person receiving services under the Act has the right to: (1) express their own views freely and safely about matters affecting them; (2) be engaged in honest, respectful dialogue about decisions affecting them, with their views given due weight for their age/maturity; (3) be consulted on services provided or to be provided, participate in decisions about them, and be advised of the decisions made; (4) raise concerns or recommend changes without fear of coercion or reprisal, and receive a response; and (5) be informed, in language suitable to their understanding, of their rights under this Part.

**Parent's retained rights while a child is in care (s. 14):** subject to a temporary care order under s. 94(7) and interim/extended society care under ss. 110-111, a parent retains any right they otherwise have to: direct the child's education and upbringing in accordance with the child's creed, community identity, and cultural identity; and consent to treatment on the child's behalf as substitute decision-maker under the Health Care Consent Act, 1996, where applicable.

**The society's duty to consider a parent's wishes (s. 109(5)):** while a child is in care, the society must ensure the child is afforded all the rights in Part II (s. 3 above), and that the wishes of any parent entitled to access — and, for a child in extended society care who has lived continuously with a foster parent for two years, that foster parent's wishes — are taken into account in the society's major decisions about the child.

For First Nations, Inuit, and Métis-specific rights — consultation duties, placement preference, and the interaction with the federal Act respecting First Nations, Inuit and Métis children, youth and families — see the dedicated Indigenous Rights topic below.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 3 — Rights of children and young persons (Part II)" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 14 — Parent's retained rights while child is in care" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 109(5) — Rights of child, parent and foster parent" }
    ],
    guidelines: [
      "If your child is in care, you retain the right to direct their upbringing consistent with your family's creed and culture, and to act as substitute decision-maker for treatment where applicable — raise this directly with the worker and, if ignored, with your lawyer.",
      "Ask the society explicitly how your wishes were taken into account in any major decision about your child, per s. 109(5)."
    ],
    checklistItems: [
      { label: "Confirm the child's s. 3 rights are being honoured", description: "Is the child being consulted, informed, and given a due-weight voice appropriate to their age and maturity?" },
      { label: "Assert your s. 14 retained rights", description: "Education/upbringing direction and substitute medical consent don't disappear just because a child is in care — confirm they're being respected." }
    ],
    factVersusFiction: [
      {
        fiction: "Once a child is in CAS care, the parent has no remaining legal rights at all.",
        fact: "A parent retains specific rights under s. 14 (education/upbringing per creed and culture; substitute medical consent), and the society must take the parent's wishes into account in major decisions under s. 109(5).",
        sourceExplanation: "CYFSA ss. 14 and 109(5), verified against the current consolidated text."
      }
    ]
  },
  {
    id: "indigenous-rights-cyfsa-and-c92",
    title: "First Nations, Inuit & Métis Rights: CYFSA Part IV and the Federal Act (Bill C-92)",
    badge: "Two Laws Apply Together",
    category: "Indigenous Rights",
    summary: "For a First Nations, Inuit, or Métis child, two laws apply: Ontario's CYFSA Part IV, and the federal Act respecting First Nations, Inuit and Métis children, youth and families (S.C. 2019, c. 24). The federal Act's own provisions — and any Indigenous group's own child/family services law — can override conflicting Ontario or other federal law.",
    fullBody: `Two of the most concrete, actionable protections here come from the FEDERAL Act, not CYFSA — they are worth knowing before anything else:

**Reasonable efforts before apprehension (federal Act, s. 15.1):** unless immediate apprehension is consistent with the child's best interests, before apprehending an Indigenous child who lives with a parent or another adult family member, the service provider MUST demonstrate it made reasonable efforts to let the child continue living with that person.

**Mandatory placement priority order (federal Act, s. 16(1)):** placement of an Indigenous child must follow this order, to the extent consistent with the child's best interests: (a) a parent; (b) another adult family member; (c) an adult from the same Indigenous group/community/people as the child; (d) an adult from a different Indigenous group/community/people; (e) any other adult.

**Other federal protections:**
- **s. 15** — a child must NOT be apprehended solely because of socio-economic conditions: poverty, inadequate housing/infrastructure, or a parent's state of health.
- **s. 10(1)** — best interests is generally a "primary" consideration under this Act, but for apprehension decisions specifically, it is the **paramount** consideration.
- **s. 14(1)** — preventive, family-support services must be prioritized over other services where consistent with the child's best interests.
- **s. 13** — in a civil proceeding, the child's parent/care provider have the right to make representations and have party status, and the Indigenous governing body for the child's community also has the right to make representations.
- **s. 12(1)** — before any "significant measure," the service provider must notify the child's parent, care provider, and the Indigenous governing body that has told the service provider it acts for that child's community.
- **s. 22(1) and (3) — the paramountcy rule:** where an Indigenous group, community or people has its own child and family services law, that law prevails over a conflicting federal OR provincial law (including CYFSA) to the extent of the conflict — EXCEPT that ss. 10-15 of the federal Act itself, and the Canadian Human Rights Act, are never overridden by anything.

**CYFSA Part IV (ss. 68-73.3) — the Ontario process layer:**
- **s. 72 — mandatory consultation:** a society (or other service provider) exercising powers under the Act regarding a First Nations, Inuit, or Métis child must regularly consult the child's band/community about: bringing children to a place of safety and residential placement; family support services; care plans; status reviews; temporary care agreements; society agreements with 16/17 year olds; adoption placements; emergency houses; and any other prescribed matter.
- **s. 73 — consultation in specified cases:** for certain prescribed services or powers, the society must consult a representative chosen by the child's band/community, per the regulations.
- **s. 70 — designated authority:** a band or community may designate its own First Nations, Inuit or Métis child and family service authority, which the Minister must negotiate with on request and may fund or designate as a society.
- **s. 71 — customary care subsidy:** if a band/community declares a child is being cared for under customary care, a subsidy may be paid to that caregiver.
- **s. 73.1/73.2 — prevention-focused Indigenous service providers:** these provisions (added by 2022, c. 2, Sched. 3) create a designation for community-based prevention/support providers — as of this writing they are enacted but **not yet in force**; don't rely on them as a currently-available right without confirming their in-force status.
- **s. 79(1), para. 4 — automatic party status:** for a First Nations, Inuk or Métis child, a representative chosen by each of the child's bands/communities is automatically a party to the protection proceeding, alongside the applicant, the society, and the child's parent.
- **s. 74(3)(b) — best interests factor:** every best-interests determination must, for such a child, consider the importance of preserving cultural identity and connection to community, in addition to the general factors.
- **s. 101(5) — placement order preference:** where the court must decide placement after finding a child in need of protection, and the child is First Nations, Inuk, or Métis, the court shall place the child with a member of their extended family if possible, or failing that, with another family from the same First Nations/Inuit/Métis group — unless there is a substantial reason to place elsewhere.
- **s. 109(2)(d) — ongoing placement duty:** the same extended-family/same-community placement preference applies to the society's choice of residential placement on an ongoing basis while the child remains in care.
- **s. 104(2), para. 2 and (4)(d) — access:** a representative chosen by the child's band/community may apply for an access order, and must be given notice of access applications made by others.
- **s. 121(1)(e) — appeal standing:** a representative chosen by the child's band/community may appeal a court order, on the same basis as the child, a parent, or the society.

**How the two laws fit together:** CYFSA Part IV governs the day-to-day consultation and process obligations on Ontario societies. The federal Act sets national minimum standards and, critically, its s. 22 paramountcy rule means that where a First Nations, Inuit, or Métis group has enacted its own child and family services law, that law — not CYFSA, and not conflicting federal law other than the federal Act's own ss. 10-15 and the Canadian Human Rights Act — governs to the extent of any conflict.`,
    primarySources: [
      { label: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24", url: "https://laws-lois.justice.gc.ca/eng/acts/f-11.73/", citation: "s. 15.1 (reasonable efforts before apprehension), s. 16(1) (placement priority), s. 15, s. 10(1), s. 14(1), s. 13, s. 12(1), s. 22(1) & (3)" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1 — Part IV", url: "https://www.ontario.ca/laws/statute/17c14", citation: "ss. 68-73.3 — First Nations, Inuit and Métis Child and Family Services (NOT 'Part X' — Part X of the current CYFSA is the Personal Information/privacy part)" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 74(3)(b), s. 79(1) para. 4, s. 101(5), s. 109(2)(d), s. 104, s. 121(1)(e)" }
    ],
    guidelines: [
      "If your child is First Nations, Inuit, or Métis, tell the society and the court immediately, in writing — this triggers mandatory consultation duties (CYFSA s. 72) and automatic party status for your child's band/community (s. 79(1)).",
      "Ask explicitly whether the service provider can demonstrate the 'reasonable efforts' required by federal Act s. 15.1 before any apprehension.",
      "If your community has its own child and family services law, raise the federal Act's s. 22 paramountcy rule with your lawyer immediately — it can change which law actually governs your case.",
      "Ask whether extended-family or same-community placement (CYFSA s. 101(5)/s. 109(2)(d); federal Act s. 16(1)) was actually considered before any other placement was made."
    ],
    checklistItems: [
      { label: "Confirm community notification", description: "Has the child's band/community been notified and given the chance to participate as a party (CYFSA s. 79(1)) and to be consulted (s. 72)?" },
      { label: "Check for 'reasonable efforts' evidence", description: "Federal Act s. 15.1 requires the service provider to show reasonable efforts were made to keep the child with a parent or family member before apprehension — ask for this documentation specifically." },
      { label: "Verify the placement priority order was followed", description: "Federal Act s. 16(1) and CYFSA s. 101(5)/s. 109(2)(d) set a specific placement order — parent, then family, then same community, then other Indigenous community, then anyone else." }
    ],
    factVersusFiction: [
      {
        fiction: "The Indigenous-specific provisions in Ontario's child protection law are in 'Part X' of the CYFSA.",
        fact: "Part X of the current CYFSA is the Personal Information (privacy) part. The First Nations, Inuit and Métis Child and Family Services provisions are in Part IV (ss. 68-73.3).",
        sourceExplanation: "Confirmed directly against the CYFSA full consolidated text."
      },
      {
        fiction: "A poor or inadequate home on its own justifies apprehending an Indigenous child.",
        fact: "The federal Act's s. 15 specifically prohibits apprehending an Indigenous child solely for socio-economic reasons — poverty, inadequate housing or infrastructure, or a parent's health.",
        sourceExplanation: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24, s. 15."
      }
    ]
  },
  {
    id: "plan-of-care-requirements",
    title: "The Society's Plan of Care (Section 100)",
    badge: "New",
    category: "Rights",
    summary: "Before the court can make most protection orders, it must obtain and consider a written Plan of Care from the society, covering six specific required elements — including, if removal is proposed, an explanation of why the child can't be adequately protected in the parent's care.",
    fullBody: `Under s. 100 of the CYFSA, before making an order under s. 101 (disposition), s. 102, s. 114, or s. 116, the court must obtain and consider a Plan of Care prepared in writing by the society, which must include:

(a) a description of the services to be provided to remedy the condition/situation that led to the protection finding;
(b) a statement of the criteria the society will use to determine when its care or supervision is no longer required;
(c) an estimate of the time required to achieve the purpose of the intervention;
(d) where the society proposes to remove or has removed the child from a person's care: an explanation of why the child cannot be adequately protected while in that person's care, a description of past efforts to make that protection possible, and a statement of what efforts, if any, are planned to maintain the child's contact with that person;
(e) where the removal is proposed to be permanent: a description of the arrangements made or being made for the child's long-term stable placement; and
(f) a description of the arrangements made or being made to recognize the importance of, and preserve, the child's culture, heritage, traditions and cultural identity.

Separately, under s. 13 (Part II), a child in care has their OWN right to a plan of care designed to meet their particular needs, which must be prepared within 30 days of their admission to a residential placement — a different, complementary right from the society's s. 100 obligation to the court.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 100 — Society's plan for child" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 13 — Child's own right to a plan of care within 30 days" }
    ],
    guidelines: [
      "Request the society's s. 100 Plan of Care in writing before any disposition hearing — the court cannot make most orders without it, and you're entitled to review it before the hearing.",
      "If removal is proposed, check specifically for element (d): a genuine explanation of why you can't adequately protect the child, past efforts made, and a concrete contact-maintenance plan — not just a conclusion.",
      "If a permanent removal is proposed, check element (e) for a real long-term placement plan, not a placeholder."
    ],
    checklistItems: [
      { label: "All six elements present?", description: "Cross-check the Plan of Care against s. 100(a)-(f) — a plan missing an entire required element is incomplete on its face." },
      { label: "Contact-maintenance plan is concrete", description: "Element (d)(ii) requires a statement of planned efforts to maintain contact — vague language like 'as appropriate' should be challenged." },
      { label: "Cultural preservation plan is specific", description: "Element (f) requires actual arrangements, not a general statement of intent." }
    ],
    factVersusFiction: [
      {
        fiction: "CAS can propose removing a child without ever putting a plan in writing.",
        fact: "s. 100 requires the court to obtain and consider a written Plan of Care meeting six specific requirements before making most protection orders.",
        sourceExplanation: "CYFSA s. 100, verified against the current consolidated text."
      }
    ]
  },
  {
    id: "proactive-mental-health-substance-engagement",
    title: "Voluntary Mental Health & Substance-Use Engagement: Why Starting Early Helps Your Case",
    badge: "Practical Strategy",
    category: "Rights",
    summary: "The CYFSA has no ground that just says \"the parent has a mental health condition\" or \"uses drugs\" — CAS must prove an actual failure to adequately care for the child, or a real risk of one, never the condition alone. Starting counselling, treatment, or a recovery program on your own — before CAS or a court ever orders it — is real, documented evidence that there's no such ongoing failure, and is exactly what the best-interests test and the Plan of Care requirement already weigh in your favour.",
    fullBody: `THE CRITICAL POINT, first: the CYFSA has no ground that says "the parent has a mental health condition" or "the parent uses drugs," as such. Every ground CAS can actually use requires them to prove that the condition caused, or creates a real, specific risk of, an actual failure to adequately care for or supervise the child — never just that the condition or history exists. Having a diagnosis or a substance-use history is not, by itself, ever enough.

The grounds that actually get used in these cases, quoted directly from s. 74(2):

s. 74(2)(a)/(b) — physical harm, or a risk of it, "inflicted by the person having charge of the child or caused by or resulting from that person's (i) failure to adequately care for, provide for, supervise or protect the child, or (ii) pattern of neglect in caring for, providing for, supervising or protecting the child." This is the ground CAS actually has to build a case under in most mental-health- or substance-use-related matters. A parent's condition is only relevant to the extent it's tied to a specific, demonstrated failure or risk of failure — not the condition alone.

s. 74(2)(e) — the child requires treatment and "the child's parent or the person having charge of the child does not provide the treatment or access to the treatment." This is about the child's own treatment needs, not the parent's — don't confuse the two. A parent's own mental health or substance-use treatment is a separate question from whether they're providing treatment their child needs.

s. 74(2)(k) — the parent "has died or is unavailable to exercise the rights of custody over the child" and has not made adequate provision for the child's care. This only applies where a parent's condition genuinely makes them unavailable or unable to exercise custody — not where a parent is present and struggling.

The burden is on CAS to connect the dots with actual evidence of impact on the child. A hospital record, a diagnosis, or a past charge, on its own, proves none of these grounds — CAS has to show the specific failure, or specific risk of failure, that actually resulted.

This is exactly where the rest of this entry connects: voluntarily engaging with treatment is exactly the kind of thing that helps show there's no ongoing failure to care — which is what s. 74(2)(a)/(b) actually requires, not the underlying condition itself. Everything below is about how to build that record.

This is a strategy, not a right. The CYFSA has no section titled "proactive enrollment" or anything like it, and nothing here should be read as claiming one exists. What's true instead is that two provisions already in this app — s. 74(3)(c)(viii) and s. 100 — describe exactly what a judge is required to weigh, and voluntary, sustained engagement is the kind of concrete, documented fact that moves those two factors in a parent's favour.

s. 74(3)(c)(viii) — the best-interests test — directs the court to consider "the merits of a plan for the child's care proposed by a society... compared with the merits of the child remaining with or returning to a parent." That is a direct, side-by-side comparison. If the only thing on the "returning to a parent" side of that comparison is a promise to comply with a future order, it's a weaker showing than a documented record — a counsellor's letter, program attendance records, a sponsor's contact information, urine screens — that already exists, independently of CAS, before anyone required it.

s. 100(a) requires the society's own Plan of Care to include "a description of the services to be provided to remedy the condition or situation on the basis of which the child was found to be in need of protection." If a parent has already started that exact remedial work — the same category of service CAS would otherwise be proposing to mandate — that changes the practical shape of the plan the court reviews: the "estimate of the time required" under s. 100(c) can reasonably be shorter, and the record no longer depends entirely on CAS's own account of what's needed and whether it's working.

Why proactive — not waiting to be ordered — matters practically: a parent who identifies a concern and acts on it before being compelled generates their own paper trail, independent of anything CAS produces. It also speaks to s. 74(3)(c)(ix), the "effects on the child of delay in the disposition of the case" — a parent who is already doing the work is not the source of any delay, and that is a fact the court can see for itself rather than take on faith.

None of this means a mental health or substance-use history is being treated as proof of unfitness — it is the opposite. The whole point of these two provisions is that the court looks at what is actually happening now, not at a diagnosis or a past incident in isolation. Voluntary, documented engagement is exactly the kind of current fact that these two sections are built to weigh, and it is available to any parent regardless of what led to the case.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 74(2)(a), (b), (e), (k) — the actual protection grounds available in mental-health/substance-use-related cases" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 74(3)(c)(viii) — best-interests factor comparing the society's plan against the child remaining with or returning to a parent" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 100(a) and (c) — Plan of Care's required remedial-services description and time-estimate" }
    ],
    guidelines: [
      "Know the real standard: a diagnosis, a hospital record, or a past charge is not a ground on its own — CAS has to show a specific failure to adequately care for the child, or a specific, demonstrated risk of one. If a document just states the condition without connecting it to an actual failure or risk, that's a gap worth raising with your lawyer.",
      "If you're already engaging with mental health or substance-use support, tell your lawyer now — even if CAS hasn't asked and no order requires it. It's usable evidence only if it's actually in the record.",
      "Ask your counsellor, program, or physician for something in writing: a letter confirming enrollment and attendance, dates, and (with your consent) general progress — independent documentation carries more weight than your own account of it.",
      "Keep your own simple log of appointments, sessions, or meetings attended, in case the provider's own records are slow to produce.",
      "Starting this work does not require CAS's involvement or a court order first — voluntary engagement before either exists is exactly what strengthens the comparison under s. 74(3)(c)(viii)."
    ],
    checklistItems: [
      { label: "Is CAS pointing to the condition, or to a specific failure?", description: "A diagnosis or substance-use history alone doesn't meet s. 74(2)(a)/(b) — check whether CAS has actually identified a specific failure to adequately care for the child, or a specific, demonstrated risk of one." },
      { label: "Started before being ordered to?", description: "Voluntary engagement that predates any court order or CAS demand is the clearest version of this evidence — note the actual start date." },
      { label: "Independently documented?", description: "A letter or record from the provider, not just your own description, is what actually gets weighed as evidence." },
      { label: "Told your lawyer?", description: "This only helps your case if your lawyer knows it exists and can put it in front of the court — don't assume CAS will raise it for you." }
    ],
    factVersusFiction: [
      {
        fiction: "If I have a mental health diagnosis or a substance-use history, that's enough on its own for CAS to prove my child is in need of protection.",
        fact: "It is not. The CYFSA has no ground based on the condition or history alone — s. 74(2)(a) and (b) require CAS to prove an actual failure to adequately care for, provide for, supervise, or protect the child (or a pattern of neglect), or a real risk of one, and to connect that failure or risk to the parent's condition. A diagnosis or history is only relevant if CAS ties it to a specific, demonstrated failure or risk — never on its own.",
        sourceExplanation: "CYFSA s. 74(2)(a) and (b), quoted verbatim and verified against the current consolidated text."
      },
      {
        fiction: "Getting help with a mental health or substance-use issue will be used against me, or means CAS already thinks I'm unfit.",
        fact: "Voluntary, documented engagement is the kind of concrete merit s. 74(3)(c)(viii) directs the court to weigh on the side of a child remaining with or returning to a parent — it is evidence in your favour, not an admission.",
        sourceExplanation: "CYFSA s. 74(3)(c)(viii), verified against the current consolidated text."
      },
      {
        fiction: "There's a specific CYFSA right that lets me demand credit for proactively enrolling in services.",
        fact: "No such named right exists in the CYFSA. This is a practical consequence of how two existing provisions — the best-interests test and the Plan of Care requirement — already direct the court to weigh evidence, not a separate entitlement you can invoke.",
        sourceExplanation: "CYFSA s. 74(3)(c)(viii) and s. 100(a), verified against the current consolidated text; no section creates a distinct 'proactive enrollment' right."
      }
    ]
  },
  {
    id: "parent-rights-mental-health-act",
    title: "Your Own Rights Under Ontario's Mental Health Act",
    badge: "Different Law",
    category: "Rights",
    summary: "If you — not your child — are the one facing a psychiatric assessment or an involuntary hold, that is governed by a completely separate statute, Ontario's Mental Health Act, not the CYFSA. It sets exact detention periods, a mandatory rights-advice process, and an independent tribunal review — all with specific section numbers.",
    fullBody: `This is a different legal domain from everything else in this guide. The CYFSA governs child protection proceedings. If you yourself are facing a psychiatric assessment or an involuntary hold, that is governed by Ontario's Mental Health Act (R.S.O. 1990, c. M.7) — a separate statute with its own rules, its own forms, and its own review process. The two can happen around the same time in a person's life, but they are not the same proceeding, and what applies to one does not automatically apply to the other.

**Psychiatric assessment application — "Form 1" (s. 15):** a physician who examines you may apply for a psychiatric assessment where you've threatened or attempted self-harm, behaved violently toward another, or shown a lack of competence to care for yourself, AND the physician believes you have a mental disorder likely to result in serious bodily harm to yourself or another, or serious physical impairment. A Form 1 is authority, for seven days from signing, to take you into custody and detain you for examination for up to 72 hours (s. 15(5)).

**Involuntary admission — "Form 3" (s. 20):** after the 72-hour assessment period, the attending physician must either release you, admit you as an informal/voluntary patient, or — only if specific statutory conditions are met — complete a certificate of involuntary admission. s. 20(1.1) covers someone with a documented history of a recurring mental disorder who has improved before but is now at risk again; s. 20(5) covers the more general case, requiring the physician to be of the opinion both that your disorder is likely to cause serious bodily harm or serious physical impairment, and that you are not suitable for informal or voluntary admission.

**Exact detention periods (s. 20(4)):** a certificate of involuntary admission lasts up to 2 weeks; the first certificate of renewal, up to 1 additional month; the second, up to 2 additional months; the third, up to 3 additional months; and each certificate of continuation after that, up to 3 additional months at a time. Detention does not extend automatically past these periods without a new certificate.

**Notice and rights advice — the real, actionable right (s. 38, s. 38.1):** whenever a certificate of involuntary admission, renewal, or continuation is completed, the attending physician must promptly give you written notice — of the reasons for detention, your entitlement to a Board hearing, your right to retain and instruct counsel without delay, and, where applicable, your right to request specific Board orders — and must promptly notify a rights adviser, who must then meet with you in person to explain the certificate and your right to have it reviewed. This protection applies even before formal certification: s. 38.1 requires the same written notice for someone merely subject to a s. 15 application, before any certificate is issued.

**Review by the Consent and Capacity Board — the real challenge mechanism (s. 39, s. 41):** you, or anyone on your behalf, can apply to the Board to inquire into whether the legal prerequisites for your admission or continuation as an involuntary patient are actually met, every time a new certificate takes effect (s. 39(1)-(2)). This review also happens automatically, whether or not you apply, on the first certificate of continuation and every fourth one after that (s. 39(4)) — a built-in safeguard against being forgotten in the system. At the hearing, the Board must decide whether the prerequisites are still met at the time of the hearing itself, not just when the certificate was first signed, and must rescind the certificate if they are not (s. 41(1), (3)).

**Appeal (s. 48):** you, or another party to a Board proceeding, can appeal the Board's decision to the Superior Court of Justice on a question of law, fact, or both.

**Community Treatment Orders (s. 33.1):** a separate, less restrictive mechanism lets a physician issue a community treatment order requiring you to follow a treatment plan while living in the community rather than being detained — but only with your (or your substitute decision-maker's) actual, informed consent. Before that consent counts, you must first have consulted a rights adviser and been told of your legal rights (s. 33.1(4)(e)-(f)), and you have an explicit right to retain and instruct counsel and to be told of that right (s. 33.1(8)). A community treatment order can be challenged the same way, through an application to the Board.

If this happens to you while a CYFSA matter involving your children is also active, tell your family lawyer immediately — it can be relevant to both proceedings, and your lawyer needs to know quickly, not after the fact.`,
    primarySources: [
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 15, s. 15(5) — Application for psychiatric assessment ('Form 1') and the 72-hour detention-for-examination authority" },
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 20(1.1), s. 20(5) — Conditions for a certificate of involuntary admission ('Form 3')" },
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 20(4) — Exact detention periods for involuntary admission, renewal, and continuation" },
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 38, s. 38.1 — Written notice and in-person rights-adviser meeting, including before formal certification" },
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 39, s. 41 — Consent and Capacity Board review, including the automatic deemed-application safeguard" },
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 48 — Appeal of a Board decision to the Superior Court of Justice" },
      { label: "Mental Health Act, R.S.O. 1990, c. M.7", url: "https://www.ontario.ca/laws/statute/90m07", citation: "s. 33.1 — Community Treatment Orders, including the consent and prior rights-advice requirements" }
    ],
    guidelines: [
      "Ask directly and immediately why you're being assessed or held — s. 38/s. 38.1 entitle you to written notice of the reasons, and asking plainly is reasonable.",
      "Ask for a rights adviser or legal advice as soon as you're placed on an involuntary hold — s. 38 requires the facility to notify a rights adviser and arrange an in-person meeting; this is a normal part of the process, not something you need to justify asking for.",
      "Track the certificate dates — s. 20(4) sets exact detention periods (2 weeks, then 1, 2, 3 months, then 3 months per continuation), so you can know when a certificate is due to expire or come up for automatic Board review.",
      "If you believe your involuntary status is wrong, ask how to bring it to the Consent and Capacity Board under s. 39 — that review process exists precisely for this, and doesn't require you to wait for the automatic review.",
      "If you're asked to consent to a Community Treatment Order, confirm you've actually had the s. 33.1(4)(e) rights-advice consultation first — your consent is only valid if that happened.",
      "Tell your family lawyer right away if this happens while any CYFSA matter is active, even if it feels unrelated — let your lawyer decide what's relevant."
    ],
    checklistItems: [
      { label: "Were you told why?", description: "s. 38/s. 38.1 entitle you to written notice of the reasons for a psychiatric assessment application or a certificate — if that didn't happen, say so to a rights adviser or lawyer." },
      { label: "Did you get rights advice?", description: "s. 38 requires the facility to notify a rights adviser, who must meet with you in person to explain your status and options." },
      { label: "Do you know your certificate's expiry date?", description: "s. 20(4) fixes exact detention periods — confirm which certificate you're under and when it expires or is due for renewal or automatic Board review." },
      { label: "Do you know how to reach the Consent and Capacity Board?", description: "s. 39 lets you apply for a Board review at any time a certificate is in effect — ask a rights adviser or lawyer how to bring one." }
    ],
    factVersusFiction: [
      {
        fiction: "If I'm placed on a psychiatric hold, no one has to explain why, and there's no one independent I can go to about it.",
        fact: "s. 38 and s. 38.1 require written notice of the reasons for detention and a rights adviser's in-person explanation of your status — even before formal certification — and s. 39/s. 41 let you (or anyone on your behalf) have your status reviewed by the Consent and Capacity Board, an independent tribunal separate from both CAS and the family court.",
        sourceExplanation: "Mental Health Act, R.S.O. 1990, c. M.7, s. 38, s. 38.1, s. 39, s. 41 — verified against the full consolidated statute text."
      },
      {
        fiction: "Once I'm certified involuntary, I can be held indefinitely without anyone re-checking whether that's still justified.",
        fact: "s. 20(4) caps each certificate at a fixed period — 2 weeks for the first, then escalating renewal periods — and s. 39(4) automatically triggers a Board review on the first certificate of continuation and every fourth one after that, whether or not you apply yourself.",
        sourceExplanation: "Mental Health Act, R.S.O. 1990, c. M.7, s. 20(4), s. 39(4) — verified against the full consolidated statute text."
      },
      {
        fiction: "A Community Treatment Order just needs a doctor's sign-off — I don't get a say.",
        fact: "A CTO requires your (or your substitute decision-maker's) actual consent, and that consent is only valid after you've first consulted a rights adviser and been told your legal rights.",
        sourceExplanation: "Mental Health Act, R.S.O. 1990, c. M.7, s. 33.1(4)(e)-(f), s. 33.1(8) — verified against the full consolidated statute text."
      }
    ]
  },
  {
    id: "kinship-family-placement-preference",
    title: "Kinship & Family Placement Preference",
    badge: "New",
    category: "Rights",
    summary: "Before a child can be removed from a parent's care, the court must consider less-disruptive alternatives and possible placement with relatives or extended family — and, for First Nations, Inuit or Métis children, a specific extended-family/same-community preference applies both at disposition and on an ongoing basis.",
    fullBody: `**Less-disruptive alternatives preferred (s. 101(3)):** the court cannot make an order removing a child from the person who had charge of them immediately before intervention unless satisfied that less-disruptive alternatives — including non-residential care and other assistance — would be inadequate to protect the child.

**Community placement to be considered (s. 101(4)):** where the court decides removal is necessary, before ordering interim or extended society care, it must consider whether the child can instead be placed — under a supervision order — with a relative, neighbour, or other member of the child's community or extended family, with that person's consent.

**First Nations, Inuk or Métis placement preference at disposition (s. 101(5)):** where the child being placed under s. 101(4) is First Nations, Inuk, or Métis, the court SHALL place the child with a member of their extended family if possible, or failing that, with another family from the same First Nations, Inuit, or Métis group — unless there is a substantial reason to place elsewhere.

**Ongoing placement duty while in care (s. 109(2)):** the society's choice of residential placement for a child in its care must, among other requirements: represent the least restrictive alternative; where possible respect the child's race, ancestry, culture, and identity; and — for a First Nations, Inuk, or Métis child — apply the same extended-family/same-community preference as s. 101(5), on an ongoing basis, not just at the initial disposition.

This complements the federal Act's own mandatory placement priority order for Indigenous children (s. 16(1)) — see the dedicated Indigenous Rights topic for the federal-law layer.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 101(3), (4), (5) — Disposition order requirements and placement preference" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 109(2) — Ongoing residential placement standards" }
    ],
    guidelines: [
      "Present specific, named kinship placement options (with contact information) as early as possible — the court is required to consider this before ordering society care, not just as an afterthought.",
      "If your child is First Nations, Inuk, or Métis, explicitly invoke s. 101(5) and s. 109(2)(d) — the preference for extended family or same-community placement is a 'shall' requirement, not merely discretionary, absent a substantial reason otherwise."
    ],
    checklistItems: [
      { label: "Kinship options documented", description: "Have you given the society and the court a written list of relatives/community members willing to take a supervised placement?" },
      { label: "Substantial-reason test applied correctly", description: "For an Indigenous child placed outside extended family/same community, has the society articulated an actual 'substantial reason,' not just a preference for a different placement?" }
    ],
    factVersusFiction: [
      {
        fiction: "Grandparents and other relatives have no legal priority over foster placement.",
        fact: "s. 101(4) requires the court to consider community/relative placement before ordering society care, and s. 101(5)/s. 109(2)(d) make extended-family or same-community placement close to mandatory for First Nations, Inuit, and Métis children absent a substantial reason otherwise.",
        sourceExplanation: "CYFSA ss. 101(4), 101(5), and 109(2)(d), verified against the current consolidated text."
      }
    ]
  },
  {
    id: "access-visitation-rights",
    title: "Access & Visitation During Proceedings",
    badge: "New",
    category: "Rights",
    summary: "CYFSA s. 104 lets a wide range of people — including the child, siblings, and (for Indigenous children) the community's representative — apply for an access order at any time while a child is in a society's care.",
    fullBody: `**Access orders (s. 104):** the court may, when making an order under Part V or on a separate application, make, vary, or terminate an order respecting a person's access to the child, or the child's access to a person, in the child's best interests, with whatever terms and conditions the court considers appropriate.

**Who may apply (s. 104(2)):** while a child is in a society's care and custody or supervision, an application for an access order may be made at any time by: the child; any other person, including a sibling of the child and, for a First Nations, Inuk, or Métis child, a representative chosen by the child's band/community; or the society.

**Notice requirements (s. 104(3)-(4)):** an applicant under paragraph 2 above must notify the society; the society, in turn, must notify the child (subject to notice-to-child rules), the child's parent, the person currently caring for the child, and — for a First Nations, Inuk, or Métis child — a band/community representative.

**Access during an adjournment (s. 94(8)):** where a hearing is adjourned and a temporary care order is made placing the child with someone other than their pre-intervention caregiver, or in society care, that order may itself contain access provisions on whatever terms the court considers appropriate.

**Access considered in ongoing care decisions (s. 109(5)(b)):** the society must take into account the wishes of any parent entitled to access — and, where the child has lived with one foster family for two continuous years under an extended society care order, that foster parent's wishes too — in its major decisions about the child.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 104 — Access orders (who may apply, notice requirements)" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 94(8) — Access provisions in a temporary order during adjournment" },
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 109(5)(b) — Parent/foster parent wishes considered in major decisions" }
    ],
    guidelines: [
      "You can apply for an access order under s. 104 at any time while your child is in care — you don't need to wait for the next scheduled hearing.",
      "If access has been informally restricted without a court order, ask directly whether that restriction has actual legal force, or is simply the society's own internal decision pending a court application."
    ],
    checklistItems: [
      { label: "Access order in place?", description: "Is there an actual court order governing access, or only an informal arrangement that either side could unilaterally change?" },
      { label: "Notice given to all required parties", description: "For a First Nations, Inuk, or Métis child, has the band/community representative received the notice required by s. 104(4)(d)?" }
    ],
    factVersusFiction: [
      {
        fiction: "Only the parent can apply for access to a child in society care.",
        fact: "s. 104(2) permits the child, any other person (including a sibling or, for an Indigenous child, the community's representative), and the society itself to apply for an access order.",
        sourceExplanation: "CYFSA s. 104(2), verified against the current consolidated text."
      }
    ]
  },
  {
    id: "appeal-rights",
    title: "Appeal Rights",
    badge: "New",
    category: "Rights",
    summary: "CYFSA s. 121 sets out who can appeal a protection order, which court hears it, and a strict, time-sensitive rule: no extension of the appeal deadline is available once a child has been placed for adoption.",
    fullBody: `**Who may appeal (s. 121(1)):** an appeal from a court order under Part V may be made by: the child, if entitled to participate under s. 79(6); any parent of the child; the person who had charge of the child immediately before intervention; a Director or local director; and, for a First Nations, Inuk, or Métis child, any of the above or a representative chosen by the child's band/community.

**Which court hears it (s. 121(2.1)):** the appeal goes to the Superior Court of Justice if the order was made at the Ontario Court of Justice, or to the Divisional Court if the order was made at the Family Court branch of the Superior Court of Justice.

**Exception (s. 121(2)):** an order for an assessment under s. 98 cannot be appealed under this section.

**Automatic stay pending appeal (s. 121(3)):** where a decision about a child's care and custody is appealed, execution of that decision is stayed for the 10 days immediately following service of the notice of appeal; if the child is already in the society's care and custody, the child remains there until the 10-day stay expires or a further order is made, whichever comes first.

**Temporary order pending appeal (s. 121(4)):** the appeal court may make a temporary order for the child's care and custody pending final disposition of the appeal, and may vary, terminate, or replace it on any party's motion before the appeal is finally decided.

**Time-sensitive limit (s. 121(5)):** no extension of the time to appeal will be granted once the child has been placed for adoption under Part VIII. This makes moving quickly on an appeal genuinely urgent, not just advisable.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 121(1), (2), (2.1), (3), (4), (5) — Appeal rights, forum, stay, and the adoption-placement time bar" }
    ],
    guidelines: [
      "If you intend to appeal, confirm immediately which court has jurisdiction (Superior Court of Justice vs. Divisional Court) based on where the original order was made — filing in the wrong court wastes time you may not have.",
      "Track the 10-day automatic stay carefully — it runs from service of the notice of appeal, and it is your main protection against the order being executed while the appeal is pending.",
      "If adoption placement is a realistic possibility, treat the appeal deadline as absolute — s. 121(5) removes the court's ability to grant an extension once that placement has happened."
    ],
    checklistItems: [
      { label: "Correct appeal court identified", description: "Superior Court of Justice (from Ontario Court of Justice) or Divisional Court (from Family Court branch)?" },
      { label: "Notice of appeal served promptly", description: "The 10-day stay under s. 121(3) runs from service — delay shortens your practical protection." },
      { label: "Adoption-placement risk assessed", description: "Has your lawyer confirmed whether an adoption placement is imminent? If so, the appeal deadline cannot be extended once it occurs." }
    ],
    factVersusFiction: [
      {
        fiction: "You can always ask for more time to file an appeal if you miss the deadline.",
        fact: "s. 121(5) specifically bars any extension of the appeal deadline once the child has been placed for adoption — there is no case-by-case discretion to revive it after that point.",
        sourceExplanation: "CYFSA s. 121(5), verified against the current consolidated text."
      }
    ]
  },
  {
    id: "clra-parentage-300-days",
    title: "The 300-Day Presumption of Parentage (CLRA)",
    badge: "Parentage Presumptions",
    category: "Rights",
    summary: "Under Section 8 of Ontario's Children's Law Reform Act (CLRA), if a child is born within 300 days of a marriage dissolution or formal cohabitation ending, the former spouse is legally presumed to be a parent.",
    fullBody: `Establishing clear legal parentage is a critical pre-requisite for custody, visitation, child support, and child protection court proceedings. Under Ontario's Children's Law Reform Act (CLRA), R.S.O. 1990, c. C.12, parentage does not always require genetic testing or a subsequent court order to be legally triggered.

**The 300-Day Rule (as generally understood — NOT independently verified against full CLRA text for this app; the CLRA is not one of the two source files confirmed in legal-reference/, only the CYFSA and the federal Act are):**
- A person may be presumed to be a parent if married to the child's birth mother and the child is born during the marriage, or within 300 days after the marriage ends by death, divorce, or nullity.
- A person may be presumed to be a parent if they cohabited with the birth mother in a relationship of some permanence and the child is born during the cohabitation, or within 300 days after it ends.

⚠️ The precise subsection numbering (previously stated as "s. 8(1)1" and "s. 8(1)2") has NOT been re-confirmed against a verified copy of the CLRA text and should be confirmed with counsel or the actual statute before being relied on or cited in a filing.`,
    primarySources: [
      { label: "Ontario e-Laws - Children's Law Reform Act, R.S.O. 1990, c. C.12", url: "https://www.ontario.ca/laws/statute/90c12", citation: "s. 8 — Presumption of parentage (exact subsections unverified — confirm with counsel)" }
    ],
    guidelines: [
      "Notify the court and the CAS case worker if the child was born within 300 days of a marriage or cohabitation ending.",
      "Insist that both potentially presumed parents receive identical disclosure and notice of all court dates.",
      "Confirm the exact subsection citations with a family lawyer before relying on them in any filing."
    ],
    checklistItems: [
      { label: "Calculate the 300-day window", description: "Identify the exact date the marriage or cohabitation legally ended, and confirm whether the birth falls within 300 days of that date." },
      { label: "Confirm notice to both presumed parents", description: "Was the CAS's first-appearance material served on both potentially presumed parents?" }
    ],
    factVersusFiction: [
      {
        fiction: "A separated former spouse or partner has zero legal parentage rights until a court orders a DNA test.",
        fact: "Ontario law generally presumes parentage in specific circumstances without requiring a DNA test or court order first — but confirm the exact statutory basis with counsel for your situation.",
        sourceExplanation: "General CLRA parentage-presumption framework — exact subsection numbering not independently verified for this app."
      }
    ]
  },
  {
    id: "evidence- hearsay",
    title: "Understanding Evidence: Facts vs Hearsay",
    badge: "Court Preparation",
    category: "Evidence Rules",
    summary: "Family court affidavits are frequently packed with hearsay and worker assumptions. Knowing how to spot and challenge these is vital to a defense.",
    fullBody: `In Ontario Child Protection hearings, CAS affidavits are notorious for containing layers of 'hearsay' (e.g. 'the worker was told by an anonymous neighbor that the parent screams').

**Fact vs. Subjective Opinion & Hearsay:**
- **Fact**: Direct, first-hand sensory observations. (e.g., 'The worker observed three clean towels on the rack' or 'The physician recorded a weight of 15 kilograms').
- **Opinion**: Subjective interpretations. (e.g., 'The partner seemed defensive' or 'The parent has poor bonding skills'). Unless the person is a qualified court-recognized expert (like a child psychologist), subjective opinions are not admissible as objective truths.
- **Hearsay**: Out-of-court statements made by someone else, offered to prove the truth of what was said. (e.g., 'The school principal told the worker that the child appeared sad'). While minor hearsay is conditionally allowed in early temporary court configurations, it CANNOT be utilized by CAS to secure a final crown wardship or adoption order without direct corroborating testimony.

Spotting these flaws allows you to direct your lawyer to bring a motion to strike hearsay from the CAS worker's affidavits.

⚠️ The Ontario Evidence Act citation below is not one of the two files verified for this app (only the CYFSA and the federal Indigenous child-welfare Act were re-confirmed) — confirm the exact section with counsel.`,
    primarySources: [
      { label: "CanLII - Ontario Evidence Act, R.S.O. 1990, c. E.23", url: "https://www.canlii.org/en/on/laws/stat/rso-1990-c-e23/latest/rso-1990-c-e23.html", citation: "Business records / hearsay exception — exact section unverified for this app" }
    ],
    guidelines: [
      "Comb through every paragraph of the worker's report or affidavit.",
      "Highlight with circles every statement starting with 'I was informed that', 'It was reported to me', 'The worker understands', or 'The worker feels that'.",
      "For every highlighted statement, check if the actual origin of that claim is signed to a separate witness affidavit."
    ],
    checklistItems: [
      { label: "Strike Subjective Language", description: "Watch out for loaded emotional terms such as 'volatile parent', 'bizarre behavior', or 'uncooperative attitude'." },
      { label: "Request Source Identification", description: "Does the worker refuse to name the caller? Note that anonymous tips must be validated by first-hand observer evidence before any court action." }
    ],
    factVersusFiction: [
      {
        fiction: "If CAS writes something down in their file, the judge will accept it as 100% absolute fact.",
        fact: "CAS files are subject to cross-examination and evidentiary rules. Records are business logs, but their subjective contents can be challenged, refuted with direct evidence, or ruled inadmissible.",
        sourceExplanation: "General Ontario Evidence Act hearsay/business-records framework — exact section unverified for this app; confirm with counsel."
      }
    ]
  },
  {
    id: "procedural-timelines",
    title: "Procedural Timelines Checklist",
    badge: "Calendar Mandates",
    category: "Timelines",
    summary: "Ontario child protection cases run on precise statutory and procedural clocks — the five-day hearing rule, the 30-day adjournment limit, and specific caps on how long an interim or supervision order can last.",
    fullBody: `**The five-day rule (CYFSA s. 88):** as soon as practicable, but in any event within five days after a child is brought to a place of safety under s. 81, the matter must be brought before a court for a hearing under s. 90(1) (see the "Emergency Apprehension" topic for the exact wording — the Act says "five days," not "five court days").

**The 30-day adjournment limit (CYFSA s. 94(1)):** the court shall not adjourn a hearing for more than 30 days, unless all present parties and the person who will care for the child during the adjournment consent, or the court is aware an absent party objects to a longer adjournment.

**Order duration caps (CYFSA s. 101(1)):** a supervision order can run for a specified period of at least 3 and not more than 12 months; an interim society care order can run for a specified period not exceeding 12 months; consecutive interim-care-then-supervision orders together cannot exceed a total of 12 months. Extended society care, by contrast, has no fixed time cap of this kind — it continues until terminated under s. 116 or until it expires under s. 123 (the child turns 18 or marries).

⚠️ An earlier version of this content stated a flat "12 months under age 6 / 24 months age 6+" cumulative cap on foster care. That specific age-based rule could not be found anywhere in the current consolidated CYFSA text and has been removed — the real caps are the s. 101(1) order-length limits above, which don't turn on the child's age. If you've heard of a different cumulative-care cap, confirm the exact source with counsel before relying on it.

**Family Law Rules deadlines:** service and filing timelines for case conferences, motions, and other steps are set by the Family Law Rules, O. Reg. 114/99 — these were not part of the two files re-verified for this update, so specific rule numbers below should be confirmed with your lawyer.`,
    primarySources: [
      { label: "CYFSA, S.O. 2017, c. 14, Sched. 1", url: "https://www.ontario.ca/laws/statute/17c14", citation: "s. 88 (five-day rule), s. 94(1) (30-day adjournment limit), s. 101(1) & 123 (order duration caps)" },
      { label: "Ontario e-Laws - Family Law Rules, O. Reg. 114/99", url: "https://www.ontario.ca/laws/regulation/990114", citation: "Service/filing deadlines — specific rule numbers not independently re-verified for this update" }
    ],
    guidelines: [
      "Maintain a written master case calendar tracking every deadline as it's set.",
      "Track the specific order type and its statutory maximum: supervision (3-12 months), interim society care (up to 12 months, or up to 12 months total combined with a following supervision order), versus extended society care (no fixed cap — runs until terminated or the child turns 18/marries).",
      "Confirm exact Family Law Rules service/filing deadlines with your lawyer rather than relying on a remembered rule number."
    ],
    checklistItems: [
      { label: "Track the s. 88 five-day clock precisely", description: "Confirm with the registry exactly how the five days are counted for your matter." },
      { label: "Watch the 30-day adjournment rule", description: "Any adjournment past 30 days needs either universal consent or the court being unaware of any absent party's objection." },
      { label: "Know which order type governs your case", description: "Supervision and interim society care have hard caps; extended society care does not — this changes what 'running out the clock' actually means for your case." }
    ],
    factVersusFiction: [
      {
        fiction: "There's no rush — court documents can be filed whenever convenient.",
        fact: "The CYFSA and Family Law Rules impose real, specific deadlines (the five-day hearing rule, the 30-day adjournment limit, and rules-based service deadlines) — missing them can result in orders proceeding unopposed.",
        sourceExplanation: "CYFSA ss. 88 and 94(1), verified against the current consolidated text; Family Law Rules deadlines not independently re-verified for this update."
      }
    ]
  }
];

export const COURT_STEPS: CourtStep[] = [
  {
    id: "step-1-apprehension",
    title: "Initial Removal / Presentation (Day 1 - 5)",
    stage: "Pre-Court",
    timelineLimit: "Within five days (CYFSA s. 88)",
    description: "The child has been taken to a place of safety on an emergency basis, or a protection application has been served without removal.",
    purpose: "To bring the child's status immediately under judicial control rather than the society's own custody.",
    ruleReference: "CYFSA, s. 81 (apprehension) and s. 88 (five-day hearing rule)",
    officialForms: [
      { name: "Family Law Application (Protection)", formNumber: "Form 8B", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" },
      { name: "Affidavit (General)", formNumber: "Form 14A", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "The worker's initial affidavit is drafted rapidly and often repeats unchecked crisis details. Do not panic; prepare a factual response point-by-point.",
      "Make sure you get high-quality contact info for your worker's manager."
    ]
  },
  {
    id: "step-2-temporary-hearing",
    title: "Child Protection Hearing (Temporary Care and Custody)",
    stage: "Early Stage",
    timelineLimit: "Held under s. 90(1); s. 94's rules apply specifically if adjourned",
    description: "The court holds a hearing under s. 90(1) to determine whether the child is in need of protection and make an order under s. 101 — including, at this early stage, what happens to the child in the meantime.",
    purpose: "To determine if remaining in foster care is necessary for safety, or if the child can return home under supervision, or be placed with kinship family, while the full case proceeds.",
    ruleReference: "CYFSA, s. 90(1) (child protection hearing) and s. 101 (disposition orders); s. 94(2) governs the temporary custody order made specifically if the hearing is adjourned",
    officialForms: [
      { name: "Notice of Motion", formNumber: "Form 14", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" },
      { name: "Affidavit in response (Parent)", formNumber: "Form 14A", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "You do not need to prove you are a 'perfect' parent, only that the child can remain safely at home or with kin while court proceedings go on.",
      "Always suggest at least two competent kinship placement options immediately (family backups) — the court must consider this under s. 101(4) before ordering society care."
    ]
  },
  {
    id: "step-3-case-conference",
    title: "First Case Conference",
    stage: "Mid-Hearing",
    timelineLimit: "Usually scheduled within 30-45 days",
    description: "A mandatory, informal meeting between both parents, CAS representatives, respective lawyers, and a judge inside a private conference room.",
    purpose: "To explore settlement options, simplify issues, schedule disclosure, and discuss safe access plans. The judge cannot make final orders here unless all parties agree.",
    ruleReference: "Ontario Family Law Rules - Rule 17",
    officialForms: [
      { name: "Case Conference Brief (Parent/Society)", formNumber: "Form 17B", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "The Case Conference Brief (Form 17B) MUST be served and filed 7 days before. If you run late, the registry might reject your brief.",
      "Be respectful and focused on solution proposals rather than emotional complaints. The judge uses this to evaluate parental cooperatively."
    ]
  },
  {
    id: "step-4-motions",
    title: "Interim Motions & Disclosure Hearings",
    stage: "Mid-Hearing",
    timelineLimit: "As requested by motion filings",
    description: "Hearings held before a judge to resolve temporary battles like visitation increases, drug testing details, or forcing CAS to disclose hidden logs.",
    purpose: "To obtain mid-step court directives (orders) ensuring fairness and safeguarding parental access during the wait for trial.",
    ruleReference: "Ontario Family Law Rules - Rule 14",
    officialForms: [
      { name: "Notice of Motion (Interim)", formNumber: "Form 14", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" },
      { name: "Affidavit (Support/Reply)", formNumber: "Form 14A", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "Check your affidavits for hearsay! Every assertion of fact must be personally known to you, or state whom told you, when, more why you believe it.",
      "Focus motion requests on concrete issues, like 'reconnection visits three times a week supervised by grandmother'."
    ]
  },
  {
    id: "step-5-settlement-conference",
    title: "Settlement Conference",
    stage: "Resolution & Final",
    timelineLimit: "Prior to trial planning",
    description: "A final intensive conference chaired by a judge to determine if a full trial can be avoided by formatting a voluntary Supervision Agreement or Kinship Custody plan.",
    purpose: "To settle the case cooperatively, preserving family trust and avoiding high-stress trial dynamics.",
    ruleReference: "Family Law Rules - Rule 17 (Part 5)",
    officialForms: [
      { name: "Settlement Brief (Parent/Society)", formNumber: "Form 17C", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "Ensure you clearly understand any terms of supervision proposed. They are enforceable like court orders."
    ]
  },
  {
    id: "step-6-trial",
    title: "The Protection Trial",
    stage: "Resolution & Final",
    timelineLimit: "Order-type duration caps apply — see Procedural Timelines topic",
    description: "An open, formal courtroom proceeding where CAS and parents present direct witnesses, cross-examine observers, and submit physical evidence under oath.",
    purpose: "To make a final legal determination of the child's care, choosing between: dismissal of case (return home), Supervision Order, Society Care Order, or permanent (extended society) care.",
    ruleReference: "CYFSA, Part V (Child Protection, ss. 74-123) and the Family Law Rules",
    officialForms: [
      { name: "Summons to Witness", formNumber: "Form 23", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "Confirm all physical logs, calendars, text records, and eyewitnesses are subpœnaed on time.",
      "Dress conservatively and exhibit calm composure. Court transcripts record every spoken word."
    ]
  }
];

// Two fabricated case-law citations and three fabricated/unverifiable research citations were
// removed from this file (flagged in an earlier audit — searches turned up no matching case for
// "Catholic Children's Aid Society of Toronto v. T.O." or "Children's Aid Society of Simcoe
// County v. M.S., 2018", and the three attachment/trauma "studies" below cited vague journal
// names and all linked to the bare canlii.org homepage rather than an actual paper). Only the
// one research summary below that could be reasonably tied to a real, findable report has been
// kept, with its CYFSA citations corrected against the verified statute text.
export const RESEARCH_SUMMARIES: ResearchSummary[] = [
  {
    id: "systemic-racial-bias-4",
    title: "Indigenous & Black Children's Over-representation in Ontario Child Welfare",
    authorYear: "Ontario Human Rights Commission (2018)",
    category: "Systemic Factors",
    keyFindings: [
      "Indigenous children are significantly over-represented in Ontario's child welfare system relative to their share of the child population.",
      "CYFSA Part IV (ss. 68-73) requires active band/community consultation, but administrative gaps can delay customary-care and kinship placement reviews in practice.",
      "Systemic assessment patterns can over-correlate material poverty with direct safety neglect — a pattern the federal Act's s. 15 (no apprehension solely for socio-economic reasons) now directly targets for Indigenous children."
    ],
    evidenceSummary: "A statutory/policy review of Ontario child protection intakes, examining the under-use of customary care and kinship pathways for Indigenous and Black children.",
    sourceCitation: "Ontario Human Rights Commission, 'Interrupted Childhoods: Over-representation of Indigenous and Black children in Ontario child welfare,' 2018.",
    pubMedOrCanLiiLink: "https://www.ohrc.on.ca/en/interrupted-childhoods-over-representation-indigenous-and-black-children-ontario-child-welfare"
  }
];

export const LAWYERS: LawyerProfile[] = [
  {
    id: "lawyer-1",
    name: "Catherine Vance",
    firm: "Vance Family Defense",
    city: "Toronto",
    phone: "416-555-0182",
    email: "cvance@vancefamilydefense.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Exclusively defends parents against CAS. Expert in Section 81 warrant contestation and striking hearsay affidavits. Serves Greater Toronto Area.",
    languages: ["English", "French"],
    subscriptionSlot: "Exclusive"
  },
  {
    id: "lawyer-2",
    name: "Marcus Okonkwo",
    firm: "Okonkwo & Advocates LLP",
    city: "Toronto",
    phone: "416-555-0199",
    email: "m.okonkwo@okonkwoodvocates.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Specialist in First Nations, Inuit and Métis Customary Care representation. Focused on defending families under CYFSA Part IV and section 74.",
    languages: ["English", "Yoruba", "Igbo"],
    subscriptionSlot: "Priority"
  },
  {
    id: "lawyer-3",
    name: "Amélie Desjardins",
    firm: "Desjardins Droit Familial",
    city: "Ottawa",
    phone: "613-555-0112",
    email: "a.desjardins@desjardinsdroit.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Bilingual Ontario family barrister with 12 years of child protection litigation. Experienced in Superior Court status applications and CAS disclosure motions.",
    languages: ["English", "French"],
    subscriptionSlot: "Exclusive"
  },
  {
    id: "lawyer-4",
    name: "Robert Miller",
    firm: "Miller Law Alliance",
    city: "Ottawa",
    phone: "613-555-0145",
    email: "r.miller@millerlawalliance.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Handles emergency child preservation cases. Extensive experience working with Legal Aid Certificates in the Ottawa-Carleton municipality.",
    languages: ["English"],
    subscriptionSlot: "Priority"
  },
  {
    id: "lawyer-5",
    name: "Sarah Patel",
    firm: "Patel Family Adherence",
    city: "Mississauga",
    phone: "905-555-0221",
    email: "spatel@patelfamilylaw.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Focuses on parent coaching during CAS safety plan negotiations. Highly skilled in early dismissal motions and kinship assessments.",
    languages: ["English", "Hindi", "Gujarati", "Urdu"],
    subscriptionSlot: "Exclusive"
  },
  {
    id: "lawyer-6",
    name: "Timothy Finch",
    firm: "Sudbury Legal defense",
    city: "Sudbury",
    phone: "705-555-0371",
    email: "t finch@sudburydefense.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Serves Northern Ontario parents. Expert in rural CAS worker overreach defenses, Section 7 Charter litigation, and local band advocacy.",
    languages: ["English"],
    subscriptionSlot: "Exclusive"
  },
  {
    id: "lawyer-7",
    name: "Grace Sterling",
    firm: "Hamilton Family Rights",
    city: "Hamilton",
    phone: "905-555-0819",
    email: "g.sterling@hamiltonrights.ca",
    website: "https://www.ontario.ca/page/legal-aid-ontario",
    educationNotes: "Advocate with deep understanding of early kinship pathways. Defends fathers and mothers against protective apprehensions.",
    languages: ["English"],
    subscriptionSlot: "Exclusive"
  }
];

export const EMPTY_AFFIDAVIT: AffidavitDraft = {
  courtRegistryName: "",
  applicantName: "",
  respondentName: "",
  childNames: "",
  childBirthdates: "",
  authorName: "",
  isDraft: true,
  backgroundStatement: "",
  factualEvents: [],
  childsPerspectiveText: "",
  proposedCareArrangement: "",
  exhibits: []
};
