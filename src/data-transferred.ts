/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content transferred from the separate cyfsa-parents-know-your-rights app into ParentShield,
 * at Chris's request, as free informational content (no new paywall — the source app's
 * separate Gmail-OAuth/license-key unlock system was NOT carried over).
 *
 * IMPORTANT — verification status: the source app's content had not been through
 * ParentShield's citation-verification process (checking claims against the actual saved
 * statute text in legal-reference/). Every specific statutory citation below was re-checked
 * against legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt before being ported:
 *   - CYFSA s.81 (5-day rule), s.74/s.101 (protection grounds/interim care), s.122
 *     (12-month cap on interim society care for children under 6) — all confirmed present
 *     and accurately described in the source text.
 *   - The source app's claim of a statutory "Day 45" deadline for CAS to complete an
 *     investigation does NOT appear anywhere in the consolidated CYFSA text (the only "45
 *     days" references in the whole Act concern institutional-placement reviews and an
 *     unrelated mental-disorder timeline) — this specific claim was dropped rather than
 *     ported, since it could not be confirmed and presenting an unconfirmed statutory
 *     deadline as fact is exactly the kind of error this app's prior audits exist to catch.
 *   - Charter of Rights sections (s.7, s.8, s.10(b), s.15) are federal constitutional text,
 *     quoted from the Charter itself rather than the CYFSA file, and were spot-checked
 *     against the public Charter text.
 */

import { RoadmapStage, CharterRight, EmergencyContact } from "./types";

