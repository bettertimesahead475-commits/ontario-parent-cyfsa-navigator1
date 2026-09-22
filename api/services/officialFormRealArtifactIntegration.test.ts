// Stage 9D-4B-1R — real Ontario court-form artifact integration test.
//
// SCOPE: this test processes REAL, actually-supplied official Ontario court-form artifacts
// through the existing CLOSED/FROZEN Stage 9D-4B-1 trusted-ingestion/integrity pipeline
// (ingestTrustedDevelopmentArtifact in officialFormRetrieval.ts). It builds NO new verifier, NO
// field-mapping/population (that is 9D-4B-2, out of scope), and does NOT begin 9D-4C. It reads
// the supplied bytes directly from disk exactly as an external trusted caller would — no
// `trusted=true`/`official=true`/`skipValidation` shortcut is used or exists; the frozen
// function's own signature has no such flag.
//
// The five source files live OUTSIDE this repository, at their original sandbox upload paths.
// They are intentionally NOT committed to git (copyright/licensing caution — see task Step 7).
// If this test file is ever run in an environment where those upload paths are unavailable, the
// artifact-dependent tests are skipped (not failed) rather than fabricating results — see
// `describeIfFilesPresent` below.
//
// NO FIELD MAP, NO POPULATED/FILLED FORM OUTPUT, AND NO PRODUCTION FIELD MAP DATA IS CREATED
// ANYWHERE IN THIS FILE. Structural inventory below is READ-ONLY inspection only.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  ingestTrustedDevelopmentArtifact,
  detectAndValidateFormat,
  sha256OfExactBytes,
  toPublicRetrievalResult,
  type DetectedFormat
} from "./officialFormRetrieval.js";
import {
  REAL_ONTARIO_FORM_CANDIDATES,
  REAL_ARTIFACT_BYTE_VERIFICATIONS
} from "./officialFormSourceManifest.js";

const UPLOAD_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e";

interface SuppliedFile {
  label: string;
  formNumber: string;
  format: DetectedFormat;
  path: string;
  expectedByteLength: number;
  expectedSha256: string;
}

// Reference facts as reported to this session; each is independently recomputed below (Step 3 —
// never trusted from a caller-supplied value).
const SUPPLIED_FILES: SuppliedFile[] = [
  {
    label: "35.1A PDF",
    formNumber: "35.1A",
    format: "PDF",
    path: `${UPLOAD_DIR}/33f4ddb3-form-35-1a-en-dec20.pdf`,
    expectedByteLength: 208594,
    expectedSha256: "288882fe64111160104f47ce9eeda758843b7d22d925bcb121f877a0ea711650"
  },
  {
    label: "35.1A DOCX",
    formNumber: "35.1A",
    format: "DOCX",
    path: `${UPLOAD_DIR}/48d81005-form-35-1a-en-dec20.docx`,
    expectedByteLength: 39464,
    expectedSha256: "4efdb1baabe0e621caceb73b0b9924b414665d9872e5f280a29e3ff61b28fbcc"
  },
  {
    label: "33C DOCX",
    formNumber: "33C",
    format: "DOCX",
    path: `${UPLOAD_DIR}/3bf6f793-form_33c_2018.docx`,
    expectedByteLength: 41730,
    expectedSha256: "d73d4f9d8641616fe502ec0dd2f67511e424e69a1a7fff68015d403f5645407b"
  },
  {
    label: "33C PDF",
    formNumber: "33C",
    format: "PDF",
    path: `${UPLOAD_DIR}/89af8ff6-form_33c_2018.pdf`,
    expectedByteLength: 224841,
    expectedSha256: "73ff6adc549ae0fa70ec1de3f335058a7d7cdc80ac0c2918f87ad87993499bfe"
  },
  {
    label: "33B.1 DOCX",
    formNumber: "33B.1",
    format: "DOCX",
    path: `${UPLOAD_DIR}/df0e02ef-form-33b-1-en-dec20.docx`,
    expectedByteLength: 55033,
    expectedSha256: "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e"
  }
];

const filesAvailable = SUPPLIED_FILES.every(f => fs.existsSync(f.path));

// If the sandbox upload paths are unavailable in whatever environment runs this suite later,
// skip rather than fail or fabricate — this keeps the frozen suite green for everyone while
// still documenting exactly what this ingestion run established when the files WERE present.
const describeReal = filesAvailable ? describe : describe.skip;

