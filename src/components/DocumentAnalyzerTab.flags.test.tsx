/**
 * @vitest-environment jsdom
 */
// Integration check for the parent-report flag inside the real analyzer. The flag is read from the
// build environment when the module loads, so each case stubs the variable and loads the component
// fresh. Only the network helper and Firebase are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../utils/firebase", () => ({ auth: { currentUser: null }, db: {}, googleProvider: {} }));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => "" })) };
});

const REPORT = {
  documentTitle: "Affidavit of Society Worker",
  documentType: "Affidavit",
  metadata: {},
  disclaimer: "Generated for information only.",
  completenessScore: 40,
  evidenceStrengthIndex: { score: 35, components: {} },
  fileSummary: "The affidavit relies on secondhand reports.",
  redFlags: [],
  thresholdAnalysis: [],
  proceduralTimelineViolations: [],
  charterAndHumanRightsIssues: [],
  whatIsMissing: [],
  timing: { mode: "fast", durationMs: 1200 },
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "OPA_DOC_ANALYZER_PROGRESS",
    JSON.stringify({
      organizedFiles: [
        {
          id: "file-1",
          name: "affidavit.txt",
          size: 2048,
          mimeType: "text/plain",
          category: "Court Filings",
          uploadedAt: "2026-10-01T09:00:00Z",
          content: "The affidavit relies on secondhand reports.",
          analysisStatus: "completed",
          analysisReport: REPORT,
        },
      ],
      selectedFileId: "file-1",
      activeFolder: "Court Filings",
      ragChatMessages: [],
      selectedReport: REPORT,
      activeTab: "organizer",
      savedBriefs: [],
    })
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function renderAnalyzer() {
  const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");
  return render(<DocumentAnalyzerTab />);
}

describe("parent report flag in the analyzer", () => {
  it("is off when the build variable is not set: the parent report does not appear", async () => {
    await renderAnalyzer();
    expect(screen.queryByRole("heading", { name: "Parent report" })).toBeNull();
  });

  it("is off for a value other than exactly 'true'", async () => {
    vi.stubEnv("VITE_PARENT_REPORT_UI", "1");
    await renderAnalyzer();
    expect(screen.queryByRole("heading", { name: "Parent report" })).toBeNull();
  });

  it("appears only when the build variable is exactly 'true'", async () => {
    vi.stubEnv("VITE_PARENT_REPORT_UI", "true");
    await renderAnalyzer();
    expect(await screen.findByRole("heading", { name: "Parent report" })).toBeTruthy();
  });
});
