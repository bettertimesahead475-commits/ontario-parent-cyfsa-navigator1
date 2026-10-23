// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ReportSections } from "./ReportSections";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures";
import { REPORT_SECTIONS } from "../../shared/reportContract";

describe("ReportSections", () => {
  afterEach(cleanup);

  it("renders the sixteen sections in order as native details elements", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const headings = Array.from(container.querySelectorAll("details[id^='report-'] h3")).map((h) => h.textContent);
    expect(headings).toEqual(REPORT_SECTIONS.map((s) => `${s.number}. ${s.title}`));
    expect(container.querySelectorAll("details[id^='report-']")).toHaveLength(16);
  });

  it("provides a jump-to-section navigation with a link for each section", () => {
    render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const nav = screen.getByRole("navigation", { name: "Jump to a section" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(16);
    expect(links[0].getAttribute("href")).toBe("#report-S01");
    expect(links[15].getAttribute("href")).toBe("#report-S16");
  });

  it("opens only the summary section on first view", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const open = Array.from(container.querySelectorAll("details[id^='report-']")).filter((d) => (d as HTMLDetailsElement).open);
    expect(open.map((d) => d.id)).toEqual(["report-S01"]);
  });

  it("states a court record is not scored", () => {
    render(<ReportSections report={ALL_REPORT_FIXTURES.judicialEndorsement} />);
    expect(screen.getByRole("note").textContent).toMatch(/not scored for credibility or completeness/);
  });

  it("does not show a credibility percentage for a court order", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.courtOrder} />);
    expect(container.textContent).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
  });

  it("explains an empty section as no relevant finding, and an unproduced section as not produced", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.documentary} />);
    const text = container.textContent ?? "";
    expect(text).toContain("No relevant finding identified");
    expect(text).toContain("Not produced by this analysis");
  });

  it("labels court-decision research as not performed rather than listing decisions", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(container.textContent).toContain("Not researched. No verified court decision is connected to this analysis yet.");
  });

  it("marks a missing referenced affidavit as missing information", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.missingAffidavit} />);
    expect(container.textContent).toContain("Missing information");
  });

  it("shows the same findings to parents and professionals", () => {
    const parent = render(<ReportSections report={ALL_REPORT_FIXTURES.conflictingRecords} audience="parent" />);
    const parentTitles = Array.from(parent.container.querySelectorAll("summary")).map((s) => s.textContent);
    parent.unmount();
    const pro = render(<ReportSections report={ALL_REPORT_FIXTURES.conflictingRecords} audience="professional" />);
    const proTitles = Array.from(pro.container.querySelectorAll("summary")).map((s) => s.textContent);
    expect(proTitles).toEqual(parentTitles);
  });

  it("adds professional detail only for professionals", () => {
    const parent = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} audience="parent" />);
    expect(parent.container.textContent).not.toContain("Finding ID");
    parent.unmount();
    const pro = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} audience="professional" />);
    expect(pro.container.textContent).toContain("Finding ID");
    expect(pro.container.textContent).toContain("Supporting findings");
  });

  it("never shows operating-cost, token, or model identifiers", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} audience="professional" />);
    expect(container.textContent).not.toMatch(/claude|usage|token|model-x|engineName|durationMs|\bcost\b/i);
  });

  it("gives the eight standard questions for every finding", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const findingsCount = container.querySelectorAll("dl > div").length;
    expect(findingsCount).toBeGreaterThan(8);
    expect(container.textContent).toContain("What evidence challenges it?");
  });

  it("renders an incomplete report without throwing", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.incomplete} />);
    expect(container.querySelectorAll("details[id^='report-']")).toHaveLength(16);
  });

  it("uses no code-style font", () => {
    const { container } = render(<ReportSections report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(container.querySelector("code, pre, kbd, samp")).toBeNull();
  });
});
