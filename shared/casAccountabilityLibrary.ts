/**
 * MILESTONE 2 — LIBRARY A: CAS Accountability & Professional Obligations Library
 *
 * Structured, source-verified collection of Ontario child protection agency obligations:
 * - A1. Statutory CAS Duties (Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1)
 * - A2. Ontario Child Protection Standards (2016) (Standards 1–8 + Standards for All Phases),
 *       explicitly separating mandatory "STANDARD" text from "PRACTICE_NOTE" guidance, and
 *       recording the historical CFSA-to-CYFSA legal transition.
 * - A3. Supervisory Accountability (mandatory consultation, approvals, departures from standards,
 *       review frequency, placement consultation, case closure/review approvals).
 * - A4. Case Notes and Recordkeeping (contemporaneous recording expectations under Standard G,
 *       tracking 9 required note elements, distinguishing missing documentation from proof an event did not occur).
 * - A5. Professional Ethics and Registration (OCSWSSW obligations under the Social Work and Social
 *       Service Work Act, 1998 — never assuming every CAS employee is a registered social worker).
 * - A6. Oaths, Declarations, and Sworn Evidence (verified court oaths/affirmations and affidavit
 *       commissioning under the Evidence Act and Family Law Rules r. 14(18)–(19) — never inventing
 *       a universal CAS worker oath and never automatically classifying an inaccurate affidavit as perjury).
 * - A7. Accountability and Complaint Pathways (Internal CAS s. 119 / O. Reg. 155/18, CFSRB s. 120,
 *       Ontario Ombudsman, OCSWSSW complaints, IPC Part X s. 316, and Family Court procedural remedies,
 *       with explicit court-order exclusions under s. 119(11) and s. 120(8)).
 */

export type LegalForceClassification =
  | "STATUTORY_MANDATORY"
  | "STATUTORY_DISCRETIONARY"
  | "STATUTORY_GUIDING_PRINCIPLE"
  | "REGULATORY_MANDATORY"
  | "MINISTRY_STANDARD_MANDATORY"
  | "MINISTRY_PRACTICE_NOTE_GUIDANCE"
  | "PROFESSIONAL_REGULATORY_CODE"
  | "COURT_PROCEDURAL_RULE";

export type CaseStageType =
  | "REFERRAL_SCREENING"
  | "INVESTIGATION"
  | "SAFETY_ASSESSMENT"
  | "APPREHENSION_REMOVAL"
  | "INITIAL_COURT_HEARING"
  | "TEMPORARY_CARE_ADJOURNMENT"
  | "VOLUNTARY_AGREEMENT"
  | "DISPOSITION_PLANNING"
  | "CASE_TRANSFER"
  | "ONGOING_SERVICE"
  | "PLACEMENT_AND_CONTACT"
  | "STATUS_REVIEW"
  | "CASE_CLOSURE"
  | "RECORDS_AND_PRIVACY"
  | "OVERSIGHT_AND_COMPLAINTS"
  | "ALL_STAGES";

export type ResponsibleActorRole =
  | "CHILD_PROTECTION_WORKER"
  | "CHILD_PROTECTION_SUPERVISOR"
  | "LOCAL_DIRECTOR"
  | "CHILDRENS_AID_SOCIETY"
  | "REGISTERED_SOCIAL_WORKER_OR_SSW"
  | "AFFIANT_OR_WITNESS"
  | "INTERNAL_COMPLAINT_REVIEW_PANEL"
  | "COURT_OR_TRIBUNAL";

export interface CasAccountabilityRule {
  ruleId: string;
  librarySubcategory: "A1_STATUTORY_DUTY" | "A2_OCPS_STANDARD" | "A3_SUPERVISORY_ACCOUNTABILITY" | "A4_CASE_NOTES" | "A5_OCSWSSW_ETHICS" | "A6_SWORN_EVIDENCE" | "A7_OVERSIGHT_PATHWAY";
  authorityId: string;
  legalSource: string;
  exactSectionOrStandard: string;
  title: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  historicalBasisNote: string | null;
  legalForce: LegalForceClassification;
  /** Explicit separation of mandatory Standard vs Practice Note for OCPS rules */
  ocpsTextType?: "STANDARD" | "PRACTICE_NOTE" | "NOT_APPLICABLE";
  standardSummary: string;
  practiceNoteDistinction: string;
  caseStages: CaseStageType[];
  responsibleParty: ResponsibleActorRole;
  requiredAction: string;
  triggeringCircumstances: string;
  deadlineDescription: string | null;
  deadlineDays: number | null;
  applicabilityConditions: string[];
  exceptions: string[];
  requiredComplianceEvidence: string[];
  legalConsequencesOfNonCompliance: string;
  antiOverclaimGuardrail: string;
  sourceUrl: string;
}

// ============================================================================
// A1. STATUTORY CAS DUTIES (CYFSA, 2017)
// ============================================================================