export const ROADMAP_STAGES: RoadmapStage[] = [
  {
    id: 0,
    code: "STAGE_0",
    title: "First Contact / Referral / Intake",
    timeline: "First 24 to 72 hours",
    description: "A referral is received by CAS from a school, police, hospital, or anonymous caller. A worker makes initial contact.",
    whatHappens: [
      "A CAS worker calls or arrives at the door, sometimes unannounced.",
      "The worker states they received a report regarding child safety.",
      "The worker requests to enter the home and see the child.",
    ],
    keyDeadlines: [
      "Immediately: note the date, time, and every worker's name and role.",
      "Within 24 hours: consider speaking with a lawyer or duty counsel before giving a detailed statement.",
    ],
    documentsNeeded: ["The worker's business card and supervisor's contact details", "A written copy of the specific concerns reported, if the worker will provide one"],
    yourActionPlan: [
      "Stay calm and courteous.",
      "You do not have to consent to entry without a warrant — ask what authority is being relied on.",
      "Legal Aid Ontario's emergency line can be reached at 1-800-668-8258.",
      "Start a dated, factual log of every contact from this point forward.",
    ],
    commonTraps: [
      "Inviting the worker inside out of panic before understanding what's being asked.",
      "Signing any consent form on the spot without reading it fully.",
      "Arguing or raising your voice at the door.",
    ],
  },
  {
    id: 1,
    code: "STAGE_1",
    title: "Investigation & Assessment Phase",
    timeline: "Days 1 onward",
    description: "CAS gathers facts: interviewing the child, contacting the school or doctors, and completing its own risk assessment.",
    whatHappens: [
      "A worker may interview the child, sometimes at school.",
      "Parents may be asked to sign medical or school consent forms.",
      "The worker may contact doctors, daycare, or police for information.",
    ],
    keyDeadlines: [],
    unverifiedNote: "The source material claimed a statutory \"45-day\" deadline for CAS to complete this phase. That specific deadline could not be confirmed anywhere in the consolidated CYFSA text and has been removed rather than presented as fact — ask your lawyer or Legal Aid Ontario what timeline actually applies to your specific file.",
    documentsNeeded: ["Any consent forms before you sign them", "Your child's medical and school records, gathered independently", "Character reference letters, if relevant"],
    yourActionPlan: [
      "Read any consent form carefully — you can ask that it be limited to specific providers rather than open-ended.",
      "Gather school and medical records yourself where you're able to.",
      "Ask for a copy of any completed risk assessment concerning your family.",
    ],
    commonTraps: [
      "Signing an open-ended medical release without limits.",
      "Not asking what boundaries apply to a worker interviewing your child.",
    ],
  },
  {
    id: 2,
    code: "STAGE_2",
    title: "Safety Plans & Voluntary Agreements",
    timeline: "During or following investigation",
    description: "CAS may propose an in-home safety plan, a voluntary family service agreement, or a temporary placement with a relative.",
    whatHappens: [
      "A worker presents a written safety plan or agreement.",
      "You may be asked to have your child stay with a relative temporarily.",
      "You may be asked to attend a parenting program, counselling, or testing.",
    ],
    keyDeadlines: ["Before signing anything: ask for time to have a lawyer review it first."],
    documentsNeeded: ["A copy of the draft safety plan or agreement", "Your lawyer's written recommendations, if you have counsel"],
    yourActionPlan: [
      "Treat a safety plan as a serious, binding document, not a casual formality.",
      "You are not required to sign anything on the spot, especially under pressure.",
      "Ask that any service requested have a clear end date and objective.",
      "Have a lawyer review it before you sign, if at all possible.",
    ],
    commonTraps: [
      "Assuming \"voluntary\" means low-stakes — not meeting the terms of a signed safety plan can later be used as a reason for more serious action.",
      "Agreeing to an open-ended relative placement with no court oversight or end date.",
    ],
  },
  {
    id: 3,
    code: "STAGE_3",
    title: "Apprehension / Child Removal",
    timeline: "Emergency event",
    description: "CAS removes a child, alleging a substantial risk that can't wait for a warrant or hearing.",
    whatHappens: [
      "A worker arrives, with or without police.",
      "The child is taken to a foster home or other approved place of safety.",
      "The parent is given a notice of apprehension.",
    ],
    keyDeadlines: ["The 5-day rule (CYFSA s.81/s.88): the matter must be brought before a court within 5 days of the child being brought to a place of safety."],
    documentsNeeded: ["The notice of apprehension", "The names of every worker and officer involved", "A written request for immediate access visits"],
    yourActionPlan: [
      "Do not physically block workers or police — challenge the apprehension through the court process, not in the moment.",
      "Call Legal Aid Ontario immediately: 1-800-668-8258.",
      "Put a request for access visits in writing right away.",
      "Start organizing every document you have for the upcoming hearing.",
    ],
    commonTraps: [
      "Losing composure in front of workers, which can be characterized later as evidence of instability.",
      "Waiting until the court date to make first contact with a lawyer.",
    ],
  },
  {
    id: 4,
    code: "STAGE_4",
    title: "First Court Appearance & Temporary Care Hearing",
    timeline: "Within 5 days of apprehension",
    description: "The first appearance before a Family Court judge, who decides temporary placement pending trial.",
    whatHappens: [
      "CAS files its application and supporting affidavit with the court.",
      "Duty counsel or your own lawyer represents you if you have counsel or accept duty counsel's help.",
      "The judge considers whether the child returns home under supervision or into temporary care.",
    ],
    keyDeadlines: ["Arrive early for the court date — check your specific notice for the exact time.", "A deadline will be set to file your written Answer — confirm the exact date with the court or your lawyer."],
    documentsNeeded: ["The application and affidavit you were served with", "Your own timeline of events", "Character references and any home-safety documentation, if relevant"],
    yourActionPlan: [
      "Meet with duty counsel as early as possible on the court date.",
      "CYFSA's least-intrusive-alternative principle means less disruptive options should be considered before more restrictive ones.",
      "If return home is delayed, propose a trusted family member as a kinship placement.",
      "Ask for the most frequent, structured access visits the court will grant.",
    ],
    commonTraps: [
      "Missing the court date.",
      "Not proposing a kinship placement option early, if one exists.",
    ],
  },
  {
    id: 5,
    code: "STAGE_5",
    title: "Ongoing Case Management & Service Compliance",
    timeline: "Typically several months",
    description: "The parent works through any court-ordered services while maintaining regular access visits, with case conferences along the way.",
    whatHappens: [
      "Case conferences and settlement conferences take place before the judge.",
      "CAS monitors home visits and program progress.",
      "Access visits may move from supervised toward unsupervised as things progress.",
    ],
    keyDeadlines: ["CYFSA s.122 caps interim society care at 12 months for a child under 6 at the time of the order, or 24 months for a child 6 or older."],
    documentsNeeded: ["Certificates of completion for any required programs", "Any compliance letters from a therapist or program", "A log of access visits attended"],
    yourActionPlan: [
      "Attend every scheduled access visit, on time.",
      "Keep a clear record of program attendance and completion.",
      "Ask about expanding access from supervised toward unsupervised or overnight, once appropriate.",
    ],
    commonTraps: [
      "Missing or arriving late to access visits.",
      "Not keeping your own record of program enrollment and completion.",
    ],
  },
  {
    id: 6,
    code: "STAGE_6",
    title: "Resolution, Settlement, Trial & Case Closure",
    timeline: "Varies by case",
    description: "The case concludes: the application is withdrawn, a supervision order expires, or the child is returned with the file formally closed.",
    whatHappens: [
      "A settlement conference or trial takes place.",
      "The judge either orders the child's permanent return or ends CAS's supervision.",
      "CAS issues a formal file-closure notice.",
    ],
    keyDeadlines: ["Get the exact date of the final court order in writing."],
    documentsNeeded: ["A sealed copy of the final court order", "CAS's file-closure letter"],
    yourActionPlan: [
      "Make sure your lawyer obtains an official copy of the final order.",
      "Ask for written confirmation that any record has been updated to reflect closure.",
    ],
    commonTraps: ["Assuming the case is closed without getting the official order in writing."],
  },
];

