import { describe, expect, it } from "vitest";
import { buildCaseModelFromExtraction, buildSelectedView, listSelectionOptions } from "./parentExtraction.js";
import { isParentAnalysisEnabled, PARENT_ATTRIBUTION_FIELD, PARENT_ATTRIBUTION_SCHEMA } from "./parentAnalysisSchema.js";

// Synthetic documents. Both parents are named in every document.
const DOC_PROC1 = [
  "Application FC-24-0001. Applicant: Children's Aid Society. Respondents: Parent A and Parent B.",
  "Paragraph 12. Parent A left the child alone overnight on two occasions.",
  "Paragraph 14. Parent B has offered to care for the child while the matter is decided.",
  "Paragraph 15. The worker notes that Parent B attended every scheduled visit.",
].join("\n");

const DOC_PROC2 = [
  "Application FC-25-0042. Applicant: Children's Aid Society. Respondents: Parent A and Parent B.",
  "Paragraph 4. Parent B missed three scheduled access visits without notice.",
  "Paragraph 6. Parent A has offered to care for the child during the adjournment.",
].join("\n");

const rawBlock = {
  parties: [
    { id: "P-A", displayName: "Parent A", aliases: [], role: "RESPONDENT" },
    { id: "P-B", displayName: "Parent B", aliases: [], role: "RESPONDENT" },
  ],
  proceedings: [
    { id: "PROC-1", fileNumber: "FC-24-0001", applicationDate: "2024-03-01", childNames: ["Child C"] },
    { id: "PROC-2", fileNumber: "FC-25-0042", applicationDate: "2025-06-10", childNames: ["Child C"] },
  ],
  roles: [
    { proceedingId: "PROC-1", partyId: "P-A", role: "RESPONDENT" },
    { proceedingId: "PROC-1", partyId: "P-B", role: "PROPOSED_CAREGIVER" },
    { proceedingId: "PROC-2", partyId: "P-B", role: "RESPONDENT" },
    { proceedingId: "PROC-2", partyId: "P-A", role: "PROPOSED_CAREGIVER" },
  ],
  allegations: [
    {
      id: "ALG-1", proceedingId: "PROC-1", kind: "ALLEGATION", text: "Left the child alone overnight.",
      madeBy: "Applicant", subjectPartyIds: ["P-A"], status: "UNRESOLVED", classification: "HEARSAY",
      quote: "Parent A left the child alone overnight on two occasions.", page: 1, paragraph: "12",
    },
    {
      id: "ALG-2", proceedingId: "PROC-2", kind: "ALLEGATION", text: "Missed access visits.",
      madeBy: "Applicant", subjectPartyIds: ["P-B"], status: "UNRESOLVED", classification: "DOCUMENTARY",
      quote: "Parent B missed three scheduled access visits without notice.", page: 1, paragraph: "4",
    },
  ],
  orders: [
    {
      id: "ORD-1", proceedingId: "PROC-1", description: "Child placed with Parent B",
      affectsPartyIds: ["P-A", "P-B"], proposedCaregiverPartyId: "P-B",
      quote: "Parent B has offered to care for the child while the matter is decided.", page: 1, paragraph: "14",
    },
  ],
};

