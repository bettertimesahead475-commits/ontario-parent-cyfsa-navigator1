import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CURRENT_OFFICIAL_PDF_PINS, identifyOfficialPdf } from "./acroFormIdentity";

const manifest = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../../scripts/official-forms/current-manifest.json", import.meta.url)), "utf8")
) as { files: { sha256: string; byteLength: number; formNumber: string }[] };

describe("current official PDF identity table", () => {
  it("matches the committed current manifest exactly (no drift)", () => {
    expect(CURRENT_OFFICIAL_PDF_PINS.map(p => [p.sha256, p.byteLength])).toEqual(
      manifest.files.map(f => [f.sha256, f.byteLength])
    );
  });

  it("identifies a pinned file only by exact SHA-256 and byte length", () => {
    const [first] = CURRENT_OFFICIAL_PDF_PINS;
    expect(identifyOfficialPdf(first.sha256, first.byteLength)).toEqual({ formNumber: first.formNumber });
    expect(identifyOfficialPdf(first.sha256, first.byteLength + 1)).toBeNull();
    expect(identifyOfficialPdf("0".repeat(64), first.byteLength)).toBeNull();
  });

  it("claims no form identity for the file whose page-1 caption reads 'Form 33B:'", () => {
    const pin = CURRENT_OFFICIAL_PDF_PINS.find(p => p.sha256.startsWith("a6c6a809"));
    expect(pin).toBeDefined();
    expect(pin!.formNumber).toBeNull();
  });
});
