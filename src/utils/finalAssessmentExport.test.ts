import { describe, expect, it } from "vitest";
import { FINAL_ASSESSMENT_REDACTED_NOTICE, renderFinalAssessmentHtml } from "./finalAssessmentExport";

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

  describe("with the export redaction setting on", () => {
    const pii = {
      ...report,
      title: "Synthetic Family SYN-2026-0417",
      sources: [
        { id: "s-a", document: "smith-affidavit.txt", version: "v1", page: 2, text: "Call 416-555-0199 about FC-26-00001234-0000, born 2019-04-03." },
      ],
      sections: { ...report.sections, overview: [{ text: "Worker phoned 416 555 0199 on 03/02/2026.", sources: ["s-a"] }] },
    };
    const redacted = renderFinalAssessmentHtml(pii, { redact: true, generatedAt: new Date("2026-11-26T12:00:00Z") });

    it("masks the matter title and source file names but keeps page attribution", () => {
      expect(redacted).not.toContain("Synthetic Family");
      expect(redacted).not.toContain("SYN-2026-0417");
      expect(redacted).not.toContain("smith-affidavit");
      expect(redacted).toContain("Redacted matter");
      expect(redacted).toContain("[S1: Source document 1, p. 2]");
      expect(redacted).toContain("S1. Source document 1 — page 2");
    });

    it("masks phone numbers, dates and court file numbers in findings and source text", () => {
      for (const value of ["416-555-0199", "416 555 0199", "03/02/2026", "2019-04-03", "FC-26-00001234-0000"]) {
        expect(redacted).not.toContain(value);
      }
      expect(redacted).toContain("Worker phoned [PHONE] on [DATE].");
      expect(redacted).toContain("Call [PHONE] about [FILE], born [DATE].");
    });

    it("masks parenthesized phone numbers and written-out dates", () => {
      const written = renderFinalAssessmentHtml(
        { ...pii, sections: { ...pii.sections, overview: [{ text: "Call (416) 555-0199; born April 3, 2019; seen 3 April 2019 and Sept. 14th, 2026.", sources: ["s-a"] }] } },
        { redact: true }
      );
      for (const value of ["(416) 555-0199", "555-0199", "April 3, 2019", "3 April 2019", "Sept. 14th, 2026"]) {
        expect(written).not.toContain(value);
      }
      expect(written).toContain("Call [PHONE]; born [DATE]; seen [DATE] and [DATE].");
    });

    it("says what was masked and does not change the unredacted copy or the input", () => {
      expect(redacted).toContain(FINAL_ASSESSMENT_REDACTED_NOTICE);
      expect(html).not.toContain(FINAL_ASSESSMENT_REDACTED_NOTICE);
      expect(pii.sources[0].document).toBe("smith-affidavit.txt");
      expect(renderFinalAssessmentHtml(pii)).toContain("smith-affidavit.txt");
    });
  });
});
