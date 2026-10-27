/**
 * Current official Ontario court-form PDFs (retrieved read-only 2026-10-26).
 *
 * These are a SEPARATE set from the historical pins in officialFormRealArtifactIntegration.test.ts.
 * They are checked against scripts/official-forms/current-manifest.json and never against the
 * historical pins. A current PDF is never asserted to be the historical file, and a historical
 * test is never satisfied by a current file.
 *
 * Each file gates on its own presence, so an absent file skips only its own tests.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ingestTrustedDevelopmentArtifact, toPublicRetrievalResult } from "./officialFormRetrieval";
import { pdfJsReady } from "./pdfPolyfill";
import { officialFormCurrentFile } from "../testSupport/officialFormFixtures.js";

interface CurrentManifestFile {
  label: string;
  formNumber: string;
  format: "PDF";
  fileName: string;
  sourceUrl: string;
  byteLength: number;
  sha256: string;
  retrievedAt: string;
  pdfMetadata: { pages: number; acroFormFieldCount: number; encrypted: boolean };
}
interface CurrentManifest {
  version: string;
  retrievedAt: string;
  uploadDirectory: string;
  files: CurrentManifestFile[];
}

const manifestPath = fileURLToPath(new URL("../../scripts/official-forms/current-manifest.json", import.meta.url));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CurrentManifest;

/** The identifier printed on page 1 of each current file. Read from the document, not assumed. */
const PAGE_ONE_IDENTIFIER: Record<string, string> = {
  "33f4ddb3-form-35-1a-en-dec20.pdf": "Form 35.1A:",
  "89af8ff6-form_33c_2018.pdf": "Form 33C:",
  "90196879-form-33b-1-en-dec20.pdf": "Form 33B.1:",
  "df9e829b-flr-14a-sept105-en-fil.pdf": "Form 14A:",
  "4dcaaa3e-form-8b-feb-2022-en.pdf": "Form 8B:",
  // Filename suggests 33B.1, but page 1 reads "Form 33B:". Identity is NOT claimed as 33B.1.
  "b43d35f7-form_33b_2018.pdf": "Form 33B:",
};

function filePath(f: CurrentManifestFile): string {
  // Resolved through the fixture resolver, never through a path relative to the working directory.
  return officialFormCurrentFile(f.fileName);
}

function gateFor(f: CurrentManifestFile) {
  return fs.existsSync(filePath(f)) ? describe : describe.skip;
}

// Loads the same PDF.js build the production extraction uses (pdfPolyfill configures its worker first).
async function loadPdfJs() {
  await pdfJsReady;
  return await import("pdfjs-dist/legacy/build/pdf.mjs");
}

async function openDocument(bytes: Buffer) {
  const pdfjs: any = await loadPdfJs();
  // Empty user password: these files are AES-encrypted with no user password, as recorded in the manifest.
  return await pdfjs.getDocument({ data: new Uint8Array(bytes), password: "", verbosity: 0 }).promise;
}

describe("current official court-form PDFs: manifest", () => {
  it("lists six current PDFs, each with a 64-hex SHA-256, a positive byte length and a source URL", () => {
    expect(manifest.version).toBe("current");
    expect(manifest.files).toHaveLength(6);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.byteLength).toBeGreaterThan(0);
      expect(f.sourceUrl.startsWith("https://ontariocourtforms.on.ca/")).toBe(true);
      expect(f.retrievedAt).toBe(manifest.retrievedAt);
    }
  });

  it("is kept separate from the historical pins (no current file reuses a historical file name)", () => {
    const historical = JSON.parse(
      fs.readFileSync(new URL("../../scripts/official-forms/manifest.json", import.meta.url), "utf8")
    ) as { files: { fileName: string; sha256: string }[] };
    const historicalNames = new Set(historical.files.map(f => f.fileName));
    for (const f of manifest.files) {
      // Same file name is allowed only if the bytes differ, which is the recorded finding.
      if (historicalNames.has(f.fileName)) {
        const hist = historical.files.find(h => h.fileName === f.fileName)!;
        expect(hist.sha256).not.toBe(f.sha256);
      }
    }
  });
});

