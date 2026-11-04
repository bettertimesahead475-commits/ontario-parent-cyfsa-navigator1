/**
 * MILESTONE 2 — LIBRARY B: PARENT ASSISTANCE, FAMILY PRESERVATION & REUNIFICATION LIBRARY
 *
 * Authoritative, source-verified collection of Ontario child protection rules governing:
 *   B1. Family Preservation and Less Disruptive Alternatives
 *   B2. Parenting and Family Support (with explicit Legal Force Classification)
 *   B3. Mental Health, Counselling, and Addiction Services (including CYFSA s. 94(6)(c) / s. 101(7)(c) / s. 116(4)(c) non-funding limits)
 *   B4. Housing, Income, and Basic Necessities (distinguishing poverty from neglect)
 *   B5. Kinship and Family Networks (relative/community placement priority & Bill C-92 s. 16)
 *   B6. Parent-Child Contact (meaningful access, supervision justification, cultural continuity)
 *   B7. Reunification and Ongoing Case Management (Standard 7 18-component model + s. 122(1) cumulative time-in-care limits)
 *
 * Every rule is linked to verified authorities in `shared/legalVerificationPipeline.ts`
 * and `shared/casAccountabilityLibrary.ts`.
 *
 * CRITICAL LEGAL CONSTRAINTS:
 *   - Broad statutory purposes (CYFSA s. 1(2)) do not create an unconditional entitlement to every requested service.
 *   - Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court may NOT order a society to provide financial assistance
 *     or to purchase goods or services under supervision/temporary care terms and conditions.
 *   - Under OCPS (2016) Standard 7, the 30-day initial service-plan timeline runs from completion of the investigation
 *     or transfer to ongoing services — NEVER from the date of child removal/apprehension alone. When the triggering
 *     completion/transfer date is unknown in the uploaded record, the system MUST return `DEADLINE_NOT_DETERMINABLE`.
 */

export type ParentSupportLegalForce =
  | "LEGALLY_REQUIRED"
  | "STANDARDS_BASED"
  | "DISCRETIONARY"
  | "RECOMMENDED"
  | "UNAVAILABLE_FOR_DETERMINATION";

export type ParentAssistanceDomain =
  | "B1_FAMILY_PRESERVATION"
  | "B2_PARENTING_SUPPORT"
  | "B3_MENTAL_HEALTH_AND_ADDICTIONS"
  | "B4_HOUSING_AND_BASIC_NECESSITIES"
  | "B5_KINSHIP_AND_FAMILY_NETWORKS"
  | "B6_PARENT_CHILD_CONTACT"
  | "B7_REUNIFICATION_AND_PERMANENCY";

export interface ParentAssistanceRule {
  ruleId: string;
  domain: ParentAssistanceDomain;
  authorityId: string;
  secondaryAuthorityIds?: string[];
  legalSource: string;
  exactSectionOrStandard: string;
  effectiveDate: string;
  legalForce: ParentSupportLegalForce;
  title: string;
  requiredOrExpectedAction: string;
  triggeringCircumstances: string;
  applicabilityConditions: string;
  exceptionsAndStatutoryLimits: string;
  accessibilityFactorsToEvaluate: string[];
  evidenceEstablishingCompliance: string[];
  overstatementGuard: string;
}

export type Standard7ComponentCode =
  | "STD7_01_TRANSFER_TO_ONGOING"
  | "STD7_02_STRENGTHS_AND_NEEDS_ASSESSMENT"
  | "STD7_03_INITIAL_SERVICE_PLAN_30_DAYS"
  | "STD7_04_FAMILY_CENTRED_CONFERENCING"
  | "STD7_05_PARENT_AND_CHILD_PARTICIPATION"
  | "STD7_06_CLEAR_BEHAVIOURAL_GOALS_AND_ACTIVITIES"
  | "STD7_07_DESIGNATED_RESPONSIBLE_PERSONS"
  | "STD7_08_COMPLETION_TIMEFRAMES"
  | "STD7_09_SERVICES_AND_REFERRALS"
  | "STD7_10_SERVICE_COORDINATION_AND_MONITORING"
  | "STD7_11_MONTHLY_HOME_CONTACT_EXPECTATIONS"
  | "STD7_12_SUPERVISORY_REVIEW_AND_APPROVAL"
  | "STD7_13_FORMAL_6_MONTH_CASE_REVIEW"
  | "STD7_14_REUNIFICATION_READINESS_ASSESSMENT"
  | "STD7_15_CONCURRENT_PERMANENCY_PLANNING"
  | "STD7_16_SERVICE_PLAN_REVISIONS"
  | "STD7_17_CASE_REVIEW_DOCUMENTATION_AND_SHARING"
  | "STD7_18_CASE_CLOSURE_REQUIREMENTS";

export interface Standard7ComponentSpec {
  componentCode: Standard7ComponentCode;
  componentNumber: number;
  title: string;
  sourceLabel: "STANDARD" | "PRACTICE_NOTE";
  authorityId: "OCPS:STD_7" | "OCPS:STD_8";
  exactStandardReference: string;
  triggeringEvent: string;
  timelineRequirement: string;
  responsibleParty: "CAS_WORKER" | "CAS_SUPERVISOR" | "CAS_WORKER_AND_SUPERVISOR";
  requiredAction: string;
  requiredDocumentation: string;
  exceptionsOrModificationRules: string;
}

export type Standard7DeadlineStatus =
  | "DETERMINED_FROM_INVESTIGATION_COMPLETION"
  | "DETERMINED_FROM_CASE_TRANSFER"
  | "DEADLINE_NOT_DETERMINABLE"
  | "INVALID_TRIGGER_REMOVAL_DATE_ONLY";

export interface Standard7DeadlineInput {
  /** ISO date (YYYY-MM-DD) when the child protection investigation was completed (Standard 6). */
  investigationCompletionDate?: string | null;
  /** ISO date (YYYY-MM-DD) when the case was transferred to ongoing protection services (Standard 6/7). */
  caseTransferDate?: string | null;
  /** ISO date (YYYY-MM-DD) when the initial ongoing Service Plan was completed and approved. */
  servicePlanCompletionDate?: string | null;
  /** ISO date (YYYY-MM-DD) of child apprehension/removal, if any (must NOT be used alone to compute the 30-day Standard 7 deadline). */
  removalDate?: string | null;
}

export interface Standard7DeadlineAssessment {
  deadlineStatus: Standard7DeadlineStatus;
  triggerEventUsed: "INVESTIGATION_COMPLETION" | "CASE_TRANSFER" | "NONE";
  triggerDate: string | null;
  calculatedDeadlineDate: string | null;
  servicePlanCompletionDate: string | null;
  daysElapsedToServicePlan: number | null;
  withinThirtyDayStandard: boolean | null;
  explanation: string;
  cautionNote: string;
}

// ============================================================================
// B1–B7: VERIFIED PARENT ASSISTANCE, FAMILY PRESERVATION & REUNIFICATION RULES
// ============================================================================

