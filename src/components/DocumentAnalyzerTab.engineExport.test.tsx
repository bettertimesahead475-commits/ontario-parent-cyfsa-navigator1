/**
 * @vitest-environment jsdom
 */
// The report screen, print export and summary log for a PARTIAL Forensic Engine report (one document's extraction
// failed; a page-dependent finding could not be checked against the page). The report is produced by the real
// engine with a scripted provider and adapted by the real adapter, so these tests cover what a parent would see.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { runForensicInvestigation } from "../../api/services/forensic/pipeline";
import { toLegacyReport } from "../../api/services/forensic/integration";
import type { CaseDocument } from "../../api/services/forensic/caseModel";

vi.mock("../utils/firebase", () => ({ auth: { currentUser: null }, db: {}, googleProvider: {} }));
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual<typeof import("../utils/api")>("../utils/api");
  return { ...actual, apiFetch: vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => "" })) };
});
const { default: DocumentAnalyzerTab } = await import("./DocumentAnalyzerTab");

const DOCS: CaseDocument[] = [
  { id: "end", title: "ZQTITLE Endorsement", kind: "ENDORSEMENT", extractionMethod: "OCR", text: "[Page 1]\nPresent: [X] Father [ ] Mother\nThe mother ZQQUOTE did not attend." },
  { id: "note", title: "ZQTITLE Case note", kind: "CAS_RECORD", extractionMethod: "TEXT_LAYER", text: "[Page 1]\nHome visit notes." },
];

async function partialReport() {
  const generate = async (p: any, model: string) => {
    if (p.stage === "forensic_extraction" && JSON.stringify(p.messages).includes('id=\\"note\\"')) throw new Error("extraction down");
    const text =
      p.stage === "forensic_investigation"
        ? JSON.stringify({ findings: [
            { id: "F1", title: "Mother absent", statement: "The endorsement records the mother as not attending.", evidenceClass: "A", significance: "HIGH", supporting: [{ documentId: "end", quote: "The mother ZQQUOTE did not attend." }] },
            { id: "F2", title: "Attendance boxes", statement: "Father marked present.", evidenceClass: "A", dependsOnVisual: true, supporting: [{ documentId: "end", quote: "[X] Father" }] },
          ] })
        : p.stage === "forensic_adversarial_review"
          ? JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }, { findingId: "F2", verdict: "UPHELD" }] })
          : "{}";
    return { text, model, durationMs: 1, usage: null };
  };
  const engine = await runForensicInvestigation({ documents: DOCS, generate, models: { extractor: "s", investigator: "o", reviewer: "o" }, deadlineAt: Date.now() + 60_000, requestId: "r" });
  return { engine, legacy: toLegacyReport(engine, DOCS) };
}

function seed(report: Record<string, unknown>, redact: boolean) {
  const file = { id: "f1", name: "ZQNAME-endorsement.pdf", size: 2048, mimeType: "application/pdf", category: "Court Filings", uploadedAt: "2026-10-01T09:00:00Z", content: "x", analysisStatus: "completed", analysisReport: report };
  localStorage.setItem("OPA_DOC_ANALYZER_PROGRESS", JSON.stringify({ organizedFiles: [file], selectedFileId: "f1", activeFolder: "Court Filings", ragChatMessages: [], selectedReport: report, activeTab: "organizer", savedBriefs: [] }));
  localStorage.setItem("OPA_REDACTION_ENABLED", String(redact));
}

let printed: string[];
let blobs: Blob[];
beforeEach(() => {
  localStorage.clear();
  printed = [];
  blobs = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "open").mockImplementation(() => ({ document: { write: (h: string) => printed.push(h), close: () => {} }, focus: () => {}, print: () => {} }) as unknown as Window);
  vi.spyOn(URL, "createObjectURL").mockImplementation((o: Blob | MediaSource) => { blobs.push(o as Blob); return "blob:t"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const print = async () => {
  await act(async () => { window.dispatchEvent(new CustomEvent("trigger-print-pdf", { detail: { type: "document-analyzer" } })); });
  return printed[printed.length - 1];
};
const summary = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Export Summary Log/i }));
  const blob = blobs[blobs.length - 1];
  return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });
};

describe("partial Forensic Engine report", () => {
  it("is produced as PARTIAL with each gap stated, and keeps the findings that survived", async () => {
    const { engine, legacy } = await partialReport();
    expect(engine.status).toBe("PARTIAL");
    expect(engine.incompleteness.join(" ")).toMatch(/Extraction did not complete for "ZQTITLE Case note"/);
    expect(engine.incompleteness.join(" ")).toMatch(/depend on the page itself/);
    expect(legacy.fileSummary).toMatch(/This analysis is partial/);
    expect(legacy.redFlags.map((r: any) => r.id)).toEqual(["F1", "F2"]);
    expect(legacy.redFlags[1].verificationNote).toMatch(/Uncertainty: high/);
    expect(legacy.completenessScore).toBeNull();
  });

  it("prints the partial status, every gap, and the unchecked page finding", async () => {
    const { legacy } = await partialReport();
    seed(legacy, false);
    render(<DocumentAnalyzerTab />);
    const html = await print();
    expect(html).toContain("Forensic Engine record");
    expect(html).toContain("Partial analysis");
    expect(html).toContain("Extraction did not complete for");
    expect(html).toContain("Depends on the page; not checked");
    expect(html).toContain("Not scored");
  });

  it("prints only the status in a redacted copy, with no document text or titles", async () => {
    const { legacy } = await partialReport();
    seed(legacy, true);
    render(<DocumentAnalyzerTab />);
    const html = await print();
    expect(html).toContain("Partial analysis: 2 part(s) of the analysis did not complete");
    for (const token of ["ZQTITLE", "ZQQUOTE", "ZQNAME"]) expect(html).not.toContain(token);
  });

  it("states the partial status and gaps in the summary log, and only the status when redacted", async () => {
    const { legacy } = await partialReport();
    seed(legacy, false);
    const { unmount } = render(<DocumentAnalyzerTab />);
    const text = await summary();
    expect(text).toContain("Forensic Engine : PARTIAL ANALYSIS");
    expect(text).toContain("Not done: Extraction did not complete for");
    unmount();
    cleanup();
    seed(legacy, true);
    render(<DocumentAnalyzerTab />);
    const redacted = await summary();
    expect(redacted).toContain("Forensic Engine : PARTIAL ANALYSIS");
    expect(redacted).toContain("details removed from redacted copy");
    for (const token of ["ZQTITLE", "ZQQUOTE"]) expect(redacted).not.toContain(token);
  });

  it("shows the partial status and gaps on screen", async () => {
    const { legacy } = await partialReport();
    seed(legacy, false);
    render(<DocumentAnalyzerTab />);
    expect(screen.getAllByText(/Partial analysis/).length).toBeGreaterThan(0);
    expect(screen.getByText(/What this analysis did not do/)).toBeTruthy();
  });
});
