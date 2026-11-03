/**
 * MILESTONE 2 — LIBRARY C: AGENCY COMPLIANCE & EVIDENCE MATRIX ENGINE
 *
 * Interconnects:
 *   - Verified Legal Authority Registry (`shared/legalVerificationPipeline.ts`, `shared/citationVerification.ts`)
 *   - Library A: CAS Accountability & Professional Obligations (`shared/casAccountabilityLibrary.ts`)
 *   - Library B: Parent Assistance, Family Preservation & Reunification (`shared/parentAssistanceLibrary.ts`)
 *   - Library C: Agency Compliance & Evidence Matrix (C1 Required Fields, C2 Compliance Status Model,
 *     C3 Parent Assistance Status Model, C4 15-Question Parent Assistance Analysis, Dual Presentation Modes)
 *
 * CRITICAL DESIGN CONSTRAINTS:
 *   1. Deterministic, sub-5ms execution with zero live external web scraping.
 *   2. Zero Accusation Generator: Never presume either that CAS complied or that CAS committed wrongdoing.
 *   3. Missing Document Guard: When evidence is missing from the uploaded record, classify as
 *      `NOT_DOCUMENTED_IN_UPLOADED_RECORDS` or `INSUFFICIENT_EVIDENCE` — NEVER convert a missing document
 *      into a confirmed breach.
 *   4. Authority Verification Guard: Every matrix item is verified against `resolveLegalAuthority` and
 *      `evaluatePropositionSupport` before being marked `VERIFIED`.
 */

import {
  ALL_CAS_ACCOUNTABILITY_RULES,
  A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS,
  evaluateCaseNoteCompleteness,
  type LegalForceClassification,
  type OversightPathwayId,
  type ResponsibleActorRole,
} from "./casAccountabilityLibrary";
import {
  ALL_PARENT_ASSISTANCE_RULES,
  STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS,
  calculateStandard7ServicePlanDeadline,
  type ParentSupportLegalForce,
  type Standard7DeadlineAssessment,
  type Standard7DeadlineInput,
} from "./parentAssistanceLibrary";
import {
  evaluatePropositionSupport,
  resolveLegalAuthority,
  type LegalVerificationStatus,
} from "./legalVerificationPipeline";

// ============================================================================
// C1–C4 TYPE DEFINITIONS
// ============================================================================

export type ComplianceMatrixCategory =
  | "LAW_AND_PROCEDURE"
  | "CAS_ACCOUNTABILITY"
  | "PARENT_ASSISTANCE"
  | "REUNIFICATION"
  | "EVIDENCE_AND_CONTRADICTIONS";

/**
 * C2. Compliance Status Model — Strictly restricted to these 8 neutral statuses.
 */
export type AgencyComplianceStatus =
  | "COMPLIANT_ON_AVAILABLE_EVIDENCE"
  | "POTENTIAL_NONCOMPLIANCE"
  | "PARTIAL_COMPLIANCE"
  | "NOT_DOCUMENTED_IN_UPLOADED_RECORDS"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_APPLICABLE"
  | "EXCEPTION_MAY_APPLY"
  | "REQUIRES_LEGAL_REVIEW";

export const VALID_COMPLIANCE_STATUSES: readonly AgencyComplianceStatus[] = [
  "COMPLIANT_ON_AVAILABLE_EVIDENCE",
  "POTENTIAL_NONCOMPLIANCE",
  "PARTIAL_COMPLIANCE",
  "NOT_DOCUMENTED_IN_UPLOADED_RECORDS",
  "INSUFFICIENT_EVIDENCE",
  "NOT_APPLICABLE",
  "EXCEPTION_MAY_APPLY",
  "REQUIRES_LEGAL_REVIEW",
] as const;

export type ApplicabilityStatus =
  | "APPLIES"
  | "CONDITIONALLY_APPLIES"
  | "NOT_APPLICABLE"
  | "INSUFFICIENT_CONTEXT_TO_DETERMINE";

/**
 * C3. Parent Assistance Status Model — Multiple statuses may coexist for the same parent need.
 */
export type ParentAssistanceStatus =
  | "NEED_IDENTIFIED"
  | "SERVICE_CONSIDERED"
  | "SERVICE_OFFERED"
  | "REFERRAL_MADE"
  | "SERVICE_ACCESSIBLE"
  | "SERVICE_INACCESSIBLE"
  | "SERVICE_ACCEPTED"
  | "SERVICE_DECLINED"
  | "SERVICE_COMPLETED"
  | "FOLLOW_UP_DOCUMENTED"
  | "NO_OFFER_DOCUMENTED"
  | "UNKNOWN";

export const VALID_PARENT_ASSISTANCE_STATUSES: readonly ParentAssistanceStatus[] = [
  "NEED_IDENTIFIED",
  "SERVICE_CONSIDERED",
  "SERVICE_OFFERED",
  "REFERRAL_MADE",
  "SERVICE_ACCESSIBLE",
  "SERVICE_INACCESSIBLE",
  "SERVICE_ACCEPTED",
  "SERVICE_DECLINED",
  "SERVICE_COMPLETED",
  "FOLLOW_UP_DOCUMENTED",
  "NO_OFFER_DOCUMENTED",
  "UNKNOWN",
] as const;

/**
 * C1. Required Fields — Authority Block
 */
export interface ComplianceMatrixAuthorityField {
  authorityId: string;
  legalSource: string;
  exactSectionOrStandard: string;
  effectiveDate: string;
  legalForce: LegalForceClassification | ParentSupportLegalForce;
  applicabilityConditions: string;
  exceptions: string;
}

/**
 * C1. Required Fields — Obligation Block
 */
export interface ComplianceMatrixObligationField {
  responsibleParty: ResponsibleActorRole | string;
  requiredAction: string;
  triggeringEvent: string;
  deadline: string;
  requiredDocumentation: string;
  availableDiscretion: string;
}

/**
 * C1. Required Fields — Evidence Block
 */
export interface ComplianceMatrixEvidenceField {
  documentId: string;
  documentTitle: string;
  page: number | string;
  paragraphOrSpan: string;
  eventDate: string | null;
  recordDate: string | null;
  author: string | null;
  exactExcerpt: string;
  corroboratingEvidence: string[];
  contradictoryEvidence: string[];
  evidenceLimitations: string;
}

/**
 * C1. Required Fields — Assessment Block
 */
export interface ComplianceMatrixAssessmentField {
  applicabilityStatus: ApplicabilityStatus;
  complianceStatus: AgencyComplianceStatus;
  reasoning: string;
  missingInformation: string[];
  exceptionsConsidered: string[];
  sourceVerificationStatus: LegalVerificationStatus;
  confidenceOrUncertainty: string;
  suggestedFollowUpQuestions: string[];
  potentialOversightPathway: {
    pathwayId: OversightPathwayId;
    pathwayName: string;
    statutoryAuthority: string;
    jurisdictionNote: string;
    cannotOverturnCourtOrder: boolean;
  } | null;
}

/**
 * Dual Presentation Modes for each Compliance Matrix entry:
 *   Mode 1: Educational Legal Analysis (plain-English, grade-10 reading level)
 *   Mode 2: Courtroom-Style Presentation (professional, restrained, evidence-grounded)
 * Both modes share the exact same underlying facts, authorityId, and complianceStatus.
 */
export interface ComplianceMatrixDualPresentation {
  educationalMode: {
    whatRuleRequires: string;
    whyItAppliesOrMayNotApply: string;
    whatDocumentShows: string;
    whatIsMissing: string;
    questionsToAskNext: string[];
  };
  courtroomMode: {
    relevantRuleAndAuthority: string;
    documentedFactAndAttribution: string;
    evidentialGapOrInconsistency: string;
    targetedDisclosureOrClarificationRequest: string[];
  };
}

export interface ComplianceMatrixItem {
  itemId: string;
  category: ComplianceMatrixCategory;
  title: string;
  authority: ComplianceMatrixAuthorityField;
  obligation: ComplianceMatrixObligationField;
  evidence: ComplianceMatrixEvidenceField;
  assessment: ComplianceMatrixAssessmentField;
  presentation: ComplianceMatrixDualPresentation;
}

/**
 * C4. 15-Question Parent Assistance Analysis
 */
export interface ParentAssistance15QuestionAnalysis {
  needId: string;
  identifiedNeedTitle: string;
  domain: string;
  coexistingStatuses: ParentAssistanceStatus[];
  legalForceClassification: ParentSupportLegalForce;
  statutoryNonFundingRuleTriggered: boolean;
  statutoryNonFundingExplanation: string;
  questions: {
    q1_concernIdentifiedByCas: string;
    q2_rootProblemBehindConcern: string;
    q3_serviceCouldReduceRisk: string;
    q4_serviceDiscussedWithParent: string;
    q5_referralOrServiceOffered: string;
    q6_whenWasItOffered: string;
    q7_whoWasResponsibleForFollowUp: string;
    q8_wasServiceAccessible: string;
    q9_didParentParticipateOrAttempt: string;
    q10_barriersPreventingParticipation: string;
    q11_didCasAdjustPlanWhenBarriersAppeared: string;
    q12_wereKinshipOrCommunitySupportsExplored: string;
    q13_howDidAssistanceAffectRiskAndReunification: string;
    q14_whatEvidenceSupportsEachAnswer: string;
    q15_whatRecordsAreMissing: string;
  };
  pageAndParagraphAttribution: string;
  exactExcerpt: string;
}