export const B1_FAMILY_PRESERVATION_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B1-CYFSA-1-2-PRESERVATION-PRINCIPLE",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "CYFSA:1(2)",
    secondaryAuthorityIds: ["CYFSA:35(1)", "CYFSA:74(3)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 1(2) paras. 1–3",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Support for Family Autonomy, Least Disruptive Course of Action & Prevention Services",
    requiredOrExpectedAction:
      "Recognize and support the autonomy and integrity of the family unit, pursue the least disruptive course of action available and appropriate in the case to help a child, and provide early assessment, planning, and prevention services consistent with the paramount purpose of the child's best interests, protection, and well-being.",
    triggeringCircumstances:
      "All child protection assessments, planning, interventions, and court recommendations under the CYFSA.",
    applicabilityConditions:
      "Applies consistently with the paramount purpose in CYFSA s. 1(1) (promote the best interests, protection, and well-being of children).",
    exceptionsAndStatutoryLimits:
      "Subordinate to the paramount purpose of protecting the child's safety and well-being (s. 1(1)). Does not create an unconditional private entitlement to any specific parent-requested service or society expenditure.",
    accessibilityFactorsToEvaluate: [
      "Whether less disruptive community or extended-family supports were explored before removal or escalated intervention",
      "Whether prevention and early intervention services were matched to the specific protection concerns identified",
    ],
    evidenceEstablishingCompliance: [
      "Assessment or court affidavit detailing less disruptive interventions considered and why they were or were not sufficient",
      "Documentation of early support or prevention referrals offered to the family",
    ],
    overstatementGuard:
      "Never state that CYFSA s. 1(2) guarantees an unconditional right to every requested service or prohibits apprehension when immediate child safety cannot be managed in the home.",
  },
  {
    ruleId: "B1-CYFSA-94-4-INTERIM-CARE-LEAST-DISRUPTIVE",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "CYFSA:94(2)",
    secondaryAuthorityIds: ["CYFSA:94(4)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 94(2), s. 94(4), s. 94(5)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Interim Care and Custody Test & Supervision Consideration",
    requiredOrExpectedAction:
      "At the temporary care and custody stage, the court shall not order a child removed from or kept out of the care of the person who had charge before intervention unless satisfied there are reasonable grounds to believe there is a risk the child is likely to suffer harm AND the child cannot be protected adequately by returning the child under parental or relative/community care with or without supervision conditions.",
    triggeringCircumstances:
      "Temporary care and custody hearing or motion under CYFSA s. 94 following apprehension or protection application.",
    applicabilityConditions:
      "Applies whenever CAS seeks an interim/temporary order placing the child outside the pre-intervention caregiver's care.",
    exceptionsAndStatutoryLimits:
      "Where reasonable grounds establish likely harm that cannot be mitigated by supervision conditions (s. 94(5)) or kinship placement (s. 94(2)(c)), temporary society care is legally authorized.",
    accessibilityFactorsToEvaluate: [
      "Whether concrete supervision terms under s. 94(5) were considered and explained",
      "Whether proposed family/community caregivers under s. 94(2)(c) were assessed",
    ],
    evidenceEstablishingCompliance: [
      "Affidavit evidence addressing both limbs of s. 94(4): (a) risk of likely harm and (b) why supervision or kin placement cannot adequately protect the child",
    ],
    overstatementGuard:
      "Do not treat an interim placement order as proof of final protection findings; s. 94(4) is an interim risk-and-adequacy test.",
  },
  {
    ruleId: "B1-CYFSA-101-2-3-DISPOSITIONAL-LESS-DISRUPTIVE-INQUIRY",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "CYFSA:101(2)",
    secondaryAuthorityIds: ["CYFSA:101(3)", "CYFSA:100"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 101(2), s. 101(3), s. 100",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Mandatory Inquiry into Efforts to Assist & Less Disruptive Alternatives Before Removal Order",
    requiredOrExpectedAction:
      "Before making a dispositional order under s. 101(1), the court must ask what efforts the society or another person or entity has made to assist the child before intervention, and shall not make an order removing the child from the pre-intervention caregiver unless satisfied that less disruptive alternatives (including non-residential services and assistance to help the caregiver care for the child) would be inadequate to protect the child.",
    triggeringCircumstances:
      "Dispositional hearing following a finding that a child is in need of protection under CYFSA s. 74(2).",
    applicabilityConditions:
      "Applies to all dispositional orders under CYFSA s. 101, and specifically before any order removing a child from the pre-intervention caregiver (s. 101(3)).",
    exceptionsAndStatutoryLimits:
      "Requires the society's Plan of Care (s. 100(a)) to contain a description of the services to be provided to remedy the condition and the explanation of why the child cannot be adequately protected while in the parent's care (s. 100(c)(i)).",
    accessibilityFactorsToEvaluate: [
      "What pre-intervention and post-intervention assistance CAS or community agencies offered",
      "Why non-residential services or a supervision order under s. 101(1) para. 1 would or would not adequately protect the child",
    ],
    evidenceEstablishingCompliance: [
      "Society Plan of Care (s. 100) and supporting affidavit setting out pre-intervention assistance efforts (s. 101(2)) and why less disruptive alternatives are inadequate (s. 101(3))",
    ],
    overstatementGuard:
      "Distinguish between the court's mandatory inquiry under s. 101(2)–(3) and whether a specific service was available in the community.",
  },
  {
    ruleId: "B1-BILL-C92-14-PREVENTIVE-CARE-PRIORITY",
    domain: "B1_FAMILY_PRESERVATION",
    authorityId: "BILL_C92:14(1)",
    secondaryAuthorityIds: ["BILL_C92:10(1)", "BILL_C92:15", "BILL_C92:16(1)"],
    legalSource: "An Act respecting First Nations, Inuit and Métis children, youth and families, S.C. 2019, c. 24",
    exactSectionOrStandard: "s. 14(1), s. 15, s. 16(1)",
    effectiveDate: "2020-01-01",
    legalForce: "LEGALLY_REQUIRED",
    title: "Federal Priority for Preventive Care and Protection from Socio-Economic Apprehension for Indigenous Children",
    requiredOrExpectedAction:
      "In providing child and family services in relation to an Indigenous child, the provision of preventive care to support the child's family must be given priority over other services (s. 14(1)); a child must not be apprehended solely on the basis of socio-economic conditions, including poverty, lack of adequate housing or infrastructure, or parent health (s. 15); and out-of-home placement must prioritize parents, extended family, and the child's Indigenous community (s. 16(1)).",
    triggeringCircumstances:
      "Any child protection service delivery involving a First Nations, Inuit, or Métis child.",
    applicabilityConditions:
      "Applies as paramount federal law whenever the child is an Indigenous child within the meaning of S.C. 2019, c. 24.",
    exceptionsAndStatutoryLimits:
      "Consistent with the best interests of the Indigenous child under Bill C-92 ss. 9(1) and 10(1).",
    accessibilityFactorsToEvaluate: [
      "Whether culturally appropriate preventive services through an Indigenous service provider or band/community were offered first",
      "Whether notice under Bill C-92 s. 12(1) was provided to the parent, care provider, and Indigenous governing body",
    ],
    evidenceEstablishingCompliance: [
      "Documentation of preventive care priority, cultural continuity planning, and s. 12(1) notice to the Indigenous governing body",
    ],
    overstatementGuard:
      "Only apply Bill C-92 provisions when the record indicates or raises the question that the child is First Nations, Inuit, or Métis.",
  },
] as const;

export const B2_PARENTING_SUPPORT_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B2-CYFSA-35-1-PREVENTIVE-AND-COUNSELLING-FUNCTION",
    domain: "B2_PARENTING_SUPPORT",
    authorityId: "CYFSA:35(1)",
    secondaryAuthorityIds: ["CYFSA:100"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 35(1)(b), s. 35(1)(d), s. 100(a)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Statutory Function to Provide Guidance, Counselling & Supportive Services",
    requiredOrExpectedAction:
      "Perform the statutory function of providing guidance, counselling, and other services to families for protecting children or for the prevention of circumstances requiring the protection of children, and specify in any court Plan of Care (s. 100(a)) the services to be provided to remedy the condition causing the child to be in need of protection.",
    triggeringCircumstances:
      "Verified protection concerns or court proceedings where a Plan of Care is filed under CYFSA s. 100.",
    applicabilityConditions:
      "Applies across child protection service delivery; under s. 35(2), society functions are carried out in accordance with prescribed standards (OCPS 2016).",
    exceptionsAndStatutoryLimits:
      "Specific parenting programs may be provided directly by CAS or through community referrals depending on local service availability.",
    accessibilityFactorsToEvaluate: [
      "Waitlists and program availability in the parent's community",
      "Cost and whether free or subsidized options were identified",
      "Transportation, distance, and work/childcare scheduling compatibility",
      "Language, literacy, disability, neurodiversity, or cultural accommodations",
    ],
    evidenceEstablishingCompliance: [
      "Service Plan or Plan of Care identifying specific parenting programs or in-home family support",
      "Case notes documenting concrete referral steps, intake coordination, and follow-up on waitlists or barriers",
    ],
    overstatementGuard:
      "Classify statutory Plan of Care disclosure (s. 100(a)) as LEGALLY_REQUIRED, OCPS Standard 7 referral coordination as STANDARDS_BASED, and specific non-mandated program choices as DISCRETIONARY or RECOMMENDED.",
  },
  {
    ruleId: "B2-OCPS-STD-7-PARENTING-REFERRAL-AND-BARRIER-COORDINATION",
    domain: "B2_PARENTING_SUPPORT",
    authorityId: "OCPS:STD_7",
    secondaryAuthorityIds: ["O_REG_156_18:STANDARDS"],
    legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18, s. 1",
    exactSectionOrStandard: "Standard 7 — Ongoing Service Case Management (Service Plan & Service Provision)",
    effectiveDate: "2016-01-01",
    legalForce: "STANDARDS_BASED",
    title: "Tailored Parenting Support Referrals & Active Barrier Monitoring",
    requiredOrExpectedAction:
      "Develop a Service Plan with the family that links parenting or family-support interventions directly to the verified protection concerns, make referrals to required services, and actively coordinate with community service providers while monitoring barriers to participation.",
    triggeringCircumstances:
      "Ongoing child protection service delivery following investigation verification or transfer.",
    applicabilityConditions:
      "Mandatory operational standard under OCPS (2016) Standard 7, prescribed under O. Reg. 156/18, s. 1.",
    exceptionsAndStatutoryLimits:
      "Practice Notes regarding preferred coaching modalities or specific curriculum selection are guidance (`PRACTICE_NOTE`), whereas developing and monitoring the Service Plan is a mandatory `STANDARD`.",
    accessibilityFactorsToEvaluate: [
      "Whether the parenting program matched the child's developmental stage and the specific safety/risk concern",
      "Whether CAS assisted with referral intake rather than providing a generic phone list without follow-up",
      "Whether disability, trauma, or language accommodations were addressed",
    ],
    evidenceEstablishingCompliance: [
      "Signed Service Plan linking parenting support activities to specific behavioural protection goals",
      "Case notes recording referral transmission, provider contact, and barrier problem-solving",
    ],
    overstatementGuard:
      "Do not treat a parent's placement on a community waitlist as non-compliance by either the parent or CAS unless the record shows a failure to refer or monitor.",
  },
] as const;

