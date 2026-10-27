/**
 * Identity of the six current official Ontario court-form PDFs, by pinned SHA-256 and byte length.
 * Generated from scripts/official-forms/current-manifest.json and checked against it by a test.
 *
 * A file is identified only by an exact pin match. The pinned file whose page-1 caption reads "Form 33B:" has no
 * confirmed form identity, so its formNumber is null. Any other upload is UNIDENTIFIED: its printed labels can still
 * be mapped, but nothing says which official form it is.
 */
export const CURRENT_OFFICIAL_PDF_PINS: readonly { sha256: string; byteLength: number; formNumber: string | null }[] = [
  { sha256: "269183d42eb6071a0c0831c212dd3ad9b08cd2d4a6fb33ca5c1bd709d630adb9", byteLength: 136085, formNumber: "35.1A" },
  { sha256: "c02ae08fff8702431d8ced60567e4d6d7233e90fa11644a4ec0c8279e14a8a87", byteLength: 169341, formNumber: "33C" },
  { sha256: "8da3f80e927567d34b970a78ec4a3e3395319d5bf3865cab3b7f0eed0808071e", byteLength: 290950, formNumber: "33B.1" },
  { sha256: "ff0ff2936d6f195004ba517dd32c7b89b8c8a814584437b9d27cee014a815333", byteLength: 113949, formNumber: "14A" },
  { sha256: "5b024525e7c244bd2020ddbd871683de14b2fe84e7ad79971a8b687b89a825ff", byteLength: 320366, formNumber: "8B" },
  { sha256: "a6c6a8098a424d57bb885d65c8b56034ad0beb5874f067e5060bbf4a2b09e108", byteLength: 217939, formNumber: null }
];

export function identifyOfficialPdf(sha256: string, byteLength: number): { formNumber: string | null } | null {
  const pin = CURRENT_OFFICIAL_PDF_PINS.find(p => p.sha256 === sha256 && p.byteLength === byteLength);
  return pin ? { formNumber: pin.formNumber } : null;
}
