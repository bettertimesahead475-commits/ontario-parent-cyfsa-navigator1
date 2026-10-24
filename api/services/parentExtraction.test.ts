import { describe, expect, it } from "vitest";
import { attachParentAttribution, buildCaseModelFromExtraction, buildSelectedView, listSelectionOptions } from "./parentExtraction.js";
import { isParentAnalysisEnabled, PARENT_ATTRIBUTION_FIELD, PARENT_ATTRIBUTION_SCHEMA, sectionForClient } from "./parentAnalysisSchema.js";

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
  it("never accepts a model-asserted finding or admitted status; the model's classification stays a label only", () => {
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

describe("attribution gates (review fixes)", () => {
  it("drops a subject whose name is not in the verified quotation", () => {
    const raw = structuredClone(rawBlock);
    raw.allegations[0].subjectPartyIds = ["P-B"];
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations[0].subjectPartyIds).toEqual([]);
    const view = buildSelectedView(caseModel, "PROC-1", "P-B");
    expect(view.ok && view.report.specificAllegations).toEqual([]);
  });

  it("keeps a subject only when the quotation names that party as a whole word", () => {
    const raw = structuredClone(rawBlock);
    raw.parties.push({ id: "P-AB", displayName: "Parent AB", aliases: [], role: "OTHER_PARTY" } as never);
    raw.allegations[0].subjectPartyIds = ["P-AB", "P-A"];
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations[0].subjectPartyIds).toEqual(["P-A"]);
  });

  it("drops a role for a party the document never names", () => {
    const raw = structuredClone(rawBlock);
    raw.parties.push({ id: "P-C", displayName: "Parent C", aliases: [], role: "OTHER_PARTY" } as never);
    raw.roles.push({ proceedingId: "PROC-1", partyId: "P-C", role: "RESPONDENT" } as never);
    const { caseModel, rejected } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.roles.some(r => r.partyId === "P-C")).toBe(false);
    expect(rejected).toContainEqual({ kind: "role", id: "P-C", reason: "NOT_IN_DOCUMENT" });
  });

  it("drops a role that points at an unknown party or proceeding", () => {
    const raw = structuredClone(rawBlock);
    raw.roles.push({ proceedingId: "PROC-1", partyId: "P-ZZ", role: "RESPONDENT" } as never);
    raw.roles.push({ proceedingId: "PROC-9", partyId: "P-A", role: "RESPONDENT" } as never);
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.roles.every(r => ["P-A", "P-B"].includes(r.partyId))).toBe(true);
    expect(caseModel.roles.every(r => r.proceedingId === "PROC-1" || r.proceedingId === "PROC-2")).toBe(true);
  });

  it("rejects a quotation that appears more than once, since it cannot point to one place", () => {
    const doc = `${DOC_PROC1}\nParagraph 30. Parent A left the child alone overnight on two occasions.`;
    const { caseModel, rejected } = buildCaseModelFromExtraction(rawBlock, doc, "doc-1");
    expect(caseModel.allegations.map(a => a.id)).toEqual([]);
    expect(rejected).toContainEqual({ kind: "allegation", id: "ALG-1", reason: "QUOTE_NOT_VERIFIED" });
  });

  it("rejects a very short quotation such as a bare name", () => {
    const raw = structuredClone(rawBlock);
    raw.allegations[0].quote = "Parent A";
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.allegations).toEqual([]);
  });

  it("does not use a file number the document does not contain", () => {
    const raw = structuredClone(rawBlock);
    raw.proceedings[0].fileNumber = "FC-99-9999";
    const { caseModel } = buildCaseModelFromExtraction(raw, DOC_PROC1, "doc-1");
    expect(caseModel.proceedings.find(p => p.id === "PROC-1")?.fileNumber).toBeNull();
  });
});

describe("section values sent to clients", () => {
  it("removes the unverified parent block and keeps the rest of the section", () => {
    const value = { overview: "x", [PARENT_ATTRIBUTION_FIELD]: { parties: [] } };
    expect(sectionForClient(value)).toEqual({ overview: "x" });
    expect(value[PARENT_ATTRIBUTION_FIELD]).toBeDefined();
  });
});

describe("attachParentAttribution", () => {
  it("leaves no parent model when the block is missing or not an object", () => {
    for (const missing of [undefined, null, "text", []]) {
      const report: Record<string, unknown> = { parentAttribution: missing, other: 1 };
      attachParentAttribution(report, DOC_PROC1, "doc-1");
      expect("parentAttribution" in report).toBe(false);
      expect(report.other).toBe(1);
    }
  });

  it("replaces a real block with the verified model and removes the raw key contents", () => {
    const report: Record<string, any> = { parentAttribution: structuredClone(rawBlock) };
    attachParentAttribution(report, DOC_PROC1, "doc-1");
    expect(report.parentAttribution.version).toBe(1);
    expect(report.parentAttribution.caseModel.allegations.map((a: { id: string }) => a.id)).toEqual(["ALG-1"]);
    expect(report.parentAttribution.parties).toBeUndefined();
  });
});