export const B3_MENTAL_HEALTH_AND_ADDICTIONS_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B3-CYFSA-NON-FUNDING-STATUTORY-LIMIT",
    domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
    authorityId: "CYFSA:94(6)",
    secondaryAuthorityIds: ["CYFSA:101(7)", "CYFSA:116(4)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "s. 94(6)(c), s. 101(7)(c), s. 116(4)(c)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Statutory Prohibition on Court Orders Requiring CAS to Fund or Purchase Goods or Services",
    requiredOrExpectedAction:
      "Recognize the express statutory limitation in CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c): when the court imposes terms and conditions on a temporary supervision order, dispositional supervision order, or status review supervision order, the court SHALL NOT require the society to provide financial assistance or to purchase any goods or services.",
    triggeringCircumstances:
      "Any analysis of whether CAS was legally required to pay for private therapy, private residential addiction treatment, private psychological assessments, drug testing, or other purchased goods/services under a supervision order.",
    applicabilityConditions:
      "Applies to all court-imposed supervision terms and conditions under ss. 94(5), 101(6), and 116(3).",
    exceptionsAndStatutoryLimits:
      "While a court cannot order CAS to purchase goods or services under ss. 94(6)(c), 101(7)(c), or 116(4)(c), CAS remains subject to its duty under s. 100(a) to specify in its Plan of Care the services to be provided, its inquiry under s. 101(2)–(3) regarding assistance efforts, and its OCPS Standard 7 duty to make and coordinate referrals to publicly funded or accessible community services. CAS may also exercise discretionary budget authority to fund services voluntarily.",
    accessibilityFactorsToEvaluate: [
      "Whether publicly funded (OHIP-covered or community-funded) mental health, trauma, or addiction services were identified and referred",
      "Whether private unfunded services were demanded of an indigent parent without accessible publicly funded alternatives or reasonable time to access waitlist services",
      "Whether privacy/consent releases for treatment providers were proportionate and focused on safety/participation rather than wholesale disclosure without basis",
    ],
    evidenceEstablishingCompliance: [
      "Referrals to publicly funded community mental health, addiction, or trauma programs",
      "Clear differentiation in the Service Plan between mandatory safety steps and voluntary/recommended therapy",
    ],
    overstatementGuard:
      "NEVER assert that CYFSA legally compels CAS to pay for private therapy or private addiction treatment; always cite the statutory bar in ss. 94(6)(c), 101(7)(c), and 116(4)(c) while evaluating whether accessible public referrals were made.",
  },
  {
    ruleId: "B3-OCPS-STD-7-MENTAL-HEALTH-ADDICTION-COORDINATION",
    domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
    authorityId: "OCPS:STD_7",
    secondaryAuthorityIds: ["CYFSA:100", "CYFSA:101(2)"],
    legalSource: "Ontario Child Protection Standards (2016) & CYFSA s. 100(a), s. 101(2)",
    exactSectionOrStandard: "OCPS (2016) Standard 7; CYFSA s. 100(a), s. 101(2)",
    effectiveDate: "2016-01-01",
    legalForce: "STANDARDS_BASED",
    title: "Assessment-Linked Mental Health, Trauma, Domestic Violence & Substance Use Referrals",
    requiredOrExpectedAction:
      "Where parental mental health, trauma, domestic violence victimization, or substance use is identified as contributing to child protection risk, include specific, realistic goals in the Service Plan, facilitate referrals to appropriate community services, and evaluate progress based on impact on child safety and parenting capacity rather than diagnosis alone.",
    triggeringCircumstances:
      "Cases where parental mental health, addiction, or domestic violence exposure is cited as a protection concern.",
    applicabilityConditions:
      "Applies during ongoing service planning (OCPS Standard 7) and Plan of Care preparation (CYFSA s. 100(a)).",
    exceptionsAndStatutoryLimits:
      "A mental health diagnosis or history of substance use is not, by itself, a ground for a protection finding under CYFSA s. 74(2) absent evidence of resulting physical/emotional harm or likely risk of harm to the child.",
    accessibilityFactorsToEvaluate: [
      "Waitlist durations for publicly funded counselling, detox, or residential treatment",
      "Whether domestic violence support was trauma-informed and did not penalize a non-offending protective parent for seeking help",
      "Whether relapse or treatment barriers were assessed in relation to actual child safety mitigation plans",
    ],
    evidenceEstablishingCompliance: [
      "Service Plan goals linking substance use or mental health supports to concrete child safety outcomes",
      "Documentation of referral offers, consent forms, and collateral follow-up with treatment providers",
    ],
    overstatementGuard:
      "Do not equate a mental health diagnosis or past substance use with child neglect unless the evidence links it to a statutory ground in CYFSA s. 74(2).",
  },
] as const;

