import { describe, expect, it } from "vitest";
import { buildCaseDocuments, guessDocumentKind, isForensicEngineEnabled, pageProvenance, parseAdditionalDocuments, runForensicEngineForRoute, toLegacyReport } from "./integration";
import type { CaseDocument } from "./caseModel";
import { AnalyzerError } from "../analyzerErrors";

describe("feature flag", () => {
  it("is off unless FORENSIC_ENGINE_ENABLED is exactly true", () => {
    expect(isForensicEngineEnabled({})).toBe(false);
    expect(isForensicEngineEnabled({ FORENSIC_ENGINE_ENABLED: "1" })).toBe(false);
    expect(isForensicEngineEnabled({ FORENSIC_ENGINE_ENABLED: "true" })).toBe(true);
  });
});

describe("buildCaseDocuments", () => {
  it("keeps the original PDF for visual checks and marks Gemini text as OCR", () => {
    const [d] = buildCaseDocuments({ extractedText: "Endorsement text", pastedText: "", fileData: { base64: "data:application/pdf;base64,JVBERi0=", mimeType: "application/pdf", name: "e.pdf" } });
    expect(d).toMatchObject({ id: "upload", extractionMethod: "OCR", kind: "ENDORSEMENT", sourceFile: { mediaType: "application/pdf", data: "JVBERi0=" } });
  });

  it("treats pasted text as its own document", () => {
    const docs = buildCaseDocuments({ extractedText: "File text", pastedText: "Pasted affidavit. Sworn before me.", fileData: { base64: "eA==", mimeType: "text/plain", name: "a.txt" } });
    expect(docs.map((d) => [d.id, d.extractionMethod])).toEqual([["upload", "TEXT_LAYER"], ["pasted", "MANUAL_TRANSCRIPTION"]]);
    expect(docs[0].sourceFile).toBeUndefined();
  });

  it("does not attach an original larger than the input limit", () => {
    const big = "A".repeat(21 * 1024 * 1024);
    const [d] = buildCaseDocuments({ extractedText: "t", pastedText: "", fileData: { base64: big, mimeType: "application/pdf" } });
    expect(d.sourceFile).toBeUndefined();
  });

  it("guesses document kinds from content", () => {
    expect(guessDocumentKind("x", "I make oath and say")).toBe("AFFIDAVIT");
    expect(guessDocumentKind("note.pdf", "Case note — home visit")).toBe("CAS_RECORD");
    expect(guessDocumentKind("x", "nothing")).toBe("OTHER");
  });
});

const DOCS: CaseDocument[] = [{ id: "document", title: "Affidavit", kind: "AFFIDAVIT", extractionMethod: "TEXT_LAYER", text: "[Page 1]\nI did not attend the home." }];
const ok = (text: string) => ({ text, model: "m", durationMs: 1, usage: { input_tokens: 10, output_tokens: 5 } });

