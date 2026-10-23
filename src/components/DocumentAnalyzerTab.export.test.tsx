/**
 * @vitest-environment jsdom
 */
// Wiring tests for the analyzer's two export paths: the print window (printAnalyzer) and the
// plain-text summary log (exportSummaryLog). The real component is rendered with its saved state
// seeded in localStorage. Every identifying value carries a planted token, and each test checks
// that the token reaches the export with redaction off and never reaches it with redaction on.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { REDACTED_COPY_NOTICE } from "../../shared/exportRedaction";

vi.mock("../utils/firebase", () => ({ auth: { currentUser: null }, db: {}, googleProvider: {} }));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => "" })) };
});

const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");

const FILE_ID = "file-1";
const FILE_NAME = "ZQNAME-custody-affidavit.txt";

const REPORT = {
  documentTitle: "ZQTITLE Final Order",
  documentType: "Affidavit",
  metadata: { courtFileNumber: "ZQMETA-123", respondentName: "ZQMETA Parent" },
  disclaimer: "Generated for information only.",
  completenessScore: 40,
  evidenceStrengthIndex: { score: 35, components: {} },
  fileSummary: "ZQFREE summary of the affidavit.",
  redFlags: [
    {
      id: "rf1",
      severity: "Affects Evidentiary Weight",
      category: "Hearsay",
      phraseDetected: "ZQQUOTE a neighbour told me",
      explanation: "ZQFREE explanation of the secondhand statement.",
      verifyRequirement: "Ask who the source is.",
      legalReference: "CYFSA s. 74(2)",
      locationInDocument: "Page 2",
      parentActionStep: "ZQFREE ask the lawyer about the source.",
    },
  ],
  thresholdAnalysis: [
    {
      thresholdChecked: "Grounds (s. 74)",
      isMet: "Yes",
      reasoning: "ZQFREE reasoning for the threshold.",
      primarySourceLaw: "CYFSA s. 74(2)",
    },
  ],
  proceduralTimelineViolations: [],
  charterAndHumanRightsIssues: [],
  whatIsMissing: [],
  timing: { mode: "fast", durationMs: 1200 },
};

const DEEP_SCAN = {
  timestamp: "2026-10-22T10:00:00Z",
  findings: "ZQDEEP forensic finding text",
};

const CHAT = [
  {
    id: "m1",
    sender: "user",
    text: "ZQCHAT my question about ZQNAME",
    timestamp: "10:01",
  },
  {
    id: "m2",
    sender: "ai",
    text: "ZQCHAT answer that cites a source",
    timestamp: "10:02",
    citations: [{ name: "ZQCITE.pdf", category: "Court Filings", score: 0.9 }],
  },
];

const ALL_TOKENS = ["ZQNAME", "ZQTITLE", "ZQMETA", "ZQQUOTE", "ZQFREE", "ZQDEEP", "ZQCHAT", "ZQCITE"];

function seed({ redact, activeTab = "organizer" }: { redact: boolean; activeTab?: string }) {
  const file = {
    id: FILE_ID,
    name: FILE_NAME,
    size: 2048,
    mimeType: "text/plain",
    category: "Court Filings",
    uploadedAt: "2026-10-01T09:00:00Z",
    content: "ZQFREE document text",
    analysisStatus: "completed",
    analysisReport: REPORT,
  };
  localStorage.setItem(
    "OPA_DOC_ANALYZER_PROGRESS",
    JSON.stringify({
      organizedFiles: [file],
      selectedFileId: FILE_ID,
      activeFolder: "Court Filings",
      ragChatMessages: CHAT,
      selectedReport: REPORT,
      activeTab,
      savedBriefs: [],
    })
  );
  localStorage.setItem("OPA_DEEPSCAN_REPORTS", JSON.stringify({ [FILE_ID]: DEEP_SCAN }));
  localStorage.setItem("OPA_REDACTION_ENABLED", String(redact));
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

let printedHtml: string[];
let summaryBlobs: Blob[];

beforeEach(() => {
  localStorage.clear();
  printedHtml = [];
  summaryBlobs = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "open").mockImplementation(() => {
    const doc = {
      write: (html: string) => printedHtml.push(html),
      close: () => {},
    };
    return { document: doc, focus: () => {}, print: () => {} } as unknown as Window;
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
    summaryBlobs.push(obj as Blob);
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  // jsdom has no layout; the chat view scrolls to its bottom marker on render.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function printedPage(): Promise<string> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "document-analyzer" } }));
  });
  expect(printedHtml.length).toBeGreaterThan(0);
  return printedHtml[printedHtml.length - 1];
}

async function summaryText(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: /Export Summary Log/i }));
  expect(summaryBlobs.length).toBeGreaterThan(0);
  return readBlob(summaryBlobs[summaryBlobs.length - 1]);
}