export const B4_HOUSING_AND_BASIC_NECESSITIES_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B4-POVERTY-AND-SOCIOECONOMIC-CONDITIONS-DISTINCTION",
    domain: "B4_HOUSING_AND_BASIC_NECESSITIES",
    authorityId: "CYFSA:74(2)",
    secondaryAuthorityIds: ["CYFSA:1(2)", "CYFSA:101(2)", "BILL_C92:14", "CYFSA:94(6)"],
    legalSource:
      "Child, Youth and Family Services Act, 2017, s. 74(2), s. 101(2)–(3), s. 94(6)(c); Bill C-92, S.C. 2019, c. 24, s. 15",
    exactSectionOrStandard: "CYFSA s. 74(2), s. 101(2)–(3), s. 94(6)(c); S.C. 2019, c. 24, s. 15",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Distinguishing Poverty / Housing Hardship from Child Neglect & Navigation of Basic-Needs Supports",
    requiredOrExpectedAction:
      "Distinguish financial hardship, precarious housing, or lack of material resources from culpable neglect under CYFSA s. 74(2). For Indigenous children, Bill C-92 s. 15 expressly prohibits apprehension solely on the basis of socio-economic conditions, including poverty, lack of adequate housing or infrastructure, or the state of health of the parent. While a court cannot order CAS to provide direct financial assistance under CYFSA ss. 94(6)(c), 101(7)(c), or 116(4)(c), CAS must identify assistance efforts under s. 101(2) and coordinate community housing/income referrals under OCPS Standard 7.",
    triggeringCircumstances:
      "Cases involving inadequate housing, overcrowding, shelter residence, utility arrears, food insecurity, or lack of infant/child supplies.",
    applicabilityConditions:
      "CYFSA s. 74(2) and s. 101(2)–(3) apply to all families; Bill C-92 s. 15 applies as paramount federal law to First Nations, Inuit, and Métis children.",
    exceptionsAndStatutoryLimits:
      "CAS is not a public housing authority or income-maintenance ministry and cannot be court-ordered to pay rent or provide financial assistance (ss. 94(6)(c), 101(7)(c), 116(4)(c)). However, CAS may issue support letters for special priority housing, navigate Ontario Works/ODSP/shelter supports, or provide discretionary emergency vouchers where agency policy permits.",
    accessibilityFactorsToEvaluate: [
      "Whether CAS provided housing support letters, shelter navigation, or referrals to housing stability / income support programs",
      "Whether housing conditions posed an actual safety hazard to the child vs. poverty-related crowding or aesthetic concerns",
      "Whether Bill C-92 s. 15 applies (for Indigenous children)",
    ],
    evidenceEstablishingCompliance: [
      "Documentation distinguishing actual physical safety hazards from socio-economic hardship",
      "Case notes or correspondence showing housing support letters, community resource referrals, or concrete problem-solving around basic necessities",
    ],
    overstatementGuard:
      "Never state that CAS has a statutory duty to provide housing or pay rent; instead evaluate whether CAS coordinated housing/income navigation and whether poverty was improperly conflated with protection risk.",
  },
] as const;

export const B5_KINSHIP_AND_FAMILY_NETWORKS_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B5-CYFSA-KINSHIP-PRIORITY-AND-ASSESSMENT",
    domain: "B5_KINSHIP_AND_FAMILY_NETWORKS",
    authorityId: "CYFSA:101(4)",
    secondaryAuthorityIds: ["CYFSA:94(2)", "CYFSA:101(5)", "CYFSA:109(2)", "BILL_C92:16(1)"],
    legalSource:
      "Child, Youth and Family Services Act, 2017, ss. 74(4), 94(2)(c), 101(4)–(5), 109(2)(d); O. Reg. 156/18 Part II (Kinship Service Standards); Bill C-92 s. 16",
    exactSectionOrStandard: "CYFSA ss. 74(4), 94(2)(c), 101(4), 101(5), 109(2)(d); Bill C-92 s. 16(1)–(2)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Mandatory Consideration of Relative, Extended Family, and Community Placement Before Society Care",
    requiredOrExpectedAction:
      "Where a child cannot remain safely with a parent, the court and society must consider whether the child can be placed with a relative, extended family member, or member of the child's community (CYFSA s. 94(2)(c) at interim stage; s. 101(4) before making a temporary or extended society care order; s. 109(2)(d) in society placement decisions). For Indigenous children, Bill C-92 s. 16(1) mandates placement priority: (a) parent, (b) family member, (c) member of the same Indigenous group/community, (d) member of another Indigenous group, before non-Indigenous placement.",
    triggeringCircumstances:
      "Any out-of-home placement decision, interim care motion (s. 94), or dispositional hearing (s. 101), or whenever a parent or family member proposes a kin caregiver.",
    applicabilityConditions:
      "Applies to all out-of-home placements under the CYFSA; heightened statutory duties apply to First Nations, Inuk, or Métis children under CYFSA ss. 74(4), 101(5) and Bill C-92 s. 16.",
    exceptionsAndStatutoryLimits:
      "Proposed kinship placements are subject to safety/kinship assessment under the Ontario Kinship Service Standards (O. Reg. 156/18, s. 2) and the child's best interests (CYFSA s. 74(3)).",
    accessibilityFactorsToEvaluate: [
      "Whether CAS asked the parents and child to identify relatives, extended family, or community members early in the case",
      "Whether proposed kin caregivers were assessed promptly under the Kinship Service Standards rather than left unassessed",
      "If a proposed kin caregiver was rejected, whether the specific safety reasons were documented and communicated",
      "Whether Family Group Decision Making, family-centred conferencing, or ADR (CYFSA s. 17 / s. 76(3)) was offered to build a family safety network",
    ],
    evidenceEstablishingCompliance: [
      "Kinship identification inquiries and Kinship Service Assessment records",
      "Plan of Care or affidavit explaining the assessment of proposed relatives/community members under s. 94(2)(c) or s. 101(4)–(5)",
    ],
    overstatementGuard:
      "Do not assert that every proposed relative must be approved; CAS is required to consider and assess proposed kin against child safety and best-interests criteria.",
  },
] as const;

