/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PrimarySourceLink {
  label: string;
  url: string;
  citation?: string;
}

export interface CYFSATopic {
  id: string;
  title: string;
  badge?: string;
  category: "Removal" | "Protection Grounds" | "Worker Authority" | "Rights" | "Evidence Rules" | "Timelines" | "Syllabi & Community";
  summary: string;
  fullBody: string;
  primarySources: PrimarySourceLink[];
  guidelines: string[];
  checklistItems: {
    label: string;
    description: string;
  }[];
  factVersusFiction: {
    fact: string;
    fiction: string;
    sourceExplanation: string;
  }[];
}

export interface CourtStep {
  id: string;
  title: string;
  stage: "Pre-Court" | "Early Stage" | "Mid-Hearing" | "Resolution & Final";
  timelineLimit?: string;
  description: string;
  purpose: string;
  ruleReference: string; // Family Law Rules references
  officialForms: {
    name: string;
    formNumber: string;
    officialUrl: string;
  }[];
  watchpoints: string[];
}

export interface ResearchSummary {
  id: string;
  title: string;
  authorYear: string;
  category: "Attachment Disruption" | "Short & Long-term Trauma" | "Reunification Success" | "Systemic Factors";
  keyFindings: string[];
  evidenceSummary: string;
  sourceCitation: string;
  pubMedOrCanLiiLink?: string;
}

// Analysis response types representing the Claude outputs
export interface AnalysisReport {
  analysisDate: string;
  documentTitle: string;
  documentType: string;
  disclaimer: string;
  completenessScore: number; // 0 to 100 educational score
  fileSummary?: string; // Concise executive summary of the document
  metadata?: {
    fileNumber?: string;
    applicantName?: string;
    respondentName?: string;
    childNames?: string;
    hearingDate?: string;
  };
  redFlags: {
    id: string;
    severity: string;
    category: string;
    phraseDetected: string;
    explanation: string;
    verifyRequirement: string;
    legalReference: string; // Cites sections of CYFSA or Family Law Rules
    locationInDocument?: string; // Exact page or section location where violation is found
    parentActionStep?: string; // Step-by-step visual instruction for parents to debunk this violation
  }[];
  thresholdAnalysis: {
    thresholdChecked: string;
    isMet: "Yes" | "No" | "Inconclusive";
    reasoning: string;
    primarySourceLaw: string;
  }[];
  proceduralTimelineViolations: {
    timelineRule: string;
    documentAssertion: string;
    evaluation: string;
    citation: string;
    locationInDocument?: string; // Exact page or section location where violation is found
    parentActionStep?: string; // Step-by-step action step for parents to dispute this rule violation
  }[];
  charterAndHumanRightsIssues: string[];
  whatToVerify: string[];
  whatToAskALawyer: string[];
  whatIsMissing: string[];
  lawyerCaseBrief?: string[]; // Bullet form detailed lawyer case brief points
  customAnalysisNotes?: string;
}

// User Membership types

// Form Builders / Draft Templates Types
export interface AffidavitDraft {
  courtRegistryName: string;
  applicantName: string;
  respondentName: string;
  childNames: string;
  childBirthdates: string;
  authorName: string;
  isDraft: boolean;
  backgroundStatement: string;
  factualEvents: {
    date: string;
    time?: string;
    eventDescription: string;
    unsupportedOrHearsayWarn: boolean; // educational flag
    witnessesOrEvidence: string;
  }[];
  childsPerspectiveText: string;
  proposedCareArrangement: string;
  exhibits: {
    letter: string;
    description: string;
    verifiedWithPrimary: boolean;
  }[];
}

export interface EvidenceLogItem {
  id: string;
  date: string;
  involvedWorkers: string;
  whatHappened: string;
  statementsMade: string;
  hearsayFlag: "Direct Evidence" | "Hearsay (Worker told me)" | "Double Hearsay (Worker said another said)";
  audioPhotoLog?: string;
  questionsForCounsel: string;
}

export interface CaseTimelineItem {
  id: string;
  date: string;
  title: string;
  description: string;
  statutoryDeadline?: string;
  isCourtDate: boolean;
  actionRequired: string;
}

export interface IssueSummarySheet {
  id: string;
  agencyAssertion: string;
  ourParentResponse: string;
  primaryEvidenceWeHave: string;
  missingEvidenceNeeded: string;
}

export interface ParentPrepWorksheet {
  nextHearingDate: string;
  hearingType: string;
  mainEducationalGoals: string;
  topThreePriorities: string[];
  mentalGroundingPlan: string;
  whoIsTakingNotes: string;
}

// B2B Lawyer Directory types
export interface LawyerProfile {
  id: string;
  name: string;
  firm: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  educationNotes: string; // CYFSA knowledge / family defense focus
  languages: string[];
  subscriptionSlot: "Exclusive" | "Priority" | "Standard";
  intakeNote?: string;
}

export interface Form33BAnswer {
  courtRegistryName: string;
  caseNumber: string;
  applicantName: string;
  respondentName: string;
  childNames: string;
  applicationDate: string;
  claimDetails: string;
  agreedFacts: string;
  disagreedFacts: {
    id: string;
    societyStatement: string;
    parentResponse: string;
    supportingEvidence: string;
  }[];
  parentStatementOfFacts: string;
}

export interface PlanOfCare {
  childName: string;
  birthdate: string;
  livingArrangements: string;
  safetySupervision: string;
  educationNeeds: string;
  healthcareDevelopment: string;
  cultureReligion: string;
  contactAccessArrangements: string;
  parentSupportServices: string;
}

export interface SavedDocument {
  id: string;
  userId: string;
  title: string;
  type: 'template' | 'analysis';
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedBrief {
  id: string;
  documentId: string;
  documentTitle: string;
  documentCategory: string;
  savedAt: string;
  notes?: string;
  lawyerCaseBrief: string[];
}


