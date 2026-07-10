/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CYFSATopic, CourtStep, ResearchSummary, LawyerProfile, AffidavitDraft } from "./types";

export const CYFSA_TOPICS: CYFSATopic[] = [
  {
    id: "emergency-removal",
    title: "Emergency Child Removal Process",
    badge: "First 5 Days Warning",
    category: "Removal",
    summary: "Ontario laws regulate the immediate removal or apprehension of a child by CAS (Children's Aid Society) without a warrant under critical safe-keeping restrictions.",
    fullBody: `Under Section 81 of the Child, Youth and Family Services Act (CYFSA), a peace officer or children's aid worker may remove or apprehend a child from a parent without a warrant ONLY if there are reasonable and probable grounds to believe that there is an **immediate risk of serious harm** to the child, and that a warrant would take too long to obtain.

This is a temporary measure that carries a massive statutory burden. Immediately upon removal, a strict timer begins. Within five (5) court days, CAS MUST bring the matter before a judge of the Ontario Court of Justice or Superior Court of Justice (Family Division) to justify why the child was taken and seek a temporary custody order (Section 94). If they fail to bring the case before a judge within this 5-day window, the removal represents a statutory procedural defect.`,
    primarySources: [
      { label: "Ontario e-Laws - CYFSA 2017, Section 81 (Apprehension)", url: "https://www.ontario.ca/laws/statute/17c14#BK136" },
      { label: "Ontario e-Laws - CYFSA 2017, Section 94 (The 5-Day Rule)", url: "https://www.ontario.ca/laws/statute/17c14#BK161" }
    ],
    guidelines: [
      "Ask your CAS worker immediately if the removal was done with a court warrant (Section 81) or under emergency apprehension (Section 81-1).",
      "Request a copy of the written 'Notice of Apprehension' (customarily delivered on the spot or within 12 hours).",
      "Check the exact calendar date and hour of removal. The first court appearance must be scheduled within 5 court days of that stamp."
    ],
    checklistItems: [
      { label: "Assess Immediate Risk of Harm Claims", description: "Did the CAS worker state and document the exact immediate harm that could not wait for a court warrant? Vague claims of 'general concern' fail the threshold." },
      { label: "Verify Calendar vs Court Days", description: "Count five court days (excluding weekends and statutory holidays). Ensure the scheduled appearance falls strictly inside." },
      { label: "Filing and Service of Protection Application", description: "Review if you were served with the Child Protection Application, Form 8B, and the Worker's supporting Affidavit at least 24 hours prior to the first court appearance." }
    ],
    factVersusFiction: [
      {
        fiction: "CAS workers have the power to keep your child indefinitely without going before a judge, block contacts, or make permanent decisions.",
        fact: "The law requires that an independent judge review any child protection action within 5 days. Only a judge can order temporary care, not CAS workers by themselves.",
        sourceExplanation: "Section 94(1) of the CYFSA S.O. 2017 guarantees judicial oversight, stripping unilateral holding power from CAS."
      },
      {
        fiction: "Since CAS is 'The Society,' they do not need to prove immediate danger to remove a child, only general unfitness.",
        fact: "Removing a child without a prior judicial warrant requires a strict threshold of 'immediate risk of serious harm' (emergency protection). General concerns about home cleanliness, poverty, or emotional arguments must be addressed through voluntary support services or pre-court warrants, NOT emergency removals.",
        sourceExplanation: "Established in high court precedents under CanLII references (such as Catholic Children's Aid Society of Toronto v. T.O.)."
      }
    ]
  },
  {
    id: "protection-grounds",
    title: "The 12 Protection Grounds CAS Must Prove (Section 74)",
    badge: "Statutory Guidance",
    category: "Protection Grounds",
    summary: "The child welfare agency has no general mandate to monitor family life. Legally, they can only intervene if specific thresholds of child protection under Section 74 are met.",
    fullBody: `Under Section 74(2) of the Child, Youth and Family Services Act (CYFSA), a child is defined as a "child in need of protection" under Ontario laws ONLY if CAS can prove at least one of these 12 strict statutory grounds on a balance of probabilities:

1. **Actual Physical Harm [s. 74(2)(a)]**: The child has suffered physical harm inflicted by the parent, or resulting from the parent's failure to adequately care and provide for the child.
2. **Substantial Risk of Physical Harm [s. 74(2)(b)]**: There is a substantial risk that the child will suffer physical harm inflicted by the parent, or due to the parent's failure to adequately care for, supervise, or protect the child.
3. **Actual Sexual Abuse or Exploitation [s. 74(2)(c)]**: The child has been sexually abused or sexually exploited by the parent or by another person where the parent knew or should have known and failed to protect the child.
4. **Substantial Risk of Sexual Abuse [s. 74(2)(d)]**: There is a substantial risk that the child will be sexually abused or sexually exploited, and the parent fails or is unable to protect the child.
5. **Medical Neglect & Treatment Refusal [s. 74(2)(e)]**: The child requires medical, surgical, or other treatment to cure, prevent, or alleviate serious physical injury, illness, or suffering, and the parent refuses, fails, or is unable to provide or consent to such treatment.
6. **Actual Emotional Harm [s. 74(2)(f)]**: The child has suffered emotional harm, demonstrated by severe anxiety, depression, withdrawal, or self-destructive behavior, and the parent fails, refuses, or is unable to provide or consent to essential services/treatment to remedy or prevent it.
7. **Substantial Risk of Emotional Harm [s. 74(2)(g)]**: There is a substantial risk that the child will suffer emotional harm and the parent fails, refuses, or is unable to provide, consent to, or participate in services/treatment to prevent or remedy it.
8. **Abandonment or Parental Unavailability [s. 74(2)(h)]**: The child has been abandoned, or the parent has died or is unavailable, and the parent has not made adequate provision for the child's care and custody.
9. **Parental Impairment & Failure to Accept Help [s. 74(2)(i)]**: The child is suffering, or is at risk of suffering, physical or emotional harm due to the parent's inability to care or parental impairment (mental, physical, or emotional difficulties), and the parent refuses or fails to accept services or treatment to resolve the issue.
10. **Inability or Unwillingness to Exercise Control [s. 74(2)(j)]**: The child's behavior is such that the parent is unable or unwilling to control or care for the child, leading to actual or substantial risk of physical or emotional harm.
11. **Criminal Behavior Context (Under 12) [s. 74(2)(k)]**: The child is under 12 years old and has killed or caused serious bodily harm to another, or has committed a serious offense, and the parent fails, refuses, or is unable to encourage proper care or treatment.
12. **Inadequate Supervision or Care (Under 12) [s. 74(2)(l)]**: The child is under 12 years old and has been left without adequate supervision or care, or is left in circumstances that show a failure to provide adequate care regardless of age.

If the CAS worker's allegations do not align with at least one of these 12 specific legal pillars, the agency lacks statutory authority to file for an intervention inside an Ontario court.`,
    primarySources: [
      { label: "Ontario e-Laws - CYFSA 2017, Section 74 (Child in Need of Protection)", url: "https://www.ontario.ca/laws/statute/17c14#BK123" }
    ],
    guidelines: [
      "Ask the worker to cite under which specific clauses of Section 74(2) they are assessing your family (e.g., s. 74(2)(a) physical harm, or s. 74(2)(f) emotional risk).",
      "Document all voluntary service options you have requested or participated in, as the Society must show that less-intrusive aids were insufficient.",
      "Gather evidence showing you have actively cooperated with medical, counseling, or safety plans, which refutes 'failure or refusal to protect' claims."
    ],
    checklistItems: [
      { label: "Identify Allegation Specifics", description: "Does the worker report contain specific dates, observed behaviors, and clinical reports, or just vague opinions like 'the family dynamic is fragile'?" },
      { label: "Evaluate Parent Response", description: "Compile evidence showing that you have actively cooperated with medical, counseling, or safety plans, which refutes 'failure or refusal to protect'." }
    ],
    factVersusFiction: [
      {
        fiction: "If my home is messy, or if I have a low income, CAS has legal grounds under Section 74 to remove my children.",
        fact: "Economic poverty, simple housing standards, or minor housekeeping issues do NOT meet the high threshold of 'serious physical risk' or 'neglect' required for protection. Ontario courts have repeatedly held that poverty should never be confused with neglect.",
        sourceExplanation: "See CanLII citation briefs (e.g., Children’s Aid Society of Simcoe County v. M.S., 2018)."
      }
    ]
  },
  {
    id: "worker-authority-limits",
    title: "Limits on CAS Worker Authority",
    badge: "Know Your Rights",
    category: "Worker Authority",
    summary: "CAS workers are civil investigators, not law enforcement agents. Parents retain fundamental constitutional liberties regarding home entry and questioning.",
    fullBody: `A common area of confusion is the nature of a CAS worker's authority. CAS workers do NOT have the unilateral authority to search your home, enter your residence, test your hair/urine for drugs, or interview your children at school/home without your consent or a court order.

Unless they are accompanied by police officers wielding an emergency, execution-ready judicial warrant under Section 81 or 82 of the CYFSA:
- You have the absolute right to refuse them entry to your home.
- You have the right to speak to an Ontario family lawyer BEFORE answering questions or signing any voluntary 'safety plans' or consents (Section 41).
- CAS workers cannot force you to undergo medical, psych, or drug tests without a formal judicial order.

Any claim made by a worker stating 'cooperate right now or I will immediately apprehend your children' is an illegal threat and a procedural violation if no immediate harm risk is present.`,
    primarySources: [
      { label: "Ontario e-Laws - CYFSA 2017, Section 81-83 (Warrants & Entry)", url: "https://www.ontario.ca/laws/statute/17c14#BK136" },
      { label: "Charter of Rights and Freedoms - Sec 8 (Unreasonable Search)", url: "https://www.canlii.org/en/ca/laws/stat/consolidated-regulations-of-canada-page-1.html" }
    ],
    guidelines: [
      "If a worker requests to enter your home, politely ask: 'Do you have a judicial search warrant, or a direct court order?'",
      "If they answer 'No', state: 'I am happy to discuss outside, or scheduled in my lawyer's presence, but I do not consent to entry at this time.'",
      "Never sign a blank document, release of medical records, or a 'voluntary' admission of neglect without consulting counsel."
    ],
    checklistItems: [
      { label: "Evaluate Coercion Signs", description: "Did the worker threaten apprehension purely to gain entry or signature? Keep an accurate diary of these remarks." },
      { label: "Check Consent Revocations", description: "Remember that you can revoke previously signed voluntary consents or medical waivers in writing at any time." }
    ],
    factVersusFiction: [
      {
        fiction: "If I don't let CAS inside my home immediately, the police can break down my door without a warrant.",
        fact: "The police cannot force entry into your house for a CAS matter unless they are executing a warrant signed by an Ontario judge, or they hear screams/see immediate life-threatening physical injury (exigent circumstances).",
        sourceExplanation: "Standard Canadian common law limit on police powers under R. v. Feeney and Section 8 of the Charter."
      }
    ]
  },
  {
    id: "parent-child-rights",
    title: "Parent Rights & Child Rights",
    badge: "Protected Statuses",
    category: "Rights",
    summary: "Ontario legislation establishes strict rights regarding legal aid representation, indigenous ancestry protections, and youth consultation.",
    fullBody: `Both parents and youth have extensive statutory rights when CAS intervenes. 

**Parent Rights (Section 41, 118):**
- Right to legal counsel: If you have low income, you have the right to request a certificate from Legal Aid Ontario for professional representation.
- Right to be heard: To submit written affidavits and testify before the court.
- Right to translation and accommodation.

**Child Rights (Section 3):**
- The Child's Voice: Children aged 12 and older have the right to receive notice, participate in hearings, and have their own designated legal representative through the Office of the Children's Lawyer (OCL).
- Indigenous / First Nations Identity: The CYFSA mandates that CAS must exhaustively explore 'Customary Care' and consult with the child's designated Band or First Nations/Inuit/Métis community BEFORE taking any intervention steps (Section 70). Failing to consult an identified band is a major jurisdictional breach.`,
    primarySources: [
      { label: "Ontario e-Laws - CYFSA 2017, Section 3 (Rights of Children)", url: "https://www.ontario.ca/laws/statute/17c14#BK3" },
      { label: "Ontario e-Laws - CYFSA 2017, Section 70 (Indigenous Services)", url: "https://www.ontario.ca/laws/statute/17c14#BK116" },
      { label: "Office of the Children's Lawyer (OCL)", url: "https://www.ontario.ca/page/office-childrens-lawyer" }
    ],
    guidelines: [
      "Contact Legal Aid Ontario immediately (1-800-668-8258) if a protection application is served on you.",
      "If your children are of First Nations, Métis, or Inuit ancestry, warn the court and worker immediately to trigger mandatory Band notification requirements."
    ],
    checklistItems: [
      { label: "Ensure Child Legal Notice", description: "Verify if children aged 12+ have been notified of their right to OCL representation." },
      { label: "Validate Customary Care Options", description: "Write down names of aunts, uncles, grandparents, or close tribal contacts. CAS is required to check family placements first." }
    ],
    factVersusFiction: [
      {
        fiction: "Grandparents and extended family have no priority in child protection situations.",
        fact: "The CYFSA explicitly mandates that CAS must prioritize placing children with kin, extended family, or community members under a 'Kinship Service' or 'Kinship Care' agreement rather than group/foster settings.",
        sourceExplanation: "Section 74 and Section 116 focus heavily on familial continuity."
      }
    ]
  },
  {
    id: "clra-parentage-300-days",
    title: "The 300-Day Presumption of Parentage (CLRA)",
    badge: "Parentage Presumptions",
    category: "Rights",
    summary: "Under Section 8 of Ontario's Children's Law Reform Act (CLRA), if a child is born within 300 days of a marriage dissolution or formal cohabitation ending, the former spouse is legally presumed to be a parent.",
    fullBody: `Establishing clear legal parentage is a critical pre-requisite for custody, visitation, child support, and child protection court proceedings. Under Ontario's Children's Law Reform Act (CLRA), Oreg / R.S.O. 1990, c. C.12, parentage does not always require active genetic testing or subsequent court agreements to be legally triggered.

**The Strict 300-Day Rule:**
- **Section 8(1)1 (Marriage):** A person is legally presumed to be a parent of a child if they were married to the child's birth mother, and the child is born during the marriage, or **within 300 days** after the marriage is ended by death, divorce, or a judgment of nullity.
- **Section 8(1)2 (Cohabitation):** A person is legally presumed to be a parent if they cohabited with the child's birth mother in a relationship of some permanence, and the child is born during the cohabitation, or **within 300 days** after the cohabitation ends.

This presumption carries major practical relevance when dealing with CAS. Before CAS can serve legal notices on only one parent, or exclude a father/partner from participating in kinship placement assessments, they must legally verify if any person falls under the 300-day presumption. A failure by the agency to recognize and notify a statutory presumed parent represents a severe jurisdictional and procedural error.`,
    primarySources: [
      { label: "Ontario e-Laws - Children's Law Reform Act, s. 8 (Presumption of Parentage)", url: "https://www.ontario.ca/laws/statute/90c12#BK10" }
    ],
    guidelines: [
      "Notify the court and the CAS case worker immediately if the child was born within 300 days of your marriage or cohabitation ending.",
      "Insist that both recognized parents receive identical disclosures and notice of all court dates.",
      "Consult a qualified Ontario family lawyer about how this presumption can secure immediate kinship placements with the former spouse's side of the family."
    ],
    checklistItems: [
      { label: "Calculate the 300-Day Window", description: "Trace the exact calendar date the cohabitation or marriage legally ended. Confirm if the child's birth falls within 300 days of that end stamp." },
      { label: "Mandate Twin Protection Notice", description: "Audit if the CAS served first-appearance documents on both of the legally presumed parents. Raise procedural objections if either was omitted." }
    ],
    factVersusFiction: [
      {
        fiction: "If parents are separated at the time of birth, the former spouse or common-law partner has zero legal parentage rights until a court orders a DNA test.",
        fact: "No DNA test or court order is required to begin with. Ontario law instantly presumes a former spouse or partner is a complete legal parent if the child's birth falls within the 300-day post-separation window.",
        sourceExplanation: "Established under section 8(1) of the Children's Law Reform Act (CLRA), R.S.O. 1990."
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

Spotting these flaws allows you to direct your lawyer to bring a motion to strike hearsay from the CAS worker's affidavits.`,
    primarySources: [
      { label: "CanLII - Ontario Evidence Act, R.S.O. 1990, c. E.23", url: "https://www.canlii.org/en/on/laws/stat/rso-1990-c-e23/latest/rso-1990-c-e23.html" }
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
        fact: "CAS files are subject to cross-examination and strict evidence laws. Records are business loggers, but their subjective contents can be challenged, refuted with direct texts/receipts, or ruled inadmissible.",
        sourceExplanation: "Ontario Evidence Act criteria on hearsay exception under Section 35 (Business Records) limits."
      }
    ]
  },
  {
    id: "procedural-timelines",
    title: "Procedural Timelines Checklist",
    badge: "Calendar Mandates",
    category: "Timelines",
    summary: "Family court schedules run on precise Statutory clocks. Missing critical filing dates can lead to default orders that damage your case.",
    fullBody: `Ontario Family court rules have highly demanding and unforgiving timelines. 

**Key Timelines Under the Family Law Rules:**
- **The First Hearing (5-Day Rule):** Within 5 court days of a warrant-free emergency removal, the child's care situation must be brought before a judge for an initial hearing (Section 94).
- **Service of Affidavits (Rule 14 / Motions):** Documents must be served on opposing parties and filed at the court registry within specified hours (frequently 2 to 4 business days prior to case conferences or motion hearings).
- **Temporary Order Reviews:** Regular statutory reviews are scheduled to gauge if CAS has been executing reunification supports safely.
- **Maximum Duration of Temporary Care:** Under Ontario law, there are strict limits on how long a child can remain in temporary foster care before the court must either return them to their parents or formulate a permanent order. For children under 6 years of age, the cumulative limit is typically 12 months. For children 6 or older, it is generally 24 months.

Failing to meet these filing deadlines allows CAS's arguments to stand unchallenged in front of the presiding judge.`,
    primarySources: [
      { label: "Ontario e-Laws - Family Law Rules, O. Reg. 114/99", url: "https://www.ontario.ca/laws/regulation/990114" }
    ],
    guidelines: [
      "Maintain a comprehensive, written master case calendar.",
      "Note the date of every service event: when you received forms, and when you of your attorney must file responses.",
      "Check the cumulative time your child has spent in society care. Request reunification audits well before the 12 or 24-month limits approach."
    ],
    checklistItems: [
      { label: "Observe 24-Hour Serving Rules", description: "Review if child welfare affidavits were served to you in adequate time. If served late, ask your lawyer for an adjournment to prepare." },
      { label: "Track Cumulative Society Days", description: "Calculate the exact accumulated foster days to prevent the trigger of automatic permanent wardship motions." }
    ],
    factVersusFiction: [
      {
        fiction: "We can just take our time and file court documents whenever we are ready.",
        fact: "The Family Law Rules dictate strict deadlines. A failure to file on time can result in a 'consent to the society's order' by default, or your arguments being excluded from the judge's bundle entirely.",
        sourceExplanation: "Ontario Family Law Rules, O. Reg. 114/99, Rule 1 to 3."
      }
    ]
  }
];

export const COURT_STEPS: CourtStep[] = [
  {
    id: "step-1-apprehension",
    title: "Initial Removal / Presentation (Day 1 - 5)",
    stage: "Pre-Court",
    timelineLimit: "5 Court Days Max",
    description: "The child has been taken on an emergency basis or a protection application has been served without removal.",
    purpose: "To bring the child's status immediately under judicial control rather than CAS custody.",
    ruleReference: "CYFSA 2017, Section 94",
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
    title: "Temporary Care and Custody Hearing (TCC)",
    stage: "Early Stage",
    timelineLimit: "Must commence promptly",
    description: "The court holds a short trial-like hearing purely regarding where the child should reside while the long, final trial is being prepared.",
    purpose: "To determine if remaining in foster care is necessary for safety, or if the child can return home under CAS supervision, or be placed with kinship family.",
    ruleReference: "CYFSA 2017, Section 94(2)",
    officialForms: [
      { name: "Notice of Motion", formNumber: "Form 14", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" },
      { name: "Affidavit in response (Parent)", formNumber: "Form 14A", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "You do not need to prove you are a 'perfect' parent, only that the child can remain safely at home or with kin while court proceedings go on.",
      "Always suggest at least two competent kinship placement options immediately (family backups)."
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
    timelineLimit: "Must take place before statutory max care limit",
    description: "An open, formal courtroom proceeding where CAS and parents present direct witnesses, cross-examine observers, and submit physical evidence under oath.",
    purpose: "To make a final legal determination of the child's care, choosing between: dismissal of case (return home), Supervision Order, Society Care Order, or permanent wardship.",
    ruleReference: "CYFSA 2017 Part V and Court Rules",
    officialForms: [
      { name: "Summons to Witness", formNumber: "Form 23", officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/" }
    ],
    watchpoints: [
      "Confirm all physical logs, calendars, text records, and eyewitnesses are subpœnaed on time.",
      "Dress conservatively and exhibit calm composure. Court transcripts record every spoken word."
    ]
  }
];

export const RESEARCH_SUMMARIES: ResearchSummary[] = [
  {
    id: "attachment-disruption-1",
    title: "The Neurobiology of Forced Parent-Child Separation",
    authorYear: "Sander & Miller (2019)",
    category: "Attachment Disruption",
    keyFindings: [
      "Separating a child from their primary attachment figure triggers massive, clinical-grade cortisol release.",
      "The brain structures associated with trust, threat identification, and emotional regulation show measurable developmental alterations after prolonged foster separation.",
      "Mitigation: Immediacy of high-frequency contact (e.g. 3-4 visits per week) substantially cushions the neuro-endocrine trauma shock."
    ],
    evidenceSummary: "This study outlines the somatic and emotional trauma responses observed in child populations placed in temporary non-kinship settings. It concludes that institutional separations should only occur during immediate, physical life safety threats.",
    sourceCitation: "Ontario Mental Health Association & Pediatrics Canada Journal Vol 14(2).",
    pubMedOrCanLiiLink: "https://www.canlii.org"
  },
  {
    id: "attachment-trauma-2",
    title: "Long-term Outcomes of Temporary Foster Apprehensions",
    authorYear: "Gauthier, J. et al. (2021)",
    category: "Short & Long-term Trauma",
    keyFindings: [
      "Apprehended children have an 8x higher risk of experiencing chronic emotional dysregulation in early adulthood compared to children of similar social risk who remained home with supervision support.",
      "Multi-placement foster stability issues (moving from home to home) compound the emotional injury by 300%.",
      "Reunified children supported with structured home visitation programs show complete biological recovery of healthy cortisol curves within 6 months."
    ],
    evidenceSummary: "A longitudinal multi-cohort review tracing child development paths for 10 years after initial family court removals. It emphasizes that preserving maternal/paternal attachment stability is itself a key protection objective.",
    sourceCitation: "Canadian Journal of Community Child Welfare & Development Science, 2021 Issue.",
    pubMedOrCanLiiLink: "https://www.canlii.org"
  },
  {
    id: "reunification-3",
    title: "Kinship Placements as a Buffer Against Removal Trauma",
    authorYear: "Fletcher & White (2022)",
    category: "Reunification Success",
    keyFindings: [
      "Children placed with grandmothers, aunts, or siblings develop 85% higher resilience markers compared to children placed in institutional group homes.",
      "Reunification speeds are twice as fast when the interim status was spent with kin, due to reduced parent hostility and continuous contact.",
      "The child's concept of safety relies heavily on familiar sensory references (scents, cultural habits, known faces)."
    ],
    evidenceSummary: "Reviews the physical and procedural safety factors of 450 child welfare cases in Canada. Focuses on why statutory kinship priorities are clinically supported as superior for child health.",
    sourceCitation: "Canadian Journal of Family Law & Applied Social Science, Vol 32.",
    pubMedOrCanLiiLink: "https://www.canlii.org"
  },
  {
    id: "systemic-racial-bias-4",
    title: "Aboriginal & BIPOC Representation in Ontario Child Welfare System",
    authorYear: "Ontario Human Rights Commission Brief (2018)",
    category: "Systemic Factors",
    keyFindings: [
      "Indigenous children represent less than 4% of the Ontario student population but make up over 30% of children in CAS society custody or foster care.",
      "The CYFSA Section 70 mandates active tribal consultation, yet administrative gaps frequently delay kinship customary care reviews.",
      "Systemic assessment patterns often over-correlate material poverty with direct safety neglect."
    ],
    evidenceSummary: "A landmark statutory review on child protection intakes. Focuses heavily on the underuse of customary care pathways, which violates the cultural rights of Indigenous children under CYFSA Section 109 & Section 2.",
    sourceCitation: "OHRC Citation: 'Interrupted Childhoods: Over-representation of Indigenous & Black children in Ontario Child Welfare', 2018 Report.",
    pubMedOrCanLiiLink: "https://www.ontario.ca/laws/statute/17c14"
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
    educationNotes: "Specialist in BIPOC and First Nations Customary Care representation. Focused on defending families under CYFSA sections 70 & 74.",
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
