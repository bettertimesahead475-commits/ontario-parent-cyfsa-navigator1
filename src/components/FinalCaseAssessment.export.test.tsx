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
const apiFetch = vi.fn(async (url: string) => ({
  ok: true,
  json: async () => (url.includes("matterId=") ? { report: REPORT } : { matters: [{ id: REPORT.matterId, title: REPORT.title }] }),
}));
vi.mock("../utils/api", () => ({ apiFetch: (url: string) => apiFetch(url) }));
const { default: FinalCaseAssessment } = await import("./FinalCaseAssessment");

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Final Case Assessment PDF download", () => {
  it("prints the saved report without calling the assessment API again", async () => {
    const written: string[] = [];
    const fakeWindow = { document: { write: (h: string) => written.push(h), close: vi.fn(), querySelectorAll: () => [] }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);
    render(<FinalCaseAssessment />);
    fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
    fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: REPORT.matterId } });
    const button = await screen.findByRole("button", { name: "Download PDF" });
    const callsBefore = apiFetch.mock.calls.length;
    fireEvent.click(button);
    expect(apiFetch.mock.calls.length).toBe(callsBefore);
    expect(written[0]).toContain("Synthetic overview point.");
    expect(written[0]).toContain("[S1: affidavit.txt, p. 1]");
  });

  it("shows an error instead of failing silently when pop-ups are blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<FinalCaseAssessment />);
    fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
    fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: REPORT.matterId } });
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Allow pop-ups");
  });

  it("honours the export redaction setting in the PDF", async () => {
    const written: string[] = [];
    const fakeWindow = { document: { write: (h: string) => written.push(h), close: vi.fn(), querySelectorAll: () => [] }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);
    render(<FinalCaseAssessment redactionEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
    fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: REPORT.matterId } });
    fireEvent.click(await screen.findByRole("button", { name: "Download redacted PDF" }));
    expect(written[0]).not.toContain("Synthetic matter");
    expect(written[0]).not.toContain("affidavit.txt");
    expect(written[0]).toContain("[S1: Source document 1, p. 1]");
    expect(written[0]).toContain("Redacted copy");
    const preview = screen.getByLabelText("Redacted PDF contents");
    expect(preview.textContent).toContain("It withholds:");
    expect(preview.textContent).toContain("The matter title");
    expect(preview.textContent).not.toContain("Synthetic matter");
  });

  it("uses the saved redaction setting when no setting is passed in", async () => {
    localStorage.setItem("OPA_REDACTION_ENABLED", "true");
    try {
      const written: string[] = [];
      const fakeWindow = { document: { write: (h: string) => written.push(h), close: vi.fn(), querySelectorAll: () => [] }, focus: vi.fn(), print: vi.fn() };
      vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);
      render(<FinalCaseAssessment />);
      fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
      fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: REPORT.matterId } });
      fireEvent.click(await screen.findByRole("button", { name: "Download redacted PDF" }));
      expect(written[0]).not.toContain("affidavit.txt");
    } finally {
      localStorage.removeItem("OPA_REDACTION_ENABLED");
    }
  });
});