describe("attribution scenarios through the extraction pipeline", () => {
  const SHARED_DOC = [
    "Application FC-24-0001. Respondents: Parent A and Parent B.",
    "Paragraph 20. Parent A and Parent B were both present when the child was left alone overnight.",
    "Paragraph 21. The child was found outside the home after midnight on the second occasion.",
  ].join("\n");
  const base = () => {
    const raw = structuredClone(rawBlock);
    raw.proceedings = [raw.proceedings[0]];
    raw.roles = [raw.roles[0], raw.roles[1]];
    raw.orders = [];
    return raw;
  };
  const allegation = (id: string, quote: string, subjects: string[]) => ({
    id, proceedingId: "PROC-1", kind: "ALLEGATION", text: `Text for ${id}`, madeBy: "Applicant",
    subjectPartyIds: subjects, status: "UNRESOLVED", classification: "UNCLEAR", quote, page: 1, paragraph: "20",
  });

  it("shows shared evidence to each parent it names, and as specific to neither", () => {
    const raw = base();
    raw.allegations = [allegation("ALG-S", "Parent A and Parent B were both present when the child was left alone overnight.", ["P-A", "P-B"])] as never;
    const { caseModel } = buildCaseModelFromExtraction(raw, SHARED_DOC, "doc-1");
    for (const party of ["P-A", "P-B"]) {
      const view = buildSelectedView(caseModel, "PROC-1", party);
      expect(view.ok && view.report.sharedAllegations.map(a => a.id)).toEqual(["ALG-S"]);
      expect(view.ok && view.report.specificAllegations).toEqual([]);
    }
  });

  it("shows an allegation with no stated subject as unattributed for both parents, with a warning", () => {
    const raw = base();
    raw.allegations = [allegation("ALG-U", "The child was found outside the home after midnight on the second occasion.", ["P-A"])] as never;
    const { caseModel } = buildCaseModelFromExtraction(raw, SHARED_DOC, "doc-1");
    // The model named P-A, but the quotation does not name anyone, so no subject is kept.
    expect(caseModel.allegations[0].subjectPartyIds).toEqual([]);
    for (const party of ["P-A", "P-B"]) {
      const view = buildSelectedView(caseModel, "PROC-1", party);
      expect(view.ok && view.report.unattributedAllegations.map(a => a.id)).toEqual(["ALG-U"]);
      expect(view.ok && view.report.specificAllegations).toEqual([]);
      expect(view.ok && view.report.issues.some(i => i.code === "NO_SUBJECT_IDENTIFIED")).toBe(true);
    }
  });

  it("flags two parties sharing an alias and blocks drafting for both", () => {
    const raw = base();
    raw.parties[0].aliases = ["Pat"];
    raw.parties[1].aliases = ["Pat"];
    raw.allegations = [];
    const { caseModel } = buildCaseModelFromExtraction(raw, SHARED_DOC, "doc-1");
    for (const party of ["P-A", "P-B"]) {
      const view = buildSelectedView(caseModel, "PROC-1", party);
      expect(view.ok && view.report.issues.some(i => i.code === "ALIAS_COLLISION")).toBe(true);
      expect(view.ok && view.drafting.status).toBe("NOT_ACTIVATED");
      expect(view.ok && view.drafting.blockedBy.length).toBeGreaterThan(0);
    }
  });

  it("does not attribute records that share an identifier", () => {
    const raw = base();
    const quote = "Parent A and Parent B were both present when the child was left alone overnight.";
    raw.allegations = [allegation("ALG-D", quote, ["P-A"]), allegation("ALG-D", quote, ["P-B"])] as never;
    const { caseModel } = buildCaseModelFromExtraction(raw, SHARED_DOC, "doc-1");
    for (const party of ["P-A", "P-B"]) {
      const view = buildSelectedView(caseModel, "PROC-1", party);
      expect(view.ok && view.report.specificAllegations).toEqual([]);
      expect(view.ok && view.report.issues.some(i => i.code === "DUPLICATE_ID")).toBe(true);
    }
  });

  it("keeps reversed roles separate per proceeding", () => {
    const { caseModel } = buildCaseModelFromExtraction(rawBlock, `${DOC_PROC1}\n${DOC_PROC2}`, "doc-1");
    const roles = (proceeding: string, party: string) => {
      const view = buildSelectedView(caseModel, proceeding, party);
      return view.ok ? view.report.roles : null;
    };
    expect(roles("PROC-1", "P-A")).toEqual(["RESPONDENT"]);
    expect(roles("PROC-1", "P-B")).toEqual(["PROPOSED_CAREGIVER"]);
    expect(roles("PROC-2", "P-A")).toEqual(["PROPOSED_CAREGIVER"]);
    expect(roles("PROC-2", "P-B")).toEqual(["RESPONDENT"]);
  });
});
