import { describe, expect, it } from "vitest";
import { buildParentReportView, readability } from "./parentReportView";

// A quote from pasted text must not be presented as the original record. A match against pasted text is a text match only.
const flag = (extra: Record<string, unknown>) => ({
  id: "rf1",
  phraseDetected: "the child appeared unwell",
  explanation: "x",
  legalReference: "",
  ...extra,
});

describe("parent view: quote provenance", () => {

  it("says a quote from pasted text is not confirmed against the original file", () => {
    const view = buildParentReportView({
      sourceProvenance: "pasted_text",
      redFlags: [flag({ quoteVerified: null, quoteVerification: "UNAUTHENTICATED_SOURCE" })],
    });
    const what = view.findings[0].whatHappened;
    expect(what).toContain("We did not check it against your original file");
    expect(what).not.toContain("The record says");
  });

  it("reports that the words appear in the pasted text, without calling them the record", () => {
    const view = buildParentReportView({
      sourceProvenance: "pasted_text",
      redFlags: [flag({ quoteVerified: null, quoteVerification: "UNAUTHENTICATED_SOURCE", pastedTextMatch: true })],
    });
    expect(view.findings[0].whatHappened).toContain("The words appear in the text you pasted.");
    expect(view.findings[0].whatHappened).not.toContain("The record says");
  });

  it("reports that the words are not in the pasted text, so the point is treated as a paraphrase", () => {
    const view = buildParentReportView({
      sourceProvenance: "pasted_text",
      redFlags: [flag({ quoteVerified: null, quoteVerification: "UNAUTHENTICATED_SOURCE", pastedTextMatch: false })],
    });
    expect(view.findings[0].whatHappened).toContain("Treat it as a paraphrase");
  });

  it("still presents a verified quote as the record's words", () => {
    const view = buildParentReportView({
      sourceProvenance: "authenticated_pages",
      redFlags: [flag({ quoteVerified: true, quoteVerification: "EXACT" })],
    });
    expect(view.findings[0].whatHappened).toContain("The record says");
  });
});

describe("parent view: how the report was checked", () => {
  const finding = (status: string, page: number, extra: Record<string, unknown> = {}) => ({
    id: `rf${page}`,
    phraseDetected: "the child appeared unwell",
    explanation: "x",
    legalReference: "",
    locationInDocument: `Page ${page}`,
    pageCitation: { status, reportedPage: page, sourcePages: [] },
    ...extra,
  });

  it("states that pasted text was not checked against the original file", () => {
    const view = buildParentReportView({ sourceProvenance: "pasted_text", redFlags: [finding("PAGE_UNVERIFIABLE", 1)] });
    expect(view.sourceCheck.heading).toBe("How this report was checked");
    expect(view.sourceCheck.lines[0]).toContain("You pasted this text");
    expect(view.sourceCheck.lines.join(" ")).toContain("not checked against a page");
  });

  it("counts verified, corrected and missing page checks for an uploaded file", () => {
    const view = buildParentReportView({
      sourceProvenance: "authenticated_pages",
      redFlags: [
        finding("PAGE_VERIFIED", 1),
        finding("PAGE_CORRECTED", 2, { pageCitation: { status: "PAGE_CORRECTED", reportedPage: 2, sourcePages: [3] } }),
        finding("PAGE_NOT_FOUND", 4),
      ],
    });
    const text = view.sourceCheck.lines.join(" ");
    expect(view.sourceCheck.lines[0]).toContain("We checked the quotes and page numbers");
    expect(text).toContain("We looked at 3 points.");
    expect(text).toContain("1 point is on the page named.");
    expect(text).toContain("1 point is on a different page.");
    expect(text).toContain("1 point could not be found on any page.");
  });

  it("gives the page the words were found on when the analyzer named another page", () => {
    const view = buildParentReportView({
      sourceProvenance: "authenticated_pages",
      redFlags: [finding("PAGE_CORRECTED", 2, { pageCitation: { status: "PAGE_CORRECTED", reportedPage: 2, sourcePages: [3] } })],
    });
    expect(view.findings[0].evidenceDetail.pageCheck).toBe("We found the words on page 3, not page 2. Check page 3.");
  });

  it("keeps every new parent-facing sentence at or below Grade 8", () => {
    const view = buildParentReportView({
      sourceProvenance: "pasted_text",
      redFlags: [
        flag({ quoteVerified: null, quoteVerification: "UNAUTHENTICATED_SOURCE", pastedTextMatch: true, locationInDocument: "Page 1", pageCitation: { status: "PAGE_UNVERIFIABLE" } }),
        finding("PAGE_NOT_FOUND", 4),
      ],
    });
    const lines = [
      ...view.sourceCheck.lines,
      ...view.findings.flatMap((f) => [f.whatHappened, f.evidenceDetail.pageCheck]),
    ];
    for (const line of lines) {
      expect(readability(line).gradeLevel, line).toBeLessThanOrEqual(8);
    }
  });
});