for (const f of manifest.files) {
  gateFor(f)(`current official ${f.label} (${f.fileName})`, () => {
    it("bytes match the current manifest's byte length and SHA-256", () => {
      const bytes = fs.readFileSync(filePath(f));
      expect(bytes.length).toBe(f.byteLength);
      expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(f.sha256);
    });

    it("ingestion reads the bytes and establishes identity only against the current pin", () => {
      const bytes = fs.readFileSync(filePath(f));
      const result = ingestTrustedDevelopmentArtifact({
        sourceUrlForProvenanceOnly: f.sourceUrl,
        expectedFormat: "PDF",
        bytes,
        trustedPin: { sha256Hex: f.sha256, byteLength: f.byteLength }
      });
      expect(result.detectedFormat).toBe("PDF");
      expect(result.bytesRead).toBe(true);
      expect(result.identityVerifiedAgainstPin).toBe(true);
      expect(result.trustedPinSha256).toBe(f.sha256);
      expect(toPublicRetrievalResult(result) as object).not.toHaveProperty("bytes");
    });

    it("ingestion does NOT establish identity against a pin that names a different file", () => {
      const bytes = fs.readFileSync(filePath(f));
      const otherPin = manifest.files.find(o => o.sha256 !== f.sha256)!;
      const result = ingestTrustedDevelopmentArtifact({
        sourceUrlForProvenanceOnly: f.sourceUrl,
        expectedFormat: "PDF",
        bytes,
        trustedPin: { sha256Hex: otherPin.sha256, byteLength: otherPin.byteLength }
      });
      expect(result.identityVerifiedAgainstPin).toBe(false);
    });

    it("is a structurally valid PDF that pdfjs opens with the empty user password", async () => {
      const bytes = fs.readFileSync(filePath(f));
      expect(bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.7");
      const doc = await openDocument(bytes);
      try {
        expect(doc.numPages).toBe(f.pdfMetadata.pages);
      } finally {
        await doc.destroy();
      }
    });

    it("extracts non-empty text from every page, attributed by page index", async () => {
      const doc = await openDocument(fs.readFileSync(filePath(f)));
      try {
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const content = await page.getTextContent();
          const text = content.items.map((i: { str: string }) => i.str).join(" ").trim();
          expect(text.length, `page ${p} has text`).toBeGreaterThan(0);
        }
      } finally {
        await doc.destroy();
      }
    });

    it("page 1 carries this file's form identifier", async () => {
      const doc = await openDocument(fs.readFileSync(filePath(f)));
      try {
        const page = await doc.getPage(1);
        const text = (await page.getTextContent()).items.map((i: { str: string }) => i.str).join(" ");
        expect(text).toContain(PAGE_ONE_IDENTIFIER[f.fileName]);
      } finally {
        await doc.destroy();
      }
    });

    it("AcroForm inventory: unique field names equal the count recorded for this file", async () => {
      const doc = await openDocument(fs.readFileSync(filePath(f)));
      try {
        const fields = await doc.getFieldObjects();
        expect(Object.keys(fields ?? {})).toHaveLength(f.pdfMetadata.acroFormFieldCount);
      } finally {
        await doc.destroy();
      }
    });

    it("ingestion is deterministic: repeated reads of the same bytes give the same SHA-256 and length", () => {
      const bytes = fs.readFileSync(filePath(f));
      const first = ingestTrustedDevelopmentArtifact({ sourceUrlForProvenanceOnly: f.sourceUrl, expectedFormat: "PDF", bytes });
      const second = ingestTrustedDevelopmentArtifact({ sourceUrlForProvenanceOnly: f.sourceUrl, expectedFormat: "PDF", bytes });
      expect(second.sha256Hex).toBe(first.sha256Hex);
      expect(second.byteLength).toBe(first.byteLength);
    });
  });
}
