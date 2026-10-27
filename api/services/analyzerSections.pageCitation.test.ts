// Page citations are checked only against an authoritative page map (server extraction). Each finding keeps the
// page the model reported; a correction is proposed only when the quotation is on exactly one other authoritative
// page. Without an authoritative map every page citation is unverifiable, whatever the text says.
import { describe, expect, it } from "vitest";
import { applyReportGuards, verifyPageCitation } from "./analyzerSections.js";

const PAGES = new Map<number, string>([
  [1, "The Society received a report about the family on 4 March 2026 from a neighbour."],
  [2, "The worker said the child appeared unwell at school on 9 March 2026."],
  [3, "Notice of hearing issued on 12 March 2026."],
]);

// The source text the analyzer sees. For the citation check it does not matter what the text says.
const SOURCE = [...PAGES].map(([n, t]) => `[Page ${n}]\n${t}`).join("\n\n");

describe("verifyPageCitation with an authoritative page map", () => {
  it("VERIFIED: the cited authoritative page contains the quotation", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 2, Paragraph 1", phraseDetected: "appeared unwell at school" };
    verifyPageCitation(flag, PAGES);
    expect(flag.pageCitation).toEqual({ status: "PAGE_VERIFIED", reportedPage: 2, sourcePages: [2] });
    expect(flag.locationInDocument).toBe("Page 2, Paragraph 1");
    expect(flag.proposedLocation).toBeUndefined();
  });

  it("CORRECTED: a wrong page is proposed as a correction, and the reported location is kept", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 1", phraseDetected: "appeared unwell at school" };
    verifyPageCitation(flag, PAGES);
    expect(flag.pageCitation).toMatchObject({ status: "PAGE_CORRECTED", reportedPage: 1, sourcePages: [2] });
    expect(flag.locationInDocument).toBe("Page 1");
    expect(flag.proposedLocation).toBe("Page 2");
  });

  it("NOT_FOUND: a quotation on no authoritative page keeps its location and is flagged", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 3", phraseDetected: "the child was taken by police" };
    verifyPageCitation(flag, PAGES);
    expect(flag.pageCitation).toMatchObject({ status: "PAGE_NOT_FOUND", reportedPage: 3, sourcePages: [] });
    expect(flag.proposedLocation).toBeUndefined();
  });

  it("AMBIGUOUS: a quotation on several authoritative pages is never silently relocated", () => {
    const pages = new Map<number, string>([
      [1, "The same sentence appears here in full."],
      [4, "The same sentence appears here in full."],
    ]);
    const flag: Record<string, any> = { locationInDocument: "Page 2", phraseDetected: "The same sentence appears here in full." };
    verifyPageCitation(flag, pages);
    expect(flag.pageCitation).toMatchObject({ status: "PAGE_AMBIGUOUS", reportedPage: 2, sourcePages: [1, 4] });
    expect(flag.proposedLocation).toBeUndefined();
  });

  it("UNVERIFIABLE: no authoritative pages means no page can be verified", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 2", phraseDetected: "appeared unwell" };
    verifyPageCitation(flag, null);
    expect(flag.pageCitation).toEqual({ status: "PAGE_UNVERIFIABLE", reportedPage: 2 });
  });

  it("NO_PAGE_CITED: a finding that names no page is not given a page status it did not earn", () => {
    const flag: Record<string, any> = { locationInDocument: "Paragraph 4", phraseDetected: "appeared unwell" };
    verifyPageCitation(flag, PAGES);
    expect(flag.pageCitation).toEqual({ status: "NO_PAGE_CITED" });
  });
});

describe("applyReportGuards keeps page checks tied to authoritative pages", () => {
  it("records the provenance and runs the page check for every red flag", () => {
    const report: Record<string, any> = {
      redFlags: [
        { locationInDocument: "Page 1", phraseDetected: "appeared unwell at school", legalReference: "" },
        { locationInDocument: "Page 3", phraseDetected: "a fabricated quotation", legalReference: "" },
      ],
    };
    applyReportGuards(report, PAGES);
    expect(report.sourceProvenance).toBe("authenticated_pages");
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_CORRECTED");
    expect(report.redFlags[1].quoteVerified).toBe(false);
    expect(report.redFlags[1].pageCitation.status).toBe("PAGE_NOT_FOUND");
  });
});