describe("runForensicEngineForRoute", () => {
  it("returns the analyzer's run shape, per-model usage, and thinking only on Opus stages", async () => {
    const seen: Array<[string, string, boolean | undefined]> = [];
    const run = await runForensicEngineForRoute({
      documents: DOCS,
      investigatorModel: "claude-opus-5",
      extractorModel: "claude-sonnet-5",
      deadlineAt: Date.now() + 60_000,
      requestId: "r",
      generate: async (p, model) => {
        seen.push([String(p.stage), model, p.enableThinking]);
        if (p.stage === "forensic_investigation") return ok(JSON.stringify({ findings: [{ id: "F1", title: "t", statement: "s", evidenceClass: "A", supporting: [{ documentId: "document", quote: "I did not attend the home." }] }] }));
        if (p.stage === "forensic_adversarial_review") return ok(JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }] }));
        return ok("{}");
      },
    });
    expect(seen).toEqual([
      ["forensic_extraction", "claude-sonnet-5", false],
      ["forensic_investigation", "claude-opus-5", true],
      ["forensic_adversarial_review", "claude-opus-5", true],
    ]);
    expect(run.usageByModel).toEqual({ "claude-sonnet-5": { input_tokens: 10, output_tokens: 5 }, "claude-opus-5": { input_tokens: 20, output_tokens: 10 } });
    expect(run.report.redFlags).toHaveLength(1);
  });

  it("throws a retryable error when the investigation fails, so the route releases the credit", async () => {
    await expect(
      runForensicEngineForRoute({
        documents: DOCS, investigatorModel: "o", extractorModel: "s", deadlineAt: Date.now() + 60_000, requestId: "r",
        generate: async (p) => { if (p.stage === "forensic_investigation") throw new Error("down"); return ok("{}"); },
      })
    ).rejects.toMatchObject({ retryable: true, statusCode: 503 });
  });

  it("delivers a report when only the page check fails, marking findings uncertain", async () => {
    const docs: CaseDocument[] = [{ ...DOCS[0], sourceFile: { mediaType: "application/pdf", data: "JVBERi0=" } }];
    const run = await runForensicEngineForRoute({
      documents: docs, investigatorModel: "o", extractorModel: "s", deadlineAt: Date.now() + 60_000, requestId: "r",
      generate: async (p) => {
        if (p.stage === "forensic_investigation") return ok(JSON.stringify({ findings: [{ id: "F1", title: "t", statement: "s", evidenceClass: "A", dependsOnVisual: true, supporting: [{ documentId: "document", quote: "I did not attend the home." }] }] }));
        if (p.stage === "forensic_adversarial_review") return ok(JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }] }));
        if (p.stage === "forensic_visual_verification") throw new Error("pdf too large");
        return ok("{}");
      },
    });
    expect(run.engine.status).toBe("PARTIAL");
    expect(run.engine.findings[0].uncertainty).toBe("HIGH");
  });
});

describe("toLegacyReport", () => {
  it("never grades a finding CRITICAL, never invents a score, and keeps usage out of the customer copy", async () => {
    const run = await runForensicEngineForRoute({
      documents: DOCS, investigatorModel: "o", extractorModel: "s", deadlineAt: Date.now() + 60_000, requestId: "r",
      generate: async (p) => {
        if (p.stage === "forensic_investigation") return ok(JSON.stringify({ findings: [{ id: "F1", title: "t", statement: "s", evidenceClass: "E", significance: "HIGH", supporting: [{ documentId: "document", quote: "I did not attend the home." }] }] }));
        if (p.stage === "forensic_adversarial_review") return ok(JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }] }));
        return ok("{}");
      },
    });
    const legacy = toLegacyReport(run.engine, DOCS);
    expect(legacy.redFlags[0].severity).toBe("Worth Raising With Counsel");
    expect(legacy.completenessScore).toBeNull();
    expect(legacy.forensicEngine.totals).toBeUndefined();
    expect(JSON.stringify(legacy.forensicEngine.stages)).not.toMatch(/inputTokens|model/);
    expect(legacy.redFlags[0].locationInDocument).toBe("Affidavit, page 1");
  });

  it("is an AnalyzerError subclass on failure", () => {
    expect(new AnalyzerError("AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, "x", true)).toBeInstanceOf(Error);
  });
});

describe("parseAdditionalDocuments", () => {
  it("accepts up to nine titled text documents and gives them stable ids", () => {
    const docs = parseAdditionalDocuments([{ title: "Case note", text: "Case note — home visit" }, { text: "Dear Ms. X,\nPlease call me.\nYours truly" }]);
    expect(docs.map((d) => [d.id, d.title, d.kind])).toEqual([["doc2", "Case note", "CAS_RECORD"], ["doc3", "Additional document 2", "CORRESPONDENCE"]]);
  });

  it("rejects anything malformed instead of repairing it", async () => {
    const { parseAdditionalDocuments } = await import("./integration");
    expect(parseAdditionalDocuments(undefined)).toEqual([]);
    for (const bad of ["text", [{ title: "x" }], [{ text: "" }], Array.from({ length: 10 }, () => ({ text: "t" })), [{ text: "x".repeat(300_001) }]]) {
      expect(() => parseAdditionalDocuments(bad)).toThrow(/Additional documents/);
    }
  });
});