export const B6_PARENT_CHILD_CONTACT_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B6-CYFSA-104-105-ACCESS-AND-MEANINGFUL-CONTACT",
    domain: "B6_PARENT_CHILD_CONTACT",
    authorityId: "CYFSA:104(1)",
    secondaryAuthorityIds: ["CYFSA:105(1)", "CYFSA:105(5)", "CYFSA:100"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "ss. 10(1)(a), 100(d)(ii), 104(1), 105(1), 105(5)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Access Orders, Plan of Care Access Arrangements & Beneficial/Meaningful Contact",
    requiredOrExpectedAction:
      "When a child is placed out of the parent's care, the society's Plan of Care must specify the arrangements for access between the child and parents, siblings, and extended family (s. 100(d)(ii)), and the child in care has a statutory right to speak in private with family members subject to court orders (s. 10(1)(a)). The court may make an access order in the child's best interests (s. 104(1)), must make an access order where custody is transferred under s. 102 unless best interests dictate otherwise (s. 105(1)), and shall not make an access order for a child in extended society care unless the relationship is beneficial and meaningful to the child (s. 105(5)).",
    triggeringCircumstances:
      "Any out-of-home placement, interim care order, temporary society care order, custody order, or extended society care order.",
    applicabilityConditions:
      "Applies whenever a child is removed from or living apart from a parent or sibling under CYFSA intervention.",
    exceptionsAndStatutoryLimits:
      "Access frequency, duration, location, and supervision are governed by the child's safety and best interests (s. 74(3), s. 104(1)). Supervision of visits or restriction of contact must be justified by documented child safety or emotional well-being concerns.",
    accessibilityFactorsToEvaluate: [
      "Frequency, duration, and developmental appropriateness of visits (especially for infants and young children)",
      "Whether the level of supervision (fully supervised at CAS office vs. semi-supervised, community, or kin-supervised) is justified by specific safety risks",
      "Whether CAS progressively reviewed expanding access (longer, less supervised, community/home visits) as safety goals were met",
      "Whether practical barriers to visits (transportation, transit tokens, distance, parent work hours, school schedules) were addressed",
      "Whether sibling contact and cultural/linguistic continuity were maintained",
    ],
    evidenceEstablishingCompliance: [
      "Plan of Care section addressing access arrangements (s. 100(d)(ii))",
      "Access observation notes and periodic reviews evaluating whether supervision can be reduced or frequency increased",
    ],
    overstatementGuard:
      "Distinguish between court-ordered access parameters and discretionary CAS scheduling decisions where an order leaves access in the society's discretion.",
  },
] as const;

export const B7_REUNIFICATION_AND_PERMANENCY_RULES: readonly ParentAssistanceRule[] = [
  {
    ruleId: "B7-CYFSA-122-CUMULATIVE-TIME-IN-CARE-AND-REUNIFICATION",
    domain: "B7_REUNIFICATION_AND_PERMANENCY",
    authorityId: "CYFSA:122(1)",
    secondaryAuthorityIds: ["CYFSA:122(5)", "CYFSA:100", "CYFSA:113(1)", "CYFSA:114", "CYFSA:75(6)"],
    legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
    exactSectionOrStandard: "ss. 75(6), 100(b), 113(1), 114, 122(1), 122(2), 122(4), 122(5)",
    effectiveDate: "2018-04-30",
    legalForce: "LEGALLY_REQUIRED",
    title: "Statutory Cumulative Interim Society Care Time Limits (12 / 24 Months), Deemed Extension (s. 122(4)), Discretionary 6-Month Extension (s. 122(5)) & Status Review",
    requiredOrExpectedAction:
      "Ensure timely reunification planning and status review (ss. 113–114) within statutory cumulative interim society care limits under CYFSA s. 122(1): 12 months if the child is younger than 6 on the day the court makes the order, or 24 months if the child is 6 or older on the day the court makes the order. Time in care under temporary care agreements (s. 75(1)) or temporary adjournment custody (s. 94(2)(d)) counts toward the limit (s. 122(2)). Where the period expires while an appeal of a s. 101(1) order is pending or a s. 114 status review hearing is adjourned, the period is deemed extended until the appeal is disposed of or the s. 114 order is made (s. 122(4)). Under s. 122(5), the court may by order extend the period permitted under s. 122(1) by up to 6 months if in the child's best interests. Where the society intends for the child to return to a parent, the Plan of Care (s. 100(b)(i)) must state the changes required before the child can return.",
    triggeringCircumstances:
      "Any case where a child is in temporary care (by Temporary Care Agreement under s. 75 or interim society care order under s. 101(1) para. 2) or approaching a status review under s. 113.",
    applicabilityConditions:
      "Applies to all children in interim society care; s. 122(2) includes time spent in society care under temporary care agreements (s. 75(6) max 12 months in 24) and temporary orders.",
    exceptionsAndStatutoryLimits:
      "Deemed extension under s. 122(4) during pending appeals or adjourned s. 114 status review hearings; discretionary judicial extension of up to 6 months under s. 122(5) where in the child's best interests.",
    accessibilityFactorsToEvaluate: [
      "Whether the required behavioural/safety changes for return of the child were clearly stated in the Plan of Care (s. 100(b)(i)) and Service Plan",
      "Whether referral delays or waitlists consumed the 12-month or 24-month statutory clock under s. 122(1)",
      "Whether transition planning, step-down access, and post-reunification supervision/supports were prepared",
    ],
    evidenceEstablishingCompliance: [
      "Plan of Care explicitly stating the changes required for return of the child (s. 100(b)(i))",
      "Status review application filed before expiry of the existing order (s. 113(2)) and accurate calculation of cumulative time in care under s. 122",
    ],
    overstatementGuard:
      "Always state both the statutory ceiling (12 months for under 6; 24 months for 6 and older under s. 122(1)), the deemed extension under s. 122(4), and the court's discretionary authority to extend by up to 6 months under s. 122(5).",
  },
] as const;

export const ALL_PARENT_ASSISTANCE_RULES: readonly ParentAssistanceRule[] = [
  ...B1_FAMILY_PRESERVATION_RULES,
  ...B2_PARENTING_SUPPORT_RULES,
  ...B3_MENTAL_HEALTH_AND_ADDICTIONS_RULES,
  ...B4_HOUSING_AND_BASIC_NECESSITIES_RULES,
  ...B5_KINSHIP_AND_FAMILY_NETWORKS_RULES,
  ...B6_PARENT_CHILD_CONTACT_RULES,
  ...B7_REUNIFICATION_AND_PERMANENCY_RULES,
] as const;

// ============================================================================
// MANDATORY DETAILED IMPLEMENTATION: OCPS (2016) STANDARD 7 (18 COMPONENTS)
// ============================================================================

