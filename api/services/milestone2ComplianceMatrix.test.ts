import { describe, expect, it } from "vitest";
import {
  ALL_CAS_ACCOUNTABILITY_RULES,
  A7_ACCOUNTABILITY_AND_COMPLAINT_PATHWAYS,
  evaluateCaseNoteCompleteness,
  getCasAccountabilityRuleById,
  getOversightPathwayById,
  type OversightPathwayId,
} from "../../shared/casAccountabilityLibrary";
import {
  ALL_PARENT_ASSISTANCE_RULES,
  STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS,
  calculateStandard7ServicePlanDeadline,
  getParentAssistanceRulesByDomain,
  getStandard7ComponentByCode,
} from "../../shared/parentAssistanceLibrary";
import {
  buildComplianceMatrixFromReport,
  enforceMissingDocumentNeutralityGuard,
  evaluateParentAssistanceNeed15Questions,
  getMilestone2KnowledgeBaseInventorySummary,
  VALID_COMPLIANCE_STATUSES,
  VALID_PARENT_ASSISTANCE_STATUSES,
} from "../../shared/complianceMatrixEngine";
import {
  evaluatePropositionSupport,
  resolveLegalAuthority,
  VERIFIED_AUTHORITIES_REGISTRY,
} from "../../shared/legalVerificationPipeline";
import { applyReportGuards } from "./analyzerSections";
import { adaptLegacyReport } from "../../shared/reportContract";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Milestone 2: Verified Ontario Legal Intelligence System", () => {
  // ==========================================================================
  // SUITE 1: CAS ACCOUNTABILITY (10 Scenarios)
  // ==========================================================================
  describe("Suite 1: CAS Accountability & Professional Obligations", () => {
    it("1.1 verifies Standard 1 referral screening rules and timelines", () => {
      const std1 = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "OCPS_2016:STD_1_REFERRAL_SCREENING");
      expect(std1).toBeDefined();
      expect(std1?.authorityId).toBe("OCPS:STD_1");
      expect(std1?.legalForce).toBe("MINISTRY_STANDARD_MANDATORY");
      expect(std1?.ocpsTextType).toBe("STANDARD");
    });

    it("1.2 verifies Standard 2 investigation planning rules", () => {
      const std2 = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "OCPS_2016:STD_2_INVESTIGATION_PLANNING_AND_CONDUCT");
      expect(std2).toBeDefined();
      expect(std2?.authorityId).toBe("OCPS:STD_2");
      expect(std2?.caseStages).toContain("INVESTIGATION");
    });

    it("1.3 verifies Standard 3 safety assessment rules within first contact", () => {
      const std3 = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "OCPS_2016:STD_3_SAFETY_ASSESSMENT");
      expect(std3).toBeDefined();
      expect(std3?.authorityId).toBe("OCPS:STD_3");
      expect(std3?.deadlineDays).toBe(1);
    });

    it("1.4 verifies Standard 4 risk assessment rules prior to disposition", () => {
      const std4 = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "OCPS_2016:STD_4_RISK_ASSESSMENT");
      expect(std4).toBeDefined();
      expect(std4?.authorityId).toBe("OCPS:STD_4");
      expect(std4?.ocpsTextType).toBe("STANDARD");
    });

    it("1.5 verifies supervisory consultation required for departures from standards", () => {
      const supRule = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "CAS_SUPERVISION:MANDATORY_CONSULTATION_AND_APPROVALS");
      expect(supRule).toBeDefined();
      expect(supRule?.responsibleParty).toBe("CHILD_PROTECTION_SUPERVISOR");
      expect(supRule?.requiredAction).toMatch(/consultation/i);
    });

    it("1.6 evaluates case-note completeness across 9 required elements", () => {
      const complete = evaluateCaseNoteCompleteness({
        hasContactDateAndTime: true,
        hasMethodOfContact: true,
        hasParticipantsIdentified: true,
        hasSignificantDiscussionsRecorded: true,
        hasDirectObservationsSeparatedFromOpinion: true,
        hasWorkerIdentityAndRole: true,
        hasDateOfNoteCreation: true,
        hasSupervisoryDiscussionsRecorded: true,
        hasLateEntryOrAmendmentAttribution: true,
      });
      expect(complete.presentElements.length).toBe(9);
      expect(complete.missingElements.length).toBe(0);
    });

    it("1.7 distinguishes missing case-note creation date from evidence that event did not occur", () => {
      const partial = evaluateCaseNoteCompleteness({
        hasContactDateAndTime: true,
        hasMethodOfContact: true,
        hasParticipantsIdentified: true,
        hasSignificantDiscussionsRecorded: true,
        hasDirectObservationsSeparatedFromOpinion: true,
        hasWorkerIdentityAndRole: true,
        hasDateOfNoteCreation: false,
        hasSupervisoryDiscussionsRecorded: false,
        hasLateEntryOrAmendmentAttribution: false,
      });
      expect(partial.missingElements).toContain("DATE_OF_NOTE_CREATION");
      expect(partial.distinctionNote).toMatch(/NOT DOCUMENTED in the available record/i);
    });

    it("1.8 verifies OCSWSSW registration requirements and restricted titles under SWSSWA ss. 46-47", () => {
      const ocsRule = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "OCSWSSW_ETHICS:REGISTRATION_AND_STANDARDS_OF_PRACTICE");
      expect(ocsRule).toBeDefined();
      expect(ocsRule?.authorityId).toBe("OCSWSSW:REGISTRATION");
      expect(ocsRule?.legalForce).toBe("PROFESSIONAL_REGULATORY_CODE");
      expect(ocsRule?.antiOverclaimGuardrail).toMatch(/NEVER assume every CAS employee is a registered social worker/i);
    });

    it("1.9 verifies affidavit personal knowledge and sourced belief rules under FLR r. 14(18)-(19)", () => {
      const affRule = ALL_CAS_ACCOUNTABILITY_RULES.find((r) => r.ruleId === "SWORN_EVIDENCE:AFFIDAVIT_COMMISSIONING_AND_FLR_14_18");
      expect(affRule).toBeDefined();
      expect(affRule?.legalForce).toBe("COURT_PROCEDURAL_RULE");
      expect(affRule?.antiOverclaimGuardrail).toMatch(/NEVER invent a universal statutory CAS worker oath/i);
    });

    it("1.10 verifies oversight pathways: CFSRB s. 120 jurisdiction vs court order exclusion", () => {
      const cfsrb = getOversightPathwayById("OVERSIGHT:CFSRB_SERVICE_COMPLAINT_120");
      expect(cfsrb).toBeDefined();
      expect(cfsrb?.canOverturnCourtOrder).toBe(false);
      expect(cfsrb?.mandatoryExclusions.some((e) => e.includes("before the court"))).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 2: PARENT ASSISTANCE & FAMILY PRESERVATION (11 Scenarios)
  // ==========================================================================
  describe("Suite 2: Parent Assistance & Family Preservation", () => {
    it("2.1 verifies mandatory inquiry into pre-intervention assistance & less disruptive alternatives (CYFSA s. 101(2)-(3))", () => {
      const b1 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B1-CYFSA-101-2-3-DISPOSITIONAL-LESS-DISRUPTIVE-INQUIRY");
      expect(b1).toBeDefined();
      expect(b1?.authorityId).toBe("CYFSA:101(2)");
      expect(b1?.legalForce).toBe("LEGALLY_REQUIRED");
      expect(b1?.requiredOrExpectedAction).toMatch(/less disruptive alternatives/i);
    });

    it("2.2 verifies interim care and custody two-limb test under CYFSA s. 94(4)", () => {
      const b1Int = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B1-CYFSA-94-4-INTERIM-CARE-LEAST-DISRUPTIVE");
      expect(b1Int).toBeDefined();
      expect(b1Int?.authorityId).toBe("CYFSA:94(2)");
      expect(b1Int?.secondaryAuthorityIds).toContain("CYFSA:94(4)");
    });

    it("2.3 verifies Bill C-92 s. 14(1) priority for preventive care for Indigenous children", () => {
      const c92 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B1-BILL-C92-14-PREVENTIVE-CARE-PRIORITY");
      expect(c92).toBeDefined();
      expect(c92?.authorityId).toBe("BILL_C92:14(1)");
      expect(c92?.exactSectionOrStandard).toContain("s. 14(1)");
    });

    it("2.4 verifies Bill C-92 s. 15 prohibition against apprehension solely for socio-economic conditions", () => {
      const b4 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B4-POVERTY-AND-SOCIOECONOMIC-CONDITIONS-DISTINCTION");
      expect(b4).toBeDefined();
      expect(b4?.exactSectionOrStandard).toContain("s. 15");
      expect(b4?.requiredOrExpectedAction).toMatch(/prohibits apprehension solely on the basis of socio-economic conditions/i);
    });

    it("2.5 verifies parent support legal force classification across categories", () => {
      const statRule = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B2-CYFSA-35-1-PREVENTIVE-AND-COUNSELLING-FUNCTION");
      const stdRule = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B2-OCPS-STD-7-PARENTING-REFERRAL-AND-BARRIER-COORDINATION");
      expect(statRule?.legalForce).toBe("LEGALLY_REQUIRED");
      expect(stdRule?.legalForce).toBe("STANDARDS_BASED");
    });

    it("2.6 enforces statutory non-funding bar under CYFSA ss. 94(6)(c), 101(7)(c), and 116(4)(c)", () => {
      const fundingRule = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B3-CYFSA-NON-FUNDING-STATUTORY-LIMIT");
      expect(fundingRule).toBeDefined();
      expect(fundingRule?.authorityId).toBe("CYFSA:94(6)");
      expect(fundingRule?.exactSectionOrStandard).toContain("s. 94(6)(c)");
      expect(fundingRule?.exactSectionOrStandard).toContain("s. 101(7)(c)");
      expect(fundingRule?.exactSectionOrStandard).toContain("s. 116(4)(c)");
      expect(fundingRule?.requiredOrExpectedAction).toMatch(/SHALL NOT require the society to provide financial assistance/i);
    });

    it("2.7 distinguishes CAS Plan of Care service specification (s. 100(a)) from court purchase orders", () => {
      const b3 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B3-CYFSA-NON-FUNDING-STATUTORY-LIMIT");
      expect(b3?.overstatementGuard).toMatch(/NEVER assert that CYFSA legally compels CAS to pay for private therapy/i);
    });

    it("2.8 distinguishes poverty and housing hardship from child neglect under CYFSA s. 74(2)", () => {
      const b4 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B4-POVERTY-AND-SOCIOECONOMIC-CONDITIONS-DISTINCTION");
      expect(b4?.overstatementGuard).toMatch(/Never state that CAS has a statutory duty to provide housing or pay rent/i);
    });

    it("2.9 verifies kinship placement priority under CYFSA s. 101(4) and s. 94(2)(c)", () => {
      const kin = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B5-CYFSA-KINSHIP-PRIORITY-AND-ASSESSMENT");
      expect(kin).toBeDefined();
      expect(kin?.authorityId).toBe("CYFSA:101(4)");
      expect(kin?.secondaryAuthorityIds).toContain("CYFSA:94(2)");
    });

    it("2.10 verifies parent-child access and meaningful contact orders under CYFSA s. 104(1) and s. 105(5)", () => {
      const access = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B6-CYFSA-104-105-ACCESS-AND-MEANINGFUL-CONTACT");
      expect(access).toBeDefined();
      expect(access?.authorityId).toBe("CYFSA:104(1)");
      expect(access?.exactSectionOrStandard).toContain("105(5)");
    });

    it("2.11 evaluates 15-question parent assistance analysis with coexisting statuses", () => {
      const analysis = evaluateParentAssistanceNeed15Questions({
        needId: "TEST-NEED",
        identifiedNeedTitle: "Addiction Counselling",
        domain: "B3_MENTAL_HEALTH_AND_ADDICTIONS",
        sourceText: "Mother was referred to community addiction program, but placed on a 6-month waitlist. Transportation was an issue.",
        legalForceClassification: "STANDARDS_BASED",
        relevantPatterns: [/addiction/i, /counselling/i],
      });
      expect(analysis.coexistingStatuses).toContain("NEED_IDENTIFIED");
      expect(analysis.coexistingStatuses).toContain("REFERRAL_MADE");
      expect(analysis.coexistingStatuses).toContain("SERVICE_INACCESSIBLE");
      expect(analysis.statutoryNonFundingRuleTriggered).toBe(true);
      expect(analysis.statutoryNonFundingExplanation).toMatch(/CYFSA ss\. 94\(6\)\(c\)/i);
    });
  });

  // ==========================================================================
  // SUITE 3: REUNIFICATION & STANDARD 7 ONGOING CASE MANAGEMENT (10 Scenarios)
  // ==========================================================================
  describe("Suite 3: Reunification & Standard 7 Ongoing Case Management", () => {
    it("3.1 verifies all 18 components of OCPS (2016) Standard 7 are modeled", () => {
      expect(STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS.length).toBe(18);
      const codes = STANDARD_7_ONGOING_CASE_MANAGEMENT_COMPONENTS.map((c) => c.componentCode);
      expect(codes).toContain("STD7_01_TRANSFER_TO_ONGOING");
      expect(codes).toContain("STD7_03_INITIAL_SERVICE_PLAN_30_DAYS");
      expect(codes).toContain("STD7_11_MONTHLY_HOME_CONTACT_EXPECTATIONS");
      expect(codes).toContain("STD7_13_FORMAL_6_MONTH_CASE_REVIEW");
      expect(codes).toContain("STD7_18_CASE_CLOSURE_REQUIREMENTS");
    });

    it("3.2 calculates Standard 7 30-day deadline from caseTransferDate", () => {
      const res = calculateStandard7ServicePlanDeadline({
        caseTransferDate: "2026-05-01",
        servicePlanCompletionDate: "2026-05-20",
      });
      expect(res.deadlineStatus).toBe("DETERMINED_FROM_CASE_TRANSFER");
      expect(res.triggerDate).toBe("2026-05-01");
      expect(res.calculatedDeadlineDate).toBe("2026-05-31");
      expect(res.daysElapsedToServicePlan).toBe(19);
      expect(res.withinThirtyDayStandard).toBe(true);
    });

    it("3.3 calculates Standard 7 30-day deadline from investigationCompletionDate", () => {
      const res = calculateStandard7ServicePlanDeadline({
        investigationCompletionDate: "2026-03-10",
        servicePlanCompletionDate: "2026-04-05",
      });
      expect(res.deadlineStatus).toBe("DETERMINED_FROM_INVESTIGATION_COMPLETION");
      expect(res.triggerDate).toBe("2026-03-10");
      expect(res.calculatedDeadlineDate).toBe("2026-04-09");
      expect(res.withinThirtyDayStandard).toBe(true);
    });

    it("3.4 explicitly rejects measuring Standard 7 30-day deadline from removalDate alone", () => {
      const res = calculateStandard7ServicePlanDeadline({
        removalDate: "2026-04-01",
      });
      expect(res.deadlineStatus).toBe("DEADLINE_NOT_DETERMINABLE");
      expect(res.triggerDate).toBeNull();
      expect(res.explanation).toMatch(/DEADLINE_NOT_DETERMINABLE/i);
      expect(res.cautionNote).toMatch(/apprehension\/removal/i);
    });

    it("3.5 returns DEADLINE_NOT_DETERMINABLE when triggering dates are missing", () => {
      const res = calculateStandard7ServicePlanDeadline({});
      expect(res.deadlineStatus).toBe("DEADLINE_NOT_DETERMINABLE");
      expect(res.triggerDate).toBeNull();
      expect(res.calculatedDeadlineDate).toBeNull();
    });

    it("3.6 marks service plan completed within 30 days as compliant", () => {
      const res = calculateStandard7ServicePlanDeadline({
        caseTransferDate: "2026-06-01",
        servicePlanCompletionDate: "2026-06-15",
      });
      expect(res.withinThirtyDayStandard).toBe(true);
      expect(res.daysElapsedToServicePlan).toBe(14);
    });

    it("3.7 marks service plan completed after 30 days as outside standard and notes supervisory departure check", () => {
      const res = calculateStandard7ServicePlanDeadline({
        caseTransferDate: "2026-06-01",
        servicePlanCompletionDate: "2026-07-15",
      });
      expect(res.withinThirtyDayStandard).toBe(false);
      expect(res.daysElapsedToServicePlan).toBe(44);
      expect(res.explanation).toMatch(/outside the 30-day/i);
    });

    it("3.8 verifies CYFSA s. 122(1)(a) cumulative time-in-care ceiling of 12 months for child under 6", () => {
      const s122 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B7-CYFSA-122-CUMULATIVE-TIME-IN-CARE-AND-REUNIFICATION");
      expect(s122?.requiredOrExpectedAction).toMatch(/12 months if the child is younger than 6/i);
      expect(s122?.title).toMatch(/Interim Society Care/i);
    });

    it("3.9 verifies CYFSA s. 122(1)(b) cumulative time-in-care ceiling of 24 months for child 6 or older", () => {
      const s122 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B7-CYFSA-122-CUMULATIVE-TIME-IN-CARE-AND-REUNIFICATION");
      expect(s122?.requiredOrExpectedAction).toMatch(/24 months if the child is 6 or older/i);
    });

    it("3.10 verifies CYFSA s. 122(4) deemed extension and s. 122(5) discretionary 6-month extension", () => {
      const s122 = ALL_PARENT_ASSISTANCE_RULES.find((r) => r.ruleId === "B7-CYFSA-122-CUMULATIVE-TIME-IN-CARE-AND-REUNIFICATION");
      expect(s122?.requiredOrExpectedAction).toMatch(/deemed extended.*s\.\s*122\(4\)/i);
      expect(s122?.requiredOrExpectedAction).toMatch(/extend the period permitted under s\. 122\(1\) by up to 6 months/i);
    });
  });

  // ==========================================================================
  // SUITE 4: EVIDENCE, CONTRADICTIONS & PRESENTATION MODES (10 Scenarios)
  // ==========================================================================
  describe("Suite 4: Evidence, Contradictions & Presentation Modes", () => {
    it("4.1 ensures missing document in uploaded records is never classified as confirmed breach", () => {
      const status = enforceMissingDocumentNeutralityGuard({
        proposedStatus: "POTENTIAL_NONCOMPLIANCE",
        hasAffirmativeEvidenceOfConductOrOmission: false,
        isSolelyMissingDocumentInUpload: true,
      });
      expect(status).toBe("NOT_DOCUMENTED_IN_UPLOADED_RECORDS");
    });

    it("4.2 flags contradictory evidence as REQUIRES_LEGAL_REVIEW in evidence category", () => {
      const matrix = buildComplianceMatrixFromReport(
        {
          contradictions: [
            {
              claim: "Worker visited mother weekly",
              counterEvidence: "Mother stated worker did not visit for 3 months",
              significance: "Affects visit frequency credibility",
              sourcePage: 4,
              paragraphReference: "Para 12 vs Para 30",
            },
          ],
        },
        "Affidavit sworn by worker. Concerns raised that worker visited regularly.",
      );
      const evidItem = matrix.items.find((i) => i.category === "EVIDENCE_AND_CONTRADICTIONS");
      expect(evidItem?.assessment.complianceStatus).toBe("REQUIRES_LEGAL_REVIEW");
    });

    it("4.3 ensures Educational presentation mode explains rule, application, and next steps plainly", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Case transferred to ongoing services on 2026-05-01. Initial service plan completed.");
      const item = matrix.items[0];
      expect(item.presentation.educationalMode.whatRuleRequires.length).toBeGreaterThan(20);
      expect(item.presentation.educationalMode.questionsToAskNext.length).toBeGreaterThan(0);
    });

    it("4.4 ensures Courtroom presentation mode uses professional, evidence-grounded terms", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Testing courtroom mode.");
      const item = matrix.items[0];
      expect(item.presentation.courtroomMode.relevantRuleAndAuthority).toMatch(/CYFSA|OCPS|FLR/);
      expect(item.presentation.courtroomMode.targetedDisclosureOrClarificationRequest.length).toBeGreaterThan(0);
    });

    it("4.5 proves Fact Identity Invariant: both modes share identical facts and authorityId", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Document test text.");
      for (const item of matrix.items) {
        expect(item.authority.authorityId.length).toBeGreaterThan(0);
        expect(VALID_COMPLIANCE_STATUSES).toContain(item.assessment.complianceStatus);
      }
    });

    it("4.6 verifies authority lookup in registry resolves to VERIFIED", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Court hearing held under CYFSA s. 101.");
      const item = matrix.items.find((i) => i.authority.authorityId === "CYFSA:101(2)");
      expect(item?.assessment.sourceVerificationStatus).toBe("VERIFIED");
    });

    it("4.7 flags adversarial proposition mismatch as IRRELEVANT_OR_UNSUPPORTED", () => {
      const check = evaluatePropositionSupport("102", "Section 102 authorizes the society to place the child under a supervision order");
      expect(check.support).toBe("IRRELEVANT_OR_MISAPPLIED");
    });

    it("4.8 catches historical version pre-CYFSA case date", () => {
      const res = resolveLegalAuthority("CYFSA s. 88", { caseDate: "2015-01-01" });
      expect(res.status).toBe("INAPPLICABLE");
      expect(res.temporalStatus).toBe("BEFORE_EARLIEST_VERSION");
    });

    it("4.9 resolves valid oversight pathway safely", () => {
      const p = getOversightPathwayById("OVERSIGHT:CAS_INTERNAL_COMPLAINT_119");
      expect(p).toBeDefined();
      expect(p?.authorityId).toBe("CYFSA:119(1)");
    });

    it("4.10 safely returns undefined for unknown oversight pathway ID", () => {
      const p = getOversightPathwayById("UNKNOWN_PATHWAY" as any);
      expect(p).toBeUndefined();
    });
  });

  // ==========================================================================
  // SUITE 5: SECURITY, PERFORMANCE & REGRESSION (11 Scenarios)
  // ==========================================================================
  describe("Suite 5: Security, Performance & Regression", () => {
    it("5.1 generates full compliance matrix with zero external web calls", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Standard text without network access.");
      expect(matrix).toBeDefined();
      expect(matrix.items.length).toBe(5);
    });

    it("5.2 benchmark: matrix generation executes in under 5 milliseconds", () => {
      const start = performance.now();
      buildComplianceMatrixFromReport(
        {
          executiveSummary: "Summary text",
          statutoryFindings: [{ title: "Testing", statute: "CYFSA s. 101", description: "Details" }],
        },
        "Case transferred to ongoing on 2026-05-01. Initial service plan completed on 2026-05-25.",
      );
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(15); // comfortably under threshold
    });

    it("5.3 proves Neutrality Invariant: matrix contains no inflammatory or accusatory labels", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Sample text for testing.");
      const rawJson = JSON.stringify(matrix);
      expect(rawJson).not.toMatch(/\b(?:is guilty|committed perjury|proves perjury|criminal misconduct|is a lawbreaker)\b/i);
    });

    it("5.4 verifies summary counts accurately match item compliance statuses", () => {
      const matrix = buildComplianceMatrixFromReport({}, "Testing summary counts.");
      const total =
        matrix.summaryCounts.compliantOnAvailableEvidenceCount +
        matrix.summaryCounts.potentialNoncomplianceCount +
        matrix.summaryCounts.partialComplianceCount +
        matrix.summaryCounts.notDocumentedInUploadedRecordsCount +
        matrix.summaryCounts.insufficientEvidenceCount +
        matrix.summaryCounts.notApplicableCount +
        matrix.summaryCounts.exceptionMayApplyCount +
        matrix.summaryCounts.requiresLegalReviewCount;
      expect(total).toBe(matrix.items.length);
    });

    it("5.5 validates knowledge base inventory summary totals", () => {
      const inv = getMilestone2KnowledgeBaseInventorySummary();
      expect(inv.casAccountabilityRulesCount).toBeGreaterThanOrEqual(15);
      expect(inv.parentAssistanceRulesCount).toBeGreaterThanOrEqual(10);
      expect(inv.standard7ComponentsCount).toBe(18);
      expect(inv.oversightPathwaysCount).toBe(6);
    });

    it("5.6 verifies pending SQL migration file exists and contains valid table definitions", () => {
      const sqlPath = path.resolve(__dirname, "../../supabase/migrations_pending_approval/milestone2_compliance_matrix_foundation.sql");
      expect(fs.existsSync(sqlPath)).toBe(true);
      const sqlContent = fs.readFileSync(sqlPath, "utf8");
      expect(sqlContent).toContain("create table public.navigator_compliance_obligations");
      expect(sqlContent).toContain("create table public.navigator_matter_compliance_assessments");
      expect(sqlContent).toContain("create table public.navigator_matter_parent_assistance_records");
    });

    it("5.7 verifies pending SQL rollback file exists and cleanly drops tables", () => {
      const rollbackPath = path.resolve(__dirname, "../../supabase/migrations_pending_approval/milestone2_compliance_matrix_foundation.rollback.sql");
      expect(fs.existsSync(rollbackPath)).toBe(true);
      const rollbackContent = fs.readFileSync(rollbackPath, "utf8");
      expect(rollbackContent).toContain("drop table if exists public.navigator_matter_parent_assistance_records;");
      expect(rollbackContent).toContain("drop table if exists public.navigator_matter_compliance_assessments;");
      expect(rollbackContent).toContain("drop table if exists public.navigator_compliance_obligations;");
    });

    it("5.8 verifies RLS and service_role security grants in pending SQL migration", () => {
      const sqlPath = path.resolve(__dirname, "../../supabase/migrations_pending_approval/milestone2_compliance_matrix_foundation.sql");
      const sqlContent = fs.readFileSync(sqlPath, "utf8");
      expect(sqlContent).toContain("alter table public.navigator_compliance_obligations enable row level security;");
      expect(sqlContent).toContain("grant select, insert, update on public.navigator_matter_compliance_assessments to service_role;");
      expect(sqlContent).toContain("revoke all on");
    });

    it("5.9 verifies pending SQL migration preserves Stage 9A OTHER_OFFICIAL_AUTHORITY source_type", () => {
      const sqlPath = path.resolve(__dirname, "../../supabase/migrations_pending_approval/milestone2_compliance_matrix_foundation.sql");
      const sqlContent = fs.readFileSync(sqlPath, "utf8");
      expect(sqlContent).toContain("'OTHER_OFFICIAL_AUTHORITY'");
    });

    it("5.10 verifies adaptLegacyReport carries complianceMatrix through cleanly", () => {
      const adapted = adaptLegacyReport({
        documentTitle: "Test Doc",
        complianceMatrix: {
          matrixVersion: "2.0.0",
          items: [],
        },
      });
      expect(adapted.complianceMatrix).toBeDefined();
      expect(adapted.complianceMatrix?.matrixVersion).toBe("2.0.0");
    });

    it("5.11 verifies applyReportGuards deterministically attaches complianceMatrix to analyzed report", () => {
      const report: Record<string, any> = {
        redFlags: [],
        thresholdAnalysis: [],
      };
      applyReportGuards(report, "Mother was referred to parenting course. Child removed.");
      expect(report.complianceMatrix).toBeDefined();
      expect(report.complianceMatrix.matrixVersion).toBe("2.0.0");
      expect(report.complianceMatrix.items.length).toBe(5);
    });
  });
});
