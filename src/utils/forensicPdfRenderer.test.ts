import { describe, expect, it } from "vitest";
import { isScored, renderForensicReportHtml } from "./forensicPdfRenderer";

describe("forensic PDF renderer with missing data", () => {
  const html = renderForensicReportHtml({
    documentTitle: "Synthetic affidavit",
    evidenceStrengthIndex: { components: { corroboration: { maxScore: 15 } } },
  });

  it("does not invent court-file metadata", () => {
    for (const invented of ["FC-25-00000240-0000", "September 25, 2025", "Family &amp; Children's Services", "Parent Parties", "Ontario Child Welfare Court Document"]) {
      expect(html).not.toContain(invented);
    }
    expect(html).toContain("Not stated in the document");
  });

  it("shows unscored values as not scored instead of a number", () => {
    expect(html).toContain("Information Completeness: Not scored");
    expect(html).not.toMatch(/>\s*62\s*</);
    expect(html).not.toContain("0 / 15");
    expect(html).not.toContain("Evaluated from document record.");
  });

  it("does not call the reference list verified for this case", () => {
    expect(html).toContain("does not mean the provision applies to this case");
  });

  it("numbers the sections it shows without gaps", () => {
    const numbers = [...html.matchAll(/<h2 class="section-heading">(\d+)\. /g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("does not claim a second review or e-Laws verification that did not happen", () => {
    expect(html).not.toContain("Dual-Pass");
    expect(html).not.toContain("Citations are verified against Ontario e-Laws");
    expect(html).toContain("The second review was not completed for this report.");
    const incomplete = renderForensicReportHtml({ forensicVerification: { status: "incomplete" } });
    expect(incomplete).toContain("Not completed. The findings were not second-reviewed.");
    expect(incomplete).not.toContain("Verification in progress");
    const done = renderForensicReportHtml({ forensicVerification: { status: "completed", checkedFindings: 4 } });
    expect(done).toContain("Completed. 4 findings checked");
  });

  it("keeps real scores, including zero", () => {
    const scored = renderForensicReportHtml({
      completenessScore: 0,
      evidenceStrengthIndex: { score: 41, components: { corroboration: { score: 7, maxScore: 15 } } },
    });
    expect(scored).toContain("Information Completeness: 0/100");
    expect(scored).toContain("7 / 15");
    expect(scored).toMatch(/>\s*41\s*</);
  });
});

describe("isScored", () => {
  it("accepts numbers and numeric strings only", () => {
    expect([0, 55, "40"].map(isScored)).toEqual([true, true, true]);
    expect([undefined, null, "", "n/a", true, NaN].map(isScored)).toEqual([false, false, false, false, false, false]);
  });
});