describe("analyzer summary log export (exportSummaryLog)", () => {
  it("keeps names, titles, quotes, chat and free text when redaction is off", async () => {
    seed({ redact: false });
    render(<DocumentAnalyzerTab />);
    const text = await summaryText();
    for (const token of ["ZQNAME", "ZQTITLE", "ZQQUOTE", "ZQFREE", "ZQCHAT", "ZQCITE"]) {
      expect(text).toContain(token);
    }
  });

  it("removes every identifying value when redaction is on", async () => {
    seed({ redact: true });
    render(<DocumentAnalyzerTab />);
    const text = await summaryText();
    for (const token of ALL_TOKENS) {
      expect(text).not.toContain(token);
    }
    expect(text).toContain("Document 1");
    expect(text).toContain("Analysis report");
    expect(text).toContain(REDACTED_COPY_NOTICE.slice(0, 60));
    expect(text).toContain("Consultation messages are not included in a redacted copy.");
  });

  it("keeps the threshold result labelled as a preliminary read, not a legal finding", async () => {
    seed({ redact: false });
    render(<DocumentAnalyzerTab />);
    const text = await summaryText();
    expect(text).toContain("Analyzer preliminary read (not a legal finding): Yes");
  });
});

describe("analyzer print export (printAnalyzer)", () => {
  it("keeps titles, quotes, chat and file text in the printed page when redaction is off", async () => {
    seed({ redact: false });
    render(<DocumentAnalyzerTab />);
    const html = await printedPage();
    expect(html).toContain("ZQTITLE");
    expect(html).toContain("ZQQUOTE");
  });

  it("removes every identifying value from the printed page when redaction is on", async () => {
    seed({ redact: true });
    render(<DocumentAnalyzerTab />);
    const html = await printedPage();
    for (const token of ALL_TOKENS) {
      expect(html).not.toContain(token);
    }
    expect(html).toContain("Analysis report");
    expect(html).toContain(REDACTED_COPY_NOTICE.slice(0, 60));
  });

  it("prints the consultation transcript with its citations when redaction is off", async () => {
    seed({ redact: false, activeTab: "rag-chat" });
    render(<DocumentAnalyzerTab />);
    const html = await printedPage();
    expect(html).toContain("ZQCHAT");
    expect(html).toContain("ZQCITE");
  });

  it("replaces the consultation transcript with a notice when redaction is on", async () => {
    seed({ redact: true, activeTab: "rag-chat" });
    render(<DocumentAnalyzerTab />);
    const html = await printedPage();
    expect(html).toContain("The consultation transcript is not included in a redacted copy.");
    for (const token of ALL_TOKENS) {
      expect(html).not.toContain(token);
    }
  });

  it("prints the deep scan without its findings or file name when redaction is on", async () => {
    seed({ redact: true });
    render(<DocumentAnalyzerTab />);
    fireEvent.click(screen.getByRole("button", { name: /Export Deep Scan PDF/i }));
    const html = printedHtml[printedHtml.length - 1];
    expect(html).toBeDefined();
    for (const token of ALL_TOKENS) {
      expect(html).not.toContain(token);
    }
  });

  it("prints the deep scan findings when redaction is off", async () => {
    seed({ redact: false });
    render(<DocumentAnalyzerTab />);
    fireEvent.click(screen.getByRole("button", { name: /Export Deep Scan PDF/i }));
    const html = printedHtml[printedHtml.length - 1];
    expect(html).toContain("ZQDEEP");
  });

  it("keeps the quick review printout free of quoted and free text when redaction is on", async () => {
    seed({ redact: true });
    render(<DocumentAnalyzerTab />);
    fireEvent.click(screen.getByRole("button", { name: /Export Quick Review PDF/i }));
    const html = printedHtml[printedHtml.length - 1];
    expect(html).not.toContain("ZQQUOTE");
    expect(html).not.toContain("ZQFREE");
  });
});
