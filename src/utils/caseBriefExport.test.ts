import { describe, expect, it } from "vitest";
import { CASE_BRIEF_NOTICE, formatLawyerCaseBriefText, renderLawyerCaseBriefHtml } from "./caseBriefExport";

const REPORT = {
  documentTitle: "Synthetic affidavit of a society worker",
  documentType: "Affidavit",
  analysisDate: "2026-11-20",
  fileSummary: "Synthetic summary of the affidavit.",
  lawyerCaseBrief: [
    "ISSUE — hearsay reliance — DOCUMENT EVIDENCE — \"the neighbour told me\" (p. 3, para 12) — SIGNIFICANCE — weight — LIMITATION/COUNTERPOINT — source named — VERIFY/NEXT QUESTION — was the neighbour interviewed?",
    "An unstructured <b>point</b> with markup.",
  ],
  whatToAskALawyer: ["Question: Was consent given? | What the uploaded record shows: Not determinable | Still unknown: endorsement | Source: p. 2"],
  whatToVerify: ["Request the disclosure log."],
  whatIsMissing: [],
  contradictions: [{ description: "Two dates for the same visit", locations: ["p. 2", "p. 5"], significance: "credibility" }],
};

const opts = { analyzerLabel: "Forensic Deep Scan", generatedAt: new Date("2026-11-26T12:00:00Z"), fileName: "affidavit.pdf" };

describe("renderLawyerCaseBriefHtml", () => {
  const html = renderLawyerCaseBriefHtml(REPORT, opts);

  it("renders each brief component as its own labelled subsection", () => {
    expect(html).toContain("1. Issue: hearsay reliance");
    for (const label of ["Document Evidence", "Significance", "Limitation / Counterpoint", "Verify / Next Question"]) {
      expect(html).toContain(`<span class="part-label">${label}</span>`);
    }
    expect(html).toContain("&quot;the neighbour told me&quot; (p. 3, para 12)");
    expect(html).not.toContain("ISSUE —");
  });

  it("has a cover page with identification from the saved analysis, not invented values", () => {
    expect(html).toContain("Lawyer Case Brief");
    expect(html).toContain("CYFSA Navigator");
    expect(html).toContain("Synthetic affidavit of a society worker");
    expect(html).toContain("2026-11-20");
    expect(html).toContain("Forensic Deep Scan");
    expect(html).not.toContain("Court file number");
  });

  it("includes contents, page numbers, questions, contradictions and the notice", () => {
    expect(html).toContain("<h2>Contents</h2>");
    expect(html).toContain('counter(page) " of " counter(pages)');
    expect(html).toContain("<dt>Still unknown</dt><dd>endorsement</dd>");
    expect(html).toContain("Two dates for the same visit");
    expect(html).toContain("not a court filing, and not certified");
    expect(html).not.toMatch(/court[- ]filed|certified copy/i);
    expect(html).not.toContain("Missing Information and Evidentiary Limitations");
  });

  it("escapes analyzer text and has no inline script (the site CSP forbids it)", () => {
    expect(html).toContain("&lt;b&gt;point&lt;/b&gt;");
    expect(html).not.toMatch(/<script|onclick=/i);
    expect(html).toContain("data-print-button");
  });

  it("states plainly when a report has no brief points", () => {
    const empty = renderLawyerCaseBriefHtml({ documentTitle: "X" }, opts);
    expect(empty).toContain("did not produce Lawyer Case Brief points");
    expect(empty).toContain("Not recorded");
  });
});

describe("formatLawyerCaseBriefText", () => {
  const text = formatLawyerCaseBriefText(REPORT, opts);
  it("lays out each component on its own labelled lines", () => {
    expect(text).toContain("   ISSUE\n     hearsay reliance");
    expect(text).toContain("   LIMITATION / COUNTERPOINT\n     source named");
    expect(text).toContain("   Still unknown: endorsement");
    expect(text).toContain(CASE_BRIEF_NOTICE);
    expect(text).toContain("2.\n   An unstructured <b>point</b> with markup.");
  });
});

describe("Lawyer Case Brief TXT parity with the PDF", () => {
  const report = {
    documentTitle: "Synthetic summary",
    fileSummary: "Synthetic summary text.",
    lawyerCaseBrief: [],
    contradictions: [{ description: "Synthetic attendance differs", locations: ["Page 2", "Page 3"] }],
  };
  const text = formatLawyerCaseBriefText(report, { fileName: "synthetic.txt" });
  const html = renderLawyerCaseBriefHtml(report, { fileName: "synthetic.txt" });

  it("lists the contradictions the PDF shows, with locations and an honest missing significance", () => {
    expect(html).toContain("Contradictions and Discrepancies");
    expect(text).toContain("CONTRADICTIONS AND DISCREPANCIES");
    expect(text).toContain("1. Synthetic attendance differs");
    expect(text).toContain("Where in the document: Page 2; Page 3");
    expect(text).toMatch(/Significance: Not (recorded|stated)/);
  });

  it("names the source file like the PDF cover", () => {
    expect(text).toContain("File:            synthetic.txt");
  });
});