describeReal("Stage 9D-4B-1R: real Ontario artifact trusted ingestion", () => {
  // -------------------------------------------------------------------------
  // STEP 2/3 — trusted ingestion + exact byte integrity, per file.
  // -------------------------------------------------------------------------
  for (const f of SUPPLIED_FILES) {
    describe(f.label, () => {
      it("matches the expected byte length and SHA-256 recorded for this ingestion run", () => {
        const bytes = fs.readFileSync(f.path);
        expect(bytes.length).toBe(f.expectedByteLength);
        const hash = crypto.createHash("sha256").update(bytes).digest("hex");
        expect(hash).toHaveLength(64);
        expect(hash).toBe(f.expectedSha256);
      });

      it("is accepted by ingestTrustedDevelopmentArtifact (the real frozen pipeline function, no shortcuts)", () => {
        const bytes = fs.readFileSync(f.path);
        const result = ingestTrustedDevelopmentArtifact({
          sourceUrlForProvenanceOnly: `sandbox-upload:${f.path}`,
          expectedFormat: f.format,
          bytes
        });
        expect(result.detectedFormat).toBe(f.format);
        expect(result.byteLength).toBe(f.expectedByteLength);
        expect(result.sha256Hex).toBe(f.expectedSha256);
        expect(result.artifactBytesVerified).toBe(true);
        expect(result.verificationOrigin).toBe("TRUSTED_DEVELOPMENT_INGESTION");
        expect(result.isSynthetic).toBe(false);
        // Public projection excludes raw bytes, matching production contract.
        const pub = toPublicRetrievalResult(result);
        expect((pub as any).bytes).toBeUndefined();
      });

      it("produces a deterministic SHA-256 (hashed twice, identical)", () => {
        const bytes = fs.readFileSync(f.path);
        const h1 = sha256OfExactBytes(bytes);
        const h2 = sha256OfExactBytes(bytes);
        expect(h1).toBe(h2);
        expect(h1).toBe(f.expectedSha256);
      });

      it("changes SHA-256 when a single byte is mutated (does not touch the original file on disk)", () => {
        const original = fs.readFileSync(f.path);
        const mutated = Buffer.from(original); // copy — never mutate the buffer read from disk in place on the original file
        mutated[Math.floor(mutated.length / 2)] ^= 0xff;
        const originalHash = sha256OfExactBytes(original);
        const mutatedHash = sha256OfExactBytes(mutated);
        expect(mutatedHash).not.toBe(originalHash);
        // Confirm the on-disk file itself was never touched by this test.
        const reread = fs.readFileSync(f.path);
        expect(sha256OfExactBytes(reread)).toBe(f.expectedSha256);
      });

      it("rejects a truncated (corrupted) copy of these real bytes via content validation", () => {
        // Two truncation depths: (a) a 3-byte prefix breaks the PDF "%PDF-" magic-byte check
        // (too short to match) while still being a non-empty buffer for DOCX, and (b) an empty
        // buffer is rejected outright (EMPTY_ARTIFACT) for either format. A half-length
        // truncation of a real DOCX is NOT used here because the OOXML
        // "[Content_Types].xml" marker sits in an early local file header and can survive a
        // half-length cut, which would not actually exercise rejection.
        const bytes = fs.readFileSync(f.path);
        const tinyPrefix = bytes.subarray(0, 3);
        expect(() => detectAndValidateFormat(tinyPrefix, f.format)).toThrow();
        const empty = Buffer.alloc(0);
        expect(() => detectAndValidateFormat(empty, f.format)).toThrow();
      });

      it("passive structural inspection does not alter the original bytes on disk (hash before/after)", () => {
        const before = sha256OfExactBytes(fs.readFileSync(f.path));
        // Read-only inspection: just re-read and detect format, no write path exists here.
        const bytes = fs.readFileSync(f.path);
        detectAndValidateFormat(bytes, f.format);
        const after = sha256OfExactBytes(fs.readFileSync(f.path));
        expect(after).toBe(before);
      });
    });
  }

  // -------------------------------------------------------------------------
  // STEP 4 — PDF and DOCX of the same form are distinct artifacts (35.1A, 33C).
  // -------------------------------------------------------------------------
  it("35.1A PDF and 35.1A DOCX get distinct hashes and are never conflated", () => {
    const pdf = SUPPLIED_FILES.find(f => f.label === "35.1A PDF")!;
    const docx = SUPPLIED_FILES.find(f => f.label === "35.1A DOCX")!;
    expect(pdf.expectedSha256).not.toBe(docx.expectedSha256);
    const pdfResult = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "sandbox-upload:35.1a-pdf",
      expectedFormat: "PDF",
      bytes: fs.readFileSync(pdf.path)
    });
    const docxResult = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "sandbox-upload:35.1a-docx",
      expectedFormat: "DOCX",
      bytes: fs.readFileSync(docx.path)
    });
    expect(pdfResult.sha256Hex).not.toBe(docxResult.sha256Hex);
    expect(pdfResult.detectedFormat).not.toBe(docxResult.detectedFormat);
  });

  it("33C PDF and 33C DOCX get distinct hashes and are never conflated", () => {
    const pdf = SUPPLIED_FILES.find(f => f.label === "33C PDF")!;
    const docx = SUPPLIED_FILES.find(f => f.label === "33C DOCX")!;
    expect(pdf.expectedSha256).not.toBe(docx.expectedSha256);
    const pdfResult = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "sandbox-upload:33c-pdf",
      expectedFormat: "PDF",
      bytes: fs.readFileSync(pdf.path)
    });
    const docxResult = ingestTrustedDevelopmentArtifact({
      sourceUrlForProvenanceOnly: "sandbox-upload:33c-docx",
      expectedFormat: "DOCX",
      bytes: fs.readFileSync(docx.path)
    });
    expect(pdfResult.sha256Hex).not.toBe(docxResult.sha256Hex);
    expect(pdfResult.detectedFormat).not.toBe(docxResult.detectedFormat);
  });
});

