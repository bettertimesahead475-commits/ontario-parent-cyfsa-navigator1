/**
 * Test Suite: Finding Presentation Engine (api/services/findingPresentation.test.ts)
 */

import { describe, it, expect } from "vitest";
import {
  determineFindingNature,
  buildEducationalAnalysis,
  buildCourtroomPresentation,
  buildCourtFormsGuidance,
  buildPracticalUses,
  enhanceFindingPresentation,
} from "../../shared/findingPresentation.js";

describe("findingPresentation engine", () => {
  const sampleHearsayFlag = {
    id: "rf-1",
    severity: "Affects Evidentiary Weight",
    category: "Hearsay",
    evidenceClassification: "HEARSAY",
    phraseDetected: "The worker was informed by an anonymous caller that the mother was intoxicated.",
    explanation: "This statement is secondhand hearsay from an unidentified source.",
    verifyRequirement: "Request disclosure of the intake log and caller identity.",
    legalReference: "CYFSA s. 74(2)",
    locationInDocument: "Page 4, Paragraph 12",
    quoteLocation: { page: 4, startOffset: 120, endOffset: 210 },
    parentActionStep: "Ask your lawyer to challenge the admissibility under Family Law Rule 14(18).",
  };

  const sampleContradictionFlag = {
    id: "rf-2",
    severity: "Worth Raising With Counsel",
    category: "Internal Contradiction",
    evidenceClassification: "DIRECT",
    phraseDetected: "The child was removed on October 12, 2025, but the intake note states child remained in care on October 15.",
    explanation: "Mutually incompatible dates recorded by two different caseworkers.",
    legalReference: "CYFSA s. 88",
    locationInDocument: "Page 8, Paragraph 31",
  };

  const sampleProceduralFlag = {
    id: "rf-3",
    severity: "CRITICAL",
    category: "Procedural Defect",
    evidenceClassification: "DOCUMENTARY",
    phraseDetected: "The hearing was scheduled 45 days after the initial apprehension without parental waiver.",
    explanation: "Exceeds the 30-day adjournment limitation under CYFSA.",
    legalReference: "CYFSA s. 94(1)",
    locationInDocument: "Page 2, Paragraph 5",
  };

  it("accurately classifies finding nature", () => {
    expect(determineFindingNature(sampleHearsayFlag)).toBe("Evidentiary Deficiency (Secondhand Hearsay Allegation)");
    expect(determineFindingNature(sampleContradictionFlag)).toBe("Documented Evidentiary Contradiction");
    expect(determineFindingNature(sampleProceduralFlag)).toBe("Procedural Noncompliance Concern");
  });

  describe("Educational Legal Analysis Mode", () => {
    it("identifies exact allegation, quotes document, and cites verified law", () => {
      const edu = buildEducationalAnalysis(sampleHearsayFlag);
      expect(edu.nature).toBe("Evidentiary Deficiency (Secondhand Hearsay Allegation)");
      expect(edu.documentQuote).toBe(sampleHearsayFlag.phraseDetected);
      expect(edu.documentLocator).toContain("Page 4, Paragraph 12");
      expect(edu.applicableLegislation).toContain("CYFSA");
      expect(edu.proceduralRule).toContain("Family Law Rules");
      expect(edu.verifiedCaseLaw.caseName).toContain("Children's Aid Society");
    });

    it("explains what evidence establishes, what law requires, and why finding matters", () => {
      const edu = buildEducationalAnalysis(sampleHearsayFlag);
      expect(edu.whatEvidenceEstablishes).toBeTruthy();
      expect(edu.whatLawRequires).toContain("Rule 14(18)");
      expect(edu.whyFindingMatters).toMatch(/without firsthand testimony/i);
    });

    it("identifies specific missing evidence where conclusion is unresolved", () => {
      const edu = buildEducationalAnalysis(sampleHearsayFlag);
      expect(edu.missingEvidenceToResolve).toContain("Primary source records");
      expect(edu.missingEvidenceToResolve).toContain("does not prove they do not exist");
    });

    it("provides parent examination and rights guidance", () => {
      const edu = buildEducationalAnalysis(sampleHearsayFlag);
      expect(edu.parentExaminationGuidance.length).toBeGreaterThan(0);
      expect(edu.parentExaminationGuidance.some(g => g.includes("Questions to Consider"))).toBe(true);
      expect(edu.parentExaminationGuidance.some(g => g.includes("represent yourself"))).toBe(true);
    });
  });

  describe("Courtroom-Style Legal Presentation Mode", () => {
    it("presents finding in formal courtroom language addressing judge", () => {
      const court = buildCourtroomPresentation(sampleHearsayFlag);
      expect(court.advocacyContext).toContain("Formal Courtroom Submissions");
      expect(court.formalOpening).toContain("Your Honour");
      expect(court.courtroomDialogueExample).toContain("Your Honour");
      expect(court.courtroomDialogueExample).toContain(sampleHearsayFlag.phraseDetected);
      expect(court.courtroomDialogueExample).toContain("Rule 14(19)");
    });

    it("uses identical verified quotes and citations as educational mode", () => {
      const edu = buildEducationalAnalysis(sampleHearsayFlag);
      const court = buildCourtroomPresentation(sampleHearsayFlag);
      expect(court.courtroomDialogueExample).toContain(edu.documentQuote);
      expect(court.factualEvidentiarySubmission).toContain(edu.documentLocator);
    });

    it("submits specific evidentiary standards without exaggerating evidence", () => {
      const court = buildCourtroomPresentation(sampleHearsayFlag);
      expect(court.evidentiaryStandardStatus).toContain("Evidentiary Element Missing");
      expect(court.substantivePrayerForRelief).toBeTruthy();
    });
  });

  describe("Ontario Court Forms Connection & Safeguards", () => {
    it("connects hearsay findings to Form 14A and Form 35.1A with field guidance", () => {
      const forms = buildCourtFormsGuidance(sampleHearsayFlag);
      expect(forms.primaryFormNumber).toBe("14A");
      expect(forms.primaryFormTitle).toContain("Affidavit");
      expect(forms.applicableSectionOrField).toContain("Factual Deposition");
      expect(forms.educationalDraftingGuidance).toContain("Form 14A Responding Affidavit");
    });

    it("connects contradiction findings to Form 33C (Statement of Agreed Facts)", () => {
      const forms = buildCourtFormsGuidance(sampleContradictionFlag);
      expect(forms.primaryFormNumber).toBe("33C");
      expect(forms.primaryFormTitle).toContain("Agreed Facts");
    });

    it("connects procedural defect findings to Form 14B (Motion Form)", () => {
      const forms = buildCourtFormsGuidance(sampleProceduralFlag);
      expect(forms.primaryFormNumber).toBe("14B");
      expect(forms.primaryFormTitle).toContain("Motion");
    });

    it("includes prominent mandatory safeguard explaining self-representation rights and mandatory formalities", () => {
      const forms = buildCourtFormsGuidance(sampleHearsayFlag);
      expect(forms.safeguardNotice).toContain("Educational guidance only");
      expect(forms.safeguardNotice).toContain("does not autofill, complete, sign, or submit");
      expect(forms.safeguardNotice).toContain("Self-represented parents have the legal right to draft and file their own court materials");
      expect(forms.safeguardNotice).toContain("legal representation is optional");
      expect(forms.safeguardNotice).toContain("commissioner for taking affidavits");
    });
  });

  describe("Practical Litigation Uses", () => {
    it("generates targeted cross-examination questions, objections, and disclosure demands", () => {
      const practical = buildPracticalUses(sampleHearsayFlag);
      expect(practical.crossExaminationQuestions.length).toBeGreaterThanOrEqual(2);
      expect(practical.crossExaminationQuestions[0]).toContain("Worker");
      expect(practical.evidentiaryObjections.length).toBeGreaterThanOrEqual(1);
      expect(practical.disclosureDemands.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("enhanceFindingPresentation integrated builder", () => {
    it("builds unified enhanced presentation object without repetitive disclaimers", () => {
      const enhanced = enhanceFindingPresentation(sampleHearsayFlag);
      expect(enhanced.id).toBe("rf-1");
      expect(enhanced.educationalAnalysis).toBeDefined();
      expect(enhanced.courtroomPresentation).toBeDefined();
      expect(enhanced.practicalUses).toBeDefined();

      // Ensure no repetitive disclaimer inside individual finding text
      expect(enhanced.educationalAnalysis.directFindingStatement).not.toContain("This document is generated for informational/educational purposes only");
      expect(enhanced.courtroomPresentation.courtroomDialogueExample).not.toContain("Please consult a lawyer licensed by the Law Society of Ontario");
    });
  });
});