export interface ComplianceMatrixSummaryCounts {
  totalItemsEvaluated: number;
  compliantOnAvailableEvidenceCount: number;
  potentialNoncomplianceCount: number;
  partialComplianceCount: number;
  notDocumentedInUploadedRecordsCount: number;
  insufficientEvidenceCount: number;
  notApplicableCount: number;
  exceptionMayApplyCount: number;
  requiresLegalReviewCount: number;
  byCategory: Record<ComplianceMatrixCategory, number>;
}

export interface ComplianceMatrixReport {
  matrixVersion: "2.0.0";
  generatedAtIso: string;
  documentTitle: string;
  standard7DeadlineAssessment: Standard7DeadlineAssessment;
  caseNoteCompletenessSummary: {
    presentElementsCount: number;
    missingElementsCount: number;
    missingElementCodes: string[];
    distinctionNote: string;
  };
  items: ComplianceMatrixItem[];
  parentAssistanceAnalyses: ParentAssistance15QuestionAnalysis[];
  summaryCounts: ComplianceMatrixSummaryCounts;
  neutralityAndMethodologyDisclaimer: string;
}

export interface BuildComplianceMatrixOptions {
  documentId?: string;
  documentTitle?: string;
  documentDate?: string | null;
  standard7Dates?: Standard7DeadlineInput;
  indigenousChildIndicatorsPresent?: boolean;
}

// ============================================================================
// DETERMINISTIC HELPERS & GUARDS
// ============================================================================

/**
 * Guard that prevents missing documentation from being turned into a confirmed breach.
 */
export function enforceMissingDocumentNeutralityGuard(params: {
  proposedStatus: AgencyComplianceStatus;
  hasAffirmativeEvidenceOfConductOrOmission: boolean;
  isSolelyMissingDocumentInUpload: boolean;
  exceptionMayApply?: boolean;
}): AgencyComplianceStatus {
  if (params.exceptionMayApply) {
    return "EXCEPTION_MAY_APPLY";
  }
  if (params.isSolelyMissingDocumentInUpload && !params.hasAffirmativeEvidenceOfConductOrOmission) {
    if (
      params.proposedStatus === "POTENTIAL_NONCOMPLIANCE" ||
      params.proposedStatus === "COMPLIANT_ON_AVAILABLE_EVIDENCE"
    ) {
      return "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";
    }
  }
  return params.proposedStatus;
}

function extractFirstMatchingSpan(
  sourceText: string,
  patterns: RegExp[],
  fallbackExcerpt: string,
): { excerpt: string; page: number | string; paragraphOrSpan: string } {
  if (!sourceText || !sourceText.trim()) {
    return {
      excerpt: fallbackExcerpt,
      page: 1,
      paragraphOrSpan: "Uploaded Document Overview",
    };
  }

  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const pattern of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const snippet = lines[i].slice(0, 260);
        const estimatedPage = Math.max(1, Math.ceil(((i + 1) / Math.max(lines.length, 1)) * 4));
        return {
          excerpt: snippet,
          page: estimatedPage,
          paragraphOrSpan: `Para. / Line ${i + 1}`,
        };
      }
    }
  }

  const firstLine = lines[0] ? lines[0].slice(0, 240) : fallbackExcerpt;
  return {
    excerpt: firstLine,
    page: 1,
    paragraphOrSpan: "Para. / Line 1",
  };
}

function extractDatesForStandard7(
  sourceText: string,
  explicitDates?: Standard7DeadlineInput,
): Standard7DeadlineInput {
  if (explicitDates) {
    return explicitDates;
  }

  const text = sourceText || "";
  const transferMatch =
    /(?:transfer(?:red)?\s+to\s+ongoing(?:\s+services?)?|case\s+transfer(?:\s+date)?)\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
      text,
    );
  const investigationCompletionMatch =
    /(?:investigation\s+(?:completed|completion|concluded|disposition))\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
      text,
    );
  const servicePlanMatch =
    /(?:initial\s+service\s+plan|service\s+plan\s+(?:completed|signed|approved))\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
      text,
    );
  const removalMatch =
    /(?:apprehended|removed\s+from\s+care|removal\s+date)\s*(?:on|:)?\s*(\d{4}-\d{2}-\d{2})/i.exec(
      text,
    );

  return {
    investigationCompletionDate: investigationCompletionMatch?.[1] ?? null,
    caseTransferDate: transferMatch?.[1] ?? null,
    servicePlanCompletionDate: servicePlanMatch?.[1] ?? null,
    removalDate: removalMatch?.[1] ?? null,
  };
}

function buildOversightPathwaySummary(pathwayId: OversightPathwayId) {
  const found = A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS.find((p) => p.pathwayId === pathwayId);
  if (!found) return null;
  return {
    pathwayId: found.pathwayId,
    pathwayName: found.pathwayName,
    statutoryAuthority: `${found.legalSource} (${found.exactSection})`,
    jurisdictionNote: found.exclusionsAndMattersBeforeCourtRule,
    cannotOverturnCourtOrder: found.cannotOverturnCourtOrder,
  };
}

function verifyMatrixAuthority(
  authorityId: string,
  propositionText: string,
): LegalVerificationStatus {
  const resolved = resolveLegalAuthority(authorityId, null);
  if (!resolved) {
    return "UNVERIFIED";
  }
  const support = evaluatePropositionSupport({
    authority: resolved,
    propositionText,
    documentDate: null,
  });
  return support.status;
}

// ============================================================================
// C4. 15-QUESTION PARENT ASSISTANCE EVALUATOR
// ============================================================================