export const STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS: readonly Standard7ComponentSpec[] = [
  {
    componentCode: "STD7_01_TRANSFER_TO_ONGOING",
    componentNumber: 1,
    title: "Transfer into Ongoing Protection Services",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 6 (Case Transfer) & Standard 7 (Ongoing Service Case Management)",
    triggeringEvent:
      "Investigation disposition concluding that ongoing child protection services are required.",
    timelineRequirement:
      "At investigation completion / case transfer conference between investigative and ongoing workers and supervisors.",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Conduct a structured transfer of the case from investigation to ongoing services, ensuring the family is informed of the ongoing worker's identity and the reasons for ongoing involvement.",
    requiredDocumentation:
      "Case transfer record, investigation completion date, and transfer date documented in the case record.",
    exceptionsOrModificationRules:
      "Where the same generalist worker retains the file from investigation into ongoing service, the date of investigation disposition/completion serves as the transfer trigger.",
  },
  {
    componentCode: "STD7_02_STRENGTHS_AND_NEEDS_ASSESSMENT",
    componentNumber: 2,
    title: "Family and Child Strengths-and-Needs Assessment",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Assessment of Family and Child Strengths and Needs",
    triggeringEvent:
      "Initiation of ongoing child protection services and prior to each formal case review.",
    timelineRequirement:
      "Within 30 days of investigation completion or case transfer (informing the initial Service Plan) and prior to every 6-month case review.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Complete the approved Family and Child Strengths and Needs Assessment tool to identify protective capacities, family strengths, and high-priority caregiver and child needs driving ongoing protection risk.",
    requiredDocumentation:
      "Completed Family and Child Strengths and Needs Assessment instrument in the case file.",
    exceptionsOrModificationRules:
      "Assessment must be updated whenever there is a significant change in family circumstances or prior to case review.",
  },
  {
    componentCode: "STD7_03_INITIAL_SERVICE_PLAN_30_DAYS",
    componentNumber: 3,
    title: "Initial Service Plan Development Within 30 Days of Investigation Completion or Case Transfer",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Initial Service Plan Timeline",
    triggeringEvent:
      "Completion of the child protection investigation OR transfer of the case to ongoing protection services (NOT measured from the date of child removal/apprehension alone).",
    timelineRequirement:
      "Within 30 days of completion of the investigation or transfer of the case to ongoing services.",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Develop and document the initial ongoing Service Plan addressing the verified protection concerns and highest priority family/child needs, and obtain supervisory approval.",
    requiredDocumentation:
      "Written initial Service Plan signed/approved by the supervisor with the completion date and copies/distribution noted.",
    exceptionsOrModificationRules:
      "Any departure from the 30-day timeline requires prior supervisory consultation, approval, and documented reasons. If the uploaded record does not show the investigation completion or case transfer date, the 30-day deadline MUST be classified as `DEADLINE_NOT_DETERMINABLE`.",
  },
  {
    componentCode: "STD7_04_FAMILY_CENTRED_CONFERENCING",
    componentNumber: 4,
    title: "Family-Centred Conferencing and Collaborative Planning",
    sourceLabel: "PRACTICE_NOTE",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Practice Notes on Family-Centred Conferencing & CYFSA s. 76(3)",
    triggeringEvent:
      "Development or major revision of the ongoing Service Plan or when court disputes arise.",
    timelineRequirement:
      "During initial service planning and at key decision points.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Consider and, where appropriate, offer family-centred conferencing, Family Group Decision Making, or prescribed Alternative Dispute Resolution (CYFSA s. 76(3)) to engage extended family and community networks in safety and service planning.",
    requiredDocumentation:
      "Case notes or Service Plan entries recording whether conferencing/ADR was considered, offered, held, or declined.",
    exceptionsOrModificationRules:
      "Conferencing format is guided by Practice Notes and safety screening (e.g., domestic violence screening); for Indigenous children, CYFSA s. 76(3) requires considering prescribed ADR if the child is or may be in need of protection.",
  },
  {
    componentCode: "STD7_05_PARENT_AND_CHILD_PARTICIPATION",
    componentNumber: 5,
    title: "Parent, Child, and Extended Family Participation in Service Planning",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Family Involvement in Service Planning; CYFSA s. 2(2)",
    triggeringEvent:
      "Every initial Service Plan and subsequent Service Plan review.",
    timelineRequirement:
      "Throughout service plan development and at each 6-month formal review.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Actively involve the parents/caregivers, the child (according to age and maturity), and relevant extended family or Indigenous community representatives in developing and reviewing the Service Plan.",
    requiredDocumentation:
      "Documentation in the Service Plan of the participants involved, the family's views/input, or the specific efforts made to engage the family if a parent was unavailable or declined to participate.",
    exceptionsOrModificationRules:
      "If a parent refuses or is unable to participate despite documented outreach, the worker must still complete the Service Plan and document the efforts made to involve the parent.",
  },
  {
    componentCode: "STD7_06_CLEAR_BEHAVIOURAL_GOALS_AND_ACTIVITIES",
    componentNumber: 6,
    title: "Clear, Specific, Behaviourally Stated Goals and Activities",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Service Plan Content (Outcomes, Goals & Activities)",
    triggeringEvent:
      "Preparation of the initial Service Plan and all revised Service Plans.",
    timelineRequirement:
      "Included in every approved Service Plan.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Specify clear, observable, behaviourally stated protection outcomes and concrete activities directly tied to reducing the verified child protection risks and addressing the priority needs from the Strengths and Needs Assessment.",
    requiredDocumentation:
      "Written goals and activities in the Service Plan stated in understandable, measurable behavioural terms rather than vague compliance labels.",
    exceptionsOrModificationRules:
      "Goals must directly relate to child safety and well-being rather than extraneous lifestyle preferences.",
  },
  {
    componentCode: "STD7_07_DESIGNATED_RESPONSIBLE_PERSONS",
    componentNumber: 7,
    title: "Identification of Responsible Persons for Each Activity",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Service Plan Content (Responsible Persons)",
    triggeringEvent:
      "Preparation of the initial Service Plan and all revised Service Plans.",
    timelineRequirement:
      "Included in every approved Service Plan.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Clearly identify who is responsible for carrying out each planned task or activity (e.g., parent, CAS worker, extended family member, or community service provider).",
    requiredDocumentation:
      "Service Plan matrix/entries assigning specific tasks to named responsible parties.",
    exceptionsOrModificationRules:
      "None; every Service Plan activity requires an assigned responsible party.",
  },
  {
    componentCode: "STD7_08_COMPLETION_TIMEFRAMES",
    componentNumber: 8,
    title: "Target Timeframes for Achievement of Goals and Activities",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Service Plan Content (Timeframes)",
    triggeringEvent:
      "Preparation of the initial Service Plan and all revised Service Plans.",
    timelineRequirement:
      "Included in every approved Service Plan.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Establish realistic target timeframes for completing planned activities and evaluating progress toward protection goals, aligned with the formal case review cycle and any applicable CYFSA s. 122 time-in-care limits.",
    requiredDocumentation:
      "Target dates or review timeframes recorded for each goal/activity in the Service Plan.",
    exceptionsOrModificationRules:
      "Timeframes should be adjusted at Service Plan review if external service waitlists delayed access through no fault of the parent.",
  },
  {
    componentCode: "STD7_09_SERVICES_AND_REFERRALS",
    componentNumber: 9,
    title: "Provision of Services and Community Referrals",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Service Provision and Referrals",
    triggeringEvent:
      "Identification of priority parent/child needs in the Strengths and Needs Assessment and Service Plan.",
    timelineRequirement:
      "Promptly upon completion of the Service Plan and ongoing as needs are identified.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Provide direct casework support and facilitate concrete referrals to community services addressing the identified protection concerns and priority family needs.",
    requiredDocumentation:
      "Service Plan list of services/referrals and case notes documenting when and how each referral was made.",
    exceptionsOrModificationRules:
      "Subject to community service availability and the statutory rule in CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c) that a court cannot order CAS to purchase goods or services.",
  },
  {
    componentCode: "STD7_10_SERVICE_COORDINATION_AND_MONITORING",
    componentNumber: 10,
    title: "Coordination with Collateral Service Providers and Active Monitoring",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Ongoing Case Management & Collateral Coordination",
    triggeringEvent:
      "Active referrals or involvement of community, health, educational, or therapeutic providers.",
    timelineRequirement:
      "Ongoing throughout the service period and prior to each formal case review.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Coordinate service delivery with collateral professionals (with appropriate consents), monitor the family's access to and participation in services, and assess whether services are producing behavioural change that reduces protection risk.",
    requiredDocumentation:
      "Collateral contact case notes, service provider reports, and progress summaries.",
    exceptionsOrModificationRules:
      "Collection and disclosure of personal information must comply with CYFSA Part X privacy and consent rules.",
  },
  {
    componentCode: "STD7_11_MONTHLY_HOME_CONTACT_EXPECTATIONS",
    componentNumber: 11,
    title: "Minimum Monthly Direct Contact & Unannounced/Home Visit Considerations",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Minimum Contact Requirements with Child and Family",
    triggeringEvent:
      "Open ongoing child protection case.",
    timelineRequirement:
      "At least once every month (minimum standard), or more frequently based on risk level and safety plan requirements; majority of visits to occur in the family home.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Conduct direct in-person visits with the parents/caregivers and private interviews/observations of the child at least monthly (or more frequently as required by the risk level), including visits in the home environment.",
    requiredDocumentation:
      "Contemporaneous case notes recording visit date, location (home vs. office), participants, private child observation/interview, and safety/risk observations.",
    exceptionsOrModificationRules:
      "Any departure from minimum monthly contact requires supervisory consultation, approval, and documented reasons.",
  },
  {
    componentCode: "STD7_12_SUPERVISORY_REVIEW_AND_APPROVAL",
    componentNumber: 12,
    title: "Regular Supervisory Consultation and Approval of Service Plans and Reviews",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) All Phases (Supervisory Consultation) & Standard 7",
    triggeringEvent:
      "Initial Service Plan, every 6-month formal case review, significant change in risk/safety, placement change, and at least once every 6 weeks during ongoing service.",
    timelineRequirement:
      "Approval at initial Service Plan (within 30 days), at each 6-month review, and regular supervisory review at least every 6 weeks.",
    responsibleParty: "CAS_SUPERVISOR",
    requiredAction:
      "Review and approve the initial Service Plan, formal case reviews, risk reassessments, and any departures from standards; conduct regular ongoing case supervision.",
    requiredDocumentation:
      "Supervisor sign-off/approval on Service Plans and Case Reviews, plus supervisory consultation notes in the file.",
    exceptionsOrModificationRules:
      "None; supervisory approval of Service Plans and departures from standards is mandatory under OCPS (2016).",
  },
  {
    componentCode: "STD7_13_FORMAL_6_MONTH_CASE_REVIEW",
    componentNumber: 13,
    title: "Formal Case Review and Risk Reassessment Every 6 Months (or Earlier)",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Formal Review of Ongoing Cases",
    triggeringEvent:
      "Passage of 6 months since the initial Service Plan or previous formal review, OR a significant change in family circumstances, new verified referral, or planned return of a child/case closure.",
    timelineRequirement:
      "At least once every 6 months, or earlier upon a triggering change in circumstances.",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Conduct a formal case review including a reassessment of child safety, risk reassessment, updated Family and Child Strengths and Needs Assessment, evaluation of progress toward Service Plan goals, and decision on continued service vs. closure.",
    requiredDocumentation:
      "Completed Risk Reassessment, updated Strengths and Needs Assessment, and Formal Case Review / Revised Service Plan approved by the supervisor.",
    exceptionsOrModificationRules:
      "Must occur earlier than 6 months if a new investigation is verified or a major change in household composition/safety occurs.",
  },
  {
    componentCode: "STD7_14_REUNIFICATION_READINESS_ASSESSMENT",
    componentNumber: 14,
    title: "Reunification Safety and Readiness Assessment",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Reunification Assessment; CYFSA s. 100(b)(i)",
    triggeringEvent:
      "Where a child has been placed out of the home (kinship or society care) and return to the parent is being planned or reviewed.",
    timelineRequirement:
      "At each formal case review, prior to recommending return of the child, and prior to status review filings.",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Assess whether the conditions that led to the child's removal have been sufficiently mitigated, whether the home is safe for the child's return (with or without supervision supports), and what transition and post-reunification supports are required.",
    requiredDocumentation:
      "Reunification safety assessment, Case Review analysis, and court Plan of Care (CYFSA s. 100(b)(i)) specifying changes achieved or still required.",
    exceptionsOrModificationRules:
      "Subject to court orders where the child is in care pursuant to a CYFSA s. 94 or s. 101 order.",
  },
  {
    componentCode: "STD7_15_CONCURRENT_PERMANENCY_PLANNING",
    componentNumber: 15,
    title: "Concurrent Permanency Planning Within Statutory Timeframes",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Permanency Planning; CYFSA s. 122(1)",
    triggeringEvent:
      "When a child is placed out of the parent's care in kinship or society care.",
    timelineRequirement:
      "Reviewed at every 6-month case review and aligned with CYFSA s. 122(1) cumulative time-in-care limits (12 months for under 6; 24 months for 6 and older).",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Pursue active family reunification efforts while concurrently identifying and assessing alternative family-based or culturally appropriate permanency options (such as kinship care or customary care) in case reunification cannot be safely achieved within statutory timelines.",
    requiredDocumentation:
      "Permanency planning records in the Case Review and Plan of Care (CYFSA s. 100(b)(ii)).",
    exceptionsOrModificationRules:
      "Concurrent planning must not undermine active reunification assistance while reunification remains a viable goal.",
  },
  {
    componentCode: "STD7_16_SERVICE_PLAN_REVISIONS",
    componentNumber: 16,
    title: "Revision of the Service Plan Following Case Review",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Revision of the Service Plan",
    triggeringEvent:
      "Completion of a formal 6-month case review or significant change in family circumstances where ongoing services continue.",
    timelineRequirement:
      "At each formal 6-month review (or earlier triggered review).",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Update and revise the Service Plan with the family to reflect goals achieved, remaining protection concerns, adjusted services/referrals, and updated timeframes.",
    requiredDocumentation:
      "Revised Service Plan signed/approved by the supervisor.",
    exceptionsOrModificationRules:
      "Not required if the formal review results in approved case closure under Standard 8.",
  },
  {
    componentCode: "STD7_17_CASE_REVIEW_DOCUMENTATION_AND_SHARING",
    componentNumber: 17,
    title: "Documentation of Case Reviews and Provision of Service Plan to Family",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_7",
    exactStandardReference: "OCPS (2016) Standard 7 — Documentation and Sharing of the Service Plan",
    triggeringEvent:
      "Approval of the initial Service Plan and each revised Service Plan.",
    timelineRequirement:
      "Promptly following supervisory approval of the Service Plan.",
    responsibleParty: "CAS_WORKER",
    requiredAction:
      "Document the completed assessments, review findings, and Service Plan in the case record, invite the parents (and age-appropriate child) to sign the Service Plan, and provide a copy of the Service Plan to the family.",
    requiredDocumentation:
      "Signed Service Plan (or notation if parent declined to sign) and record that a copy was provided to the parents.",
    exceptionsOrModificationRules:
      "If providing a specific portion would pose a safety risk to a child or third party, document the supervisory-approved redaction/reason.",
  },
  {
    componentCode: "STD7_18_CASE_CLOSURE_REQUIREMENTS",
    componentNumber: 18,
    title: "Transition and Case Closure Requirements (Standard 8 Interface)",
    sourceLabel: "STANDARD",
    authorityId: "OCPS:STD_8",
    exactStandardReference: "OCPS (2016) Standard 8 — Case Closure for Ongoing Protection Cases",
    triggeringEvent:
      "Determination that protection risks have been sufficiently mitigated and the child is no longer in need of ongoing protection services.",
    timelineRequirement:
      "Prior to closing an ongoing protection case.",
    responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
    requiredAction:
      "Assess current child safety (ensuring no active safety threats), review recent direct contact with the child and family, link the family with any desired voluntary community aftercare supports, notify the family and relevant collaterals of closure, and obtain supervisory approval.",
    requiredDocumentation:
      "Case closure summary, safety assessment confirmation, family notification record, and supervisory approval.",
    exceptionsOrModificationRules:
      "Case cannot be closed while an active court supervision or society care order remains in force unless the order has expired or been terminated.",
  },
] as const;

