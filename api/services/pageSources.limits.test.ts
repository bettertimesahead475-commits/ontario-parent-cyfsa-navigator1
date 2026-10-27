import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { decodeSource, extractPages } from "./pageSources";
import { expandedBytesWithin, isBase64Text, ANALYZER_MAX_EXPANDED_BYTES } from "./pdfResourceLimits";
import { buildExpansionPdf } from "../testSupport/acroFormFixtures";
import { OFFICIAL_FORMS_CURRENT_DIR } from "../testSupport/officialFormFixtures.js";

const noOcr = async () => {
  throw new Error("OCR must not run for a refused file");
};

describe("upload path: base64 validation (regression for the stack overflow)", () => {
  it("accepts a large valid base64 upload without a stack overflow (was: RangeError at about 12 million characters)", () => {
    const bytes = randomBytes(9_500_000);
    const encoded = bytes.toString("base64");
    expect(encoded.length).toBeGreaterThan(12_000_000);
    const decoded = decodeSource(encoded, "application/pdf");
    expect(decoded.bytes.equals(bytes)).toBe(true);
  });

  it("accepts a data-URL prefixed upload and a whitespace-wrapped upload", () => {
    const bytes = Buffer.from("%PDF-1.4 small");
    expect(decodeSource(`data:application/pdf;base64,${bytes.toString("base64")}`, "application/pdf").bytes.equals(bytes)).toBe(true);
    expect(decodeSource(`${bytes.toString("base64").slice(0, 8)}\n${bytes.toString("base64").slice(8)}`, "application/pdf").bytes.equals(bytes)).toBe(true);
  });

  it("still refuses invalid base64 with the same message, including a bad character deep in a large string", () => {
    expect(() => decodeSource("QUJD!REVG", "application/pdf")).toThrow(/Invalid base64 source/);
    const big = "QUJD".repeat(3_000_000) + "!";
    expect(() => decodeSource(big, "application/pdf")).toThrow(/Invalid base64 source/);
    expect(() => decodeSource("", "application/pdf")).toThrow(/Invalid base64 source/);
  });

  it("keeps the accepted set the same as the former pattern for padding and length", () => {
    expect(isBase64Text("QQ==")).toBe(true);
    expect(isBase64Text("QUI=")).toBe(true);
    expect(isBase64Text("QUJD")).toBe(true);
    expect(isBase64Text("QUJDR")).toBe(false);
    expect(isBase64Text("QQ===")).toBe(false);
    expect(isBase64Text("Q=Q=")).toBe(false);
  });
});

describe("analyzer: decompression bound before any PDF parser", () => {
  it("refuses a small PDF that expands past the analyzer budget, before OCR or parsing", async () => {
    const bomb = await buildExpansionPdf(ANALYZER_MAX_EXPANDED_BYTES + 8 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const t = performance.now();
    await expect(extractPages(bomb, "application/pdf", noOcr as any)).rejects.toThrow(/too large to read/);
    expect(performance.now() - t).toBeLessThan(10000);
  }, 120000);

  it("does not refuse a PDF whose content expands within the budget", async () => {
    const ok = await buildExpansionPdf(8 * 1024 * 1024);
    expect(expandedBytesWithin(ok, ANALYZER_MAX_EXPANDED_BYTES)).toBe(true);
  }, 60000);

  it("does not refuse the real current official PDFs (when present)", () => {
    const dir = OFFICIAL_FORMS_CURRENT_DIR;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/official-forms/current-manifest.json"), "utf8")
    ) as { files: { fileName: string }[] };
    const present = manifest.files.filter(f => fs.existsSync(path.join(dir, f.fileName)));
    if (present.length !== manifest.files.length) return; // skipped by presence, not passed
    for (const f of present) {
      expect(expandedBytesWithin(fs.readFileSync(path.join(dir, f.fileName)), ANALYZER_MAX_EXPANDED_BYTES), f.fileName).toBe(true);
    }
  });
});

describe("analyzer: logs never carry document content", () => {
  it("does not write a document's text into the console when the PDF text reader fails", async () => {
    const { extractTextFromPdfBuffer } = await import("./pageSources");
    const { vi } = await import("vitest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await extractTextFromPdfBuffer(Buffer.from("%PDF-1.4\nSECRET-PARENT-NOTE-7731 (unterminated"));
      const logged = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls].map(c => JSON.stringify(c)).join("\n");
      expect(logged).not.toContain("SECRET-PARENT-NOTE-7731");
    } finally {
      warn.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });
});
