import { describe, expect, it } from "vitest";
import { assertFinalAssessmentRedacted, FINAL_ASSESSMENT_REDACTED_NOTICE, renderFinalAssessmentHtml } from "./finalAssessmentExport";
import { REDACTED_TEXT } from "../../shared/exportRedaction";

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

    it("removes findings and source text, including names that no pattern can detect", () => {
      const named = renderFinalAssessmentHtml(
        { ...pii, sections: { ...pii.sections, chronology: [{ text: "Jane Smith told the worker that Liam Smith missed school.", sources: ["s-a"] }] } },
        { redact: true }
      );
      for (const value of ["Jane Smith", "Liam", "416-555-0199", "416 555 0199", "03/02/2026", "2019-04-03", "FC-26-00001234-0000", "Worker phoned", "Call "]) {
        expect(named).not.toContain(value);
      }
      expect(named).toContain(REDACTED_TEXT);
      expect(named).toContain("[S1: Source document 1, p. 2]");
    });

    it("fails closed when any sensitive text would survive", () => {
      expect(() => assertFinalAssessmentRedacted("<p>smith-affidavit.txt</p>", pii)).toThrow("REDACTION_INCOMPLETE");
      expect(() => assertFinalAssessmentRedacted(redacted, pii)).not.toThrow();
    });

    it("says what was masked and does not change the unredacted copy or the input", () => {
      expect(redacted).toContain(FINAL_ASSESSMENT_REDACTED_NOTICE);
      expect(html).not.toContain(FINAL_ASSESSMENT_REDACTED_NOTICE);
      expect(pii.sources[0].document).toBe("smith-affidavit.txt");
      expect(renderFinalAssessmentHtml(pii)).toContain("smith-affidavit.txt");
    });
  });
});