// ============================================================================
// DETERMINISTIC STANDARD 7 INITIAL SERVICE PLAN 30-DAY DEADLINE CALCULATOR
// ============================================================================

function parseIsoDateUtc(dateStr?: string | null): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Deterministic calculator for the OCPS (2016) Standard 7 initial Service Plan 30-day deadline.
 *
 * CRITICAL RULE:
 *   Under OCPS (2016) Standard 7, the initial ongoing Service Plan must be completed within
 *   30 days of:
 *     (a) completion of the child protection investigation (Standard 6), OR
 *     (b) transfer of the case to ongoing protection services.
 *
 *   It is NEVER measured from the date of child removal/apprehension alone.
 *   If neither `investigationCompletionDate` nor `caseTransferDate` is present in the uploaded
 *   evidence, this function MUST return `DEADLINE_NOT_DETERMINABLE` (or `INVALID_TRIGGER_REMOVAL_DATE_ONLY`
 *   when only `removalDate` was supplied, which maps to `DEADLINE_NOT_DETERMINABLE` for compliance purposes).
 */
export function calculateStandard7ServicePlanDeadline(
  input: Standard7DeadlineInput,
): Standard7DeadlineAssessment {
  const investigationCompletion = parseIsoDateUtc(input.investigationCompletionDate);
  const caseTransfer = parseIsoDateUtc(input.caseTransferDate);
  const servicePlanCompletion = parseIsoDateUtc(input.servicePlanCompletionDate);
  const removal = parseIsoDateUtc(input.removalDate);

  // Prefer explicit caseTransferDate if provided; otherwise investigationCompletionDate.
  // If both are provided, Standard 7 measures 30 days from completion of the investigation or case transfer
  // (using the transfer date when transfer to ongoing service occurs upon/after investigation completion).
  let triggerDateObj: Date | null = null;
  let triggerEventUsed: "INVESTIGATION_COMPLETION" | "CASE_TRANSFER" | "NONE" = "NONE";
  let deadlineStatus: Standard7DeadlineStatus = "DEADLINE_NOT_DETERMINABLE";

  if (caseTransfer) {
    triggerDateObj = caseTransfer;
    triggerEventUsed = "CASE_TRANSFER";
    deadlineStatus = "DETERMINED_FROM_CASE_TRANSFER";
  } else if (investigationCompletion) {
    triggerDateObj = investigationCompletion;
    triggerEventUsed = "INVESTIGATION_COMPLETION";
    deadlineStatus = "DETERMINED_FROM_INVESTIGATION_COMPLETION";
  }

  if (!triggerDateObj) {
    const removalNote = removal
      ? `Although a child removal/apprehension date (${formatIsoDateUtc(removal)}) appears in the record, OCPS (2016) Standard 7 measures the 30-day initial Service Plan timeline from completion of the investigation or transfer to ongoing services — NOT from the date of removal alone.`
      : "Neither the investigation completion date nor the ongoing service case transfer date is documented in the uploaded records.";

    return {
      deadlineStatus: "DEADLINE_NOT_DETERMINABLE",
      triggerEventUsed: "NONE",
      triggerDate: null,
      calculatedDeadlineDate: null,
      servicePlanCompletionDate: servicePlanCompletion ? formatIsoDateUtc(servicePlanCompletion) : null,
      daysElapsedToServicePlan: null,
      withinThirtyDayStandard: null,
      explanation: `DEADLINE_NOT_DETERMINABLE: ${removalNote} Additional records (such as the Investigation Conclusion / Case Transfer record under OCPS Standard 6) are needed to determine the exact 30-day Standard 7 deadline.`,
      cautionNote:
        "Do not calculate the 30-day OCPS Standard 7 initial Service Plan deadline from the date of apprehension/removal or referral alone.",
    };
  }

  const deadlineDateObj = new Date(triggerDateObj.getTime() + 30 * 86_400_000);
  const triggerDateIso = formatIsoDateUtc(triggerDateObj);
  const deadlineDateIso = formatIsoDateUtc(deadlineDateObj);

  if (!servicePlanCompletion) {
    return {
      deadlineStatus,
      triggerEventUsed,
      triggerDate: triggerDateIso,
      calculatedDeadlineDate: deadlineDateIso,
      servicePlanCompletionDate: null,
      daysElapsedToServicePlan: null,
      withinThirtyDayStandard: null,
      explanation: `Based on the documented ${triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} date (${triggerDateIso}), the 30-day OCPS Standard 7 deadline for the initial ongoing Service Plan is ${deadlineDateIso}. The completion date of the initial Service Plan is not documented in the uploaded records.`,
      cautionNote:
        "Missing Service Plan completion date in the uploaded excerpt means the Service Plan is not documented in the uploaded records — not a confirmed failure to create one.",
    };
  }

  const servicePlanIso = formatIsoDateUtc(servicePlanCompletion);
  const daysElapsed = Math.round(
    (servicePlanCompletion.getTime() - triggerDateObj.getTime()) / 86_400_000,
  );
  const withinStandard = daysElapsed >= 0 && daysElapsed <= 30;

  return {
    deadlineStatus,
    triggerEventUsed,
    triggerDate: triggerDateIso,
    calculatedDeadlineDate: deadlineDateIso,
    servicePlanCompletionDate: servicePlanIso,
    daysElapsedToServicePlan: daysElapsed,
    withinThirtyDayStandard: withinStandard,
    explanation: withinStandard
      ? `The initial ongoing Service Plan (${servicePlanIso}) was completed ${daysElapsed} day(s) after ${triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} (${triggerDateIso}), within the 30-day OCPS (2016) Standard 7 timeline (deadline ${deadlineDateIso}).`
      : `The initial ongoing Service Plan (${servicePlanIso}) was completed ${daysElapsed} day(s) after ${triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} (${triggerDateIso}), which is outside the 30-day OCPS (2016) Standard 7 timeline (deadline ${deadlineDateIso}). Check whether supervisory approval and reasons for a timeline departure were documented.`,
    cautionNote:
      "Under OCPS (2016), a departure from the 30-day Standard 7 timeline may be authorized with supervisory consultation, approval, and documented reasons.",
  };
}

export function getParentAssistanceRulesByDomain(
  domain: ParentAssistanceDomain,
): readonly ParentAssistanceRule[] {
  return ALL_PARENT_ASSISTANCE_RULES.filter((rule) => rule.domain === domain);
}

export function getStandard7ComponentByCode(
  code: Standard7ComponentCode,
): Standard7ComponentSpec | undefined {
  return STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS.find(
    (comp) => comp.componentCode === code,
  );
}