export const CHARTER_RIGHTS: CharterRight[] = [
  {
    section: "Section 7",
    title: "Right to Life, Liberty & Security of the Person",
    legalText: "Everyone has the right to life, liberty and security of the person and the right not to be deprived thereof except in accordance with the principles of fundamental justice.",
    meaning: "Courts have recognized the parent-child relationship as a protected liberty interest. CAS must follow fair, lawful process — proper notice and a fair hearing — before that relationship can be disrupted.",
    casConstraint: [
      "You're entitled to full disclosure of the allegations against you.",
      "A child cannot be removed arbitrarily or on unverified suspicion alone.",
      "You have the right to a fair hearing before an impartial judge.",
    ],
    script: "I understand I have a right to full written notice of the allegations before providing a detailed statement.",
  },
  {
    section: "Section 8",
    title: "Protection Against Unreasonable Search & Seizure",
    legalText: "Everyone has the right to be secure against unreasonable search or seizure.",
    meaning: "A child protection worker cannot enter your home without your voluntary consent, a court warrant, or a genuine emergency. Courts have treated the apprehension of a child as a form of seizure for the purposes of this section.",
    casConstraint: [
      "No entry without consent, a warrant, or an active emergency.",
      "Entry obtained through pressure or misrepresentation raises real Charter concerns.",
    ],
    script: "I don't consent to entry or inspection without a warrant. Please put your concerns in writing and provide your supervisor's contact information.",
  },
  {
    section: "Section 10(b)",
    title: "Right to Counsel Upon Detention or Apprehension",
    legalText: "Everyone has the right on arrest or detention to retain and instruct counsel without delay and to be informed of that right.",
    meaning: "If you are detained, or your child is apprehended, you have the right to speak with a lawyer before answering questions or signing documents.",
    casConstraint: [
      "You must be allowed to contact a lawyer without unreasonable delay.",
      "You are not required to sign a document, including a safety plan, under pressure before getting legal advice.",
    ],
    script: "I'd like to speak with a lawyer or duty counsel before answering further questions or signing anything.",
  },
  {
    section: "Section 15",
    title: "Equality Rights & Protection Against Discrimination",
    legalText: "Every individual is equal before and under the law and has the right to equal protection and equal benefit of the law without discrimination.",
    meaning: "A mental health diagnosis, disability, substance-use history, low income, or Indigenous or racialized background is not, on its own, a legal ground for removing a child.",
    casConstraint: ["A diagnosis alone does not equal an inability to parent."],
    script: "I'd like to understand specifically what safety concern is being relied on, separate from any diagnosis or personal circumstance.",
  },
];

