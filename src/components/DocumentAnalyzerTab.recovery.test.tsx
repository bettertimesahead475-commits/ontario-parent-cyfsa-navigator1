/**
 * @vitest-environment jsdom
 */
// Recovery tests for the Document Analyzer: a saved analysis is restored after a reload, each outcome shows its own
// state, and a Retry or a sign-in never starts a second analysis. Firebase and the network helpers are mocked; the real
// component, its saved state and the analysis-id rules are exercised. Polling is mocked so each outcome is immediate.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockApiFetch, mockPoll, mockSignIn } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPoll: vi.fn(),
  mockSignIn: vi.fn(),
}));

vi.mock("../utils/firebase", () => ({
  auth: { currentUser: null },
  db: {},
  googleProvider: {},
  signInMinimal: mockSignIn,
}));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: mockApiFetch, pollAnalysisJob: mockPoll };
});

const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");
const { ApiResponseError } = await import("../utils/api");

const JOB = "req_1700000000000_abcd1234";
const POINTER = "OPA_ACTIVE_ANALYZER_JOB_ID";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const analyzeCalls = () => mockApiFetch.mock.calls.filter(([url]) => url === "/api/analyze");
const analyzeIds = () =>
  analyzeCalls().map(([, init]) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return Object.entries(headers).find(([k]) => k.toLowerCase() === "x-analysis-id")?.[1];
  });

function routeApi() {
  mockApiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/extract-text") return jsonResponse(200, { extractedText: "A neighbour told me the child was unsafe.", pages: [] });
    if (url === "/api/analyze") return jsonResponse(400, { code: "ANALYSIS_REFUSED", error: "The analysis was refused." });
    return jsonResponse(404, {});
  });
}

async function renderWithSavedJob(pollOutcome: () => Promise<unknown>) {
  localStorage.setItem(POINTER, JOB);
  mockPoll.mockImplementation(pollOutcome);
  const view = render(<DocumentAnalyzerTab />);
  return view;
}

beforeEach(() => {
  localStorage.clear();
  mockApiFetch.mockReset();
  mockPoll.mockReset();
  mockSignIn.mockReset();
  routeApi();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("saved analysis after a sign-in problem", () => {
  it("shows sign-in, keeps the saved job, and never offers a new Retry or starts another analysis", async () => {
    await renderWithSavedJob(async () => {
      throw new ApiResponseError("Please sign in again to see this analysis.", 401, "SIGN_IN_REQUIRED", false);
    });
    expect(await screen.findByText("Sign in to see your analysis")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry Analysis" })).toBeNull();
    expect(localStorage.getItem(POINTER)).toBe(JOB);
    expect(analyzeCalls()).toHaveLength(0);
  });

  it("restores the same saved job after a reload, with no new analysis", async () => {
    await renderWithSavedJob(async () => {
      throw new ApiResponseError("Please sign in again to see this analysis.", 401, "SIGN_IN_REQUIRED", false);
    });
    expect(await screen.findByText("Sign in to see your analysis")).toBeTruthy();
    cleanup();
    await renderWithSavedJob(async () => {
      throw new ApiResponseError("Please sign in again to see this analysis.", 401, "SIGN_IN_REQUIRED", false);
    });
    expect(await screen.findByText("Sign in to see your analysis")).toBeTruthy();
    expect(mockPoll.mock.calls.map(([id]) => id)).toEqual([JOB, JOB]);
    expect(analyzeCalls()).toHaveLength(0);
  });

  it("after a successful sign-in, polls the same job and clears it once the report is ready", async () => {
    mockSignIn.mockResolvedValue({});
    let attempt = 0;
    await renderWithSavedJob(async () => {
      attempt++;
      if (attempt === 1) throw new ApiResponseError("Please sign in again to see this analysis.", 401, "SIGN_IN_REQUIRED", false);
      return { status: "completed", report: { documentTitle: "Restored report", fileSummary: "Summary.", redFlags: [] } };
    });
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to continue" }));
    await waitFor(() => expect(localStorage.getItem(POINTER)).toBeNull());
    expect(mockPoll.mock.calls.map(([id]) => id)).toEqual([JOB, JOB]);
    expect(analyzeCalls()).toHaveLength(0);
  });
});

describe("saved analysis with an unknown outcome", () => {
  it("network unavailable: keeps the job, offers Check again, and only reads the same job", async () => {
    await renderWithSavedJob(async () => {
      throw new ApiResponseError("We lost the connection while checking your analysis.", 0, "NETWORK_ERROR", true);
    });
    expect(await screen.findByText("The server is unavailable right now")).toBeTruthy();
    expect(localStorage.getItem(POINTER)).toBe(JOB);
    mockPoll.mockImplementation(async () => ({ status: "analyzing", percent: 40 }));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mockPoll).toHaveBeenCalledTimes(2));
    expect(mockPoll.mock.calls.every(([id]) => id === JOB)).toBe(true);
    expect(analyzeCalls()).toHaveLength(0);
  });

  it("job genuinely unavailable: says so, and Dismiss forgets the saved job without starting anything", async () => {
    await renderWithSavedJob(async () => {
      throw new ApiResponseError("This analysis never started on the server.", 404, "JOB_NOT_FOUND", false);
    });
    expect(await screen.findByText("The server has no record of this analysis")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(localStorage.getItem(POINTER)).toBeNull());
    expect(screen.queryByText("The server has no record of this analysis")).toBeNull();
    expect(analyzeCalls()).toHaveLength(0);
  });

  it("still processing: says so and never offers a new analysis", async () => {
    await renderWithSavedJob(async () => {
      throw new ApiResponseError("We couldn't confirm whether this analysis finished.", 504, "RECOVERY_TIMEOUT", true);
    });
    expect(await screen.findByText("Analysis still processing")).toBeTruthy();
    expect(localStorage.getItem(POINTER)).toBe(JOB);
    expect(analyzeCalls()).toHaveLength(0);
  });
});

describe("duplicate retries", () => {
  it("a Retry after a failed start sends the same analysis id as the first attempt", async () => {
    const { container } = render(<DocumentAnalyzerTab />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["A neighbour told me the child was unsafe."], "note.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(analyzeCalls().length).toBeGreaterThanOrEqual(1));
    const retry = await screen.findAllByRole("button", { name: /Retry Analysis/ }, { timeout: 10000 });
    const before = analyzeCalls().length;
    fireEvent.click(retry[0]);
    await waitFor(() => expect(analyzeCalls().length).toBeGreaterThan(before));
    const ids = analyzeIds();
    expect(ids[0]).toBeTruthy();
    expect(ids.every((id) => id === ids[0])).toBe(true);
  });

  it("a Retry after a reload still sends the same analysis id, because the id is saved with the file", async () => {
    const first = render(<DocumentAnalyzerTab />);
    const input = first.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["A neighbour told me the child was unsafe."], "note.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(analyzeCalls().length).toBeGreaterThanOrEqual(1));
    const firstId = analyzeIds()[0];
    await screen.findAllByRole("button", { name: /Retry Analysis/ }, { timeout: 10000 });
    cleanup();
    render(<DocumentAnalyzerTab />);
    const retry = await screen.findAllByRole("button", { name: /Retry Analysis/ }, { timeout: 10000 });
    const before = analyzeCalls().length;
    fireEvent.click(retry[0]);
    await waitFor(() => expect(analyzeCalls().length).toBeGreaterThan(before));
    expect(analyzeIds().every((id) => id === firstId)).toBe(true);
  });
});
