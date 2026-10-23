import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_PROVIDER,
  customerAuthorities,
  researchStatus,
  verificationProblems,
  type AuthorityRecord,
} from "../../shared/authorityVerification.js";

const base: AuthorityRecord = {
  id: "A1",
  status: "VERIFIED",
  caseName: "Example v. Example",
  court: "Example Court",
  decisionDate: "2001-01-01",
  neutralCitation: "2001 EXCT 1",
  sourceReference: { sourceName: "Authorized source", url: null, retrievedOn: "2026-10-21" },
  paragraphs: ["12"],
  legalPrinciple: "Example principle.",
  applicationToIssue: "Applies to the issue.",
  similarities: [],
  differences: [],
  stance: "SUPPORTING",
  subsequentTreatment: "NOT_CHECKED",
  issueId: "I1",
};

describe("authority verification", () => {
  it("accepts a complete verified record", () => {
    expect(verificationProblems(base)).toEqual([]);
  });

  it("rejects a verified record missing paragraphs or a source", () => {
    expect(verificationProblems({ ...base, paragraphs: [] })).toContain("paragraph references missing");
    expect(verificationProblems({ ...base, sourceReference: null })).toContain("source reference missing");
  });

  it("never lets an unverified lead into customer-facing authorities", () => {
    const lead: AuthorityRecord = { ...base, status: "UNVERIFIED_LEAD" };
    expect(customerAuthorities([lead])).toEqual([]);
  });

  it("drops a verified-looking record that fails validation", () => {
    expect(customerAuthorities([{ ...base, paragraphs: [] }])).toEqual([]);
  });

  it("states that subsequent treatment was not checked unless it was", () => {
    const [out] = customerAuthorities([base]);
    expect(out.treatmentNote).toMatch(/not checked/);
    const [checked] = customerAuthorities([{ ...base, subsequentTreatment: "CHECKED" }]);
    expect(checked.treatmentNote).toBe("Subsequent treatment checked.");
  });
});

describe("research status", () => {
  it("reports research not performed when it was not run", () => {
    expect(researchStatus(UNAVAILABLE_PROVIDER, false, [])).toBe("RESEARCH_NOT_PERFORMED");
  });

  it("reports the source unavailable when no authorized provider is connected", () => {
    expect(researchStatus(UNAVAILABLE_PROVIDER, true, [])).toBe("SOURCE_UNAVAILABLE");
  });

  it("reports no verified authority when the provider finds only leads", () => {
    const provider = { name: "test", find: async () => [] };
    expect(researchStatus(provider, true, [{ ...base, status: "UNVERIFIED_LEAD" }])).toBe("NO_VERIFIED_AUTHORITY_FOUND");
  });

  it("lists verified authorities when they exist", () => {
    const provider = { name: "test", find: async () => [base] };
    expect(researchStatus(provider, true, [base])).toBe("VERIFIED_AUTHORITIES_LISTED");
  });

  it("the unavailable provider returns nothing and does not invent results", async () => {
    expect(await UNAVAILABLE_PROVIDER.find("any issue")).toEqual([]);
  });
});
