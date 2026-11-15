// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgencyComplianceMatrixView } from "./AgencyComplianceMatrixView";
import { renderForensicReportHtml } from "../utils/forensicPdfRenderer";
import type { AnalysisReport } from "../types";
import type {
  ComplianceMatrixReport,
  ComplianceMatrixItem,
  ParentAssistance15QuestionAnalysis,
} from "../../shared/complianceMatrixEngine";
import { buildComplianceMatrixFromReport } from "../../shared/complianceMatrixEngine";

afterEach(() => {
  cleanup();
});

describe("Milestone 2 Audit Remediation: AgencyComplianceMatrixView & PDF", () => {
  const createMockMatrix = (overrides?: Partial<ComplianceMatrixReport>): ComplianceMatrixReport => {
    const defaultItem: ComplianceMatrixItem = {
      itemId: "ITEM-1",
      category: "CAS_ACCOUNTABILITY",
      title: "Standard 7 — 30-Day Service Plan Requirement",
      authority: {
        authorityId: "OCPS:STD_7",
        legalSource: "Ontario Child Protection Standards (2016), Standard 7",
        exactSectionOrStandard: "Standard 7",
        effectiveDate: "2016-02-01",
        legalForce: "MINISTRY_STANDARD_MANDATORY",
        applicabilityConditions: "Applies to all open child protection cases transferred to ongoing services.",
        exceptions: "None for initial 30-day plan.",
      },
      obligation: {
        responsibleParty: "CHILD_PROTECTION_WORKER",
        requiredAction: "Complete written collaborative Service Plan within 30 days",
        triggeringEvent: "Case transfer to ongoing services",
        deadline: "30 calendar days",
        requiredDocumentation: "Service plan document signed by worker, supervisor, and parent",
        availableDiscretion: "Limited to service matching within mandated categories",
      },
      evidence: {
        documentId: "DOC-001",
        documentTitle: "Protection Affidavit",
        page: 4,
        paragraphOrSpan: "Para 12",
        eventDate: "2026-08-01",
        recordDate: "2026-08-01",
        author: "Child Protection Worker",
        exactExcerpt: "The worker did not record an initial service plan within 30 days of case transfer.",
        corroboratingEvidence: ["Intake chronology shows transfer date August 1, 2026."],
        contradictoryEvidence: [],
        evidenceLimitations: "Internal supervisory notes not included in disclosure.",
      },
      assessment: {
        applicabilityStatus: "APPLIES",
        complianceStatus: "POTENTIAL_NONCOMPLIANCE",
        reasoning: "Documentary records do not show a completed service plan within 30 days.",
        missingInformation: ["Internal supervisor consultation notes"],
        exceptionsConsidered: [],
        sourceVerificationStatus: "VERIFIED",
        confidenceOrUncertainty: "High",
        suggestedFollowUpQuestions: ["Was an initial service plan approved by a supervisor within 30 days?"],
        potentialOversightPathway: {
          pathwayId: "OVERSIGHT:CFSRB_SERVICE_COMPLAINT_120",
          pathwayName: "Child and Family Services Review Board (CFSRB) Service Complaint",
          statutoryAuthority: "CYFSA s. 120(4)",
          jurisdictionNote: "Board cannot overturn or vary a court order.",
          cannotOverturnCourtOrder: true,
        },
      },
      presentation: {
        educationalMode: {
          whatRuleRequires: "Workers must complete a collaborative service plan within 30 days.",
          whyItAppliesOrMayNotApply: "Case was transferred to ongoing services.",
          whatDocumentShows: "No service plan was recorded in the first 30 days.",
          whatIsMissing: "Internal supervisor consultation notes",
          questionsToAskNext: ["Request a copy of the current service plan in writing."],
        },
        courtroomMode: {
          relevantRuleAndAuthority: "OCPS (2016) Standard 7; CYFSA s. 1(2)",
          documentedFactAndAttribution: "Worker affidavit sworn without attached 30-day service plan.",
          evidentialGapOrInconsistency: "The Society has not filed an initial service plan compliant with Standard 7.",
          targetedDisclosureOrClarificationRequest: ["Produce supervisor approval record for Standard 7 compliance."],
        },
      },
    };

    const defaultAssessment1: ParentAssistance15QuestionAnalysis = {
      needId: "PA-NEED-01-PARENTING-AND-PRESERVATION",
      identifiedNeedTitle: "Parenting Support & Family Preservation",
      domain: "FAMILY_PRESERVATION",
      coexistingStatuses: ["NEED_IDENTIFIED", "SERVICE_OFFERED", "SERVICE_ACCESSIBLE"],
      legalForceClassification: "LEGALLY_REQUIRED",
      statutoryNonFundingRuleTriggered: false,
      statutoryNonFundingExplanation: "",
      pageAndParagraphAttribution: "Page 2, Para 4",
      exactExcerpt: "The worker referred the mother to Triple P Parenting on September 15, 2026.",
      questions: {
        q1_concernIdentifiedByCas: "Alleged lack of positive parenting strategies.",
        q2_rootProblemBehindConcern: "Parental stress and lack of community respite.",
        q3_serviceCouldReduceRisk: "Evidence-based parenting instruction.",
        q4_serviceDiscussedWithParent: "Discussed during home visit September 14.",
        q5_referralOrServiceOffered: "Referred to Triple P program at community centre.",
        q6_whenWasItOffered: "Offered prior to court application.",
        q7_whoWasResponsibleForFollowUp: "Ongoing worker Sarah Jenkins.",
        q8_wasServiceAccessible: "Fully funded community service with child care.",
        q9_didParentParticipateOrAttempt: "Mother attended 3 of 4 sessions.",
        q10_barriersPreventingParticipation: "Transit disruption prevented attendance at session 4.",
        q11_didCasAdjustPlanWhenBarriersAppeared: "Worker provided transit passes for makeup session.",
        q12_wereKinshipOrCommunitySupportsExplored: "Maternal aunt identified as informal respite.",
        q13_howDidAssistanceAffectRiskAndReunification: "Reduced risk score to low; supported supervision order.",
        q14_whatEvidenceSupportsEachAnswer: "Field notes and attendance certificate Exhibit B.",
        q15_whatRecordsAreMissing: "Final completion certificate from service provider.",
      },
    };

    const defaultAssessment2: ParentAssistance15QuestionAnalysis = {
      needId: "PA-NEED-03-HOUSING-AND-BASIC-NECESSITIES",
      identifiedNeedTitle: "Housing & Poverty Remediation",
      domain: "HOUSING_AND_BASIC_NECESSITIES",
      coexistingStatuses: ["NEED_IDENTIFIED", "SERVICE_INACCESSIBLE"],
      legalForceClassification: "LEGALLY_REQUIRED",
      statutoryNonFundingRuleTriggered: true,
      statutoryNonFundingExplanation: "CYFSA s. 94(6)(c) prohibits penalizing parents for inability to pay.",
      pageAndParagraphAttribution: "Page 3, Para 7",
      exactExcerpt: "The mother requested housing stabilization assistance due to rental arrears.",
      questions: {
        q1_concernIdentifiedByCas: "Risk of homelessness due to eviction notice.",
        q2_rootProblemBehindConcern: "Loss of employment and delay in social assistance.",
        q3_serviceCouldReduceRisk: "Emergency rent bank grant.",
        q4_serviceDiscussedWithParent: "Mother raised arrears during intake meeting.",
        q5_referralOrServiceOffered: "Worker gave brochure for housing help centre.",
        q6_whenWasItOffered: "After eviction notice was served.",
        q7_whoWasResponsibleForFollowUp: "Not specified in worker notes.",
        q8_wasServiceAccessible: "Waitlist of 6 weeks exceeded eviction deadline.",
        q9_didParentParticipateOrAttempt: "Mother applied but funds were exhausted.",
        q10_barriersPreventingParticipation: "Program funding depleted for current fiscal quarter.",
        q11_didCasAdjustPlanWhenBarriersAppeared: "No alternative housing funds provided by Society.",
        q12_wereKinshipOrCommunitySupportsExplored: "Grandmother offered temporary shelter.",
        q13_howDidAssistanceAffectRiskAndReunification: "Housing instability cited as sole basis for apprehension.",
        q14_whatEvidenceSupportsEachAnswer: "Eviction notice and intake record.",
        q15_whatRecordsAreMissing: "Society emergency assistance discretionary fund records.",
      },
    };

    return {
      matrixVersion: "2.0.0",
      generatedAtIso: "2026-11-03T18:00:00.000Z",
      documentTitle: "Affidavit of Child Protection Worker",
      standard7DeadlineAssessment: {
        deadlineStatus: "DETERMINED_FROM_CASE_TRANSFER",
        triggerEventUsed: "CASE_TRANSFER",
        triggerDate: "2026-08-01",
        calculatedDeadlineDate: "2026-08-31",
        servicePlanCompletionDate: null,
        daysElapsedToServicePlan: null,
        withinThirtyDayStandard: false,
        explanation: "Service plan was overdue by 64 days relative to Standard 7.",
        cautionNote: "Must have supervisory approval within Standard 7 requirements.",
      },
      caseNoteCompletenessSummary: {
        presentElementsCount: 7,
        missingElementsCount: 2,
        missingElementCodes: ["ELEM_05", "ELEM_08"],
        distinctionNote: "Distinguishes missing notes from non-occurrence.",
      },
      items: [defaultItem],
      parentAssistanceAnalyses: [defaultAssessment1, defaultAssessment2],
      parentAssistanceAnalysis: defaultAssessment1,
      summaryCounts: {
        totalItemsEvaluated: 1,
        compliantOnAvailableEvidenceCount: 0,
        potentialNoncomplianceCount: 1,
        partialComplianceCount: 0,
        notDocumentedInUploadedRecordsCount: 0,
        insufficientEvidenceCount: 0,
        notApplicableCount: 0,
        exceptionMayApplyCount: 0,
        requiresLegalReviewCount: 0,
        byCategory: {
          LAW_AND_PROCEDURE: 0,
          CAS_ACCOUNTABILITY: 1,
          PARENT_ASSISTANCE: 0,
          REUNIFICATION: 0,
          EVIDENCE_AND_CONTRADICTIONS: 0,
        },
      },
      neutralityAndMethodologyDisclaimer:
        "CUSTOM AUDIT DISCLAIMER: Verified against official Ontario authorities. Silence in uploaded records does not prove agency misconduct.",
      missingRecordsWarning:
        "CUSTOM AUDIT DISCLAIMER: Verified against official Ontario authorities. Silence in uploaded records does not prove agency misconduct.",
      ...overrides,
    };
  };

  it("1. Renders the dynamic disclaimer from neutralityAndMethodologyDisclaimer in the UI", () => {
    const mock = createMockMatrix();
    render(<AgencyComplianceMatrixView matrix={mock} />);
    expect(
      screen.getByText(/CUSTOM AUDIT DISCLAIMER: Verified against official Ontario authorities/i)
    ).toBeDefined();
  });

  it("2. Falls back safely to default disclaimer when both dynamic fields are empty", () => {
    const mock = createMockMatrix({
      neutralityAndMethodologyDisclaimer: "",
      missingRecordsWarning: "",
    });
    render(<AgencyComplianceMatrixView matrix={mock} />);
    expect(
      screen.getByText(/Absence of a documented action in uploaded records does not prove the agency breached its duty/i)
    ).toBeDefined();
  });

  it("3. Renders the multi-assessment parent assistance header with domain count", () => {
    const mock = createMockMatrix();
    render(<AgencyComplianceMatrixView matrix={mock} />);
    expect(
      screen.getByText(/Parent Assistance, Family Preservation & Reunification Assessment \(2 Domains Evaluated\)/i)
    ).toBeDefined();
  });

  it("4. Renders multiple assessments independently with interactive tab selection", () => {
    const mock = createMockMatrix();
    render(<AgencyComplianceMatrixView matrix={mock} />);

    // Check first assessment is active by default
    expect(screen.getAllByText(/Parenting Support & Family Preservation/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Alleged lack of positive parenting strategies/i)).toBeDefined();

    // Click tab for second assessment
    const tab2 = screen.getByText(/2. Housing & Poverty Remediation/i);
    fireEvent.click(tab2);

    // Verify second assessment content renders
    expect(screen.getByText(/Risk of homelessness due to eviction notice/i)).toBeDefined();
    expect(screen.getByText(/CYFSA Non-Funding Protection Triggered/i)).toBeDefined();
  });

  it("5. Renders all 15 Parent Assistance questions in the active assessment", () => {
    const mock = createMockMatrix();
    render(<AgencyComplianceMatrixView matrix={mock} />);

    // Verify all 15 question titles exist
    for (let q = 1; q <= 15; q++) {
      expect(screen.getAllByText(new RegExp(`Q${q}\\.`, "i")).length).toBeGreaterThan(0);
    }

    // Verify specific evaluated answers render
    expect(screen.getByText(/Alleged lack of positive parenting strategies\./i)).toBeDefined();
    expect(screen.getByText(/Parental stress and lack of community respite\./i)).toBeDefined();
    expect(screen.getByText(/Evidence-based parenting instruction\./i)).toBeDefined();
    expect(screen.getByText(/Mother attended 3 of 4 sessions\./i)).toBeDefined();
    expect(screen.getAllByText(/Final completion certificate from service provider\./i).length).toBeGreaterThan(0);
  });

  it("6. Handles empty parentAssistanceAnalyses array safely without crashing", () => {
    const mock = createMockMatrix({
      parentAssistanceAnalyses: [],
      parentAssistanceAnalysis: undefined,
    });
    render(<AgencyComplianceMatrixView matrix={mock} />);

    expect(
      screen.getByText(/No Specific Parent Assistance Needs Flagged in Uploaded Records/i)
    ).toBeDefined();
  });

  it("7. Handles missing question answers gracefully with default text", () => {
    const incompleteAssessment: ParentAssistance15QuestionAnalysis = {
      needId: "PA-NEED-INCOMPLETE",
      identifiedNeedTitle: "Incomplete Assessment",
      domain: "FAMILY_PRESERVATION",
      coexistingStatuses: ["NEED_IDENTIFIED"],
      legalForceClassification: "STANDARDS_BASED",
      statutoryNonFundingRuleTriggered: false,
      statutoryNonFundingExplanation: "",
      pageAndParagraphAttribution: "Page 1",
      exactExcerpt: "Brief mention.",
      questions: {} as any,
    };

    const mock = createMockMatrix({
      parentAssistanceAnalyses: [incompleteAssessment],
      parentAssistanceAnalysis: incompleteAssessment,
    });
    render(<AgencyComplianceMatrixView matrix={mock} />);

    expect(screen.getByText(/Incomplete Assessment/i)).toBeDefined();
    expect(screen.getAllByText(/Not documented in uploaded record\./i).length).toBeGreaterThan(0);
  });

  it("8. Renders Section 11 of forensic PDF with the dynamic neutrality disclaimer", () => {
    const mock = createMockMatrix();
    const mockReport: Partial<AnalysisReport> = {
      documentTitle: "Affidavit of Child Protection Worker",
      documentType: "Protection Affidavit",
      analysisDate: "2026-11-03",
      completenessScore: 85,
      disclaimer: "Informational only.",
      redFlags: [],
      complianceMatrix: mock,
    };

    const html = renderForensicReportHtml(mockReport, { audienceMode: "full" });
    expect(html).toContain("11. Agency Compliance & Evidence Matrix");
    expect(html).toContain("CUSTOM AUDIT DISCLAIMER: Verified against official Ontario authorities.");
    expect(html).toContain("Standard 7 — 30-Day Service Plan Requirement");
    expect(html).toContain("POTENTIAL NONCOMPLIANCE");
  });

  it("9. Complies with AnalysisReport type contract in src/types.ts", () => {
    const mock = createMockMatrix();
    const typedReport: AnalysisReport = {
      documentTitle: "Form 8B Application",
      documentType: "Court Form",
      analysisDate: "2026-11-03",
      completenessScore: 90,
      disclaimer: "Legal intelligence.",
      redFlags: [],
      thresholdAnalysis: [],
      proceduralTimelineViolations: [],
      charterAndHumanRightsIssues: [],
      whatToVerify: [],
      whatToAskALawyer: [],
      whatIsMissing: [],
      complianceMatrix: mock,
    };

    expect(typedReport.complianceMatrix?.matrixVersion).toBe("2.0.0");
    expect(typedReport.complianceMatrix?.items.length).toBe(1);
  });

  it("10. Preserves complianceMatrix across full JSON serialization / deserialization roundtrip", () => {
    const mock = createMockMatrix();
    const serialized = JSON.stringify(mock);
    const parsed: ComplianceMatrixReport = JSON.parse(serialized);

    expect(parsed.matrixVersion).toBe("2.0.0");
    expect(parsed.parentAssistanceAnalyses.length).toBe(2);
    expect(parsed.parentAssistanceAnalyses[0].questions.q1_concernIdentifiedByCas).toBe(
      mock.parentAssistanceAnalyses[0].questions.q1_concernIdentifiedByCas
    );
    expect(parsed.neutralityAndMethodologyDisclaimer).toBe(mock.neutralityAndMethodologyDisclaimer);
  });
});