describe("feature flag", () => {
  it("is OFF unless the value is exactly 'true'", () => {
    expect(isParentAnalysisEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isParentAnalysisEnabled({ PARENT_ANALYSIS_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isParentAnalysisEnabled({ PARENT_ANALYSIS_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("names the schema key the overview section would return", () => {
    expect(PARENT_ATTRIBUTION_SCHEMA.startsWith(`  "${PARENT_ATTRIBUTION_FIELD}"`)).toBe(true);
  });
});

describe("quotation verification", () => {
  it("keeps a record whose quotation appears in its source document", () => {
    const { caseModel, rejected } = buildCaseModelFromExtraction(rawBlock, DOC_PROC1, "doc-1");
    expect(caseModel.allegations.map(a => a.id)).toEqual(["ALG-1"]);
    expect(caseModel.allegations[0].source).toEqual({
      documentId: "doc-1", page: 1, paragraph: "12",
      quote: "Parent A left the child alone overnight on two occasions.",
    });
    // ALG-2 quotes the second document, so it is not verified against this one.
    expect(rejected).toEqual([{ kind: "allegation", id: "ALG-2", reason: "QUOTE_NOT_VERIFIED" }]);
  });

  it("drops a record whose quotation is not in the document and reports it", () => {
    const raw = structuredClone(rawBlock);
    raw.allegations[0].quote = "Parent A never left the child alone.";
    const { caseModel, rejected } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations.map(a => a.id)).toEqual([]);
    expect(rejected).toContainEqual({ kind: "allegation", id: "ALG-1", reason: "QUOTE_NOT_VERIFIED" });
  });

  it("drops a record with no quotation at all", () => {
    const raw = structuredClone(rawBlock);
    raw.orders[0].quote = "";
    const { caseModel, rejected } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.orders).toEqual([]);
    expect(rejected).toContainEqual({ kind: "order", id: "ORD-1", reason: "QUOTE_NOT_VERIFIED" });
  });

  it("treats a missing or non-object block as empty, without throwing", () => {
    expect(buildCaseModelFromExtraction(undefined, DOC_PROC1, "doc-1").caseModel.allegations).toEqual([]);
    expect(buildCaseModelFromExtraction("garbage", DOC_PROC1, "doc-1").caseModel.parties).toEqual([]);
  });

  it("does not let a model-set kind become FINDING without a verified source", () => {
    const raw = structuredClone(rawBlock);
    raw.allegations[0].kind = "FINDING";
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations[0].kind).toBe("ALLEGATION");
    const view = buildSelectedView(caseModel, "PROC-1", "P-A");
    expect(view.ok && view.report.specificAllegations[0].status).toBe("UNRESOLVED");
  });
});

describe("two parents across two proceedings, both named in every document", () => {
  const model1 = buildCaseModelFromExtraction(rawBlock, DOC_PROC1, "doc-1").caseModel;
  const model2 = buildCaseModelFromExtraction(rawBlock, DOC_PROC2, "doc-2").caseModel;
  const model = { ...model1, allegations: [...model1.allegations, ...model2.allegations], orders: [...model1.orders] };

  it("attributes each allegation to the parent it concerns", () => {
    const a1 = buildSelectedView(model, "PROC-1", "P-A");
    const b1 = buildSelectedView(model, "PROC-1", "P-B");
    const b2 = buildSelectedView(model, "PROC-2", "P-B");
    const a2 = buildSelectedView(model, "PROC-2", "P-A");
    expect(a1.ok && a1.report.specificAllegations.map(x => x.id)).toEqual(["ALG-1"]);
    expect(b1.ok && b1.report.specificAllegations).toEqual([]);
    expect(b2.ok && b2.report.specificAllegations.map(x => x.id)).toEqual(["ALG-2"]);
    expect(a2.ok && a2.report.specificAllegations).toEqual([]);
  });

  it("never shows an allegation from one proceeding in the other proceeding's view", () => {
    const p1 = buildSelectedView(model, "PROC-1", "P-B");
    const p2 = buildSelectedView(model, "PROC-2", "P-A");
    const ids1 = p1.ok ? [...p1.report.specificAllegations, ...p1.report.sharedAllegations].map(x => x.id) : [];
    const ids2 = p2.ok ? [...p2.report.specificAllegations, ...p2.report.sharedAllegations].map(x => x.id) : [];
    expect(ids1).not.toContain("ALG-2");
    expect(ids2).not.toContain("ALG-1");
  });

  it("keeps each allegation's source citation", () => {
    const b2 = buildSelectedView(model, "PROC-2", "P-B");
    expect(b2.ok && b2.report.specificAllegations[0].source).toMatchObject({ documentId: "doc-2", paragraph: "4" });
  });

  it("requires a selection and rejects a pair that does not exist", () => {
    const options = listSelectionOptions(model);
    expect(options.selectionRequired).toBe(true);
    expect(buildSelectedView(model, "PROC-1", "P-Z")).toEqual({ ok: false, code: "NOT_A_VALID_CHOICE" });
    expect(buildSelectedView(model, "PROC-9", "P-A")).toEqual({ ok: false, code: "NOT_A_VALID_CHOICE" });
  });

  it("keeps drafting not activated and reports what blocks it", () => {
    const view = buildSelectedView(model, "PROC-1", "P-A");
    expect(view.ok && view.drafting.status).toBe("NOT_ACTIVATED");
  });
});

describe("single-parent documents", () => {
  it("does not require a selection when one parent and one proceeding are identified", () => {
    const raw = structuredClone(rawBlock);
    raw.parties = [raw.parties[0]];
    raw.proceedings = [raw.proceedings[0]];
    raw.roles = [raw.roles[0]];
    raw.allegations = [raw.allegations[0]];
    raw.orders = [];
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(listSelectionOptions(caseModel).selectionRequired).toBe(false);
    const view = buildSelectedView(caseModel, "PROC-1", "P-A");
    expect(view.ok && view.report.specificAllegations.map(x => x.id)).toEqual(["ALG-1"]);
  });
});

describe("bounds and malformed input", () => {
  it("drops malformed party and allegation records instead of guessing", () => {
    const raw = structuredClone(rawBlock);
    raw.parties.push({ id: "", displayName: "No id", aliases: [], role: "OTHER_PARTY" } as never);
    raw.allegations.push({ id: "ALG-X" } as never);
    const { caseModel, rejected } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.parties.map(p => p.id)).toEqual(["P-A", "P-B"]);
    expect(rejected.filter(r => r.reason === "MALFORMED").length).toBeGreaterThanOrEqual(2);
  });

  it("caps the number of allegations it accepts", () => {
    const raw = structuredClone(rawBlock);
    raw.allegations = Array.from({ length: 200 }, (_, i) => ({ ...rawBlock.allegations[0], id: `ALG-${i}` }));
    const { caseModel, rejected } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations.length).toBeLessThanOrEqual(150);
    expect(rejected).toContainEqual({ kind: "allegation", id: "", reason: "LIMIT_EXCEEDED" });
  });
});

describe("review fixes", () => {
  it("never accepts a model-asserted finding, documentary classification or admitted status", () => {
    const raw = structuredClone(rawBlock);
    raw.allegations[0].kind = "FINDING";
    raw.allegations[0].classification = "DOCUMENTARY";
    raw.allegations[0].status = "ADMITTED";
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations[0].kind).toBe("ALLEGATION");
    expect(caseModel.allegations[0].status).toBe("UNRESOLVED");
    const view = buildSelectedView(caseModel, "PROC-1", "P-A");
    expect(view.ok && view.report.specificAllegations[0].status).toBe("UNRESOLVED");
  });

  it("refuses a duplicate proceeding identifier cleanly instead of throwing", () => {
    const model = buildCaseModelFromExtraction(rawBlock, DOC_PROC1, "doc-1").caseModel;
    model.proceedings.push({ ...model.proceedings[0] });
    expect(buildSelectedView(model, "PROC-1", "P-A")).toEqual({ ok: false, code: "NOT_A_VALID_CHOICE" });
  });
});
