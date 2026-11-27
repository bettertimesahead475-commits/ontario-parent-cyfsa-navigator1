/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const MATTER = { id: "11111111-1111-4111-8111-111111111111", title: "Synthetic matter" };
type Reply = { ok: boolean; body: unknown };
let matterReply: Reply = { ok: true, body: { report: null } };
let generateReply: Reply = { ok: true, body: { report: null } };
const apiFetch = vi.fn(async (url: string, init?: { method?: string }) => {
  const reply = !url.includes("matterId=") ? { ok: true, body: { matters: [MATTER] } } : init?.method === "POST" ? generateReply : matterReply;
  return { ok: reply.ok, json: async () => reply.body };
});
vi.mock("../utils/api", () => ({ apiFetch: (url: string, init?: { method?: string }) => apiFetch(url, init) }));
const { default: FinalCaseAssessment } = await import("./FinalCaseAssessment");

afterEach(() => cleanup());

async function openMatter() {
  render(<FinalCaseAssessment />);
  fireEvent.click(screen.getByRole("button", { name: "Final Case Assessment" }));
  fireEvent.change(await screen.findByLabelText("Assessment matter"), { target: { value: MATTER.id } });
}

describe("Final Case Assessment empty and error states", () => {
  it("says when a matter has no saved report yet instead of showing nothing", async () => {
    matterReply = { ok: true, body: { report: null } };
    await openMatter();
    expect((await screen.findByRole("status")).textContent).toContain("No saved report for this matter yet");
  });

  it("explains a known API error code in plain words, with no doubled full stop", async () => {
    matterReply = { ok: true, body: { report: null } };
    generateReply = { ok: false, body: { code: "MISSING_SOURCE_DOCUMENTS", error: "MISSING SOURCE DOCUMENTS", retryable: false } };
    await openMatter();
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Generate assessment / retry" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Add at least one text document to this matter before generating the assessment. Your saved documents remain available.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to the server's wording for an unknown code", async () => {
    generateReply = { ok: false, body: { code: "SOMETHING_NEW", error: "Assessment could not be completed. Retry safely." } };
    await openMatter();
    fireEvent.click(await screen.findByRole("button", { name: "Generate assessment / retry" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Assessment could not be completed. Retry safely. Your saved documents remain available.");
  });

  it("does not print an invalid date or a blank source when saved values are missing", async () => {
    matterReply = {
      ok: true,
      body: {
        report: {
          reportId: "r1", matterId: MATTER.id, title: MATTER.title, allowance: "",
          sources: [{ id: "s-a", document: "affidavit.txt", version: "v1", page: 1, text: "Synthetic source text." }],
          sections: { overview: [{ text: "Synthetic point.", sources: ["s-a", "s-missing"] }], chronology: [], conflicts: [], gaps: [], questions: [] },
        },
      },
    };
    await openMatter();
    expect(await screen.findByText("Saved Not recorded")).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.getByText("affidavit.txt, p. 1")).toBeTruthy();
    expect(screen.getByText("Source s-missing (not in the saved source list)")).toBeTruthy();
  });
});
