import { describe, expect, it } from "vitest";
import { buildCourtPrep } from "../../shared/courtPrep";
import { buildPrepNotes } from "../../shared/courtPrepNotes";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures";

describe("court-prep notes export", () => {
  const prep = buildCourtPrep(ALL_REPORT_FIXTURES.casAffidavit);

  it("contains all five sections", () => {
    const text = buildPrepNotes(prep, {}, "CAS affidavit");
    for (const h of ["1. TIMELINE", "2. EVIDENCE INDEX", "3. YOUR RESPONSES", "4. FORMS", "5. DATES TO CONFIRM"]) {
      expect(text).toContain(h);
    }
  });

  it("keeps the parent's words separate from analyzer text", () => {
    const allegation = prep.allegations[0];
    const text = buildPrepNotes(prep, { [allegation.id]: { allegationFindingId: allegation.id, parentAccount: "I was at work.", supportingEntryIds: [], contraryEntryIds: [], unverifiedPoints: [], questionsForCounsel: ["Ask about the log."] } }, "T");
    expect(text).toContain("Your account: I was at work.");
    expect(text).toContain("Question for counsel: Ask about the log.");
    expect(text).toContain("(your own words, not checked by this tool)");
  });

  it("states that the notes are not a filing or sworn statement", () => {
    expect(buildPrepNotes(prep, {}, "T")).toMatch(/not filed, served, sworn, or accepted|Nothing here is filed/);
  });

  it("calculates no deadline and carries no operating data", () => {
    const text = buildPrepNotes(prep, {}, "T");
    expect(text).toContain("no deadline is calculated");
    expect(text).not.toMatch(/claude|token|model-x|\bcost\b/i);
  });

  it("states form currency as unknown", () => {
    expect(buildPrepNotes(prep, {}, "T")).toContain("Currency: unknown.");
  });
});