export const INVESTIGATION_STAGES: {
  dayRange: string;
  title: string;
  description: string;
  whatCASDoes: string;
  whatYouShouldDo: string[];
  warningNote?: string;
}[] = [
  {
    dayRange: "Days 1–3",
    title: "Referral, Screening & Priority Assessment",
    description: "CAS receives a report (from a school, hospital, police, or another source) and assesses urgency.",
    whatCASDoes: "Reviews any prior history and determines whether immediate contact is required.",
    whatYouShouldDo: [
      "Ask the worker for their name, agency, and the exact nature of the referral.",
      "Ask for the details in writing where possible.",
      "Begin a dated, factual log immediately.",
    ],
    warningNote: "Initial referral details are sometimes incomplete or exaggerated — stay calm and document everything rather than reacting to the first version you hear.",
  },
  {
    dayRange: "Days 3–14",
    title: "Initial Contact, Interviews & Home Visit Attempt",
    description: "A worker attempts to interview parents, observe the child at home or school, and conduct safety checks.",
    whatCASDoes: "Seeks entry to inspect the home, may interview the child at school, and contacts collateral sources (doctors, teachers, family).",
    whatYouShouldDo: [
      "You aren't required to consent to home entry without a warrant or genuine emergency.",
      "If you do agree to a home visit, having a witness present is reasonable to ask for.",
      "A safe, stocked home (working smoke alarms, covered outlets) is worth attending to regardless.",
    ],
    warningNote: "A worker can interview a child at school without notifying a parent first — ask the school to notify you if CAS makes contact, though the school isn't obligated to.",
  },
  {
    dayRange: "Days 14–35 (approximate)",
    title: "Collateral Checks & Risk Assessment (ORAM)",
    description: "The worker gathers information from doctors, schools, police, and family, and completes Ontario's Risk Assessment Model (ORAM).",
    whatCASDoes: "Requests signed consent-to-release forms and contacts references and medical providers.",
    whatYouShouldDo: [
      "You can ask that any consent form be limited to specific providers and specific dates rather than open-ended.",
      "Gathering positive statements from your child's own doctor or teacher yourself is a reasonable step.",
      "Lining up character references in advance can help if the matter proceeds further.",
    ],
    warningNote: "An open-ended consent form can allow CAS to request records well beyond the specific concern raised — read carefully before signing.",
  },
  {
    dayRange: "Days 35–45 (up to 60 with a documented extension)",
    title: "Investigation Closure or Decision",
    description: "Under Ontario's Child Protection Standards (2016), an investigation is expected to conclude within 45 days of the referral, though a supervisor has discretion to extend that to 60 days in complex cases, with the reasons documented in the case record.",
    whatCASDoes: "Classifies the file as: unfounded/closed, closed with community referrals, a voluntary family service agreement, or a court application.",
    whatYouShouldDo: [
      "If the file is unfounded, ask for written confirmation of closure.",
      "If CAS proposes a voluntary agreement, have a lawyer review every clause before signing.",
      "Ask for a copy of the completed risk assessment.",
    ],
    warningNote: "This 45-day (or extended 60-day) timeline comes from the Ontario Child Protection Standards 2016 — a ministry policy document, not the CYFSA statute itself. It's a real, documented expectation, but it's a standard CAS is required to follow, not a hard statutory deadline written into the Act.",
  },
];

export const ORAM_STEPS = [
  { title: "1. Eligibility Spectrum", body: "Determines whether the reported concern meets the statutory definition of a child in need of protection under CYFSA s.74." },
  { title: "2. Safety Assessment", body: "Evaluates any immediate safety threat requiring urgent safety planning or intervention." },
  { title: "3. Risk Assessment", body: "Considers historical factors, parenting capacity, and support systems to assess the likelihood of future harm." },
];

