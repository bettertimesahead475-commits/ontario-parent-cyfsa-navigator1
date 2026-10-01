/**
 * @vitest-environment jsdom
 */
// Frontend completion tests for the Document Analyzer: upload -> automatic analysis -> result
// rendered without a refresh, and server failures surfaced with their real reason instead of a
// silent "Scan Failed". Only the network helper (apiFetch) and Firebase are mocked; the real
// component, state handling and safeReadJson/ApiResponseError are exercised.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("../utils/firebase", () => ({ auth: { currentUser: null }, db: {}, googleProvider: {} }));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: mockApiFetch };
});

const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const REPORT = {
  documentTitle: "Affidavit of Society Worker",
  documentType: "Affidavit",
  metadata: {},
  disclaimer: "This document is generated for informational/educational purposes only.",
  completenessScore: 40,
  evidenceStrengthIndex: { score: 35, components: {} },
  fileSummary: "The affidavit relies on secondhand reports.",
  redFlags: [
    {
      id: "rf1",
      severity: "Affects Evidentiary Weight",
      category: "Hearsay",
      phraseDetected: "a neighbour told me",
      explanation: "Secondhand statement.",
      verifyRequirement: "Ask who the source is.",
      legalReference: "⚠️ Statute citation unverified — confirm exact section with counsel before relying on this.",
      locationInDocument: "Page 2, Paragraph 4",
      parentActionStep: "Ask your lawyer about the source.",
    },
  ],
  timing: { mode: "fast", durationMs: 1200 },
};

function analyzeCalls() {
  return mockApiFetch.mock.calls.filter(([url]) => url === "/api/analyze");
}

async function uploadTextFile(container: HTMLElement, name = "affidavit.txt") {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  const file = new File(["A neighbour told me the child was unsafe."], name, { type: "text/plain" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  localStorage.clear();
  mockApiFetch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Document Analyzer completion", () => {
  it("renders the analysis result after upload without a refresh", async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/analyze" ? jsonResponse(200, REPORT) : jsonResponse(200, { events: [], conflicts: [], openItems: [] })
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadTextFile(container);

    await waitFor(() => expect(analyzeCalls()).toHaveLength(1));
    const body = JSON.parse(analyzeCalls()[0][1].body);
    expect(body.textContent).toContain("A neighbour told me");
    expect(body.mode).toBe("fast");

    expect(await screen.findAllByText(/Affidavit of Society Worker/, {}, { timeout: 5000 })).not.toHaveLength(0);
    expect(screen.getAllByText(/Fast Analysis Complete|Audited & Verified/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Analyzing key issues/)).toBeNull();
  });

  it("shows a non-retryable server reason once instead of retrying and failing silently", async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/analyze"
        ? jsonResponse(402, {
            code: "FREE_LIMIT_REACHED",
            error: "You've used your free analysis. Upgrade to Pro or Premium for unlimited document analysis.",
          })
        : jsonResponse(200, {})
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadTextFile(container);

    expect(await screen.findByText(/You've used your free analysis/, {}, { timeout: 5000 })).toBeTruthy();
    expect(analyzeCalls()).toHaveLength(1); // not retried
    expect(screen.getByRole("alert").textContent).toMatch(/Audit failed/);
  });

  it("retries a retryable access-service outage, then reports the real reason", async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/analyze"
        ? jsonResponse(503, {
            code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
            error: "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment.",
            retryable: true,
          })
        : jsonResponse(200, {})
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadTextFile(container);

    expect(await screen.findByText(/couldn't verify your analysis access/, {}, { timeout: 10000 })).toBeTruthy();
    expect(analyzeCalls()).toHaveLength(3);
  }, 15000);
});
