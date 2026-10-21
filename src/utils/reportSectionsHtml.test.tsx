import { describe, expect, it } from "vitest";
import { buildSectionedReport } from "../../shared/reportSections";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures";
import { REPORT_SECTIONS } from "../../shared/reportContract";
import { escapeHtml, renderReportSectionsHtml } from "./reportSectionsHtml";

const OPERATING = /claude|usage|totalCost|inputTokens|outputTokens|token|model-x|engineName|durationMs|\bcost\b/i;

describe("16-section HTML export", () => {
  for (const [name, fixture] of Object.entries(ALL_REPORT_FIXTURES)) {
    it(`${name}: contains all sixteen headings in order`, () => {
      const html = renderReportSectionsHtml(fixture, "parent", "Test");
      let last = -1;
      for (const s of REPORT_SECTIONS) {
        const at = html.indexOf(`${s.number}. ${escapeHtml(s.title)}`);
        expect(at, `${name}: ${s.title}`).toBeGreaterThan(last);
        last = at;
      }
    });

    it(`${name}: preserves every finding the contract produced`, () => {
      const contract = buildSectionedReport(fixture);
      const html = renderReportSectionsHtml(fixture, "professional", "Test");
      const rendered = html.match(/class="finding"/g)?.length ?? 0;
      expect(rendered).toBe(contract.findings.length);
    });

    it(`${name}: never shows operating-cost, token, or model data`, () => {
      const html = renderReportSectionsHtml(fixture, "professional", "Test");
      expect(html).not.toMatch(OPERATING);
    });
  }

  it("escapes markup from the analyzer text", () => {
    const html = renderReportSectionsHtml(
      { documentType: "<script>alert(1)</script>", fileSummary: 'A & B "quoted"', redFlags: [] },
      "parent",
      "T"
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B &quot;quoted&quot;");
  });

  it("states the court-record limit and that no score is shown", () => {
    const html = renderReportSectionsHtml(ALL_REPORT_FIXTURES.judicialEndorsement, "parent", "T");
    expect(html).toContain("not scored for credibility or completeness");
    expect(html).not.toMatch(/\b28\s*\/\s*100|\b25\s*\/\s*100|\bscore: \d+/);
  });

  it("gives the same eight questions to both audiences", () => {
    const parent = renderReportSectionsHtml(ALL_REPORT_FIXTURES.casAffidavit, "parent", "T");
    const pro = renderReportSectionsHtml(ALL_REPORT_FIXTURES.casAffidavit, "professional", "T");
    for (const q of ["What happened?", "What have courts said?", "What is still unknown?"]) {
      expect(parent).toContain(q);
      expect(pro).toContain(q);
    }
  });

  it("shows the professional-only details only to professionals", () => {
    const parent = renderReportSectionsHtml(ALL_REPORT_FIXTURES.casAffidavit, "parent", "T");
    const pro = renderReportSectionsHtml(ALL_REPORT_FIXTURES.casAffidavit, "professional", "T");
    expect(parent).not.toContain("Finding ID");
    expect(pro).toContain("Finding ID");
  });

  it("says court-decision research was not performed rather than inventing decisions", () => {
    const html = renderReportSectionsHtml(ALL_REPORT_FIXTURES.casAffidavit, "parent", "T");
    expect(html).toContain("Not researched. No verified court decision is connected");
  });

  it("is a complete standalone document with a language and viewport", () => {
    const html = renderReportSectionsHtml(ALL_REPORT_FIXTURES.documentary, "parent", "T");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="en"');
    expect(html).toContain("viewport");
    expect(html).toContain("@media print");
  });
});
