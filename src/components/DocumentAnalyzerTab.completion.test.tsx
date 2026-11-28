/**
 * @vitest-environment jsdom
 */
// Frontend completion tests for the Document Analyzer: upload -> automatic analysis -> result
// rendered without a refresh, and server failures surfaced with their real reason instead of a
// silent "Scan Failed". Only the network helper (apiFetch) and Firebase are mocked; the real
// component, state handling and safeReadJson/ApiResponseError are exercised.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockApiFetch, mockAuth } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockAuth: { currentUser: null as { uid: string } | null },
}));

vi.mock("../utils/firebase", () => ({ auth: mockAuth, db: {}, googleProvider: {} }));
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
  mockAuth.currentUser = null;
  mockApiFetch.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Document Analyzer Deep Scan recovery", () => {
  const fileId = "synthetic-file";
  const file = {
    id: fileId, name: "synthetic.txt", uploadedAt: "Today", mimeType: "text/plain",
    category: "Court Filings", content: "Synthetic evidence", analysisStatus: "completed", analysisReport: REPORT,
  };
  const deepReport = { ...REPORT, documentTitle: "Recovered Forensic Report", modelMetadata: { mode: "full" } };
  const deepScanPosts = () => mockApiFetch.mock.calls.filter(([url]) => url === "/api/deep-scan");
  const button = (name: string) => screen.getAllByRole("button", { name })[0] as HTMLButtonElement;
  const jobKey = `OPA_DEEP_SCAN_JOB_test-account:${fileId}`;

  beforeEach(() => {
    mockAuth.currentUser = { uid: "test-account" };
    localStorage.setItem("OPA_DOC_ANALYZER_PROGRESS_test-account", JSON.stringify({
      organizedFiles: [file], selectedFileId: fileId, selectedReport: REPORT,
    }));
  });

  it("submits once and recovers the same ID after a page remount before the accepted scan was shown", async () => {
    let jobId = "";
    let abortFirstPoll!: (reason: Error) => void;
    const interruptedPoll = new Promise<ReturnType<typeof jsonResponse>>((_, reject) => { abortFirstPoll = reject; });
    const pollCalls = () => mockApiFetch.mock.calls.filter(([url]) => url === `/api/analyze/job/${jobId}`);
    mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/deep-scan") {
        jobId = JSON.parse(init?.body as string).analysisId;
        expect(localStorage.getItem(jobKey)).toBe(jobId);
        return jsonResponse(202, { jobId });
      }
      if (url === `/api/analyze/job/${jobId}`) {
        return pollCalls().length === 1 ? interruptedPoll : jsonResponse(200, { status: "completed", report: deepReport });
      }
      if (url === "/api/analyzer-usage") return jsonResponse(504, {});
      return jsonResponse(200, {});
    });

    const first = render(<DocumentAnalyzerTab />);
    const submit = button("Run Deep Scan");
    act(() => {
      submit.click();
      submit.click();
    });
    expect(deepScanPosts()).toHaveLength(1);
    await waitFor(() => expect(pollCalls()).toHaveLength(1));
    first.unmount();
    await act(async () => abortFirstPoll(new DOMException("Page unloaded", "AbortError")));

    const second = render(<DocumentAnalyzerTab />);
    fireEvent.click(button("Check existing scan"));
    expect(await screen.findAllByText(deepReport.documentTitle)).not.toHaveLength(0);
    expect(screen.queryByText("Scanning File...")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Run Deep Scan" })).toHaveLength(0);
    expect(localStorage.getItem(jobKey)).toBeNull();
    expect(deepScanPosts()).toHaveLength(1);
    expect(pollCalls()).toHaveLength(2);
    expect(pollCalls().every(([, init]) => !init?.method || init.method === "GET")).toBe(true);

    second.unmount();
    render(<DocumentAnalyzerTab />);
    fireEvent.click(button("🔬 Forensic Deep Scan"));
    expect(screen.getAllByText(deepReport.documentTitle)).not.toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Run Deep Scan" })).toHaveLength(0);
    expect(deepScanPosts()).toHaveLength(1);
  });

  it("keeps the saved scan when a status read is inconclusive and allows retry only after a failed snapshot", async () => {
    const existingId = "req_1791000000000_abcdef";
    localStorage.setItem(jobKey, existingId);
    let statusReadable = false;
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/analyze/job/${existingId}`) {
        return statusReadable
          ? jsonResponse(200, { status: "failed", error: { message: "The existing scan failed." } })
          : jsonResponse(401, { code: "SIGN_IN_REQUIRED" });
      }
      return jsonResponse(200, {});
    });
    render(<DocumentAnalyzerTab />);

    fireEvent.click(button("Check existing scan"));
    await screen.findByText(/couldn't confirm whether the Deep Scan finished/i);
    expect(localStorage.getItem(jobKey)).toBe(existingId);
    expect(deepScanPosts()).toHaveLength(0);

    statusReadable = true;
    fireEvent.click(button("Check existing scan"));
    await screen.findByText("The existing scan failed.");
    expect(localStorage.getItem(jobKey)).toBeNull();
    expect(button("Run Deep Scan").disabled).toBe(false);
    expect(deepScanPosts()).toHaveLength(0);
  });
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