export const A1_STATUTORY_CAS_DUTIES: readonly CasAccountabilityRule[] = [
  {
    ruleId: "CAS_DUTY:CYFSA_1_2_FAMILY_AUTONOMY_LEAST_DISRUPTIVE",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:1(2)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 1(1)–(2), paras. 1–7",
    title: "Paramount Best Interests Purpose & Family Preservation / Least Disruptive Course Principles",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA, R.S.O. 1990, c. C.11, s. 1(1)–(2) on April 30, 2018.",
    legalForce: "STATUTORY_GUIDING_PRINCIPLE",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "While promoting the best interests, protection and well-being of children is the paramount purpose (s. 1(1)), additional purposes require recognizing that help to parents should support the autonomy and integrity of the family unit on the basis of mutual consent wherever possible (para. 1), considering the least disruptive course of action including prevention, early intervention and community support services (para. 2), building on family strengths (para. 5), and respecting FNIM cultures, traditions, and extended family (para. 6).",
    practiceNoteDistinction:
      "Section 1(2) establishes mandatory interpretive principles subject to s. 1(1); operational service-delivery duties are enforced through specific provisions such as ss. 35(1)(c), 94(4), 100, and 101(2)–(3).",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "Consider the least disruptive course of action available and appropriate to help the child, including prevention, early intervention, and community support services, and build on family strengths wherever consistent with child safety.",
    triggeringCircumstances: "Any child protection intervention, service planning, or disposition recommendation.",
    deadlineDescription: "Ongoing throughout service delivery",
    deadlineDays: null,
    applicabilityConditions: [
      "Applies to all child protection services and court proceedings under the CYFSA",
      "Expressly subordinate to the paramount purpose of promoting the best interests, protection, and well-being of children under s. 1(1)"
    ],
    exceptions: [
      "Where a less disruptive course of action is inconsistent with the child's immediate safety, protection, or best interests under s. 1(1)"
    ],
    requiredComplianceEvidence: [
      "Documented consideration of prevention, early intervention, or community support services",
      "Assessment of family strengths and collaborative consent options in case notes or Plan of Care"
    ],
    legalConsequencesOfNonCompliance:
      "Informs judicial scrutiny of the Society's Plan of Care under s. 100 and whether removal thresholds under s. 94(4) or s. 101(2)–(3) have been met.",
    antiOverclaimGuardrail:
      "Do NOT interpret s. 1(2) as creating an unconditional statutory entitlement to every requested service or as prohibiting emergency apprehension where immediate protection is required under s. 81(7).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK3"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_15_2_OPPORTUNITY_TO_BE_HEARD",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:15(2)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 15(2)–(4)",
    title: "Duty to Ensure Children and Parents Have an Opportunity to Be Heard and Represented",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Expanded procedural fairness duties under Part II of the CYFSA effective April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "Service providers shall ensure that children, young persons, and their parents have an opportunity to be heard and represented when decisions affecting their interests are made and when they have concerns about the services they are receiving (s. 15(2)), and that decisions are made according to clear, consistent criteria and procedural safeguards (s. 15(4)).",
    practiceNoteDistinction:
      "Enforceable statutory procedural duty; alleged non-compliance with s. 15(2) is an express ground for complaint to the CFSRB under CYFSA s. 120(4), para. 4.",
    caseStages: ["ALL_STAGES", "DECISION_MAKING" as unknown as CaseStageType, "ONGOING_SERVICE", "PLACEMENT_AND_CONTACT"].filter(
      (s): s is CaseStageType => s !== ("DECISION_MAKING" as unknown as CaseStageType)
    ),
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "Provide children, young persons, and their parents a meaningful opportunity to be heard and represented before or when making decisions affecting their interests, and apply clear, consistent decision criteria.",
    triggeringCircumstances: "Any agency decision affecting the interests or rights of a child, young person, or parent (e.g., service planning, access changes, placement decisions).",
    deadlineDescription: "When decisions affecting their interests are made",
    deadlineDays: null,
    applicabilityConditions: [
      "Decision by a service provider (including a children's aid society) affecting the interests of a child, young person, or parent"
    ],
    exceptions: [
      "CYFSA s. 15(3): Does not apply if there is 'good cause' for not giving that person an opportunity to be heard or represented (e.g., acute emergency where prior notice would endanger the child)"
    ],
    requiredComplianceEvidence: [
      "Case notes or correspondence showing the parent and age-appropriate child were consulted and given an opportunity to state their views or involve a representative/support person before or during the decision",
      "Written reasons or documented criteria explaining how the decision was reached"
    ],
    legalConsequencesOfNonCompliance:
      "Subject to direct review by the Child and Family Services Review Board (CFSRB) under CYFSA s. 120(4), para. 4 (unless the issue is before or decided by the court per s. 120(8)), which may order compliance under s. 120(7)(c).",
    antiOverclaimGuardrail:
      "Always check whether the s. 15(3) 'good cause' exception applies or whether the issue is already before the court (which bars CFSRB review under s. 120(8)).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK21"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_17_ADR_CONSIDERATION",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:100",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 17(1)–(2) & s. 95",
    title: "Duty to Consider Alternative Dispute Resolution (ADR) and Indigenous ADR Consultation",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Continued and strengthened from former CFSA s. 20.2.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "If a child is or may be in need of protection, a society shall consider whether a prescribed method of alternative dispute resolution (ADR) could assist in resolving any issue related to the child or a plan for the child's care (s. 17(1)). For a First Nations, Inuk, or Métis child, the society shall consult with a representative chosen by each of the child's bands and communities regarding Indigenous or prescribed ADR processes (s. 17(2)).",
    practiceNoteDistinction:
      "Mandatory duty to consider ADR (and mandatory consultation with FNIM representatives under s. 17(2)), though participation in ADR itself requires party consent.",
    caseStages: ["INVESTIGATION", "DISPOSITION_PLANNING", "ONGOING_SERVICE"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "Consider whether a prescribed ADR method (such as Family Group Decision Making, Child Protection Mediation, or Indigenous Circle/ADR) could assist in resolving protection or care-plan issues, and consult the band/community representative for any FNIM child.",
    triggeringCircumstances: "Child is or may be in need of protection and an issue arises regarding the child or Plan of Care.",
    deadlineDescription: "During investigation, service planning, or court proceedings",
    deadlineDays: null,
    applicabilityConditions: ["Child is or may be in need of protection under the CYFSA"],
    exceptions: ["ADR participation itself requires voluntary informed consent of participants and safety suitability"],
    requiredComplianceEvidence: [
      "Documentation in case notes, transfer summary, or court filings that ADR was considered and discussed with the family",
      "For an FNIM child, documented consultation and notice to the band/community representative under s. 17(2) and s. 17(4)"
    ],
    legalConsequencesOfNonCompliance:
      "The court may adjourn a proceeding at any stage under CYFSA s. 95 (with party consent) to permit utilization of ADR; failure to consult FNIM representatives breaches s. 17(2).",
    antiOverclaimGuardrail:
      "Section 17(1) requires the society to consider ADR (and s. 17(2) requires consulting FNIM representatives), not that every dispute must be resolved out of court if safety risks or lack of consent preclude ADR.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK23"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_35_SOCIETY_FUNCTIONS_AND_STANDARDS",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:35(1)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, s. 35(1)–(2)",
    title: "Statutory Functions of a Children's Aid Society & Mandatory Compliance with Prescribed Standards",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA s. 15(3)–(4) on April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "Under s. 35(1), the functions of a society are to (a) investigate allegations or evidence that children may be in need of protection, (b) protect children where necessary, (c) provide guidance, counselling and other services to families for protecting children or for the prevention of circumstances requiring protection, (d) provide care for children assigned/committed to its care, and (e) supervise children assigned to its supervision. Under s. 35(2), a society shall provide the prescribed standard of services and follow prescribed procedures and practices.",
    practiceNoteDistinction:
      "Section 35(1)(c) establishes the society's statutory preventive/supportive mandate; however, court supervision orders remain subject to the non-funding rule in ss. 94(6)(c), 101(7)(c), and 116(4)(c).",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "Carry out child protection investigations, provide guidance, counselling, and preventive/protective family services, care for or supervise children as authorized, and follow prescribed Ministry standards and procedures (OCPS 2016 / O. Reg. 156/18).",
    triggeringCircumstances: "Receipt of a protection report, open investigation, or ongoing family service / court supervision.",
    deadlineDescription: "Ongoing statutory mandate",
    deadlineDays: null,
    applicabilityConditions: ["Agency designated as a children's aid society under CYFSA s. 34(1)"],
    exceptions: [
      "Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court supervision order cannot compel a society to provide direct financial assistance or purchase goods or services"
    ],
    requiredComplianceEvidence: [
      "Documented investigation steps under s. 35(1)(a)",
      "Documented guidance, counselling, or referrals offered to the family under s. 35(1)(c)",
      "Adherence to prescribed standards under s. 35(2)"
    ],
    legalConsequencesOfNonCompliance:
      "Failure to offer guidance/counselling or preventive assistance under s. 35(1)(c) directly undermines the society's position under s. 101(2)–(3) when seeking a removal order, and may trigger Ministry compliance orders under s. 43.",
    antiOverclaimGuardrail:
      "Never state that s. 35(1)(c) creates an unlimited obligation for CAS to pay for private therapy or purchase goods/services; always note the statutory limitation in ss. 94(6)(c), 101(7)(c), and 116(4)(c).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK46"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_72_73_80_FNIM_CONSULTATION_AND_CUSTOMARY_CARE",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:72",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1 & Federal Bill C-92",
    exactSectionOrStandard: "CYFSA, ss. 72, 73, 79(1) para. 4, 80, 101(5), 109(2)(d) & Bill C-92, ss. 12, 14, 15, 15.1, 16",
    title: "Indigenous (First Nations, Inuit, and Métis) Consultation, Party Notice, Customary Care & Placement Priority",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "CYFSA Part IV in force April 30, 2018; federal Bill C-92 (S.C. 2019, c. 24) in force January 1, 2020.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "When serving a First Nations, Inuk, or Métis child, a society must regularly consult the child's bands and FNIM communities (s. 72), consult chosen representatives on prescribed services/powers (s. 73), recognize band/community representatives as statutory parties (s. 79(1) para. 4), make all reasonable efforts to pursue customary care where the child cannot remain with the parent (s. 80), prioritize preventive care and reasonable pre-apprehension efforts (Bill C-92 ss. 14, 15.1), never apprehend solely on socio-economic conditions (Bill C-92 s. 15), and follow the statutory placement priority hierarchy (CYFSA ss. 101(5), 109(2)(d); Bill C-92 s. 16).",
    practiceNoteDistinction:
      "Binding provincial and federal statutory mandates, not discretionary practice guidelines.",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "Identify whether the child is a First Nations, Inuk, or Métis child (s. 90(2)(b)), give notice to and consult band/community representatives, prioritize preventive services, make all reasonable efforts to pursue a customary care plan (s. 80), and follow placement priority rules.",
    triggeringCircumstances: "Any child protection report, investigation, removal, agreement, service plan, or court proceeding involving a First Nations, Inuk, or Métis child.",
    deadlineDescription: "Prior to taking any significant measure (Bill C-92 s. 12(1)) and throughout the case",
    deadlineDays: null,
    applicabilityConditions: [
      "The child is a First Nations, Inuk, or Métis child (or identifies with / is a member of a band or listed FNIM community)"
    ],
    exceptions: [
      "Placement outside the priority hierarchy under s. 101(5) requires proving a 'substantial reason for placing the child elsewhere' and documenting why higher-priority placements under Bill C-92 s. 16(1) were not possible"
    ],
    requiredComplianceEvidence: [
      "Early identification inquiry into Indigenous heritage and band/community affiliation",
      "Written notice and consultation logs with the child's band(s) and FNIM community representatives",
      "Documented efforts to explore customary care (s. 80) and extended family placement (s. 101(5), Bill C-92 s. 16)"
    ],
    legalConsequencesOfNonCompliance:
      "Failure to notify/consult band representatives or demonstrate pre-apprehension reasonable efforts (Bill C-92 s. 15.1) can invalidate procedural steps, require adjournment for proper notice, or defeat a removal/disposition request.",
    antiOverclaimGuardrail:
      "If the uploaded record does not indicate whether the child is First Nations, Inuk, or Métis, mark Indigenous-specific rules as REQUIRES_FACTUAL_CLARIFICATION / NOT_APPLICABLE unless Indigenous identity is identified.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK89"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_81_88_APPREHENSION_AND_5_DAY_HEARING",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:81(7)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, ss. 81(2), 81(7) & 88",
    title: "Apprehension Thresholds (Warrant vs Warrantless) & Mandatory 5-Day Court Hearing Rule",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA ss. 40(2), 40(7), and 46(1) on April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "A warrantless apprehension under s. 81(7) requires reasonable and probable grounds that (a) the child is in need of protection, (b) the child is under 16, and (c) there would be a substantial risk to the child's health or safety during the time necessary to bring the matter on for a s. 90(1) hearing or obtain a warrant under s. 81(2). Once brought to a place of safety, s. 88 requires that as soon as practicable, and in any event within 5 days, the matter be brought before a court for a s. 90(1) hearing, the child be returned, or a s. 75(1)/s. 77 agreement be made.",
    practiceNoteDistinction:
      "Strict statutory and constitutional (Charter s. 7) safeguards governing state removal of a child.",
    caseStages: ["APPREHENSION_REMOVAL", "INITIAL_COURT_HEARING"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Document objective reasonable and probable grounds explaining why time did not permit seeking a warrant (s. 81(2)) or hearing (s. 90(1)), and bring the matter before the court (or return the child / execute a valid agreement) within 5 days under s. 88.",
    triggeringCircumstances: "Bringing a child to a place of safety with or without a warrant.",
    deadlineDescription: "As soon as practicable, and in any event within 5 days after bringing the child to a place of safety (CYFSA s. 88)",
    deadlineDays: 5,
    applicabilityConditions: [
      "Child younger than 16 brought to a place of safety under s. 81, s. 83(1)(a)(ii), or s. 136(5)"
    ],
    exceptions: [
      "If the child is returned to the person who last had charge (s. 88(b)) or a valid s. 75(1) / s. 77 agreement is executed within the 5-day window (s. 88(d)–(e))"
    ],
    requiredComplianceEvidence: [
      "Contemporaneous apprehension notes and sworn affidavit explaining why waiting for a s. 81(2) warrant or s. 90(1) hearing posed a substantial risk",
      "Court endorsement or application filing timestamp within 5 days of apprehension"
    ],
    legalConsequencesOfNonCompliance:
      "Holding a child in a place of safety beyond 5 days without bringing the matter to court or meeting s. 88(b)–(e) is unlawful and breaches CYFSA s. 88.",
    antiOverclaimGuardrail:
      "Never attribute warrantless apprehension authority to s. 81(1), and never attribute the 5-day hearing rule to s. 94(1) or s. 94(5).",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK103"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_100_101_PLAN_OF_CARE_AND_DISPOSITION",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:100",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "CYFSA, ss. 100 & 101(1)–(4), (7)",
    title: "Mandatory Written Plan of Care Elements, Pre-Intervention Assistance Inquiry & Less Disruptive Alternatives",
    effectiveFrom: "2018-04-30",
    effectiveTo: null,
    historicalBasisNote: "Succeeded former CFSA ss. 56 and 57 on April 30, 2018.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "Before the court makes a disposition or status review order under s. 101, 102, 114, or 116, the society must prepare a written Plan of Care (s. 100) describing (a) remedial services to be provided, (b) criteria by which the society will determine when its care or supervision is no longer required, (c) estimated time required, (d) if removing the child, why the child cannot be protected in the person's care, past efforts to do so, and planned contact efforts, (e) long-term placement arrangements if permanent removal is sought, and (f) cultural preservation arrangements. Under s. 101(2)–(4), the court must inquire into pre-intervention assistance efforts, prefer less disruptive alternatives, and consider placement with a relative or community member.",
    practiceNoteDistinction:
      "Mandatory statutory elements required in every written Plan of Care filed with the court.",
    caseStages: ["DISPOSITION_PLANNING", "STATUS_REVIEW"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "File a complete written Plan of Care satisfying all clauses of s. 100(a)–(f), document pre-intervention assistance efforts (s. 101(2)), explain why less disruptive alternatives are inadequate (s. 101(3)), and assess kinship/community placement options (s. 101(4)).",
    triggeringCircumstances: "Any application for a disposition order under s. 101/102 or status review order under s. 114/116.",
    deadlineDescription: "Prior to the court making an order under s. 101, 102, 114, or 116",
    deadlineDays: null,
    applicabilityConditions: ["Court proceeding seeking an order under CYFSA s. 101, 102, 114, or 116"],
    exceptions: [
      "Under s. 101(7)(c), supervision terms on the society shall not require the society to provide financial assistance or purchase goods or services"
    ],
    requiredComplianceEvidence: [
      "Written Plan of Care addressing s. 100(a) remedial services, s. 100(b) measurable exit criteria, s. 100(c) time estimate, and s. 100(d) past in-home protection efforts and access plan",
      "Evidence of pre-intervention assistance efforts (s. 101(2)) and kinship assessment (s. 101(4))"
    ],
    legalConsequencesOfNonCompliance:
      "A Plan of Care that omits specific remedial services (s. 100(a)), measurable exit criteria (s. 100(b)), or past efforts to protect the child in the parent's care (s. 100(d)(i)) is statutorily deficient under s. 100.",
    antiOverclaimGuardrail:
      "Section 100 (not s. 51) governs the court Plan of Care; s. 13(1) governs the individual residential Plan of Care prepared within 30 days of admission to a residential placement.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK123"
  },
  {
    ruleId: "CAS_DUTY:CYFSA_306_312_315_PART_X_RECORDS_AND_PRIVACY",
    librarySubcategory: "A1_STATUTORY_DUTY",
    authorityId: "CYFSA:312(1)",
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1, Part X",
    exactSectionOrStandard: "CYFSA, ss. 306(1), 312(1), 314(3), 315(2), 315(12) & 316(1)",
    title: "Part X Personal Information Accuracy, Right of Access (30-Day Response) & Right to Request Correction",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    historicalBasisNote: "Part X of the CYFSA came into force on January 1, 2020.",
    legalForce: "STATUTORY_MANDATORY",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "Service providers must take reasonable steps to ensure personal information used for providing a service is accurate, complete, and up-to-date (s. 306(1)). An individual has a right of access to records of their personal information (s. 312(1), subject to enumerated exceptions and severability under s. 312(2)), with a mandatory 30-day written response deadline (s. 314(3)). Once granted access, the individual may request in writing that inaccurate or incomplete records be corrected (s. 315(2)), and if refused, may require a Statement of Disagreement to be attached to the record (s. 315(12)) and complain to the IPC (s. 316).",
    practiceNoteDistinction:
      "Binding Part X statutory obligations overseen by the Information and Privacy Commissioner of Ontario (IPC).",
    caseStages: ["RECORDS_AND_PRIVACY", "ALL_STAGES"],
    responsibleParty: "CHILDRENS_AID_SOCIETY",
    requiredAction:
      "Maintain accurate, complete, and up-to-date personal information records (s. 306(1)), respond to written Part X access requests within 30 days (s. 314(3)), and respond to written correction requests within 30 days (s. 315(4)) or attach the requester's Statement of Disagreement (s. 315(12), (14)).",
    triggeringCircumstances: "Use/disclosure of personal information or receipt of a written access (s. 313) or correction (s. 315(2)) request on or after January 1, 2020.",
    deadlineDescription: "30 days after receiving a written access request (s. 314(3)) or correction request (s. 315(4)), subject to noticed extension up to 90 days",
    deadlineDays: 30,
    applicabilityConditions: [
      "Event or request occurs on or after January 1, 2020 (when Part X came into force)"
    ],
    exceptions: [
      "Access exceptions in s. 312(1)(a)–(d) (privilege, ongoing proceeding preparation under (c), risk of serious harm or confidential informant identity under (d), subject to mandatory severability under s. 312(2))",
      "Correction exception in s. 315(10)(b) for a professional opinion or observation made in good faith (though the right to attach a Statement of Disagreement under s. 315(12) still applies)"
    ],
    requiredComplianceEvidence: [
      "Written response to s. 313 access request within 30 days (or written extension notice under s. 314(4))",
      "Written response to s. 315(2) correction request within 30 days, non-obliterating correction under s. 315(11), or attachment of Statement of Disagreement under s. 315(14)"
    ],
    legalConsequencesOfNonCompliance:
      "Failure to respond within 30 days is a deemed refusal (ss. 314(7), 315(7)), shifting the burden of proof onto the society in an IPC complaint (ss. 314(8)(b), 315(8)(b)).",
    antiOverclaimGuardrail:
      "Never cite s. 292 (disclosure without consent) for an individual's right to access their own records (which is s. 312(1)), and never apply Part X to events prior to January 1, 2020.",
    sourceUrl: "https://www.ontario.ca/laws/statute/17c14#BK361"
  }
];

// ============================================================================
// A2. ONTARIO CHILD PROTECTION STANDARDS (2016) — STANDARDS 1–8 + ALL PHASES
// Explicitly separates "STANDARD" from "PRACTICE_NOTE".
// ============================================================================

export const A2_OCPS_2016_STANDARDS: readonly CasAccountabilityRule[] = [
  {
    ruleId: "OCPS_2016:STD_1_REFERRAL_SCREENING",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_1",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 1 (Receipt of Report or Referral)",
    title: "Standard 1 — Referral Screening, Eligibility Spectrum, 24-Hour History Check & Response Time",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued as prescribed operational standards under CYFSA s. 35(2) and O. Reg. 156/18 on April 30, 2018.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 1 requires the worker to gather referral information, check local and provincial child welfare history within 24 hours of receipt, apply the Ontario Child Welfare Eligibility Spectrum to determine whether the report meets the threshold for a protection investigation, assign the required response time (12 hours for immediate/extremely severe or 7 days for moderately severe), and obtain supervisory approval within 24 hours for extreme/immediate referrals or prior to closing at intake.",
    practiceNoteDistinction:
      "STANDARD text mandates the 24-hour database/history check, Eligibility Spectrum coding, 12-hour vs 7-day response assignment, and supervisory sign-off. PRACTICE NOTES provide clinical guidance on questioning callers and exploring community referrals when a report does not meet the protection threshold; Practice Notes do not have the same mandatory legal force as the Standard.",
    caseStages: ["REFERRAL_SCREENING"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Screen referral using the Eligibility Spectrum, complete prior history check within 24 hours, assign 12-hour or 7-day response time, and obtain supervisory approval.",
    triggeringCircumstances: "Receipt of a report or referral under CYFSA s. 125 / s. 126(1).",
    deadlineDescription: "History check within 24 hours; response time of 12 hours (immediate) or 7 days (moderately severe)",
    deadlineDays: 7,
    applicabilityConditions: ["Report or referral received by a children's aid society"],
    exceptions: ["Supervisor-approved documented extension or inability to locate family despite documented diligent efforts"],
    requiredComplianceEvidence: [
      "Intake screening record showing Eligibility Spectrum code",
      "Prior child protection history check timestamp within 24 hours",
      "Assigned response timeframe (12 hours or 7 days) and supervisor sign-off"
    ],
    legalConsequencesOfNonCompliance:
      "Delayed or unapproved screening may indicate an investigative gap or unexplained delay inconsistent with alleged urgency.",
    antiOverclaimGuardrail:
      "Do not treat Practice Notes under Standard 1 as statutory rules; verify whether the intake screening record is actually included in the uploaded disclosure before concluding a step was omitted.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_2_INVESTIGATION_PLANNING_AND_CONDUCT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_2",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 2 (Planning and Conducting a Child Protection Investigation)",
    title: "Standard 2 — Investigation Planning, Customized vs Traditional Response, and Interviews",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 2 requires pre-investigation planning in consultation with a supervisor, selecting a customized or traditional investigative approach, conducting unannounced visits only where planned visits would compromise child safety or investigation integrity, conducting separate face-to-face interviews with the alleged victim child, other children in the home, all parents/caregivers, and relevant collateral witnesses, and directly observing non-verbal/young children.",
    practiceNoteDistinction:
      "STANDARD text mandates supervisory planning, face-to-face interviews with the child, siblings, and parents/caregivers, and collateral checks. PRACTICE NOTES offer interviewing techniques and scheduling tips, which are clinical guidance rather than mandatory rules.",
    caseStages: ["INVESTIGATION"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Plan the investigation with a supervisor, interview the child, siblings, both/all custodial parents/caregivers, and relevant neutral collaterals, and document direct observations.",
    triggeringCircumstances: " Referral screened in for a child protection investigation.",
    deadlineDescription: "First face-to-face contact with child within 12 hours or 7 days per assigned response priority",
    deadlineDays: 7,
    applicabilityConditions: ["Open child protection investigation"],
    exceptions: [
      "Documented supervisory approval for any departure from required response times or interview sequence where safety or police protocol requires"
    ],
    requiredComplianceEvidence: [
      "Documented investigation plan and supervisory consultation",
      "Case notes of face-to-face interviews with the child, parents/caregivers, and independent collaterals (e.g., school, physician)"
    ],
    legalConsequencesOfNonCompliance:
      "Failure to interview a parent, failure to contact obvious neutral collaterals, or relying solely on one party's uncorroborated allegations weakens the reliability of the society's investigative conclusions.",
    antiOverclaimGuardrail:
      "Absence of collateral notes in a partial court brief is a documentation gap to pursue through disclosure, not automatic proof that no collateral contact occurred.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_3_SAFETY_ASSESSMENT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_3",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 3 (Assessing Safety)",
    title: "Standard 3 — Immediate Safety Assessment, Collaborative Safety Planning & Supervisory Approval",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 3 requires the worker to assess immediate safety threats at the first face-to-face contact, engage the family and extended network in developing the least intrusive Safety Plan capable of controlling immediate safety threats (preferring in-home or kinship safety interventions over removal where safe), assess the suitability and commitment of safety-plan participants, monitor the Safety Plan while active, and obtain immediate supervisory approval when a safety threat is identified.",
    practiceNoteDistinction:
      "STANDARD text requires completing the Safety Assessment at first face-to-face contact, considering in-home/kinship safety interventions before removal, and obtaining immediate supervisory approval. PRACTICE NOTES discuss examples of safety interventions and family engagement strategies.",
    caseStages: ["SAFETY_ASSESSMENT", "INVESTIGATION", "APPREHENSION_REMOVAL"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Complete the Safety Assessment at first face-to-face contact, evaluate less intrusive in-home or family/kinship safety-plan options with the parent before removal, and obtain supervisory approval.",
    triggeringCircumstances: "First face-to-face contact in an investigation or any subsequent emergence of an immediate safety threat.",
    deadlineDescription: "Safety assessment at first face-to-face contact; supervisory approval within 24 hours (or immediately if safety threat identified)",
    deadlineDays: 1,
    applicabilityConditions: ["Investigation or ongoing case where immediate child safety is assessed"],
    exceptions: ["Immediate emergency removal where no in-home or kinship safety plan can adequately protect the child"],
    requiredComplianceEvidence: [
      "Completed Safety Assessment tool and documented Safety Plan (if safety threats identified)",
      "Documentation of why in-home or extended-family safety interventions were or were not feasible",
      "Supervisory consultation and sign-off timestamp"
    ],
    legalConsequencesOfNonCompliance:
      "Directly relevant to whether the society satisfied CYFSA s. 81(7)(c), s. 94(4), and s. 101(3) regarding less disruptive alternatives.",
    antiOverclaimGuardrail:
      "Do not assume a Safety Assessment was not completed merely because only an affidavit was uploaded; flag the Safety Assessment tool as a priority disclosure request.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_4_RISK_ASSESSMENT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_4",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 4 (Assessing Risk)",
    title: "Standard 4 — Actuarial Risk Assessment Before Concluding Investigation or Transferring Case",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 4 mandates completion of the Ontario Family Risk Assessment tool prior to concluding an investigation or transferring a case to ongoing services, incorporating clinical judgment and family protective capacities, with supervisory review and approval.",
    practiceNoteDistinction:
      "STANDARD text requires completing the Risk Assessment and obtaining supervisory approval prior to investigation conclusion/transfer. PRACTICE NOTES provide guidance on discussing risk factors with families.",
    caseStages: ["INVESTIGATION", "CASE_TRANSFER"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Complete the standardized Family Risk Assessment tool and obtain supervisory approval before concluding the investigation or transferring the file to ongoing services.",
    triggeringCircumstances: "Conclusion of a child protection investigation or transfer to ongoing services.",
    deadlineDescription: "Prior to concluding investigation (within 45 days of referral under Standard 5)",
    deadlineDays: 45,
    applicabilityConditions: ["Child protection investigation reaching disposition or transfer"],
    exceptions: ["Investigation terminated early because child/family does not exist or society lacks jurisdiction"],
    requiredComplianceEvidence: [
      "Completed Family Risk Assessment tool with scored items, clinical overrides (if any), and supervisor approval"
    ],
    legalConsequencesOfNonCompliance:
      "Proceeding to ongoing intervention or court disposition without a completed, supervisor-approved Risk Assessment departs from Standard 4.",
    antiOverclaimGuardrail:
      "Distinguish actuarial risk scores under Standard 4 from evidence proving a child is in need of protection under CYFSA s. 74(2).",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_5_INVESTIGATION_CONCLUSION_AND_VERIFICATION",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_5",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 5 (Concluding a Child Protection Investigation)",
    title: "Standard 5 — Verification Decision, 45-Day Investigation Completion & Notice of Outcome to Parents",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 5 requires the worker to make an evidence-based verification decision (verified, not verified, or inconclusive) on a balance of probabilities, conclude the investigation within 45 days of referral (unless a supervisor approves a documented extension), obtain supervisory sign-off, and inform the parents and child (as age-appropriate) of the investigation outcome, verification decision, and disposition.",
    practiceNoteDistinction:
      "STANDARD text mandates the balance-of-probabilities verification analysis, the 45-day timeframe (subject to supervisor-approved extension), supervisory approval, and notifying the family of the outcome. PRACTICE NOTES provide guidance on communicating verification decisions sensitively.",
    caseStages: ["INVESTIGATION", "CASE_TRANSFER"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Document the verification decision and supporting evidence, complete the investigation within 45 days (or obtain supervisory extension approval), obtain supervisory approval, and notify the parents of the outcome.",
    triggeringCircumstances: "Conclusion of a child protection investigation.",
    deadlineDescription: "Within 45 days of receipt of the referral (unless a supervisor approves a documented extension)",
    deadlineDays: 45,
    applicabilityConditions: ["Open child protection investigation"],
    exceptions: [
      "Supervisor-approved documented extension where third-party forensic/medical/police information is pending"
    ],
    requiredComplianceEvidence: [
      "Investigation Conclusion / Verification record dated within 45 days of referral (or documented supervisory extension)",
      "Supervisory approval of verification and disposition",
      "Record of verbal/written notification to parents of the investigation outcome and reasons"
    ],
    legalConsequencesOfNonCompliance:
      "Unapproved delays beyond 45 days or failure to notify parents of the verification decision and reasons engages CYFSA s. 15(2) and s. 120(4), para. 5.",
    antiOverclaimGuardrail:
      "A CAS 'verification' decision under Standard 5 is an internal agency decision, NOT a judicial protection finding under CYFSA s. 74(2).",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_6_CASE_TRANSFER",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_6",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 6 (Transferring a Case)",
    title: "Standard 6 — Case Transfer Conferencing, Continuity of Service & Supervisory Approval",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 6 requires that when transferring a case from investigation to ongoing services (or between workers or societies), the transferring and receiving workers hold a transfer conference/meeting (involving the family where appropriate), complete transfer documentation, and obtain supervisory approval so service continuity is maintained.",
    practiceNoteDistinction:
      "STANDARD text mandates transfer documentation, worker handoff conferencing, family notification/involvement, and supervisory approval. PRACTICE NOTES suggest ways to introduce the new worker to the family.",
    caseStages: ["CASE_TRANSFER"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Complete transfer documentation, hold a transfer conference between transferring and receiving workers (involving the family where appropriate), and obtain supervisory approval.",
    triggeringCircumstances: "Transfer of a file from investigation to ongoing service, between ongoing workers, or between societies.",
    deadlineDescription: "At the point of case transfer (which triggers the 30-day Standard 7 service-plan clock)",
    deadlineDays: null,
    applicabilityConditions: ["Case transferred to ongoing services, a new worker, or another society"],
    exceptions: ["Emergency worker reassignment due to sudden leave (where supervisor manages interim handoff)"],
    requiredComplianceEvidence: [
      "Case transfer record with exact transfer date, transferring/receiving worker names, and supervisor sign-off",
      "Documentation of transfer conference and family notification"
    ],
    legalConsequencesOfNonCompliance:
      "Uncoordinated transfers often cause dropped referrals, lost service momentum, and ambiguity over the Standard 7 30-day service-plan deadline.",
    antiOverclaimGuardrail:
      "Record the exact case transfer date when present; if absent, do not guess the transfer date.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_7_ONGOING_SERVICE_CASE_MANAGEMENT",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_7",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 7 (Ongoing Service Case Management)",
    title: "Standard 7 — Ongoing Service Case Management, 30-Day Service Plan, Monthly Contact & 6-Month Reviews",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 7 requires completing a Family and Child Strengths and Needs Assessment and an initial written Service Plan within 30 days of investigation completion or case transfer to ongoing services, developed collaboratively with the parents, child, and extended network/FNIM representatives. It requires specific goals, activities, responsible persons, timeframes, active service referrals and monitoring, at least monthly face-to-face contact with the child and parents (including home visits), formal case reviews and Risk Reassessments at least every 6 months (or upon significant change), reunification assessment and concurrent planning where the child is out of home, and supervisory review/approval.",
    practiceNoteDistinction:
      "STANDARD text mandates the 30-day initial Service Plan from investigation completion/case transfer, collaborative parent participation, monthly face-to-face/home contact, active service coordination, 6-month formal case reviews, reunification assessment, and supervisory sign-off. PRACTICE NOTES discuss clinical goal-setting phrasing and conferencing styles.",
    caseStages: ["ONGOING_SERVICE", "DISPOSITION_PLANNING", "STATUS_REVIEW"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Complete the Strengths and Needs Assessment and initial collaborative Service Plan within 30 days of investigation completion or case transfer, make concrete referrals, maintain monthly face-to-face/home contact, review the Service Plan at least every 6 months, assess reunification, and obtain supervisory approval.",
    triggeringCircumstances: "Investigation completion with ongoing service disposition or transfer of case to ongoing protection services.",
    deadlineDescription:
      "Initial Service Plan within 30 days of investigation completion or case transfer; face-to-face contact at least monthly; formal case review at least every 6 months",
    deadlineDays: 30,
    applicabilityConditions: ["Case open in ongoing child protection services"],
    exceptions: [
      "If the triggering investigation completion date or case transfer date is not in the uploaded records, the 30-day deadline is DEADLINE_NOT_DETERMINABLE"
    ],
    requiredComplianceEvidence: [
      "Written Ongoing Service Plan and Family/Child Strengths and Needs Assessment dated within 30 days of investigation completion or case transfer",
      "Evidence of parent participation/signature or documented efforts to engage the parent",
      "Specific goals, activities, responsible persons, timeframes, and referral records",
      "Monthly face-to-face and home-visit case notes, 6-month formal review records, and supervisory approvals"
    ],
    legalConsequencesOfNonCompliance:
      "Failure to develop a timely collaborative Service Plan, make concrete referrals, or conduct periodic reunification reviews undermines any claim that the parent failed to remedy protection concerns within the s. 122(1) time-in-care limits.",
    antiOverclaimGuardrail:
      "NEVER calculate the Standard 7 30-day service-plan deadline from the removal/apprehension date alone; it runs from investigation completion or case transfer (if unknown, return DEADLINE_NOT_DETERMINABLE).",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  },
  {
    ruleId: "OCPS_2016:STD_8_ENDING_CHILD_PROTECTION_SERVICES",
    librarySubcategory: "A2_OCPS_STANDARD",
    authorityId: "OCPS:STD_8",
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18 under CYFSA s. 35(2)",
    exactSectionOrStandard: "OCPS (2016), Standard 8 (Ending Child Protection Services)",
    title: "Standard 8 — Final Safety/Risk Review, Community Linkages, Family Notice & Supervisory Approval on Closure",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Standard 8 requires that prior to terminating ongoing child protection services, the worker assess current safety and risk, review achievement of service-plan goals with the family, arrange warm handoffs to community-based support services where needed, notify the family in writing of case closure, and obtain supervisory approval.",
    practiceNoteDistinction:
      "STANDARD text mandates final safety/risk assessment, family review, written closure notice, and supervisory approval. PRACTICE NOTES provide guidance on transition planning meetings.",
    caseStages: ["CASE_CLOSURE"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Assess current safety and risk against exit criteria, review outcomes with the family, connect to community supports, provide written closure notice, and obtain supervisory approval.",
    triggeringCircumstances: "Decision to end ongoing child protection services or close a protection file.",
    deadlineDescription: "Prior to or upon case closure",
    deadlineDays: null,
    applicabilityConditions: ["Ongoing child protection case being considered for closure"],
    exceptions: ["Closure due to child turning 18 (where s. 124 Continued Care and Support transition rules apply instead)"],
    requiredComplianceEvidence: [
      "Case closure summary documenting reduced risk/resolved protection concerns",
      "Written closure notice to family and supervisory sign-off"
    ],
    legalConsequencesOfNonCompliance:
      "If a family has met the Plan of Care exit criteria (CYFSA s. 100(b)) and safety/risk threats are resolved, continuing intrusive intervention without documented justification departs from Standard 8 and CYFSA s. 1(2).",
    antiOverclaimGuardrail:
      "Completing service activities alone does not mandate automatic closure if objective, documented safety threats remain unresolved on reassessment.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  }
];

// ============================================================================
// A3. SUPERVISORY ACCOUNTABILITY
// ============================================================================

export const A3_SUPERVISORY_ACCOUNTABILITY_RULES: readonly CasAccountabilityRule[] = [
  {
    ruleId: "CAS_SUPERVISION:MANDATORY_CONSULTATION_AND_APPROVALS",
    librarySubcategory: "A3_SUPERVISORY_ACCOUNTABILITY",
    authorityId: "OCPS:ALL_PHASES",
    legalSource: "Ontario Child Protection Standards (2016), Standards for All Phases & Standards 1–8",
    exactSectionOrStandard: "OCPS (2016), All Phases (Supervisory Consultation) & Standards 1, 2, 3, 4, 5, 6, 7, 8",
    title: "Mandatory Supervisory Consultation, Decision Approvals, Departures from Standards & Regular Supervision",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "Issued February 1, 2016 under the former CFSA; continued under CYFSA s. 35(2) and O. Reg. 156/18.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Supervisors must review and approve: (1) referral screening and response-time dispositions (Standard 1), (2) investigation plans and any departure from required response times or interview sequences (Standard 2), (3) all Safety Assessments and Safety Plans within 24 hours / immediately when a safety threat is identified (Standard 3), (4) Risk Assessments (Standard 4), (5) verification decisions, 45-day extensions, and investigation conclusions (Standard 5), (6) case transfers (Standard 6), (7) initial 30-day Ongoing Service Plans, 6-month formal case reviews, placement/reunification decisions, and scheduled clinical supervision at least every 6 weeks in ongoing service (Standard 7), and (8) case closures (Standard 8). Every supervisory consultation and approval must be documented in the case record.",
    practiceNoteDistinction:
      "Mandatory supervisory approval points and documentation of departures from standards are STANDARD requirements, whereas clinical coaching techniques during supervision are Practice Notes.",
    caseStages: ["ALL_STAGES"],
    responsibleParty: "CHILD_PROTECTION_SUPERVISOR",
    requiredAction:
      "Conduct and document supervisory consultation and formal approval at every mandatory decision point, review and pre-approve any departure from a mandatory standard with documented reasons, and conduct regular ongoing case supervision.",
    triggeringCircumstances:
      "Screening disposition, Safety Plan/apprehension, departure from standard timeframe, verification decision, case transfer, initial 30-day Service Plan, 6-month review, placement change, or case closure.",
    deadlineDescription:
      "Immediate / within 24 hours for extreme safety referrals and Safety Plans; within 45 days for investigation conclusion; within 30 days of transfer for initial Service Plan; at least every 6 weeks for ongoing case supervision",
    deadlineDays: 1,
    applicabilityConditions: ["Any mandatory decision point or departure from a standard in a CAS file"],
    exceptions: ["None — departures from standards themselves require documented supervisory approval and rationale"],
    requiredComplianceEvidence: [
      "Supervisory sign-off / electronic approval timestamp on Safety Assessment, Risk Assessment, Investigation Conclusion, Transfer Summary, and Service Plan",
      "Supervisory case notes recording consultation rationale, placement consultation, and any approved departure from standards"
    ],
    legalConsequencesOfNonCompliance:
      "Unilateral worker decisions on safety plans, apprehensions, access restrictions, or verification findings without documented supervisory consultation/approval indicate a breakdown in required agency governance under OCPS (2016).",
    antiOverclaimGuardrail:
      "If only an affidavit or summary brief was uploaded, note that supervisory approval records are not documented in the uploaded excerpt and recommend requesting the complete supervisory sign-off log in disclosure.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  }
];

// ============================================================================
// A4. CASE NOTES AND RECORDKEEPING
// ============================================================================

export interface CaseNoteExpectationSpec {
  elementId: string;
  label: string;
  description: string;
  verificationCheck: string;
}

export const REQUIRED_CASE_NOTE_ELEMENTS: readonly CaseNoteExpectationSpec[] = [
  {
    elementId: "CONTACT_DATE_AND_TIME",
    label: "Contact date and time",
    description: "Exact date and time when the home visit, interview, telephone call, or observation occurred.",
    verificationCheck: "Check whether the event date/time is explicitly stated rather than vague ('recently', 'last week')."
  },
  {
    elementId: "METHOD_OF_CONTACT",
    label: "Method of contact",
    description: "Whether the contact was an announced home visit, unannounced home visit, office visit, telephone call, video call, or written message.",
    verificationCheck: "Verify how the contact occurred and whether direct observation was possible."
  },
  {
    elementId: "PARTICIPANTS",
    label: "Participants",
    description: "Full names and roles of all individuals present during the contact or interview (including children, parents, support persons, interpreters, or police).",
    verificationCheck: "Verify who was present and whether interviews were conducted separately or in the presence of others."
  },
  {
    elementId: "SIGNIFICANT_DISCUSSIONS",
    label: "Significant discussions",
    description: "Accurate, objective account of what was discussed, including parent questions, requests for assistance, and worker responses.",
    verificationCheck: "Check whether both the worker's questions/statements and the parent's actual responses are recorded."
  },
  {
    elementId: "OBSERVATIONS",
    label: "Direct observations vs opinion/hearsay",
    description: "Clear separation between what the worker personally saw or heard (firsthand observation), what a third party reported (hearsay), and the worker's clinical inference.",
    verificationCheck: "Check whether conclusory labels ('unstable', 'uncooperative', 'unsafe') are backed by concrete observable facts."
  },
  {
    elementId: "WORKER_IDENTITY",
    label: "Worker identity and role",
    description: "Name, title/role, and credentials (if applicable) of the worker who conducted the contact and authored the note.",
    verificationCheck: "Verify the author of the note matches the person who made the observation."
  },
  {
    elementId: "DATE_OF_NOTE_CREATION",
    label: "Date and time of note creation (contemporaneousness)",
    description: "Timestamp when the case note was actually entered into the agency system, enabling comparison against the event date.",
    verificationCheck: "Compare eventDate vs recordDate to identify contemporaneous entries (within 24–72 hours) vs delayed/retrospective reconstruction."
  },
  {
    elementId: "SUPERVISORY_DISCUSSIONS",
    label: "Supervisory discussions and directions",
    description: "Documentation of consultations with a supervisor, directions received, and approvals granted.",
    verificationCheck: "Check whether major decisions reference a documented supervisory consultation."
  },
  {
    elementId: "SUBSEQUENT_CORRECTIONS_OR_ADDITIONS",
    label: "Subsequent corrections or late addenda",
    description: "Any later correction or addition must be clearly marked and dated as a late addendum without altering, backdating, or obliterating the original entry.",
    verificationCheck: "Check for unexplained alterations, missing original entries, or Part X s. 315 correction/disagreement notes."
  }
];

export interface CaseNoteCompletenessEvaluation {
  presentElements: string[];
  missingElements: string[];
  distinctionNote: string;
}

export function evaluateCaseNoteCompleteness(input: {
  hasContactDateAndTime?: boolean;
  hasMethodOfContact?: boolean;
  hasParticipantsIdentified?: boolean;
  hasSignificantDiscussionsRecorded?: boolean;
  hasDirectObservationsSeparatedFromOpinion?: boolean;
  hasWorkerIdentityAndRole?: boolean;
  hasDateOfNoteCreation?: boolean;
  hasSupervisoryDiscussionsRecorded?: boolean;
  hasLateEntryOrAmendmentAttribution?: boolean;
}): CaseNoteCompletenessEvaluation {
  const present: string[] = [];
  const missing: string[] = [];

  const checks: [boolean | undefined, string][] = [
    [input.hasContactDateAndTime, "CONTACT_DATE_AND_TIME"],
    [input.hasMethodOfContact, "METHOD_OF_CONTACT"],
    [input.hasParticipantsIdentified, "PARTICIPANTS"],
    [input.hasSignificantDiscussionsRecorded, "SIGNIFICANT_DISCUSSIONS"],
    [input.hasDirectObservationsSeparatedFromOpinion, "OBSERVATIONS"],
    [input.hasWorkerIdentityAndRole, "WORKER_IDENTITY"],
    [input.hasDateOfNoteCreation, "DATE_OF_NOTE_CREATION"],
    [input.hasSupervisoryDiscussionsRecorded, "SUPERVISORY_DISCUSSIONS"],
    [input.hasLateEntryOrAmendmentAttribution, "SUBSEQUENT_CORRECTIONS_OR_ADDITIONS"],
  ];

  for (const [flag, code] of checks) {
    if (flag) {
      present.push(code);
    } else {
      missing.push(code);
    }
  }

  return {
    presentElements: present,
    missingElements: missing,
    distinctionNote:
      "CRITICAL DISTINCTION: Missing documentation in uploaded records establishes that the element is NOT DOCUMENTED in the available record — it is NOT proof that the underlying event or standard did not occur.",
  };
}

export const A4_CASE_NOTES_AND_RECORDKEEPING_RULES: readonly CasAccountabilityRule[] = [
  {
    ruleId: "CAS_RECORDS:CONTEMPORANEOUS_CASE_NOTES_STANDARD_G",
    librarySubcategory: "A4_CASE_NOTES",
    authorityId: "OCPS:ALL_PHASES",
    legalSource: "Ontario Child Protection Standards (2016), All Phases (Contemporaneous Case Notes) & CYFSA s. 306(1)",
    exactSectionOrStandard: "OCPS (2016), Standards for All Phases — Contemporaneous Case Notes & CYFSA, s. 306(1)",
    title: "Contemporaneous Case-Note Expectations, Fact-vs-Opinion Separation & Non-Obliterating Corrections",
    effectiveFrom: "2016-02-01",
    effectiveTo: null,
    historicalBasisNote:
      "OCPS (2016) Contemporaneous Case Notes standard effective February 1, 2016; reinforced by CYFSA Part X s. 306(1) accuracy duty effective January 1, 2020.",
    legalForce: "MINISTRY_STANDARD_MANDATORY",
    ocpsTextType: "STANDARD",
    standardSummary:
      "Workers must record case notes contemporaneously (as soon as possible after the event, generally within 24 hours for urgent/investigative events or prescribed agency timelines), recording contact date/time, method of contact, participants, significant discussions, concrete observations separated from professional opinion or third-party hearsay, worker identity, date of note creation, supervisory discussions, and dated non-obliterating addenda for any subsequent corrections.",
    practiceNoteDistinction:
      "Contemporaneous, accurate, factual recording is a mandatory operational and statutory (CYFSA s. 306(1)) expectation.",
    caseStages: ["ALL_STAGES", "RECORDS_AND_PRIVACY"],
    responsibleParty: "CHILD_PROTECTION_WORKER",
    requiredAction:
      "Record objective, contemporaneous case notes containing all 9 core documentation elements, distinguish direct observations from third-party hearsay and worker opinion, and never alter original entries without a dated addendum.",
    triggeringCircumstances: "Every client contact, home visit, collateral interview, observation, or supervisory consultation.",
    deadlineDescription: "Contemporaneously (as soon as possible after the contact; within 24 hours for urgent/safety events)",
    deadlineDays: 1,
    applicabilityConditions: ["All child protection case documentation"],
    exceptions: ["Documented emergency preventing immediate entry, where the late entry explicitly records both the event date/time and the later recording date/time"],
    requiredComplianceEvidence: [
      "Case notes showing both the event date/time and the system entry/creation timestamp",
      "Clear attribution of participants, method of contact, direct observations vs hearsay, and worker identity"
    ],
    legalConsequencesOfNonCompliance:
      "Substantial delay between an event and note creation reduces evidentiary reliability and weight; conflating third-party hearsay or opinion with firsthand observation violates Family Law Rules r. 14(18)–(19) when repeated in an affidavit.",
    antiOverclaimGuardrail:
      "CRITICAL DISTINCTION: Missing documentation in uploaded records establishes that the event is NOT DOCUMENTED in the available record — it is NOT automatic proof that the underlying event did not occur, though the absence of contemporaneous records when an event should normally have been recorded is a legitimate evidentiary gap to raise.",
    sourceUrl: "https://www.ontario.ca/page/ontario-child-protection-standards-2016"
  }
];

// ============================================================================
// A5. PROFESSIONAL ETHICS AND REGISTRATION (OCSWSSW)
// ============================================================================

export const A5_PROFESSIONAL_ETHICS_AND_REGISTRATION_RULES: readonly CasAccountabilityRule[] = [
  {
    ruleId: "OCSWSSW_ETHICS:REGISTRATION_AND_STANDARDS_OF_PRACTICE",
    librarySubcategory: "A5_OCSWSSW_ETHICS",
    authorityId: "OCSWSSW:REGISTRATION",
    legalSource: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31 & OCSWSSW Code of Ethics and Standards of Practice",
    exactSectionOrStandard: "SWSSWA, 1998, ss. 25–26, 46–47 & OCSWSSW Standards of Practice, Principles I–V",
    title: "OCSWSSW Registration Requirement (RSW / RSSW), Competence, Record-Keeping & Confidentiality Standards",
    effectiveFrom: "2000-08-15",
    effectiveTo: null,
    historicalBasisNote:
      "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31 and OCSWSSW Standards of Practice (Second Edition).",
    legalForce: "PROFESSIONAL_REGULATORY_CODE",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "Under the Social Work and Social Service Work Act, 1998, only registered members of the Ontario College of Social Workers and Social Service Workers (OCSWSSW) may use the restricted titles 'Social Worker' / 'Registered Social Worker' (RSW) or 'Social Service Worker' / 'Registered Social Service Worker' (RSSW) (ss. 46–47). Where a CAS worker or supervisor is a registered member (RSW, RSSW, or both), they are bound by the OCSWSSW Code of Ethics and Standards of Practice, including Principle II (Competence and Integrity — rendering opinions only on adequate firsthand/verified knowledge), Principle IV (The Social Work and Social Service Work Record — accurate, objective, contemporaneous records and non-obliterating corrections), and Principle V (Confidentiality).",
    practiceNoteDistinction:
      "Enforceable professional regulatory standards for registered College members (RSW / RSSW).",
    caseStages: ["ALL_STAGES", "OVERSIGHT_AND_COMPLAINTS"],
    responsibleParty: "REGISTERED_SOCIAL_WORKER_OR_SSW",
    requiredAction:
      "If registered with the OCSWSSW (or holding oneself out as a social worker / social service worker), comply with OCSWSSW Standards of Practice regarding competence, objective assessment, contemporaneous recordkeeping (Principle IV), and confidentiality (Principle V).",
    triggeringCircumstances:
      "Professional conduct, assessment, or recordkeeping by a CAS employee who is a registered member of the OCSWSSW (RSW or RSSW) or who uses a restricted title under SWSSWA ss. 46–47.",
    deadlineDescription: "Ongoing professional obligation for registered members",
    deadlineDays: null,
    applicabilityConditions: [
      "The individual must be a registered member of the OCSWSSW (RSW or RSSW) for College discipline jurisdiction (SWSSWA ss. 25–26), OR must be an unregistered individual unlawfully using the restricted title 'social worker' or 'social service worker' (SWSSWA ss. 46–47)"
    ],
    exceptions: [
      "Not every CAS child protection worker is a registered social worker (RSW) or registered social service worker (RSSW); Ontario child protection workers may hold other qualifying degrees or credentials authorized by agency/ministry standards"
    ],
    requiredComplianceEvidence: [
      "Verification of the worker's or supervisor's registration status on the public OCSWSSW Online Register",
      "Comparison of documented conduct/records against OCSWSSW Principle II (Competence), Principle IV (Records), and Principle V (Confidentiality)"
    ],
    legalConsequencesOfNonCompliance:
      "A registered member (RSW/RSSW) may be the subject of a written professional conduct complaint to the OCSWSSW Complaints Committee (which can refer to the Discipline Committee, issue cautions/reprimands, impose terms/conditions, or suspend/revoke registration). An unregistered person using the title 'Social Worker' may be reported to the OCSWSSW for unauthorized title use under ss. 46–47.",
    antiOverclaimGuardrail:
      "NEVER assume every CAS employee is a registered social worker (RSW/RSSW). Always instruct the user to check the OCSWSSW Public Register first, and note that an OCSWSSW complaint addresses professional regulation of the member — it cannot overturn a Family Court order.",
    sourceUrl: "https://www.ocswssw.org/professional-practice/code-of-ethics-and-standards-of-practice/"
  }
];

// ============================================================================
// A6. OATHS, DECLARATIONS, AND SWORN EVIDENCE
// ============================================================================

export const A6_OATHS_AND_SWORN_EVIDENCE_RULES: readonly CasAccountabilityRule[] = [
  {
    ruleId: "SWORN_EVIDENCE:AFFIDAVIT_COMMISSIONING_AND_FLR_14_18",
    librarySubcategory: "A6_SWORN_EVIDENCE",
    authorityId: "FLR:14(18)",
    legalSource: "Family Law Rules, O. Reg. 114/99, r. 14(18)–(19), Evidence Act, R.S.O. 1990, c. E.23, ss. 43–45 & CYFSA, s. 81(2)",
    exactSectionOrStandard: "Family Law Rules, r. 14(18)–(19) & Evidence Act, R.S.O. 1990, c. E.23, ss. 43–45",
    title: "Sworn/Affirmed Court Evidence, Affidavit Commissioning & Personal Knowledge vs Information-and-Belief Rules",
    effectiveFrom: "1999-09-15",
    effectiveTo: null,
    historicalBasisNote:
      "Governed by the Ontario Evidence Act, Commissioners for Taking Affidavits Act, and Family Law Rules r. 14(18)–(19). Note: Ontario law does NOT impose a universal statutory 'CAS worker oath of office'; sworn legal obligations arise when a worker swears or affirms an Information to Obtain a warrant (CYFSA s. 81(2), s. 131) or an affidavit/oral testimony in court.",
    legalForce: "COURT_PROCEDURAL_RULE",
    ocpsTextType: "NOT_APPLICABLE",
    standardSummary:
      "There is no universal statutory 'CAS worker oath of office' in the CYFSA (agency employees sign employment confidentiality undertakings under Part X / agency policies). However, when a child protection worker gives evidence in court or swears/affirms an affidavit or Information to Obtain a warrant (CYFSA s. 81(2)), the worker is under a solemn legal oath or affirmation under the Evidence Act (ss. 43–45) and Commissioners for Taking Affidavits Act. Under Family Law Rules r. 14(18)–(19), a motion affidavit must contain personal knowledge as much as possible, and may include secondhand information ONLY if the source is identified by name and the affiant states a belief that the information is true.",
    practiceNoteDistinction:
      "Binding evidentiary and court procedural requirements governing sworn/affirmed court filings.",
    caseStages: ["APPREHENSION_REMOVAL", "INITIAL_COURT_HEARING", "TEMPORARY_CARE_ADJOURNMENT", "DISPOSITION_PLANNING", "STATUS_REVIEW"],
    responsibleParty: "AFFIANT_OR_WITNESS",
    requiredAction:
      "Properly swear or affirm any court affidavit or warrant information before an authorized commissioner, restrict affidavit statements to personal knowledge or properly attributed information-and-belief (naming the source and stating belief in truth per FLR r. 14(19)), and present complete, non-misleading facts.",
    triggeringCircumstances: "Filing an affidavit in a Family Court child protection proceeding or swearing an Information to Obtain a warrant under CYFSA s. 81(2) or s. 131.",
    deadlineDescription: "At the time of swearing/affirming and filing the affidavit or information",
    deadlineDays: null,
    applicabilityConditions: ["Sworn or affirmed affidavit, warrant information, or oral court testimony"],
    exceptions: ["Uncommissioned draft documents or internal case notes are not sworn affidavits, though they remain subject to OCPS Standard G and CYFSA s. 306(1) accuracy duties"],
    requiredComplianceEvidence: [
      "Completed jurat showing date, location, affiant signature, and Commissioner for Taking Affidavits signature/stamp",
      "Compliance with FLR r. 14(18)–(19) source-naming and belief statements for any secondhand facts",
      "Consistency between the sworn affidavit and underlying contemporaneous case notes / collateral records"
    ],
    legalConsequencesOfNonCompliance:
      "Defective commissioning, unattributed hearsay, or material omissions/inaccuracies in an affidavit allow counsel to move to strike inadmissible paragraphs, challenge evidentiary weight under CYFSA s. 94(10) and FLR r. 14(18)–(19), cross-examine the affiant on prior inconsistent records, or seek costs.",
    antiOverclaimGuardrail:
      "NEVER invent a universal statutory CAS worker oath of office, and NEVER automatically classify an inaccurate or contradicted statement in an affidavit as criminal 'perjury' (which requires proof beyond a reasonable doubt in a criminal court of an intentional false statement under oath made with intent to mislead). Frame discrepancies accurately as material inconsistencies, reliability defects, or non-compliance with FLR r. 14(18)–(19).",
    sourceUrl: "https://www.ontario.ca/laws/regulation/990114#BK20"
  }
];

// ============================================================================
// A7. ACCOUNTABILITY AND COMPLAINT PATHWAYS
// ============================================================================

export type OversightPathwayId =
  | "OVERSIGHT:CAS_INTERNAL_COMPLAINT_119"
  | "OVERSIGHT:CFSRB_SERVICE_COMPLAINT_120"
  | "OVERSIGHT:ONTARIO_OMBUDSMAN_CHILDREN_AND_YOUTH"
  | "OVERSIGHT:OCSWSSW_PROFESSIONAL_REGULATORY_COMPLAINT"
  | "OVERSIGHT:IPC_PART_X_PRIVACY_AND_RECORDS_316"
  | "OVERSIGHT:COURT_PROCEDURAL_AND_EVIDENTIARY_REMEDIES";

export interface OversightPathwaySpec {
  pathwayId: OversightPathwayId;
  name: string;
  authorityId: string;
  governingStatuteOrRegulation: string;
  jurisdictionSummary: string;
  standingWhoMayApply: string;
  proceduralRequirements: string[];
  deadlines: string;
  mandatoryExclusions: string[];
  availableRemedies: string[];
  canOverturnCourtOrder: false;
  officialUrl: string;
}

export const A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS: readonly OversightPathwaySpec[] = [
  {
    pathwayId: "OVERSIGHT:CAS_INTERNAL_COMPLAINT_119",
    name: "Internal CAS Complaint Review Procedure (ICRP)",
    authorityId: "CYFSA:119(1)",
    governingStatuteOrRegulation: "CYFSA, s. 119(1)–(11) & O. Reg. 155/18",
    jurisdictionSummary:
      "Internal review by the children's aid society (including an Internal Complaint Review Panel) of complaints relating to a service sought or received from the society.",
    standingWhoMayApply: "Any person who has sought or received a service from the society (including a parent, child, or caregiver).",
    proceduralRequirements: [
      "Submit a written complaint to the society under CYFSA s. 119(1)",
      "Society must assess eligibility and provide written notice within 7 days (O. Reg. 155/18)",
      "If eligible for the Internal Complaint Review Panel (ICRP), the panel must convene a meeting within 14 days of eligibility notice and issue a written summary of results within 14 days after the meeting"
    ],
    deadlines:
      "7 days for society eligibility response; 14 days to hold ICRP meeting; 14 days after meeting for written decision (O. Reg. 155/18).",
    mandatoryExclusions: [
      "CYFSA s. 119(11)(a): The society SHALL NOT conduct a review if the subject of the complaint is an issue that has been decided by the court or is currently before the court",
      "CYFSA s. 119(11)(b): Excluded if subject to another decision-making process under the CYFSA or the Labour Relations Act, 1995"
    ],
    availableRemedies: [
      "Written explanation/reasons, service adjustments, corrective administrative steps, or facilitated resolution between the complainant and the service team"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ontario.ca/laws/statute/17c14#BK145"
  },
  {
    pathwayId: "OVERSIGHT:CFSRB_SERVICE_COMPLAINT_120",
    name: "Child and Family Services Review Board (CFSRB) — Service & Procedural Complaints",
    authorityId: "CYFSA:120(4)",
    governingStatuteOrRegulation: "CYFSA, ss. 119(5), 120(1)–(8), 333 & O. Reg. 155/18",
    jurisdictionSummary:
      "Independent administrative tribunal review of enumerated procedural and right-to-be-heard complaints under CYFSA s. 120(4): (1) society refusal to proceed with a s. 119 complaint, (2) society failure to respond within regulatory timeframes, (3) society failure to comply with complaint review procedures, (4) society failure to comply with s. 15(2) (opportunity for child and parent to be heard and represented when decisions affecting their interests are made), and (5) society failure to provide reasons for a decision affecting the complainant's interests. (The CFSRB also hears residential placement reviews under s. 66, emergency secure treatment reviews, and adoption refusal/removal reviews under s. 192.)",
    standingWhoMayApply: "A person who sought or received a service from a society (or a child in care under s. 66 / applicant under s. 192).",
    proceduralRequirements: [
      "May file directly with the CFSRB under s. 120(1)(a) without first completing the internal CAS complaint process, or escalate under s. 120(1)(b) / s. 119(5)",
      "Complete the prescribed CFSRB Application about Complaints to a Children's Aid Society"
    ],
    deadlines:
      "CFSRB conducts preliminary eligibility review within 7 days and, if eligible, completes review/hearing within prescribed O. Reg. 155/18 timelines (typically 20–60 days).",
    mandatoryExclusions: [
      "CYFSA s. 120(8)(a): The CFSRB SHALL NOT conduct a review if the subject of the complaint is an issue that has been decided by the court or is before the court",
      "Cannot review the merits of a court protection finding or court custody/access order"
    ],
    availableRemedies: [
      "CYFSA s. 120(7): Order the society to proceed with a complaint (cl. (a)), order a response within a specified period (cl. (b)), order the society to comply with complaint procedures or s. 15(2) (cl. (c)), or order the society to provide written reasons for a decision (cl. (d))"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://tribunalsontario.ca/cfsrb/"
  },
  {
    pathwayId: "OVERSIGHT:ONTARIO_OMBUDSMAN_CHILDREN_AND_YOUTH",
    name: "Ontario Ombudsman — Children and Youth Unit",
    authorityId: "OVERSIGHT:OMBUDSMAN",
    governingStatuteOrRegulation: "Ombudsman Act, R.S.O. 1990, c. O.6, ss. 14(1.1), 14.0.1 & CYFSA, ss. 9.1, 15.1",
    jurisdictionSummary:
      "Independent legislative officer empowered (since May 1, 2019) to investigate administrative conduct, procedural unfairness, delays, and systemic practices of children's aid societies and residential licensees.",
    standingWhoMayApply: "Any child, young person, parent, family member, or concerned person affected by CAS or residential licensee administration.",
    proceduralRequirements: [
      "Submit an online, telephone, or written complaint to the Ontario Ombudsman (Children and Youth Unit)",
      "For adults, the Ombudsman normally considers whether internal complaint mechanisms (such as s. 119) have been attempted unless urgent or systemic; children and youth in care have a direct statutory right to contact and be informed about the Ombudsman under CYFSA ss. 9.1, 10(1)(b)(iii), and 15.1"
    ],
    deadlines: "No strict statutory filing limitation, though complaints should be brought promptly while records and witnesses are available.",
    mandatoryExclusions: [
      "Cannot investigate judges or court decisions, cannot act as legal counsel for a party, and cannot overturn or vary a court order"
    ],
    availableRemedies: [
      "Informal administrative resolution, formal investigation, findings of maladministration, and recommendations for agency policy/practice changes or corrective administrative action"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ombudsman.on.ca/what-we-do/topics/children-and-youth"
  },
  {
    pathwayId: "OVERSIGHT:OCSWSSW_PROFESSIONAL_REGULATORY_COMPLAINT",
    name: "Ontario College of Social Workers and Social Service Workers (OCSWSSW) Complaint",
    authorityId: "OCSWSSW:REGISTRATION",
    governingStatuteOrRegulation: "Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 25–26, 46–47",
    jurisdictionSummary:
      "Professional regulatory oversight of registered social workers (RSW) and registered social service workers (RSSW) for professional misconduct, incompetence, or incapacity, as well as enforcement against unregistered individuals using restricted titles.",
    standingWhoMayApply: "Any member of the public, client, parent, or colleague.",
    proceduralRequirements: [
      "First confirm on the public OCSWSSW Online Register whether the worker or supervisor is a registered member (RSW or RSSW)",
      "Submit a signed written complaint to the OCSWSSW Registrar describing the specific professional conduct or recordkeeping concerns"
    ],
    deadlines: "No fixed statutory limitation period under the SWSSWA, 1998, but timely submission is recommended.",
    mandatoryExclusions: [
      "No disciplinary jurisdiction over CAS employees who are NOT registered members of the OCSWSSW (unless they unlawfully used a restricted title under ss. 46–47)",
      "Cannot adjudicate child custody/access, remove a worker from a court file, or overturn a court order"
    ],
    availableRemedies: [
      "Investigation by the Complaints Committee; remedial advice/caution, specified continuing education/remediation, or referral to the Discipline Committee (which can reprimand, impose practice conditions, or suspend/revoke registration)"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ocswssw.org/public/complaints-and-discipline/"
  },
  {
    pathwayId: "OVERSIGHT:IPC_PART_X_PRIVACY_AND_RECORDS_316",
    name: "Information and Privacy Commissioner of Ontario (IPC) — Part X Access, Correction & Privacy Complaints",
    authorityId: "CYFSA:316(1)",
    governingStatuteOrRegulation: "CYFSA, Part X, ss. 306, 312–321",
    jurisdictionSummary:
      "Oversight of personal information collection, use, disclosure, security, accuracy (s. 306), individual access requests (s. 312–314), and record correction requests / Statements of Disagreement (s. 315) by service providers under Part X of the CYFSA.",
    standingWhoMayApply: "Any individual whose personal information is held by a service provider or who has reasonable grounds to believe Part X has been contravened.",
    proceduralRequirements: [
      "For access or correction complaints, first submit a written access request (s. 313) or correction request (s. 315(2)) to the society and wait for the 30-day response window (or deemed refusal)",
      "File a written complaint with the IPC under s. 316"
    ],
    deadlines:
      "Within 6 months after a refusal or deemed refusal of an access or correction request (CYFSA s. 316(3)); within 1 year after a privacy contravention came or should reasonably have come to the complainant's attention (s. 316(2)).",
    mandatoryExclusions: [
      "Applies to Part X obligations (in force January 1, 2020)",
      "Under s. 315(10)(b), the IPC cannot compel alteration of a good-faith professional opinion or observation (though attachment of a Statement of Disagreement under s. 315(12) is mandatory)",
      "Cannot overturn a Family Court child protection order"
    ],
    availableRemedies: [
      "CYFSA s. 321(1): Binding orders directing the society to grant access to records (cl. (a)), make a factual correction (cl. (b)), attach a Statement of Disagreement (cl. (c)), or cease unauthorized collection/use/disclosure (cl. (d))"
    ],
    canOverturnCourtOrder: false,
    officialUrl: "https://www.ipc.on.ca/en/child-and-family-services"
  },
  {
    pathwayId: "OVERSIGHT:COURT_PROCEDURAL_AND_EVIDENTIARY_REMEDIES",
    name: "Family Court Procedural, Evidentiary & Dispositive Remedies",
    authorityId: "FLR:1(8)",
    governingStatuteOrRegulation: "CYFSA, ss. 88, 94, 100, 101, 113–116, 121; Family Law Rules, rr. 1(8), 14(18)–(19), 19, 20; Charter, s. 24(1)",
    jurisdictionSummary:
      "The Ontario Court of Justice or Family Court of the Superior Court of Justice has exclusive adjudicative jurisdiction over child protection findings, temporary care and custody orders, supervision terms, access orders, status reviews, and court disclosure/evidentiary motions.",
    standingWhoMayApply: "Any statutory party under CYFSA s. 79(1) (parent, society, child with party/participation status, FNIM band/community representative).",
    proceduralRequirements: [
      "Bring a motion or response within the child protection proceeding under the Family Law Rules (or an appeal under CYFSA s. 121)"
    ],
    deadlines:
      "Governed by CYFSA statutory timelines (e.g., 5-day hearing under s. 88; 30-day adjournment limit under s. 94(1); 10-day stay on appeal under s. 121(3)) and Family Law Rules r. 33.",
    mandatoryExclusions: [
      "Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), the court cannot impose supervision terms requiring the society to provide financial assistance or purchase goods or services"
    ],
    availableRemedies: [
      "Orders for disclosure/production of complete CAS records and third-party records (FLR r. 19 / CYFSA s. 130)",
      "Striking inadmissible hearsay paragraphs under FLR r. 14(18)–(19) or questioning under FLR r. 20",
      "Returning the child or ordering less disruptive supervision/kinship terms under CYFSA s. 94(2)/(4) or s. 101(1)–(4)",
      "Requiring an amended Plan of Care complying with CYFSA s. 100",
      "Varying access under CYFSA ss. 104–105 or varying disposition on status review under ss. 113–116",
      "Remedies for non-compliance with court orders under FLR r. 1(8) or Charter remedies under s. 24(1)"
    ],
    canOverturnCourtOrder: false, // A court varies/appeals orders through statutory procedure (s. 94(9), s. 114, s. 121), whereas non-court bodies never can.
    officialUrl: "https://www.ontario.ca/laws/regulation/990114"
  }
];

export const ALL_CAS_ACCOUNTABILITY_RULES: readonly CasAccountabilityRule[] = [
  ...A1_STATUTORY_CAS_DUTIES,
  ...A2_OCPS_2016_STANDARDS,
  ...A3_SUPERVISORY_ACCOUNTABILITY_RULES,
  ...A4_CASE_NOTES_AND_RECORDKEEPING_RULES,
  ...A5_PROFESSIONAL_ETHICS_AND_REGISTRATION_RULES,
  ...A6_OATHS_AND_SWORN_EVIDENCE_RULES
];

export function getCasAccountabilityRuleById(ruleId: string): CasAccountabilityRule | undefined {
  return ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === ruleId);
}

export function getOversightPathwayById(pathwayId: string): OversightPathwaySpec | undefined {
  return A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS.find((p) => p.pathwayId === pathwayId);
}