export function evaluateParentAssistanceNeed15Questions(params: {
  needId: string;
  identifiedNeedTitle: string;
  domain: string;
  sourceText: string;
  legalForceClassification: ParentSupportLegalForce;
  relevantPatterns: RegExp[];
}): ParentAssistance15QuestionAnalysis {
  const {
    needId,
    identifiedNeedTitle,
    domain,
    sourceText,
    legalForceClassification,
    relevantPatterns,
  } = params;
  const text = sourceText || "";
  const span = extractFirstMatchingSpan(
    text,
    relevantPatterns,
    "No specific excerpt for this support domain appears in the uploaded record.",
  );

  const hasNeedMention = relevantPatterns.some((re) => re.test(text));
  const hasReferralMention =
    /\b(?:referr(?:ed|al)|offered\s+services?|connected\s+with|intake|program\s+referral|counsel(?:ling|lor)|parenting\s+program|housing\s+support)\b/i.test(
      text,
    );
  const hasWaitlistOrBarrierMention =
    /\b(?:wait\s*list|waitlist|barrier|transportation|cost|unaffordable|private\s+pay|hours\s+conflict|child\s*care|language\s+barrier|inaccessible)\b/i.test(
      text,
    );
  const hasParticipationMention =
    /\b(?:attended|completed|participat(?:ed|ing)|engaged\s+in|enrolled|waitlisted)\b/i.test(text);
  const hasDeclinedMention =
    /\b(?:declined|refused\s+service|did\s+not\s+attend)\b/i.test(text);
  const hasFollowUpMention =
    /\b(?:follow(?:ed)?\s*-?\s*up|collateral\s+check|adjusted\s+plan|updated\s+service\s+plan)\b/i.test(
      text,
    );
  const hasKinshipMention =
    /\b(?:kinship|relative|grandmother|grandfather|aunt|uncle|extended\s+family|community\s+member|family\s+network)\b/i.test(
      text,
    );
  const hasPrivateFundingDemand =
    /\b(?:private\s+therapy|pay\s+for\s+private|purchase\s+services?|fund\s+residential|financial\s+assistance\s+order)\b/i.test(
      text,
    );

  // Coexisting statuses (Section 6.C3)
  const statuses: ParentAssistanceStatus[] = [];
  if (hasNeedMention) {
    statuses.push("NEED_IDENTIFIED");
  }
  if (hasReferralMention) {
    statuses.push("SERVICE_CONSIDERED", "SERVICE_OFFERED", "REFERRAL_MADE");
  } else if (hasNeedMention) {
    statuses.push("NO_OFFER_DOCUMENTED");
  }
  if (hasWaitlistOrBarrierMention) {
    statuses.push("SERVICE_INACCESSIBLE");
  } else if (hasReferralMention) {
    statuses.push("SERVICE_ACCESSIBLE");
  }
  if (hasParticipationMention) {
    statuses.push("SERVICE_ACCEPTED");
    if (/\bcompleted\b/i.test(text)) {
      statuses.push("SERVICE_COMPLETED");
    }
  }
  if (hasDeclinedMention) {
    statuses.push("SERVICE_DECLINED");
  }
  if (hasFollowUpMention) {
    statuses.push("FOLLOW_UP_DOCUMENTED");
  }
  if (statuses.length === 0) {
    statuses.push("UNKNOWN");
  }

  const statutoryNonFundingRuleTriggered =
    domain === "B3_MENTAL_HEALTH_AND_ADDICTIONS" ||
    domain === "B4_HOUSING_AND_BASIC_NECESSITIES" ||
    hasPrivateFundingDemand;

  return {
    needId,
    identifiedNeedTitle,
    domain,
    coexistingStatuses: statuses,
    legalForceClassification,
    statutoryNonFundingRuleTriggered,
    statutoryNonFundingExplanation: statutoryNonFundingRuleTriggered
      ? "Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court cannot order a society to provide financial assistance or purchase goods or services as a supervision condition. However, CAS remains subject to CYFSA s. 100(a) (Plan of Care service specification), s. 101(2)–(3) (inquiry into pre-intervention assistance and less disruptive alternatives), and OCPS (2016) Standard 7 (referrals to accessible community/publicly funded supports)."
      : "Standard statutory and operational referral duties apply (CYFSA ss. 35(1), 100(a), 101(2)–(3); OCPS Standard 7).",
    questions: {
      q1_concernIdentifiedByCas: hasNeedMention
        ? `The uploaded record references ${identifiedNeedTitle.toLowerCase()} (${span.paragraphOrSpan}: "${span.excerpt}").`
        : `No explicit concern regarding ${identifiedNeedTitle.toLowerCase()} is detailed in the uploaded excerpt.`,
      q2_rootProblemBehindConcern: hasNeedMention
        ? "Assess whether the underlying factor is an acute safety threat, an unmet treatment/support need, or a socio-economic/housing barrier."
        : "Not determinable from the uploaded excerpt alone.",
      q3_serviceCouldReduceRisk:
        "Targeted community referrals, structured safety planning, and accessible family/parenting or clinical supports tied to behavioural safety outcomes under OCPS Standard 7.",
      q4_serviceDiscussedWithParent: hasReferralMention
        ? "The uploaded record indicates services or referrals were mentioned; verify in contemporaneous case notes how options were explained to the parent."
        : "No discussion of concrete service options for this concern is documented in the uploaded record.",
      q5_referralOrServiceOffered: hasReferralMention
        ? "A service or referral reference appears in the record; verify whether a concrete intake referral was submitted or only a general recommendation was noted."
        : "No concrete referral or service offer for this need is documented in the uploaded record (`NO_OFFER_DOCUMENTED`).",
      q6_whenWasItOffered:
        "Exact referral date is not fully specified in the uploaded excerpt; request the referral transmission log and Service Plan date.",
      q7_whoWasResponsibleForFollowUp:
        "Under OCPS (2016) Standard 7, the ongoing CAS worker is responsible for coordinating referrals and monitoring progress, with each task assigned in the Service Plan.",
      q8_wasServiceAccessible: hasWaitlistOrBarrierMention
        ? "Potential accessibility barriers (such as waitlists, cost, scheduling, or transportation) are indicated in the record (`SERVICE_INACCESSIBLE`)."
        : hasReferralMention
          ? "Accessibility details (waitlists, cost, location, hours, language/disability accommodation) are not fully documented; confirm whether the service was practically accessible."
          : "Cannot be determined because no referral is documented in the uploaded record.",
      q9_didParentParticipateOrAttempt: hasParticipationMention
        ? "The record indicates parent engagement, attendance, or waitlist enrollment (`SERVICE_ACCEPTED`)."
        : hasDeclinedMention
          ? "The record notes a service was declined or not attended (`SERVICE_DECLINED`); examine whether barriers or lack of accommodation contributed."
          : "Parent participation status is not documented in the uploaded excerpt.",
      q10_barriersPreventingParticipation: hasWaitlistOrBarrierMention
        ? "Waitlists, cost, transportation, or scheduling barriers are noted in the record."
        : "Not documented in the uploaded records; inquire whether waitlist, financial, transportation, childcare, cultural, or disability barriers existed.",
      q11_didCasAdjustPlanWhenBarriersAppeared: hasFollowUpMention
        ? "The record references follow-up or plan adjustment (`FOLLOW_UP_DOCUMENTED`)."
        : "The uploaded record does not show whether the Service Plan was adjusted to address barriers.",
      q12_wereKinshipOrCommunitySupportsExplored: hasKinshipMention
        ? "Kinship, relative, or community network references appear in the record; verify whether formal Kinship Service Assessment was completed."
        : "Exploration of relative, extended family, or community network supports under CYFSA ss. 94(2)(c), 101(4) is not documented in this excerpt.",
      q13_howDidAssistanceAffectRiskAndReunification:
        "Under CYFSA ss. 100(a)–(b) and 101(2)–(3), the availability, accessibility, and completion of targeted assistance directly inform whether less disruptive alternatives or reunification under supervision can adequately protect the child.",
      q14_whatEvidenceSupportsEachAnswer: `Attributed to ${span.paragraphOrSpan} (Page ${span.page}): "${span.excerpt}"`,
      q15_whatRecordsAreMissing: [
        "Initial and revised OCPS Standard 7 Service Plans with supervisor sign-off",
        "Family and Child Strengths and Needs Assessment",
        "Referral intake forms, waitlist confirmations, and collateral correspondence",
        "Contemporaneous case notes of service planning discussions with the parent",
      ].join("; "),
    },
    pageAndParagraphAttribution: `Page ${span.page}, ${span.paragraphOrSpan}`,
    exactExcerpt: span.excerpt,
  };
}

// ============================================================================
// MAIN MATRIX BUILDER
// ============================================================================

