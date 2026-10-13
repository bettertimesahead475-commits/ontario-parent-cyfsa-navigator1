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

    expect(await screen.findAllByText(/You've used your free analysis/, {}, { timeout: 10000 })).not.toHaveLength(0);
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

    expect(await screen.findAllByText(/couldn't verify your analysis access/, {}, { timeout: 12000 })).not.toHaveLength(0);
    expect(analyzeCalls()).toHaveLength(3);
  }, 15000);

  it("follows the server job when the live stream drops, without sending the analysis again", async () => {
    const enc = new TextEncoder();
    const droppedStream = {
      ok: true,
      status: 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/event-stream" : null) },
      body: new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "stage", stage: "reviewing_evidence", percent: 45, message: "Reviewing" })}\n\n`));
          c.close(); // connection lost before the "complete" event
        },
      }),
    };
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/analyze") return droppedStream;
      if (url.startsWith("/api/analyze/job/")) return jsonResponse(200, { status: "completed", report: REPORT });
      return jsonResponse(200, { events: [], conflicts: [], openItems: [] });
    });
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadTextFile(container);

    expect(await screen.findAllByText(/Affidavit of Society Worker/, {}, { timeout: 8000 })).not.toHaveLength(0);
    expect(analyzeCalls()).toHaveLength(1); // recovered, not re-run
  }, 12000);

  it("polls instead of starting a second run when the server says the analysis is already running", async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/analyze") return jsonResponse(409, { code: "ANALYSIS_IN_PROGRESS", error: "still running" });
      if (url.startsWith("/api/analyze/job/")) return jsonResponse(200, { status: "completed", report: REPORT });
      return jsonResponse(200, { events: [], conflicts: [], openItems: [] });
    });
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadTextFile(container);
    expect(await screen.findAllByText(/Affidavit of Society Worker/, {}, { timeout: 8000 })).not.toHaveLength(0);
    expect(analyzeCalls()).toHaveLength(1);
  }, 12000);

  it("after a reload, recovers a failed job's real reason without starting a new analysis", async () => {
    localStorage.setItem("OPA_ACTIVE_ANALYZER_JOB_ID", "req_1791000000000_abcdef");
    mockApiFetch.mockImplementation(async (url: string) =>
      url.startsWith("/api/analyze/job/")
        ? jsonResponse(200, {
            status: "failed",
            error: { code: "AI_PROVIDER_TEMPORARILY_UNAVAILABLE", message: "The AI analysis engine is temporarily busy.", statusCode: 503, retryable: true },
          })
        : jsonResponse(200, {})
    );
    render(<DocumentAnalyzerTab />);
    await waitFor(() =>
      expect(mockApiFetch.mock.calls.some(([url]) => String(url).startsWith("/api/analyze/job/req_1791000000000_abcdef"))).toBe(true)
    );
    await waitFor(() => expect(localStorage.getItem("OPA_ACTIVE_ANALYZER_JOB_ID")).toBeNull(), { timeout: 5000 });
    expect(analyzeCalls()).toHaveLength(0);
  }, 12000);
});

describe("Document Analyzer results view", () => {
  const FULL_REPORT = {
    ...REPORT,
    charterAndHumanRightsIssues: ["Section 7 liberty interest is engaged by the apprehension."],
    whatToVerify: ["Confirm who the neighbour is and when they observed the event."],
    whatIsMissing: ["No dated observation log from the source."],
    whatToAskALawyer: ["Is a secondhand statement admissible at this stage?"],
  };

  async function openFastReport() {
    mockApiFetch.mockImplementation(async (url: string) =>
      url === "/api/analyze" ? jsonResponse(200, FULL_REPORT) : jsonResponse(200, { events: [], conflicts: [], openItems: [] })
    );
    const { container } = render(<DocumentAnalyzerTab />);
    await uploadTextFile(container);
    await waitFor(() => expect(analyzeCalls()).toHaveLength(1));
    await screen.findAllByText(/Affidavit of Society Worker/, {}, { timeout: 5000 });
  }

  it("offers Fast Scan and Deep Scan as separate top-level tabs, with Fast Scan selected by default", async () => {
    await openFastReport();
    const fast = screen.getByRole("tab", { name: "Fast Scan" });
    const deep = screen.getByRole("tab", { name: "Deep Scan" });
    expect(fast.getAttribute("aria-selected")).toBe("true");
    expect(deep.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("button", { name: "Export Fast Scan PDF" })).toBeTruthy();
  });

  it("switches to Deep Scan and hides the Fast report content without deleting it", async () => {
    await openFastReport();
    fireEvent.click(screen.getByRole("tab", { name: "Deep Scan" }));
    expect(screen.getByRole("tab", { name: "Deep Scan" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: /Verification Checks/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Fast Scan" }));
    expect(screen.getByRole("button", { name: /Verification Checks/ })).toBeTruthy();
  });

  it("collapses the four finding sections by default and expands them on demand", async () => {
    await openFastReport();
    for (const title of ["Charter Rights", "Verification Checks", "Missing Elements", "Ask Your Lawyer"]) {
      const toggle = screen.getByRole("button", { name: new RegExp(title) });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    }
    // Content stays in the report; it is only hidden until expanded.
    expect(document.body.textContent).toContain("No dated observation log from the source.");
    fireEvent.click(screen.getByRole("button", { name: /Missing Elements/ }));
    expect(screen.getByRole("button", { name: /Missing Elements/ }).getAttribute("aria-expanded")).toBe("true");
  });
});

