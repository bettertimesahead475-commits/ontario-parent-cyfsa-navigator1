/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const REPORT = {
  reportId: "r1", matterId: "11111111-1111-4111-8111-111111111111", title: "Synthetic matter", createdAt: "2026-11-20T15:00:00Z", allowance: "",
  sources: [{ id: "s-a", document: "affidavit.txt", version: "v1", page: 1, text: "Synthetic source text." }],
  sections: { overview: [{ text: "Synthetic overview point.", sources: ["s-a"] }], chronology: [], conflicts: [], gaps: [], questions: [] },
};
vi.mock("../utils/api", () => ({
  apiFetch: async (url: string) => ({ ok: true, json: async () => (url.includes("matterId=") ? { report: REPORT } : { matters: [{ id: REPORT.matterId, title: REPORT.title }] }) }),
}));
vi.mock("../utils/finalAssessmentExport", () => ({
  renderFinalAssessmentHtml: () => { throw new Error("REDACTION_INCOMPLETE"); },
}));
const { default: FinalCaseAssessment } = await import("./FinalCaseAssessment");

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Final Case Assessment redacted PDF", () => {
  it("exports nothing when the redacted copy cannot be prepared", async () => {
    const open = vi.spyOn(window, "open");
    render(<FinalCaseAssessment redactionEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
    fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: REPORT.matterId } });
    fireEvent.click(await screen.findByRole("button", { name: "Download redacted PDF" }));
    expect(open).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("redacted copy could not be prepared");
  });
});