export function buildComplianceMatrixFromReport(
  report: {
    documentType?: string;
    executiveSummary?: string;
     statutoryFindings?: Array<{
      title?: string;
      statute?: string;
      description?: string;
      severity?: string;
      evidenceQuotes?: string[];
      pageNumber?: number;
      paragraphReference?: string;
    }>;
    contradictions?: Array<{
      claim?: string;
      counterEvidence?: string;
      significance?: string;
      sourcePage?: number;
      paragraphReference?: string;
    }>;
  },
  sourceText: string,
  options: BuildComplianceMatrixOptions = {},
): ComplianceMatrixReport {
  const docId = options.documentId || "uploaded-cas-record-1";
  const docTitle = options.documentTitle || report.documentType || "Uploaded CAS Record";
  const combinedText = [
    sourceText || "",
    report.executiveSummary || "",
    ...(report.statutoryFindings || []).map(
      (f) => `${f.title || ""} ${f.statute || ""} ${f.description || ""} ${(f.evidenceQuotes || []).join(" ")}`,
    ),
  ]
    .join("\n")
    .trim();

  // 1. Evaluate Standard 7 30-day initial Service Plan deadline deterministically
  const std7Dates = extractDatesForStandard7(combinedText, options.standard7Dates);
  const standard7DeadlineAssessment = calculateStandard7ServicePlanDeadline(std7Dates);

  // 2. Evaluate Case Note Completeness (A4)
  const caseNoteEval = evaluateCaseNoteCompleteness({
    hasContactDateAndTime: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i.test(
      combinedText,
    ),
    hasMethodOfContact: /\b(?:home\s+visit|office\s+visit|telephone|phone\s+call|in-person|unannounced\s+visit|video\s+call)\b/i.test(
      combinedText,
    ),
    hasParticipantsIdentified: /\b(?:present|participants?|mother|father|parent|child|worker|supervisor)\b/i.test(
      combinedText,
    ),
    hasSignificantDiscussionsRecorded: combinedText.length > 80,
    hasDirectObservationsSeparatedFromOpinion: /\b(?:observed|saw|stated|reported)\b/i.test(
      combinedText,
    ),
    hasWorkerIdentityAndRole: /\b(?:worker|social\s+worker|csw|child\s+protection\s+worker|affiant)\b/i.test(
      combinedText,
    ),
    hasDateOfNoteCreation: /\b(?:note\s+created|entered\s+on|recorded\s+on|sworn\s+on|dated)\b/i.test(
      combinedText,
    ),
    hasSupervisoryDiscussionsRecorded: /\b(?:supervisor|supervisory\s+consult(?:ation)?|approved\s+by\s+supervisor)\b/i.test(
      combinedText,
    ),
    hasLateEntryOrAmendmentAttribution: /\b(?:late\s+entry|addendum|amended|corrected)\b/i.test(
      combinedText,
    ),
  });

  const items: ComplianceMatrixItem[] = [];

  // --------------------------------------------------------------------------
  // ITEM 1: LAW_AND_PROCEDURE — Less Disruptive Alternatives & Pre-Intervention Assistance (CYFSA s. 101(2)-(3) & s. 94(4))
  // --------------------------------------------------------------------------
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:less\s+disruptive|efforts?\s+to\s+assist|supervision\s+order|remove|apprehend|temporary\s+care)\b/i,
      ],
      "Uploaded document does not set out a complete record of pre-intervention assistance efforts or less disruptive alternatives.",
    );
    const hasLessDisruptiveAnalysis =
      /\b(?:less\s+disruptive\s+alternatives?|efforts?\s+to\s+assist|why\s+supervision\s+would\s+be\s+inadequate)\b/i.test(
        combinedText,
      );
    const hasRemovalWithoutAlternatives =
      /\b(?:apprehended|removed\s+from\s+care|society\s+care)\b/i.test(combinedText) &&
      !hasLessDisruptiveAnalysis;

    const rawStatus: AgencyComplianceStatus = hasLessDisruptiveAnalysis
      ? "COMPLIANT_ON_AVAILABLE_EVIDENCE"
      : hasRemovalWithoutAlternatives
        ? "INSUFFICIENT_EVIDENCE"
        : "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";

    const complianceStatus = enforceMissingDocumentNeutralityGuard({
      proposedStatus: rawStatus,
      hasAffirmativeEvidenceOfConductOrOmission: false,
      isSolelyMissingDocumentInUpload: !hasLessDisruptiveAnalysis,
    });

    const authorityId = "CYFSA:101(2)";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Before making a protection order under s. 101(1), the court shall ask what efforts the society or another person or entity has made to assist the child before intervention, and under s. 101(3) shall not make an order removing the child unless satisfied that less disruptive alternatives would be inadequate.",
    );

    items.push({
      itemId: "MATRIX-LAW-01-LESS-DISRUPTIVE",
      category: "LAW_AND_PROCEDURE",
      title: "Mandatory Assessment of Pre-Intervention Assistance & Less Disruptive Alternatives",
      authority: {
        authorityId,
        legalSource: "Child, Youth and Family Services Act, 2017, S.O. 2017, c. 14, Sched. 1",
        exactSectionOrStandard: "s. 101(2), s. 101(3), s. 94(4), s. 100(a)–(c)",
        effectiveDate: "2018-04-30",
        legalForce: "MANDATORY_STATUTORY",
        applicabilityConditions:
          "Applies to every dispositional protection hearing under CYFSA s. 101 and interim care analysis under s. 94(4).",
        exceptions:
          "Where immediate child safety cannot be protected adequately through non-residential services, supervision conditions (s. 94(5) / s. 101(6)), or kinship placement (s. 94(2)(c) / s. 101(4)).",
      },
      obligation: {
        responsibleParty: "CAS_AGENCY",
        requiredAction:
          "Detail in the Plan of Care (s. 100) and court evidence what efforts were made to assist the child before intervention (s. 101(2)) and why less disruptive alternatives—including non-residential services and a supervision order—would or would not adequately protect the child (s. 101(3)).",
        triggeringEvent:
          "Commencement of protection application, temporary care motion (s. 94), or dispositional hearing (s. 101).",
        deadline: "Prior to or at the temporary care / dispositional hearing.",
        requiredDocumentation:
          "Society Plan of Care (CYFSA s. 100) and supporting sworn affidavit.",
        availableDiscretion:
          "Selection of specific community services is tailored to the family's assessed risk, but the statutory inquiry under s. 101(2)–(3) is mandatory.",
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "CAS Worker / Author of Uploaded Record",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: hasLessDisruptiveAnalysis
          ? ["Uploaded text references assistance efforts or supervision consideration."]
          : [],
        contradictoryEvidence: [],
        evidenceLimitations:
          "Assessment is limited to the uploaded document excerpt; separate service logs or prior Plans of Care may exist in the complete CAS file.",
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: hasLessDisruptiveAnalysis
          ? "The uploaded record contains discussion of assistance efforts or less disruptive alternatives. Verify whether the concrete reasons why in-home services or supervision were adequate or inadequate are fully supported by primary case notes."
          : "The uploaded excerpt does not set out a complete record of pre-intervention assistance efforts under CYFSA s. 101(2) or an itemized comparison of less disruptive alternatives under s. 101(3). Missing documentation in a single uploaded excerpt does not prove those steps did not occur, but requires disclosure of the full Plan of Care and case notes.",
        missingInformation: [
          "Complete Society Plan of Care under CYFSA s. 100",
          "Chronology of pre-intervention referrals and non-residential support offers",
          "Specific safety analysis explaining why supervision conditions under s. 94(5) or s. 101(6) were or were not sufficient",
        ],
        exceptionsConsidered: [
          "Immediate acute safety threat where in-home safety plan could not mitigate imminent risk of harm",
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty:
          "High confidence in statutory authority (CYFSA ss. 94(4), 100, 101(2)–(3)); factual completeness depends on full file disclosure.",
        suggestedFollowUpQuestions: [
          "What specific non-residential services or in-home supports were offered to the parent prior to or instead of removal under CYFSA s. 101(2)–(3)?",
          "What concrete supervision terms under CYFSA s. 94(5) or s. 101(6) were considered, and what documented evidence showed they would be inadequate?",
        ],
        potentialOversightPathway: buildOversightPathwaySummary("PATHWAY-COURT-PROCEDURAL-REMEDIES"),
      },
      presentation: {
        educationalMode: {
          whatRuleRequires:
            "Before a court orders a child removed from a parent's care under CYFSA s. 101, the court must look at what help CAS or other services offered before stepping in (s. 101(2)), and whether less disruptive steps—like support services in the home or a supervision order—could keep the child safe (s. 101(3)).",
          whyItAppliesOrMayNotApply:
            "This rule applies whenever CAS asks a court to place or keep a child out of a parent's care, though urgent safety risks can justify temporary protective placement when in-home conditions cannot keep the child safe.",
          whatDocumentShows: `In ${span.paragraphOrSpan} (Page ${span.page}), the uploaded record states: "${span.excerpt}"`,
          whatIsMissing:
            "The complete Plan of Care (CYFSA s. 100) and case notes showing each support service considered or offered before removal.",
          questionsToAskNext: [
            "What community or in-home supports were considered before seeking removal?",
            "Why would a supervision order with safety conditions not be enough to protect the child?",
          ],
        },
        courtroomMode: {
          relevantRuleAndAuthority:
            "Pursuant to CYFSA s. 101(2)–(3) and s. 100(a), (c)(i), the court must inquire into pre-intervention efforts to assist the child and must be satisfied that less disruptive alternatives, including non-residential services, would be inadequate before making a removal order (see also s. 94(4) at the interim stage).",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency:
            hasLessDisruptiveAnalysis
              ? "Verify underlying primary referral records and collateral notes corroborating the summary assertions in the uploaded record."
              : "The uploaded record does not contain a complete itemized account of pre-intervention assistance under s. 101(2) or why less disruptive supervision terms under s. 94(5)/101(6) were rejected.",
          targetedDisclosureOrClarificationRequest: [
            "Request disclosure of all intake, investigation, and ongoing case notes recording pre-intervention services offered under CYFSA s. 101(2).",
            "Request the complete Society Plan of Care prepared pursuant to CYFSA s. 100(a) and s. 100(c)(i).",
          ],
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // ITEM 2: CAS_ACCOUNTABILITY — Supervisory Consultation, Approvals & Case Notes (OCPS 2016 All Phases & Standards 1–8)
  // --------------------------------------------------------------------------
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:supervisor|supervisory|case\s+note|approved\s+by|safety\s+assessment|risk\s+assessment)\b/i,
      ],
      "Supervisory consultation sign-offs and contemporaneous case-note metadata are not fully set out in this excerpt.",
    );
    const hasSupervisorMention = /\b(?:supervisor|supervisory\s+consult(?:ation)?|approved\s+by\s+supervisor)\b/i.test(
      combinedText,
    );

    const complianceStatus = enforceMissingDocumentNeutralityGuard({
      proposedStatus: hasSupervisorMention
        ? "PARTIAL_COMPLIANCE"
        : "NOT_DOCUMENTED_IN_UPLOADED_RECORDS",
      hasAffirmativeEvidenceOfConductOrOmission: false,
      isSolelyMissingDocumentInUpload: !hasSupervisorMention,
    });

    const authorityId = "OCPS:ALL_PHASES";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Across all phases of child protection service delivery, workers must consult with a supervisor at key decision points, obtain supervisory approval for mandatory assessments and departures from standards, and maintain contemporaneous case notes.",
    );

    items.push({
      itemId: "MATRIX-ACC-01-SUPERVISION-AND-RECORDS",
      category: "CAS_ACCOUNTABILITY",
      title: "Mandatory Supervisory Consultation, Approvals & Contemporaneous Case-Note Standards",
      authority: {
        authorityId,
        legalSource: "Ontario Child Protection Standards (2016) & O. Reg. 156/18, s. 1",
        exactSectionOrStandard:
          "OCPS (2016) Standards Applying Across All Phases of Service Delivery; Standards 1–8; O. Reg. 156/18, s. 1",
        effectiveDate: "2016-01-01",
        legalForce: "MANDATORY_STANDARD",
        applicabilityConditions:
          "Applies across all child protection investigations and ongoing service cases conducted by an Ontario Children's Aid Society.",
        exceptions:
          "Departures from prescribed timelines are permitted only where the worker consults with a supervisor, obtains supervisory approval, and documents the rationale in the case record.",
      },
      obligation: {
        responsibleParty: "CAS_SUPERVISOR",
        requiredAction:
          "Review and approve safety assessments, risk assessments, verification/disposition decisions, initial and revised Service Plans, case closures, and any departures from standards; ensure contemporaneous case notes record date/time, method of contact, participants, observations, worker identity, creation date, and supervisory consultations.",
        triggeringEvent:
          "Key decision points across Standards 1–8 and at least every 6 weeks during ongoing service.",
        deadline:
          "At each mandatory decision point and within the prescribed standard timeframe (or documented supervisory-approved departure).",
        requiredDocumentation:
          "Supervisor approval signatures/timestamps and contemporaneous case notes in the electronic case management system.",
        availableDiscretion:
          "Supervisors have professional authority to approve departures from standard timelines where justified by case-specific circumstances and documented in writing.",
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "CAS Worker / Supervisor",
        exactExcerpt: span.excerpt,
        corroboratingEvidence:
          caseNoteEval.presentElements.length > 0
            ? [
                `Case-note completeness check identified ${caseNoteEval.presentElements.length}/9 standard elements in the uploaded text.`,
              ]
            : [],
        contradictoryEvidence: [],
        evidenceLimitations:
          caseNoteEval.distinctionNote,
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: hasSupervisorMention
          ? `The uploaded record references supervisory involvement, and ${caseNoteEval.presentElements.length} of 9 standard recordkeeping elements appear in the text. However, complete supervisory sign-off logs and original note-creation timestamps (${caseNoteEval.missingElements.join(", ") || "none"}) require verification against the primary file.`
          : "Supervisory consultation approvals and full contemporaneous case-note metadata (such as original note-creation timestamps vs. event dates) are not documented in the uploaded excerpt. Under the missing-document neutrality rule, this is classified as NOT_DOCUMENTED_IN_UPLOADED_RECORDS rather than a confirmed breach.",
        missingInformation: [
          "Supervisory consultation notes and sign-off timestamps for Safety Assessment, Risk Assessment, and Service Plan",
          "Original electronic entry creation dates vs. contact dates for case notes",
          "Documentation of any supervisory-approved departures from OCPS (2016) timelines",
        ],
        exceptionsConsidered: [
          "Supervisory-approved timeline modifications documented in the internal CPIN/case management file",
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty:
          "Verified against OCPS (2016) Standards Applying Across All Phases and O. Reg. 156/18, s. 1.",
        suggestedFollowUpQuestions: [
          "Were the Safety Assessment, Risk Assessment, and Service Plan reviewed and approved by a supervisor within the OCPS (2016) timeframes?",
          "What are the electronic note-creation dates compared to the contact dates for the key observations relied upon?",
        ],
        potentialOversightPathway: buildOversightPathwaySummary("PATHWAY-INTERNAL-CAS-COMPLAINT"),
      },
      presentation: {
        educationalMode: {
          whatRuleRequires:
            "Under the Ontario Child Protection Standards (2016), CAS workers must consult with a supervisor at major decision points, get supervisor approval for key assessments and service plans, and keep accurate, timely case notes.",
          whyItAppliesOrMayNotApply:
            "These standards apply to every CAS investigation and ongoing file in Ontario under O. Reg. 156/18.",
          whatDocumentShows: `At Page ${span.page}, ${span.paragraphOrSpan}: "${span.excerpt}" (${caseNoteEval.presentElements.length}/9 case-note elements visible in this excerpt).`,
          whatIsMissing:
            "Supervisor sign-off records and the original timestamps showing when case notes were written.",
          questionsToAskNext: [
            "When did a supervisor review and approve the assessments and service plan in this file?",
            "Were the case notes written right after the visits occurred, or added later?",
          ],
        },
        courtroomMode: {
          relevantRuleAndAuthority:
            "Pursuant to O. Reg. 156/18, s. 1 and the Ontario Child Protection Standards (2016) (Standards Applying Across All Phases of Service Delivery; Standards 1–8), mandatory assessments, case transfers, service plans, and any departures from prescribed timelines require supervisory consultation and documented approval.",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency:
            "The uploaded document does not include the underlying supervisory approval audit trail or contemporaneous note-entry timestamps (`DATE_OF_NOTE_CREATION` vs. `CONTACT_DATE_AND_TIME`).",
          targetedDisclosureOrClarificationRequest: [
            "Request the supervisory consultation log and approval timestamps for all OCPS Standards 2–7 instruments in the relevant period.",
            "Request unredacted case-note metadata showing author identity, contact date/time, and electronic note-creation date.",
          ],
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // ITEM 3: PARENT_ASSISTANCE — Parenting, Mental Health/Addiction & Non-Funding Statutory Rule (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c) & OCPS Std 7)
  // --------------------------------------------------------------------------
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:counselling|therapy|addiction|substance|mental\s+health|parenting\s+program|referral|waitlist|financial\s+assistance)\b/i,
      ],
      "Specific referral intake records, waitlist tracking, and service accessibility assessments are not fully documented in the uploaded excerpt.",
    );
    const hasSupportOffer =
      /\b(?:referr(?:ed|al)|offered\s+services?|parenting\s+program|counselling\s+referral)\b/i.test(
        combinedText,
      );
    const hasUnaddressedBarrier =
      /\b(?:waitlist|wait\s*list|cannot\s+afford|unaffordable|no\s+transportation)\b/i.test(
        combinedText,
      ) && !/\b(?:alternative\s+referral|subsidized|transit\s+tokens|adjusted\s+plan)\b/i.test(combinedText);

    const rawStatus: AgencyComplianceStatus = hasUnaddressedBarrier
      ? "PARTIAL_COMPLIANCE"
      : hasSupportOffer
        ? "COMPLIANT_ON_AVAILABLE_EVIDENCE"
        : "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";

    const complianceStatus = enforceMissingDocumentNeutralityGuard({
      proposedStatus: rawStatus,
      hasAffirmativeEvidenceOfConductOrOmission: hasUnaddressedBarrier,
      isSolelyMissingDocumentInUpload: !hasSupportOffer && !hasUnaddressedBarrier,
    });

    const authorityId = "CYFSA:94(6)";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Under CYFSA s. 94(6)(c), s. 101(7)(c), and s. 116(4)(c), the court shall not require a society to provide financial assistance or to purchase any goods or services under supervision terms and conditions, while CAS coordinates community referrals under s. 100(a) and OCPS Standard 7.",
    );

    items.push({
      itemId: "MATRIX-ASSIST-01-SUPPORT-AND-FUNDING-BOUNDARY",
      category: "PARENT_ASSISTANCE",
      title: "Parent Support Referrals, Accessibility Monitoring & Statutory Non-Funding Rule",
      authority: {
        authorityId,
        legalSource:
          "Child, Youth and Family Services Act, 2017, ss. 35(1)(b), 94(6)(c), 100(a), 101(2), 101(7)(c), 116(4)(c); OCPS (2016) Standard 7",
        exactSectionOrStandard:
          "CYFSA ss. 35(1)(b), 94(6)(c), 100(a), 101(2), 101(7)(c), 116(4)(c); OCPS Standard 7",
        effectiveDate: "2018-04-30",
        legalForce: "MANDATORY_STATUTORY",
        applicabilityConditions:
          "Applies whenever CAS identifies parenting, mental health, trauma, domestic violence, substance use, or housing needs as relevant to child protection risk or supervision conditions.",
        exceptions:
          "EXPRESS STATUTORY LIMIT: Under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c), a court SHALL NOT order a society to provide financial assistance or purchase goods or services as a term of supervision.",
      },
      obligation: {
        responsibleParty: "CAS_WORKER",
        requiredAction:
          "Specify in the Plan of Care (s. 100(a)) and OCPS Standard 7 Service Plan the services to be provided to remedy the protection concern, make concrete referrals to publicly funded or accessible community programs, and monitor waitlists or barriers—while recognizing that a court cannot order CAS to purchase private services under ss. 94(6)(c), 101(7)(c), or 116(4)(c).",
        triggeringEvent:
          "Identification of caregiver support needs during investigation or ongoing service.",
        deadline:
          "Within the 30-day initial Service Plan cycle (OCPS Standard 7) and ongoing across 6-month case reviews.",
        requiredDocumentation:
          "Service Plan goals/referrals, referral transmission logs, and case notes documenting accessibility and barrier problem-solving.",
        availableDiscretion:
          "CAS has operational discretion regarding whether to voluntarily fund an external service from agency budgets, but referrals to accessible community services under the Service Plan are a mandatory OCPS Standard 7 requirement.",
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "CAS Worker",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: hasSupportOffer
          ? ["Uploaded record contains references to services or referrals."]
          : [],
        contradictoryEvidence: hasUnaddressedBarrier
          ? ["Uploaded record notes waitlist, cost, or transportation barriers without documented plan adjustment."]
          : [],
        evidenceLimitations:
          "Referral letters and collateral intake forms may be stored separately from the uploaded document.",
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning: hasUnaddressedBarrier
          ? "The uploaded record indicates that a service or expectation was discussed, but accessibility barriers (such as waitlist, cost, or transportation) appear without documented adjustment of the Service Plan. Note that while a court cannot order CAS to purchase private services (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c)), OCPS Standard 7 requires coordinating accessible community referrals and monitoring barriers."
          : hasSupportOffer
            ? "The uploaded record documents service or referral activity. Confirm whether the referred programs were practically accessible (waitlists, cost, hours, language/cultural fit) and linked to clear behavioural goals."
            : "Concrete referral records and accessibility assessments for parent support services are not documented in the uploaded excerpt (`NOT_DOCUMENTED_IN_UPLOADED_RECORDS`).",
        missingInformation: [
          "Dates and intake confirmations for each community referral made by CAS",
          "Documentation of waitlist lengths, program cost (OHIP/public vs. private pay), and transportation/scheduling feasibility",
          "Whether the Service Plan distinguished mandatory safety requirements from discretionary recommendations",
        ],
        exceptionsConsidered: [
          "Statutory prohibition on court orders requiring CAS to provide financial assistance or purchase goods or services (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c))",
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty:
          "High confidence in statutory boundary (ss. 94(6)(c), 101(7)(c), 116(4)(c)) and OCPS Standard 7 referral standards.",
        suggestedFollowUpQuestions: [
          "Which publicly funded or community-accessible programs were referred to address the identified protection concerns?",
          "If a recommended program had a waitlist or private fee, what accessible interim alternative was incorporated into the Service Plan?",
        ],
        potentialOversightPathway: buildOversightPathwaySummary("PATHWAY-CFSRB-SECTION-120"),
      },
      presentation: {
        educationalMode: {
          whatRuleRequires:
            "CAS must set out in its Plan of Care and Service Plan what services will help address the protection concerns (CYFSA s. 100(a); OCPS Standard 7) and help connect parents with accessible community programs. At the same time, Ontario law (CYFSA ss. 94(6)(c), 101(7)(c), 116(4)(c)) says a court cannot order CAS to give financial assistance or buy private goods or services under a supervision order.",
          whyItAppliesOrMayNotApply:
            "This applies whenever CAS expects a parent to complete parenting, mental health, counselling, or addiction programs to safely care for their child.",
          whatDocumentShows: `At Page ${span.page}, ${span.paragraphOrSpan}: "${span.excerpt}"`,
          whatIsMissing:
            "Details on when referrals were sent, whether the programs were free/publicly funded, how long the waitlist was, and how barriers were handled.",
          questionsToAskNext: [
            "Were publicly funded (free) community referrals made for each program CAS asked the parent to complete?",
            "How did CAS adjust the timeline if the parent was placed on a community waitlist?",
          ],
        },
        courtroomMode: {
          relevantRuleAndAuthority:
            "Under CYFSA s. 100(a) and s. 101(2), together with OCPS (2016) Standard 7, the society must specify the services to be provided to remedy the protection concern and coordinate referrals to accessible services, subject to the statutory limitation in CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c) that a court shall not require the society to provide financial assistance or purchase goods or services.",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency:
            "The uploaded record does not fully establish referral transmission dates, waitlist duration, or whether any demanded assessment/treatment required private payment unavailable to the parent.",
          targetedDisclosureOrClarificationRequest: [
            "Request copies of all referral packages transmitted by the society and all collateral responses regarding waitlists and program eligibility.",
            "Clarify which expectations in the Service Plan are mandatory safety requirements versus discretionary recommendations.",
          ],
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // ITEM 4: REUNIFICATION — Standard 7 (18-Component Ongoing Case Management, 30-Day Service Plan Rule) & CYFSA s. 122(1) Time-in-Care Limits
  // --------------------------------------------------------------------------
  {
    const span = extractFirstMatchingSpan(
      combinedText,
      [
        /\b(?:service\s+plan|reunification|return\s+of\s+the\s+child|plan\s+of\s+care|status\s+review|12\s+months|24\s+months|case\s+review|access|kinship)\b/i,
      ],
      "Ongoing Service Plan timelines, 6-month formal case reviews, and reunification criteria are not fully set out in the uploaded excerpt.",
    );

    let std7ComplianceStatus: AgencyComplianceStatus = "NOT_DOCUMENTED_IN_UPLOADED_RECORDS";
    if (standard7DeadlineAssessment.withinThirtyDayStandard === true) {
      std7ComplianceStatus = "COMPLIANT_ON_AVAILABLE_EVIDENCE";
    } else if (standard7DeadlineAssessment.withinThirtyDayStandard === false) {
      std7ComplianceStatus = "POTENTIAL_NONCOMPLIANCE";
    } else if (standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE") {
      std7ComplianceStatus = "INSUFFICIENT_EVIDENCE";
    }

    const authorityId = "OCPS:STD_7";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Under OCPS (2016) Standard 7, the initial Service Plan must be developed with the family within 30 days of completion of the investigation or transfer to ongoing services, with minimum monthly home contact and formal case reviews every 6 months.",
    );

    items.push({
      itemId: "MATRIX-REUNIF-01-STD7-AND-S122",
      category: "REUNIFICATION",
      title:
        "Standard 7 Ongoing Service Plan (30-Day Rule from Investigation Completion/Transfer), 6-Month Reviews & CYFSA s. 122 Time Limits",
      authority: {
        authorityId,
        legalSource:
          "Ontario Child Protection Standards (2016) Standard 7; Child, Youth and Family Services Act, 2017, ss. 100(b)(i), 104(1), 113(1), 122(1), 122(5)",
        exactSectionOrStandard:
          "OCPS (2016) Standard 7 (18 Ongoing Case Management Elements); CYFSA ss. 100(b)(i), 104(1), 113(1), 122(1), 122(5)",
        effectiveDate: "2016-01-01",
        legalForce: "MANDATORY_STANDARD",
        applicabilityConditions:
          "Applies to all ongoing child protection cases and all cases where a child is in temporary care with a reunification or permanency plan.",
        exceptions:
          "Departures from the 30-day initial Service Plan timeline require supervisory approval and documented reasons. Under CYFSA s. 122(5), the court may extend the s. 122(1) 12-month (under age 6) or 24-month (age 6+) cumulative time-in-care limit by up to 6 months in the child's best interests.",
      },
      obligation: {
        responsibleParty: "CAS_WORKER_AND_SUPERVISOR",
        requiredAction:
          "Complete the Family and Child Strengths and Needs Assessment and initial Service Plan with parent participation within 30 days of investigation completion or case transfer (never measured from removal date alone); specify clear behavioural goals, responsible persons, timeframes, and reunification conditions (CYFSA s. 100(b)(i)); conduct minimum monthly home visits and formal 6-month case reviews; and track cumulative time in care under CYFSA s. 122(1) (12 months for under 6; 24 months for 6+).",
        triggeringEvent:
          "Completion of child protection investigation (Standard 6) or transfer of the case to ongoing protection services (Standard 7).",
        deadline:
          standard7DeadlineAssessment.calculatedDeadlineDate
            ? `30 days from ${standard7DeadlineAssessment.triggerEventUsed === "CASE_TRANSFER" ? "case transfer" : "investigation completion"} (${standard7DeadlineAssessment.triggerDate}) -> ${standard7DeadlineAssessment.calculatedDeadlineDate}`
            : "DEADLINE_NOT_DETERMINABLE from uploaded records (requires investigation completion or case transfer date; cannot be calculated from removal date alone).",
        requiredDocumentation:
          "Family and Child Strengths and Needs Assessment, signed initial Service Plan, 6-month Formal Case Reviews, Risk Reassessments, and court Plan of Care (CYFSA s. 100(b)(i)).",
        availableDiscretion:
          "Supervisory-approved timeline departures under OCPS Standard 7; discretionary judicial extension of up to 6 months under CYFSA s. 122(5).",
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: standard7DeadlineAssessment.triggerDate,
        recordDate: standard7DeadlineAssessment.servicePlanCompletionDate,
        author: "CAS Ongoing Worker & Supervisor",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: [standard7DeadlineAssessment.explanation],
        contradictoryEvidence: [],
        evidenceLimitations: standard7DeadlineAssessment.cautionNote,
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus: std7ComplianceStatus,
        reasoning: `${standard7DeadlineAssessment.explanation} Additionally, under CYFSA s. 100(b)(i), where the society intends for a child to return to a parent, the Plan of Care must state the specific changes required before the child can return, and cumulative temporary care is governed by CYFSA s. 122(1) (12 months if under 6; 24 months if 6 or older, subject to a discretionary extension of up to 6 months under s. 122(5)).`,
        missingInformation: [
          ...(standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE"
            ? ["Exact date of investigation completion (Standard 6) or transfer to ongoing services (Standard 7)"]
            : []),
          ...(standard7DeadlineAssessment.servicePlanCompletionDate === null
            ? ["Signed and supervisor-approved initial ongoing Service Plan with completion date"]
            : []),
          "Family and Child Strengths and Needs Assessment and 6-month Formal Case Reviews",
          "Calculation of cumulative days/months in care under CYFSA s. 122(1)–(2)",
        ],
        exceptionsConsidered: [
          "Supervisory-approved departure from the 30-day Service Plan timeline under OCPS (2016) Standard 7",
          "Discretionary court extension of up to 6 months under CYFSA s. 122(5)",
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty:
          standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE"
            ? "DEADLINE_NOT_DETERMINABLE: Trigger date (investigation completion or case transfer) is absent from the uploaded record."
            : "Deterministic 30-day timeline calculation verified against OCPS (2016) Standard 7.",
        suggestedFollowUpQuestions: [
          "On what exact date was the investigation completed or the file transferred to ongoing services, and on what date was the initial Service Plan approved by a supervisor?",
          "Were the parents invited to participate in developing the Service Plan and provided with a copy under OCPS Standard 7?",
          "What specific, measurable behavioural changes are required for the return of the child under CYFSA s. 100(b)(i)?",
        ],
        potentialOversightPathway: buildOversightPathwaySummary("PATHWAY-INTERNAL-CAS-COMPLAINT"),
      },
      presentation: {
        educationalMode: {
          whatRuleRequires:
            "Under OCPS (2016) Standard 7, CAS must work with the family to create an initial Service Plan within 30 days of when the investigation ends or the case transfers to ongoing service (not measured from the removal date alone). CAS must also review the plan every 6 months, visit at least monthly, and clearly explain what changes are needed for a child to return home within Ontario's 12-month (under age 6) or 24-month (age 6+) time-in-care limits (CYFSA s. 122(1)).",
          whyItAppliesOrMayNotApply:
            "This rule applies to every ongoing protection file and reunification plan.",
          whatDocumentShows: `${standard7DeadlineAssessment.explanation} Excerpt (${span.paragraphOrSpan}, Page ${span.page}): "${span.excerpt}"`,
          whatIsMissing:
            "The exact investigation completion / case transfer date, the signed initial Service Plan, and the 6-month formal case reviews.",
          questionsToAskNext: [
            "What date was the case transferred to ongoing services, and when was the first Service Plan signed?",
            "What exact steps must be completed for the child to return home or for visits to become less supervised?",
          ],
        },
        courtroomMode: {
          relevantRuleAndAuthority:
            "Pursuant to OCPS (2016) Standard 7 (prescribed by O. Reg. 156/18, s. 1), the initial Service Plan must be completed within 30 days of investigation completion or case transfer, informed by a Family and Child Strengths and Needs Assessment, with formal reviews at least every 6 months. Under CYFSA s. 100(b)(i) and s. 122(1), (5), the Plan of Care must specify the changes required for return of the child within the 12-month (under age 6) or 24-month (age 6+) statutory ceiling (subject to up to a 6-month extension under s. 122(5)).",
          documentedFactAndAttribution: `${standard7DeadlineAssessment.explanation} Reference: Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle} ("${span.excerpt}").`,
          evidentialGapOrInconsistency:
            standard7DeadlineAssessment.deadlineStatus === "DEADLINE_NOT_DETERMINABLE"
              ? "The 30-day Standard 7 deadline is `DEADLINE_NOT_DETERMINABLE` on the current record because the investigation completion/transfer trigger date is not disclosed."
              : standard7DeadlineAssessment.explanation,
          targetedDisclosureOrClarificationRequest: [
            "Request the OCPS Standard 6 Investigation Conclusion / Case Transfer record establishing the trigger date for the 30-day Standard 7 Service Plan.",
            "Request all initial and 6-month revised Service Plans, Family and Child Strengths and Needs Assessments, and Risk Reassessments.",
          ],
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // ITEM 5: EVIDENCE_AND_CONTRADICTIONS — Affidavit Evidence Rule (FLR r. 14(18)-(19)) & Professional Registration Verification (SWSSWA ss. 46-47)
  // --------------------------------------------------------------------------
  {
    const firstContradiction = (report.contradictions || [])[0];
    const span = firstContradiction
      ? {
          excerpt: `${firstContradiction.claim || ""} vs. ${firstContradiction.counterEvidence || ""}`.trim(),
          page: firstContradiction.sourcePage || 1,
          paragraphOrSpan: firstContradiction.paragraphReference || "Contradiction Span",
        }
      : extractFirstMatchingSpan(
          combinedText,
          [
            /\b(?:affidavit|sworn|believed|hearsay|informed\s+by|registered\s+social\s+worker|rsw|ocswssw)\b/i,
          ],
          "Evaluate whether statements in court materials distinguish personal knowledge from sourced information and belief.",
        );

    const hasUnsourcedHearsayIndicator =
      /\b(?:it\s+was\s+reported\s+that|sources?\s+indicated|concerns?\s+were\s+raised\s+that)\b/i.test(
        combinedText,
      );
    const hasContradictions = (report.contradictions || []).length > 0;

    const complianceStatus: AgencyComplianceStatus =
      hasContradictions || hasUnsourcedHearsayIndicator
        ? "REQUIRES_LEGAL_REVIEW"
        : "INSUFFICIENT_EVIDENCE";

    const authorityId = "FLR:RULE_14";
    const verificationStatus = verifyMatrixAuthority(
      authorityId,
      "Under Family Law Rules r. 14(18) and r. 14(19), an affidavit shall contain only facts within the personal knowledge of the person signing it unless the source of the information and the fact of belief are specified.",
    );

    items.push({
      itemId: "MATRIX-EVID-01-AFFIDAVIT-AND-REGISTRATION",
      category: "EVIDENCE_AND_CONTRADICTIONS",
      title:
        "Affidavit Personal Knowledge / Sourced Belief Rule (FLR r. 14(18)–(19)) & OCSWSSW Registration Scope",
      authority: {
        authorityId,
        legalSource:
          "Family Law Rules, O. Reg. 114/99, r. 14(18)–(19); Social Work and Social Service Work Act, 1998, S.O. 1998, c. 31, ss. 46–47",
        exactSectionOrStandard: "O. Reg. 114/99, r. 14(18)–(19); SWSSWA 1998, ss. 46–47",
        effectiveDate: "1999-09-15",
        legalForce: "MANDATORY_STATUTORY",
        applicabilityConditions:
          "FLR r. 14(18)–(19) applies to all affidavits filed on motions in child protection proceedings. OCSWSSW standards apply where the worker is a registered member of the College or uses restricted titles ('social worker', 'registered social worker', 'social service worker').",
        exceptions:
          "Not every CAS child protection worker is statutorily required to be registered with the OCSWSSW unless they use a restricted title or hold themselves out as a social worker / social service worker (SWSSWA ss. 46–47). Factual inaccuracies in an affidavit must not be automatically classified as criminal perjury.",
      },
      obligation: {
        responsibleParty: "CAS_WORKER",
        requiredAction:
          "Confine affidavit evidence to facts within the affiant's personal knowledge or, on a motion, clearly specify the named source of information and the fact of belief (FLR r. 14(18)–(19)); separate direct observation from opinion; and accurately state professional credentials and OCSWSSW registration status if applicable.",
        triggeringEvent:
          "Swearing/affirming a child protection affidavit or recording formal evidentiary statements.",
        deadline: "At the time of commissioning and filing the affidavit or record.",
        requiredDocumentation:
          "Sworn/affirmed affidavit identifying direct observations vs. named collateral sources, commissioned jurat, and accurate professional title.",
        availableDiscretion:
          "None regarding compliance with the rules of evidence and truthful commissioning.",
      },
      evidence: {
        documentId: docId,
        documentTitle: docTitle,
        page: span.page,
        paragraphOrSpan: span.paragraphOrSpan,
        eventDate: options.documentDate ?? null,
        recordDate: options.documentDate ?? null,
        author: "Affiant / Record Author",
        exactExcerpt: span.excerpt,
        corroboratingEvidence: [],
        contradictoryEvidence: (report.contradictions || []).map(
          (c) => `${c.claim || "Claim"} <-> ${c.counterEvidence || "Counter-evidence"}`,
        ),
        evidenceLimitations:
          "Factual disputes between an affidavit and primary records require cross-reference against primary case notes and collateral records; do not label disputed statements as perjury.",
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus,
        reasoning:
          "Under Family Law Rules r. 14(18)–(19), affidavit statements relying on third-party information must identify the source of the information and the fact of belief, and factual summaries must align with contemporaneous primary case notes. Additionally, verify on the OCSWSSW Public Register whether the worker is a registered member before applying OCSWSSW professional discipline rules (SWSSWA ss. 46–47), and remember there is no universal statutory 'CAS worker oath' beyond standard court/affidavit oaths and confidentiality undertakings.",
        missingInformation: [
          "Underlying contemporaneous case notes and collateral records for each second-hand statement in the document",
          "Confirmation of whether the author is registered on the OCSWSSW Public Register",
        ],
        exceptionsConsidered: [
          "Information-and-belief evidence is permissible on a motion under FLR r. 14(19) when both the source of information and fact of belief are explicitly stated",
          "Non-registered CAS workers who do not use restricted titles under SWSSWA ss. 46–47 are governed by CYFSA, OCPS (2016), and internal CAS accountability rather than OCSWSSW discipline",
        ],
        sourceVerificationStatus: verificationStatus,
        confidenceOrUncertainty:
          "High confidence in FLR r. 14(18)–(19) and SWSSWA ss. 46–47 legal standards; evidentiary weight of specific disputed passages is a matter for legal review and the court.",
        suggestedFollowUpQuestions: [
          "For each disputed or second-hand assertion, who is the exact named source of the information and what is the date of the underlying primary note?",
          "Is the worker who authored the record registered with the OCSWSSW on the Public Register?",
        ],
        potentialOversightPathway: buildOversightPathwaySummary("PATHWAY-COURT-PROCEDURAL-REMEDIES"),
      },
      presentation: {
        educationalMode: {
          whatRuleRequires:
            "When a CAS worker signs a court affidavit, Ontario's Family Law Rules (Rule 14(18)–(19)) say they must stick to what they personally saw or heard, or clearly name who told them the information and state that they believe it. Also, while there is no special universal 'CAS worker oath,' workers who use the title 'Social Worker' must be registered with the OCSWSSW.",
          whyItAppliesOrMayNotApply:
            "Rule 14(18)–(19) applies to all court affidavits. OCSWSSW rules apply only if the worker is registered with the College or uses a protected social work title.",
          whatDocumentShows: `At Page ${span.page}, ${span.paragraphOrSpan}: "${span.excerpt}"`,
          whatIsMissing:
            "The original case notes or third-party reports behind summary claims, and confirmation of whether the worker is registered with the OCSWSSW.",
          questionsToAskNext: [
            "Which statements did the worker observe firsthand, and which ones came from someone else?",
            "Do the original case notes match how the event is described in the summary or affidavit?",
          ],
        },
        courtroomMode: {
          relevantRuleAndAuthority:
            "Pursuant to Family Law Rules, O. Reg. 114/99, r. 14(18)–(19), an affidavit shall contain only facts within the personal knowledge of the affiant unless, on a motion, the source of the information and the fact of belief are specified. Professional regulatory jurisdiction under the Social Work and Social Service Work Act, 1998, ss. 46–47 depends on registration status or restricted title use.",
          documentedFactAndAttribution: `At Page ${span.page}, ${span.paragraphOrSpan} of ${docTitle}: "${span.excerpt}"`,
          evidentialGapOrInconsistency:
            hasContradictions
              ? `${(report.contradictions || []).length} internal or documentary tension(s) identified for verification against primary records.`
              : "Verify that all second-hand assertions comply with the source-attribution requirement of FLR r. 14(19) and align with contemporaneous case notes.",
          targetedDisclosureOrClarificationRequest: [
            "Request the primary contemporaneous case notes and third-party source records underlying each contested paragraph.",
            "Where second-hand statements do not identify the source and fact of belief under FLR r. 14(19), seek clarification or evidentiary review by counsel.",
          ],
        },
      },
    });
  }

  // --------------------------------------------------------------------------
  // BUILD C4 15-QUESTION PARENT ASSISTANCE ANALYSES
  // --------------------------------------------------------------------------
  const parentAssistanceAnalyses: ParentAssistance15QuestionAnalysis[] = [
    evaluateParentAssistanceNeed15Questions({
      needId: "PA-NEED-01-PARENTING-AND-PRESERVATION",
      identifiedNeedTitle: "Parenting Support, In-Home Family Preservation & Less Disruptive Alternatives",
      domain: "B2_PARENTING_SUPPORT",
      sourceText: combinedText,
      legalForceClassification: "STANDARDS_BASED",
      relevantPatterns: [
        /\b(?:parenting|supervision|in-home\s+support|family\s+preservation|service\s+plan|less\s+disruptive)\b/i,
      ],
    }),
    evaluateParentAssistanceNeed15Questions({
      needId: "PA-NEED-02-MENTAL-HEALTH-TRAUMA-ADDICTIONS",
      identifiedNeedTitle: "Mental Health, Trauma, Domestic Violence & Substance Use Support",
      domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
      sourceText: combinedText,
      legalForceClassification: "STANDARDS_BASED",
      relevantPatterns: [
        /\b(?:mental\s+health|counselling|therapy|trauma|domestic\s+violence|substance|addiction|relapse|treatment)\b/i,
      ],
    }),
    evaluateParentAssistanceNeed15Questions({
      needId: "PA-NEED-03-HOUSING-KINSHIP-AND-CONTACT",
      identifiedNeedTitle: "Housing/Basic Necessities Navigation, Kinship Placement & Parent-Child Contact",
      domain: "B5_KINSHIP_AND_FAMILY_NETWORKS",
      sourceText: combinedText,
      legalForceClassification: "LEGALLY_REQUIRED",
      relevantPatterns: [
        /\b(?:housing|rent|shelter|poverty|kinship|relative|grandmother|aunt|access|visit(?:ation|s)?|contact)\b/i,
      ],
    }),
  ];

  // --------------------------------------------------------------------------
  // COMPUTE SUMMARY COUNTS
  // --------------------------------------------------------------------------
  const summaryCounts: ComplianceMatrixSummaryCounts = {
    totalItemsEvaluated: items.length,
    compliantOnAvailableEvidenceCount: items.filter(
      (i) => i.assessment.complianceStatus === "COMPLIANT_ON_AVAILABLE_EVIDENCE",
    ).length,
    potentialNoncomplianceCount: items.filter(
      (i) => i.assessment.complianceStatus === "POTENTIAL_NONCOMPLIANCE",
    ).length,
    partialComplianceCount: items.filter(
      (i) => i.assessment.complianceStatus === "PARTIAL_COMPLIANCE",
    ).length,
    notDocumentedInUploadedRecordsCount: items.filter(
      (i) => i.assessment.complianceStatus === "NOT_DOCUMENTED_IN_UPLOADED_RECORDS",
    ).length,
    insufficientEvidenceCount: items.filter(
      (i) => i.assessment.complianceStatus === "INSUFFICIENT_EVIDENCE",
    ).length,
    notApplicableCount: items.filter(
      (i) => i.assessment.complianceStatus === "NOT_APPLICABLE",
    ).length,
    exceptionMayApplyCount: items.filter(
      (i) => i.assessment.complianceStatus === "EXCEPTION_MAY_APPLY",
    ).length,
    requiresLegalReviewCount: items.filter(
      (i) => i.assessment.complianceStatus === "REQUIRES_LEGAL_REVIEW",
    ).length,
    byCategory: {
      LAW_AND_PROCEDURE: items.filter((i) => i.category === "LAW_AND_PROCEDURE").length,
      CAS_ACCOUNTABILITY: items.filter((i) => i.category === "CAS_ACCOUNTABILITY").length,
      PARENT_ASSISTANCE: items.filter((i) => i.category === "PARENT_ASSISTANCE").length,
      REUNIFICATION: items.filter((i) => i.category === "REUNIFICATION").length,
      EVIDENCE_AND_CONTRADICTIONS: items.filter(
        (i) => i.category === "EVIDENCE_AND_CONTRADICTIONS",
      ).length,
    },
  };

  return {
    matrixVersion: "2.0.0",
    generatedAtIso: new Date().toISOString(),
    documentTitle: docTitle,
    standard7DeadlineAssessment,
    caseNoteCompletenessSummary: {
      presentElementsCount: caseNoteEval.presentElements.length,
      missingElementsCount: caseNoteEval.missingElements.length,
      missingElementCodes: caseNoteEval.missingElements,
      distinctionNote: caseNoteEval.distinctionNote,
    },
    items,
    parentAssistanceAnalyses,
    summaryCounts,
    neutralityAndMethodologyDisclaimer:
      "NEUTRAL LEGAL INTELLIGENCE NOTICE: This Agency Compliance & Evidence Matrix compares verified Ontario statutory and operational authorities against the uploaded document excerpts. It does not presume either that CAS complied or that CAS committed wrongdoing. Where records are absent from an upload, the item is classified as NOT_DOCUMENTED_IN_UPLOADED_RECORDS or INSUFFICIENT_EVIDENCE rather than a confirmed breach. Review all findings with qualified Ontario child protection legal counsel.",
  };
}

/**
 * Helper exposing the total count of interconnected Milestone 2 rules across Libraries A, B, and Standard 7.
 */
export function getMilestone2KnowledgeBaseInventorySummary() {
  return {
    casAccountabilityRulesCount: ALL_CAS_ACCOUNTABILITY_RULES.length,
    oversightPathwaysCount: A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS.length,
    parentAssistanceRulesCount: ALL_PARENT_ASSISTANCE_RULES.length,
    standard7ComponentsCount: STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS.length,
    supportedComplianceStatuses: VALID_COMPLIANCE_STATUSES,
    supportedParentAssistanceStatuses: VALID_PARENT_ASSISTANCE_STATUSES,
  };
}
