// NAV-005 regression: strict per-key allowlists for structural values (Claude qualification d592f10, section 6.3-6.5).
import { describe, expect, it } from "vitest";
import { REDACTED_TEXT, isSafeStructuralValue, redactForExport } from "./exportRedaction";
import { ALL_REPORT_FIXTURES } from "./reportFixtures";

const CANARY = "Jordan Syntheticparent";

describe("NAV-005 structural allowlists", () => {
  it("keeps exact controlled-vocabulary values (the audit probe)", () => {
    const out: any = redactForExport({
      id: "rf_1", type: "redFlag", kind: "EVIDENCE", classification: "Procedural", severity: "high", category: "disclosure",
      status: "verified", confidence: "high", verdict: "supported", legalReference: "CYFSA s. 74(2)", citationStatus: "verified",
      supportingEntryIds: ["e1", "e2"], pageNumber: 3, concern: "POSSIBLE_CONCERN", evidenceClassification: "HEARSAY",
      eventType: "COURT_ORDER", recordKind: "COURT_ORDER", scoring: "NOT_CREDIBILITY_SCORED", verifiedBy: "Independent second review",
      schemaVersion: "2.0.0", isMet: "Inconclusive", quoteVerification: "EXACT", verificationStatus: "LOCATED_EXACT",
    });
    expect(out).toMatchObject({
      id: "rf_1", type: "redFlag", kind: "EVIDENCE", classification: "Procedural", severity: "high", category: "disclosure",
      status: "verified", confidence: "high", verdict: "supported", legalReference: "CYFSA s. 74(2)", citationStatus: "verified",
      supportingEntryIds: ["e1", "e2"], pageNumber: 3, concern: "POSSIBLE_CONCERN", evidenceClassification: "HEARSAY",
      eventType: "COURT_ORDER", recordKind: "COURT_ORDER", scoring: "NOT_CREDIBILITY_SCORED", verifiedBy: "Independent second review",
      schemaVersion: "2.0.0", isMet: "Inconclusive", quoteVerification: "EXACT", verificationStatus: "LOCATED_EXACT",
    });
  });

  it.each([
    "severity", "category", "status", "confidence", "kind", "type", "concern", "classification", "evidenceClassification",
    "citationStatus", "recordKind", "scoring", "verdict", "eventType", "verifiedBy", "schemaVersion", "isMet", "quoteVerification",
  ])("redacts a name placed under the structural key %s (G-1, default deny)", (key) => {
    const out: any = redactForExport({ [key]: CANARY });
    expect(out[key]).toBe(REDACTED_TEXT);
  });

  it.each(["id", "findingId", "legacyId", "sectionId", "allegationFindingId", "documentId"])("redacts prose, names and dates under the id key %s", (key) => {
    for (const bad of [CANARY, "Syntheticparent1", "parent's statement", "2026-01-05", "05/01/2026", "FC-2026-0417"]) {
      expect((redactForExport({ [key]: bad }) as any)[key]).toBe(REDACTED_TEXT);
    }
  });

  it("redacts a name inside an id array without dropping or reordering entries", () => {
    const out: any = redactForExport({ supportingEntryIds: ["e1", CANARY, "e3"] });
    expect(out.supportingEntryIds).toEqual(["e1", REDACTED_TEXT, "e3"]);
  });

  it("redacts citation prose: legalReference \"parent's statement, s. 74\" (G-2)", () => {
    expect((redactForExport({ legalReference: "parent's statement, s. 74" }) as any).legalReference).toBe(REDACTED_TEXT);
  });

  it("treats every date as identifying: event, hearing and sort dates are removed, and no structural key admits a date", () => {
    const out: any = redactForExport({ date: "2026-01-05", dateAsWritten: "January 5, 2026", sortDate: "2026-01-05", hearingDate: "2026-02-01", analysisDate: "2026-11-27" });
    for (const v of Object.values(out)) expect(v).toBe(REDACTED_TEXT);
    expect(isSafeStructuralValue("schemaVersion", "2026.1.5")).toBe(false);
    expect(isSafeStructuralValue("id", "2026-01-05")).toBe(false);
  });

  it("is case-exact where the vocabulary is upper-case codes, and rejects near-misses", () => {
    expect(isSafeStructuralValue("concern", "possible_concern")).toBe(false);
    expect(isSafeStructuralValue("evidenceClassification", "HEARSAY from mother")).toBe(false);
    expect(isSafeStructuralValue("severity", "high, per Jordan")).toBe(false);
    expect(isSafeStructuralValue("unknownKey", "high")).toBe(false);
  });

  it("an object-shaped key cannot be used to smuggle text (prototype keys are not validators)", () => {
    expect(isSafeStructuralValue("constructor", CANARY)).toBe(false);
    expect(isSafeStructuralValue("__proto__", CANARY)).toBe(false);
  });

  it("keeps finding count, order, ids, kinds, classifications, valid citations and supporting ids on a real fixture; removes every free-text value", () => {
    const report: any = JSON.parse(JSON.stringify(ALL_REPORT_FIXTURES.casAffidavit));
    for (const flag of report.redFlags) { flag.phraseDetected = CANARY; flag.explanation = CANARY; flag.verifyRequirement = CANARY; flag.parentActionStep = CANARY; flag.locationInDocument = CANARY; }
    report.fileSummary = CANARY; report.documentTitle = CANARY; report.documentType = CANARY;
    const out: any = redactForExport(report);
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out.redFlags.map((f: any) => f.id)).toEqual(report.redFlags.map((f: any) => f.id));
    expect(out.redFlags.map((f: any) => f.severity)).toEqual(report.redFlags.map((f: any) => f.severity));
    expect(out.redFlags.map((f: any) => f.category)).toEqual(report.redFlags.map((f: any) => f.category));
    expect(out.redFlags.map((f: any) => f.evidenceClassification)).toEqual(report.redFlags.map((f: any) => f.evidenceClassification));
    const rf2 = out.redFlags.find((f: any) => f.id === "rf2");
    expect(rf2.legalReference).toBe("CYFSA s. 74(2)");
    expect(rf2.citationStatus).toBe("INTERNAL_REFERENCE_MATCH");
    // The unverified-citation warning is prose under a citation key, so it is removed.
    expect(out.redFlags.find((f: any) => f.id === "rf1").legalReference).toBe(REDACTED_TEXT);
    expect(out.metadata).toEqual({});
  });
});
