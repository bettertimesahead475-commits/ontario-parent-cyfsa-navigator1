// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CourtPrepWorkspace } from "./CourtPrepWorkspace";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures";

afterEach(cleanup);

describe("CourtPrepWorkspace", () => {
  it("shows the legal-information limits and where entries are kept", () => {
    render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(screen.getByText(/not legal advice/)).toBeTruthy();
    expect(screen.getByText(/not saved to our servers/)).toBeTruthy();
  });

  it("labels the timeline and evidence as analyzer output", () => {
    const { container } = render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.judicialEndorsement} />);
    expect(container.textContent).toContain("Timeline from the analyzer");
    expect(container.textContent).toContain("analyzer findings, not your statements");
  });

  it("does not calculate a deadline", () => {
    const { container } = render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(container.textContent).toContain("No deadline is calculated");
    expect(container.textContent).not.toMatch(/deadline is \d|due on|must be filed by/i);
  });

  it("shows form currency as unknown and links to the official index", () => {
    const { container } = render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(container.textContent).toContain("Currency: unknown");
    const link = container.querySelector("a[href^='https://ontariocourtforms.on.ca']");
    expect(link).not.toBeNull();
  });

  it("records a parent's own words and reports the status", () => {
    render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(screen.getAllByText("Not written yet").length).toBeGreaterThan(0);
    const box = screen.getAllByLabelText("Your account in your own words")[0] as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "I was at work that day." } });
    expect(box.value).toBe("I was at work that day.");
    expect(screen.getByText("Written, no records selected yet")).toBeTruthy();
  });

  it("links a selected record to the response", () => {
    render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const box = screen.getAllByLabelText("Your account in your own words")[0];
    fireEvent.change(box, { target: { value: "My account." } });
    const first = screen.getAllByRole("checkbox")[0];
    fireEvent.click(first);
    expect(screen.getByText("Written, with records selected")).toBeTruthy();
  });

  it("uses labelled form controls throughout", () => {
    render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    for (const box of screen.getAllByRole("textbox")) {
      expect(box.getAttribute("id")).toBeTruthy();
    }
    expect(screen.getAllByRole("group").length).toBeGreaterThan(0);
  });

  it("renders an incomplete report without throwing", () => {
    const { container } = render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.incomplete} />);
    expect(container.textContent).toContain("No dated items were found");
  });

  it("does not show operating cost, token, or model data", () => {
    const { container } = render(<CourtPrepWorkspace report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(container.textContent).not.toMatch(/claude|token|model-x|\bcost\b/i);
  });
});
