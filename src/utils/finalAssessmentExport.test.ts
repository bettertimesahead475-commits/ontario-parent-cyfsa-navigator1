import { describe, expect, it } from "vitest";
import { renderFinalAssessmentHtml } from "./finalAssessmentExport";

const report = {
  reportId: "r1",
  matterId: "m1",
  title: "Synthetic matter <A>",
  createdAt: "2026-11-20T15:00:00Z",
  allowance: "",
  sources: [
    { id: "s-a", document: "affidavit.txt", version: "v1", page: 1, text: "The worker visited on October 3." },
    { id: "s-b", document: "notes.txt", version: "v1", page: 1, text: "Visit recorded on October 5." },
  ],
  sections: {
    overview: [{ text: "Two synthetic documents describe one home visit.", sources: ["s-a", "s-b"] }],
    chronology: [{ text: "Home visit, date disputed.", sources: ["s-a"] }],
    conflicts: [{ text: "The visit date differs between documents.", sources: ["s-a", "s-b", "unknown"] }],
    gaps: [],
    questions: [{ text: "Which date is correct?", sources: [] }],
  },
};

describe("Final Case Assessment PDF", () => {
  const html = renderFinalAssessmentHtml(report, { generatedAt: new Date("2026-11-26T12:00:00Z") });

  it("has a cover, contents, every section and the source appendix", () => {
    for (const text of ["Final Case Assessment", "Contents", "Case Overview", "Chronology", "Conflicting Accounts", "Evidence Gaps", "Questions for Counsel", "Source Pages Reviewed"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("No items were identified for this section.");
    expect(html).toContain('counter(page) " of " counter(pages)');
  });

  it("links each finding to the source pages it cites and ignores unknown sources", () => {
    expect(html).toContain('href="#source-1">[S1: affidavit.txt, p. 1]');
    expect(html).toContain('href="#source-2">[S2: notes.txt, p. 1]');
    expect(html).toContain('id="source-2"');
    expect(html).not.toContain("unknown");
    expect(html).toContain("The worker visited on October 3.");
  });

  it("escapes text, has no inline scripts, and carries the legal-information notice", () => {
    expect(html).toContain("Synthetic matter &lt;A&gt;");
    expect(html).not.toMatch(/<script|onclick=/i);
    expect(html).toContain("not legal advice, not a court filing, and not certified");
  });

  it("does not invent a date when the saved date is missing", () => {
    expect(renderFinalAssessmentHtml({ ...report, createdAt: "" })).toContain("Not recorded");
  });
});
