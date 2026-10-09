import { describe, it, expect } from "vitest";
import {
  OFFICIAL_FORMS,
  getOfficialForm,
  getFormsByStage,
  getFormsByFiledBy,
  getFormsWithBuilders,
  getAllFormNumbers,
} from "./formRegistry";

describe("Authoritative Ontario Court Form Registry", () => {
  it("contains all critical Ontario child-protection forms", () => {
    const requiredForms = ["6B", "8B", "14", "14A", "14B", "17A", "17B", "17C", "23", "33B", "33B.1", "33B.2", "33C", "33D", "35.1A"];
    for (const formNum of requiredForms) {
      expect(OFFICIAL_FORMS[formNum], `Missing required form ${formNum}`).toBeDefined();
    }
  });

  it("enforces mandatory traceability metadata for every registered form", () => {
    for (const [key, form] of Object.entries(OFFICIAL_FORMS)) {
      expect(form.formNumber, `Form ${key} missing formNumber`).toBe(key);
      expect(form.officialTitle, `Form ${key} missing officialTitle`).toBeTruthy();
      expect(form.formTitle, `Form ${key} missing formTitle`).toBeTruthy();
      expect(form.officialSource, `Form ${key} missing officialSource`).toBeTruthy();
      expect(form.officialUrl, `Form ${key} missing officialUrl`).toMatch(/^https:\/\//);
      expect(form.officialSourceUrl, `Form ${key} missing officialSourceUrl`).toMatch(/^https:\/\//);
      expect(form.rulesCitation, `Form ${key} missing rulesCitation`).toContain("O. Reg. 114/99");
      expect(form.purpose, `Form ${key} missing purpose`).toBeTruthy();
      expect(form.filedBy, `Form ${key} missing filedBy`).toBeTruthy();
      expect(form.lastVerified, `Form ${key} missing lastVerified`).toBeTruthy();
      expect(form.verifiedDate, `Form ${key} missing verifiedDate`).toBeTruthy();
      expect(form.stages.length, `Form ${key} missing stages`).toBeGreaterThan(0);
    }
  });

  describe("Specific Official Form Title & Citation Integrity", () => {
    it("Form 8B is 'Application (child protection and status review)', NOT an affidavit", () => {
      const f = getOfficialForm("8B");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Application (child protection and status review)");
      expect(f?.rulesCitation).toContain("Rule 8");
      expect(f?.versionDate).toBe("Feb. 1, 2022");
      expect(f?.effectiveDate).toBe("May 1, 2022");
    });

    it("Form 14 is 'Notice of Motion', NOT an affidavit", () => {
      const f = getOfficialForm("14");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Notice of Motion");
      expect(f?.rulesCitation).toContain("Rule 14");
    });

    it("Form 14A is 'Affidavit (General)'", () => {
      const f = getOfficialForm("14A");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Affidavit (General)");
      expect(f?.rulesCitation).toContain("Rule 14");
      expect(f?.versionDate).toBe("Sept. 1, 2005");
    });

    it("Form 14B is 'Motion Form'", () => {
      const f = getOfficialForm("14B");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Motion Form");
    });

    it("Form 6B is 'Affidavit of Service'", () => {
      const f = getOfficialForm("6B");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Affidavit of Service");
      expect(f?.rulesCitation).toContain("Rule 6");
    });

    it("Form 17B is 'Conference Brief (child protection)'", () => {
      const f = getOfficialForm("17B");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Conference Brief (child protection)");
      expect(f?.rulesCitation).toContain("Rule 17");
    });

    it("Form 23 is 'Summons to Witness', NOT an affidavit", () => {
      const f = getOfficialForm("23");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Summons to Witness");
      expect(f?.rulesCitation).toContain("Rule 23");
    });

    it("Form 33B is CAS's plan of care, distinct from respondent's Form 33B.1", () => {
      const casPlan = getOfficialForm("33B");
      const respondentPlan = getOfficialForm("33B.1");
      expect(casPlan).toBeDefined();
      expect(respondentPlan).toBeDefined();
      expect(casPlan?.officialTitle).toBe("Plan of care for child(ren) (Children's Aid Society)");
      expect(respondentPlan?.officialTitle).toBe("Answer and plan of care (parties other than Children's Aid Society)");
      expect(casPlan?.filedBy).toContain("Children's Aid Society ONLY");
      expect(respondentPlan?.filedBy).toContain("Respondent");
    });

    it("Form 33C is 'Statement of agreed facts (child protection)', NOT a supervision order", () => {
      const f = getOfficialForm("33C");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Statement of agreed facts (child protection)");
      expect(f?.versionDate).toBe("March 1, 2018");
    });

    it("Form 35.1A is 'Affidavit (child protection information)'", () => {
      const f = getOfficialForm("35.1A");
      expect(f).toBeDefined();
      expect(f?.officialTitle).toBe("Affidavit (child protection information)");
      expect(f?.rulesCitation).toContain("Rule 35.1");
      expect(f?.versionDate).toBe("Dec. 1, 2020");
    });
  });

  describe("Query Helpers", () => {
    it("getFormsByStage filters correctly", () => {
      const apprehensionForms = getFormsByStage("Apprehension");
      expect(apprehensionForms.length).toBeGreaterThan(0);
      expect(apprehensionForms.some(f => f.formNumber === "8B")).toBe(true);
      expect(apprehensionForms.some(f => f.formNumber === "6B")).toBe(true);
    });

    it("getFormsByFiledBy filters correctly", () => {
      const respondentForms = getFormsByFiledBy("respondent");
      expect(respondentForms.length).toBeGreaterThan(0);
      expect(respondentForms.some(f => f.formNumber === "33B.1")).toBe(true);
    });

    it("getFormsWithBuilders returns forms with guided builders/mappings", () => {
      const builders = getFormsWithBuilders();
      expect(builders.some(f => f.formNumber === "33B.1")).toBe(true);
    });

    it("getAllFormNumbers returns sorted array of numbers", () => {
      const numbers = getAllFormNumbers();
      expect(numbers).toBeInstanceOf(Array);
      expect(numbers).toContain("8B");
      expect(numbers).toContain("33B.1");
      const sorted = [...numbers].sort();
      expect(numbers).toEqual(sorted);
    });
  });
});