// ---------------------------------------------------------------------------
// STEP 6/7 — Provenance boundary (A/B/C) modeled distinctly in the manifest, always run
// (does not depend on the raw files being present, only on the manifest module itself).
// ---------------------------------------------------------------------------
describe("Stage 9D-4B-1R: provenance boundary is modeled distinctly in the manifest", () => {
  it("A (official index) and B (byte verification) are separate data structures", () => {
    // Index-only records (A) always have artifactBytesVerified: false and null byte/hash fields,
    // regardless of what REAL_ARTIFACT_BYTE_VERIFICATIONS (B) says about the same form number.
    for (const indexRecord of REAL_ONTARIO_FORM_CANDIDATES) {
      expect(indexRecord.officialIndexVerified).toBe(true);
      expect(indexRecord.artifactBytesVerified).toBe(false);
      expect(indexRecord.sha256Hex).toBeNull();
      expect(indexRecord.byteLengthPdf).toBeNull();
      expect(indexRecord.byteLengthDocx).toBeNull();
    }
  });

  it("Form 8B and Form 14A have NO byte-verification entries (no bytes were supplied for them)", () => {
    const formNumbers = REAL_ARTIFACT_BYTE_VERIFICATIONS.map(e => e.formNumber);
    expect(formNumbers).not.toContain("8B");
    expect(formNumbers).not.toContain("14A");
  });

  it("Form 8B and Form 14A index entries remain fully untouched (still null/unverified)", () => {
    const form8b = REAL_ONTARIO_FORM_CANDIDATES.find(r => r.formNumber === "8B");
    const form14a = REAL_ONTARIO_FORM_CANDIDATES.find(r => r.formNumber === "14A");
    expect(form8b).toBeDefined();
    expect(form14a).toBeDefined();
    for (const r of [form8b!, form14a!]) {
      expect(r.artifactBytesVerified).toBe(false);
      expect(r.sha256Hex).toBeNull();
      expect(r.artifactVerifiedAt).toBeNull();
    }
  });

  it("33B.1 has only a DOCX byte-verification entry, no PDF entry (no PDF was supplied)", () => {
    const entries = REAL_ARTIFACT_BYTE_VERIFICATIONS.filter(e => e.formNumber === "33B.1");
    expect(entries).toHaveLength(1);
    expect(entries[0].format).toBe("DOCX");
  });

  it("35.1A and 33C each have both a PDF and a DOCX byte-verification entry", () => {
    for (const formNumber of ["35.1A", "33C"]) {
      const entries = REAL_ARTIFACT_BYTE_VERIFICATIONS.filter(e => e.formNumber === formNumber);
      const formats = entries.map(e => e.format).sort();
      expect(formats).toEqual(["DOCX", "PDF"]);
    }
  });

  // -------------------------------------------------------------------------
  // STEP 6/8 — B (byte verification) is modeled distinctly from C (currentness): confirm no
  // processed form got marked CURRENT.
  // -------------------------------------------------------------------------
  it("B (byte verification) never implies C (currentness) — no entry is CURRENT", () => {
    for (const entry of REAL_ARTIFACT_BYTE_VERIFICATIONS) {
      expect(entry.artifactBytesVerified).toBe(true);
      expect(entry.currentnessStatus).toBe("UNKNOWN");
      expect(entry.currentnessStatus).not.toBe("CURRENT");
    }
  });

  it("every byte-verification entry has a real 64-hex-char SHA-256 and a positive byte length", () => {
    for (const entry of REAL_ARTIFACT_BYTE_VERIFICATIONS) {
      expect(entry.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.byteLength).toBeGreaterThan(0);
    }
  });
});