describe("per-page extraction provenance", () => {
  it("labels each page by how its text was obtained, and never runs OCR again", async () => {
    let ocrCalls = 0;
    const fake = (async (_b: any, _m: any, ocr: any) => {
      try { await ocr("x", "application/pdf"); } catch { ocrCalls++; }
      return [
        { pageNumber: 1, text: "a", extractionMethod: "native-pdf-text", confidence: null, checksum: "" },
        { pageNumber: 2, text: "b", extractionMethod: "gemini-page-ocr", confidence: null, checksum: "" },
      ];
    }) as any;
    const prov = await pageProvenance({ base64: "JVBERi0=", mimeType: "application/pdf" }, fake);
    expect(prov?.methods).toEqual({ 1: "TEXT_LAYER", 2: "OCR" });
    const map = prov!.methods;
    expect(ocrCalls).toBe(1); // the passed OCR function refused
    const [doc] = buildCaseDocuments({ extractedText: "[Page 1]\nalpha text\n[Page 2]\nbeta text", pastedText: "", fileData: { base64: "JVBERi0=", mimeType: "application/pdf" }, pageExtraction: map });
    expect(doc.extractionMethod).toBe("OCR");
    const { resolveEvidenceRef } = await import("./caseModel");
    expect(resolveEvidenceRef([doc], "upload", "alpha text").extractionMethod).toBe("TEXT_LAYER");
    expect(resolveEvidenceRef([doc], "upload", "beta text").extractionMethod).toBe("OCR");
  });

  it("returns null when provenance cannot be read without OCR, and for non-PDF uploads", async () => {
    expect(await pageProvenance({ base64: "JVBERi0=", mimeType: "application/pdf" }, (async () => { throw new Error("cache miss"); }) as any)).toBeNull();
    expect(await pageProvenance({ base64: "eA==", mimeType: "text/plain" })).toBeNull();
  });

  it("labels an all-text-layer PDF as TEXT_LAYER", () => {
    const [doc] = buildCaseDocuments({ extractedText: "x", pastedText: "", fileData: { base64: "JVBERi0=", mimeType: "application/pdf" }, pageExtraction: { 1: "TEXT_LAYER" } });
    expect(doc.extractionMethod).toBe("TEXT_LAYER");
  });
});


describe("OCR confidence provenance", () => {
  it("records the OCR model's per-page confidence and lets low confidence raise a finding's uncertainty", async () => {
    const fake = (async () => [
      { pageNumber: 1, text: "a", extractionMethod: "native-pdf-text", confidence: null, checksum: "" },
      { pageNumber: 2, text: "b", extractionMethod: "gemini-page-ocr", confidence: 0.62, checksum: "" },
    ]) as any;
    const prov = await pageProvenance({ base64: "JVBERi0=", mimeType: "application/pdf" }, fake);
    expect(prov?.confidence).toEqual({ 2: 0.62 });
    const [doc] = buildCaseDocuments({ extractedText: "[Page 1]\nalpha text\n[Page 2]\nbeta text here", pastedText: "", fileData: { base64: "JVBERi0=", mimeType: "application/pdf" }, pageExtraction: prov!.methods, ocrConfidence: prov!.confidence });
    const { resolveEvidenceRef } = await import("./caseModel");
    expect(resolveEvidenceRef([doc], "upload", "beta text here").ocrConfidence).toBe(0.62);
    expect(resolveEvidenceRef([doc], "upload", "alpha text").ocrConfidence).toBeNull();
    const { parseFindingCandidates, groundFinding } = await import("./grounding");
    const [f] = parseFindingCandidates([{ id: "F1", title: "t", statement: "s", evidenceClass: "A", uncertainty: "LOW", supporting: [{ documentId: "upload", quote: "beta text here" }] }], [doc]);
    const g = groundFinding(f);
    expect(g.uncertainty).toBe("MEDIUM");
    expect(g.grounding.notes.join(" ")).toMatch(/low OCR confidence/);
  });
});
