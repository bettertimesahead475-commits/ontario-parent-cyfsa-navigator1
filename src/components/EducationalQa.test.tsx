// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EducationalQa } from "./EducationalQa";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures";

afterEach(cleanup);

describe("EducationalQa", () => {
  it("states what answers are drawn from and that nothing is saved", () => {
    render(<EducationalQa report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(screen.getByText(/Nothing is saved/)).toBeTruthy();
    expect(screen.getByText(/not advice/)).toBeTruthy();
  });

  it("answers a typed question and announces the answer politely", () => {
    render(<EducationalQa report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const input = screen.getByLabelText("Your question");
    fireEvent.change(input, { target: { value: "What is hearsay?" } });
    fireEvent.submit(input.closest("form")!);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Plain-language meaning");
  });

  it("answers a suggested question with one click", () => {
    const { container } = render(<EducationalQa report={ALL_REPORT_FIXTURES.judicialEndorsement} />);
    fireEvent.click(screen.getByRole("button", { name: "What is missing from this report?" }));
    expect(container.textContent).toMatch(/affidavit/i);
  });

  it("says plainly when the records do not answer", () => {
    render(<EducationalQa report={ALL_REPORT_FIXTURES.casAffidavit} />);
    const input = screen.getByLabelText("Your question");
    fireEvent.change(input, { target: { value: "What is the weather on Mars?" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("status").textContent).toContain("does not answer that question");
  });

  it("labels every control and does not show operating data", () => {
    const { container } = render(<EducationalQa report={ALL_REPORT_FIXTURES.casAffidavit} />);
    expect(screen.getByLabelText("Your question")).toBeTruthy();
    expect(container.textContent).not.toMatch(/claude|token|model-x|\bcost\b/i);
  });
});