export const INVESTIGATION_WATCHPOINTS = [
  { id: "no_warrant_entry", category: "Procedural", title: "Entry without consent or a warrant", description: "A worker enters the home over your objection without an active emergency — worth raising with your lawyer as a potential Charter s.8 concern." },
  { id: "blanket_consent", category: "Documentation", title: "Requests for an unrestricted, open-ended consent form", description: "Being asked to sign a release covering all records indefinitely, rather than something scoped to the specific concern." },
  { id: "unverified_hearsay", category: "Investigation", title: "Relying solely on an unverified, uncorroborated report", description: "An allegation from a single source (e.g. an estranged ex-partner) with no independent corroboration." },
  { id: "school_interview_no_notice", category: "Procedural", title: "No documentation of a school interview", description: "The child was interviewed at school with no record of what was asked or discussed." },
  { id: "late_disclosure", category: "Court Disclosure", title: "Favourable records omitted from court materials", description: "CAS obtains a positive doctor's or teacher's note but it doesn't appear in the affidavit filed with the court." },
  { id: "over_timeline", category: "Timeline", title: "Investigation open well past 45–60 days with no documented extension reason", description: "If the file has been open far beyond the standard window with no explanation on record, it's worth asking for a written status update." },
];

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  {
    name: "Legal Aid Ontario (LAO)",
    phone: "1-800-668-8258",
    hours: "24/7 emergency line for apprehensions",
    description: "Free legal aid assessment and duty counsel for child protection cases in Ontario.",
    website: "https://www.legalaid.on.ca",
  },
  {
    name: "Law Society of Ontario Referral Service",
    phone: "1-855-947-5255",
    hours: "Mon–Fri, 9:00 AM–5:00 PM",
    description: "A free 30-minute consultation with a family law lawyer in your area.",
    website: "https://lsrs.lso.ca",
  },
  {
    name: "Office of the Children's Lawyer (OCL)",
    phone: "1-416-314-8000",
    hours: "Mon–Fri, 8:30 AM–5:00 PM",
    description: "Independent legal counsel the court may appoint to represent children in CYFSA proceedings.",
    website: "https://www.ontario.ca/page/office-childrens-lawyer",
  },
  {
    name: "Ontario Ombudsman (Child & Youth Unit)",
    phone: "1-800-263-1830",
    hours: "Mon–Fri, 9:00 AM–4:30 PM",
    description: "Investigates formal complaints about administrative unfairness or misconduct by an Ontario Children's Aid Society.",
    website: "https://www.ombudsman.on.ca",
  },
];

// The source app's "Defense Strategies" content made sweeping, uncited claims — "Ontario
// courts have repeatedly held...", "judges have repeatedly admonished CAS..." — with no actual
// case citations. Given this project's own history of catching fabricated citations, those
// specific claims were NOT ported. What follows instead is the one piece that IS grounded in
// verified statute text (CYFSA s.1(2), s.101(1)-(3), s.109 — confirmed against
// legal-reference/), reframed as background on how the Act is structured rather than as
// asserted case law or a guaranteed "winning strategy."
export const LEAST_INTRUSIVE_ORDER_HIERARCHY = [
  { level: "Least intrusive", title: "Application dismissed / file closed", body: "No court order made — the family is not made subject to any supervision." },
  { level: "", title: "Supervision order (s. 101(1)1)", body: "The child stays in a parent's care and custody, subject to the society's supervision, for 3 to 12 months." },
  { level: "", title: "Interim society care (s. 101(1)2)", body: "The child is placed in the society's care and custody for up to 12 months. Under s. 109(2)(d), where a First Nations, Inuk, or Métis child needs a residential placement, extended family, band, or community placement must be considered first where possible." },
  { level: "Most intrusive", title: "Extended society care (s. 101(1)3)", body: "Continues until terminated or expires under the Act — the most disruptive order, reserved for cases where less intrusive alternatives have been found inadequate." },
];

export const DEFENSE_CONSIDERATIONS = [
  {
    topic: "A mental health diagnosis or substance-use history",
    body: "A diagnosis or history isn't, on its own, a ground for protection under s.74(2) — there has to be an actual or risked harm connected to it. Documentation of treatment engagement and stability is the kind of evidence a lawyer would typically want to see and present, but whether and how to use it is a strategic decision for your lawyer, not something to decide from a general guide.",
  },
  {
    topic: "Financial hardship or housing instability",
    body: "This is covered in detail, with a specific fact-vs-fiction citation, in the Detailed CYFSA Guide's \"Protection Grounds\" topic — poverty alone doesn't meet any of the 17 clauses in s.74(2).",
  },
];

