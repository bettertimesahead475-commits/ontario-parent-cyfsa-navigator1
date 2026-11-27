/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../utils/firebase", () => ({ auth: { currentUser: null }, db: {}, googleProvider: {} }));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => "" })) };
});
const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");

function seedFiles(count: number) {
  const files = Array.from({ length: count }, (_, i) => ({
    id: `file-${i}`, name: `synthetic-${i}.txt`, size: 100, mimeType: "text/plain", category: "Court Filings",
    uploadedAt: "2026-10-01T09:00:00Z", content: "Synthetic text", analysisStatus: "completed",
  }));
  localStorage.setItem("OPA_DOC_ANALYZER_PROGRESS", JSON.stringify({ organizedFiles: files, selectedFileId: null, activeFolder: "All", ragChatMessages: [], selectedReport: null, activeTab: "organizer", savedBriefs: [] }));
}
function upload(count: number) {
  const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
  const files = Array.from({ length: count }, (_, i) => new File(["Synthetic text"], `new-${i}.txt`, { type: "text/plain" }));
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("upload limit errors are announced to screen readers", () => {
  it("announces the 20-file limit as an alert", async () => {
    seedFiles(20);
    render(<DocumentAnalyzerTab />);
    upload(1);
    expect((await screen.findByRole("alert")).textContent).toContain("You have reached the maximum allowed limit of 20 files.");
  });

  it("announces a repeated rejection again by replacing the alert", async () => {
    seedFiles(20);
    render(<DocumentAnalyzerTab />);
    upload(1);
    const first = await screen.findByRole("alert");
    upload(1);
    const second = await screen.findByRole("alert");
    expect(second.textContent).toBe(first.textContent);
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it("announces the 15-file batch limit as an alert", async () => {
    seedFiles(0);
    render(<DocumentAnalyzerTab />);
    upload(16);
    expect((await screen.findByRole("alert")).textContent).toContain("You can upload up to 15 concurrent files in a single batch");
  });
});
