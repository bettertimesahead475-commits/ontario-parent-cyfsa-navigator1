// Page citations are checked against the page the quotation really appears on. The model's page number is kept
// as reported; a correction is proposed only when the quotation is on exactly one other page.
import { describe, expect, it } from "vitest";
import { applyReportGuards, pageTextsFromSource, verifyPageCitation } from "./analyzerSections.js";

const SOURCE = [
  "[Page 1]",
  "The Society received a report about the family on 4 March 2026 from a neighbour.",
  "",
  "[Page 2]",
  "The worker said the child appeared unwell at school on 9 March 2026.",
  "",
  "[Page 3]",
  "Notice of hearing issued on 12 March 2026.",
].join("\n");

describe("pageTextsFromSource", () => {
  it("splits the extractor's [Page N] boundaries into per-page text", () => {
    const pages = pageTextsFromSource(SOURCE);
    expect([...pages.keys()]).toEqual([1, 2, 3]);
    expect(pages.get(2)).toContain("appeared unwell at school");
    expect(pages.get(2)).not.toContain("Notice of hearing");
  });

  it("returns no pages for a source without page boundaries", () => {
    expect(pageTextsFromSource("Plain text with no page labels.").size).toBe(0);
  });
});

describe("verifyPageCitation", () => {
  it("VERIFIED: the cited page contains the quotation", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 2, Paragraph 1", phraseDetected: "appeared unwell at school" };
    verifyPageCitation(flag, SOURCE);
    expect(flag.pageCitation).toEqual({ status: "PAGE_VERIFIED", reportedPage: 2, sourcePages: [2] });
    expect(flag.locationInDocument).toBe("Page 2, Paragraph 1");
    expect(flag.locationAsReported).toBeUndefined();
  });

  it("CORRECTED: a wrong page number is proposed as a correction, with the original kept", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 1", phraseDetected: "appeared unwell at school" };
    verifyPageCitation(flag, SOURCE);
    expect(flag.pageCitation).toMatchObject({ status: "PAGE_CORRECTED", reportedPage: 1, sourcePages: [2] });
    // The reported location is untouched; the proposal is separate.
    expect(flag.locationInDocument).toBe("Page 1");
    expect(flag.proposedLocation).toBe("Page 2");
    expect(flag.locationAsReported).toBeUndefined();
  });

  it("NOT_FOUND: a quotation that is on no page keeps its reported location and is flagged", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 3", phraseDetected: "the child was taken by police" };
    verifyPageCitation(flag, SOURCE);
    expect(flag.pageCitation).toMatchObject({ status: "PAGE_NOT_FOUND", reportedPage: 3, sourcePages: [] });
    expect(flag.locationInDocument).toBe("Page 3");
    expect(flag.locationAsReported).toBeUndefined();
  });

  it("AMBIGUOUS: a quotation on several pages is never silently relocated", () => {
    const source = `[Page 1]\nThe same sentence appears here in full.\n\n[Page 4]\nThe same sentence appears here in full.`;
    const flag: Record<string, any> = { locationInDocument: "Page 2", phraseDetected: "The same sentence appears here in full." };
    verifyPageCitation(flag, source);
    expect(flag.pageCitation).toMatchObject({ status: "PAGE_AMBIGUOUS", reportedPage: 2, sourcePages: [1, 4] });
    expect(flag.locationInDocument).toBe("Page 2");
    expect(flag.proposedLocation).toBeUndefined();
  });

  it("UNVERIFIABLE: a source without page boundaries cannot confirm a page", () => {
    const flag: Record<string, any> = { locationInDocument: "Page 2", phraseDetected: "appeared unwell" };
    verifyPageCitation(flag, "Plain text, no page labels, appeared unwell at school.");
    expect(flag.pageCitation).toEqual({ status: "PAGE_UNVERIFIABLE", reportedPage: 2 });
  });

  it("NO_PAGE_CITED: a finding that names no page is not given a page status it did not earn", () => {
    const flag: Record<string, any> = { locationInDocument: "Paragraph 4", phraseDetected: "appeared unwell" };
    verifyPageCitation(flag, SOURCE);
    expect(flag.pageCitation).toEqual({ status: "NO_PAGE_CITED" });
  });
});

describe("applyReportGuards keeps page checks with quote checks", () => {
  it("runs the page check for every red flag", () => {
    const report: Record<string, any> = {
      redFlags: [
        { locationInDocument: "Page 1", phraseDetected: "appeared unwell at school", legalReference: "" },
        { locationInDocument: "Page 3", phraseDetected: "a fabricated quotation", legalReference: "" },
      ],
    };
    applyReportGuards(report, SOURCE);
    expect(report.redFlags[0].pageCitation.status).toBe("PAGE_CORRECTED");
    expect(report.redFlags[1].quoteVerified).toBe(false);
    expect(report.redFlags[1].pageCitation.status).toBe("PAGE_NOT_FOUND");
  });
});
