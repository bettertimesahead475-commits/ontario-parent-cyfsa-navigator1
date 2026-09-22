// Stage 9D-4B-1 — Real Ontario integration manifest.
//
// PROVENANCE: this metadata was observed by the project lead INDEPENDENTLY OUTSIDE this Claude
// sandbox, on 2026-09-22, by reading the canonical official index page:
//   https://ontariocourtforms.on.ca/en/family-law-rules-forms/
//
// This is development metadata ONLY — title, form number, version date, effective date, and
// PDF/DOCX filenames as reportedly listed on that index page. It establishes, at most,
// OFFICIAL_INDEX_VERIFIED status (see officialFormRetrieval.ts's OfficialIndexMetadataRecord).
// It does NOT establish, and must never be treated as establishing, ARTIFACT_BYTES_VERIFIED:
// no SHA-256, byte length, final redirected artifact URL, actual MIME response, exact size, or
// internal document structure has been observed for any of these five forms in this sandbox
// (this sandbox's outbound network is proxy-blocked from reaching Ontario government hosts).
// Those fields are therefore explicitly left null below — never guessed, never filled with a
// plausible-looking placeholder value.
import { buildOfficialIndexMetadataRecord, type OfficialIndexMetadataRecord } from "./officialFormRetrieval.js";

export const OFFICIAL_INDEX_SOURCE_URL = "https://ontariocourtforms.on.ca/en/family-law-rules-forms/";
export const OFFICIAL_INDEX_OBSERVED_BY = "project lead (outside this Claude sandbox)";
export const OFFICIAL_INDEX_OBSERVED_DATE = "2026-09-22";

export const REAL_ONTARIO_FORM_CANDIDATES: OfficialIndexMetadataRecord[] = [
  buildOfficialIndexMetadataRecord({
    formNumber: "8B",
    officialTitle: "Application (child protection and status review)",
    versionDateRaw: "Feb. 1, 2022",
    effectiveDateRaw: "May 1, 2022",
    pdfFilename: "form-8b-feb-2022-en.pdf",
    docxFilename: "form-8b-feb_1_2022-en.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "33B.1",
    officialTitle: "Answer and plan of care (parties other than Children's Aid Society)",
    versionDateRaw: "Dec. 1, 2020",
    effectiveDateRaw: "March 1, 2021",
    pdfFilename: "form-33b-1-en-dec20.pdf",
    docxFilename: "form-33b-1-en-dec20.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "33C",
    officialTitle: "Statement of agreed facts (child protection)",
    versionDateRaw: "March 1, 2018",
    effectiveDateRaw: "April 30, 2018",
    pdfFilename: "form_33c_2018.pdf",
    docxFilename: "form_33c_2018.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "35.1A",
    officialTitle: "Affidavit (child protection information)",
    versionDateRaw: "Dec. 1, 2020",
    effectiveDateRaw: "March 1, 2021",
    pdfFilename: "form-35-1a-en-dec20.pdf",
    docxFilename: "form-35-1a-en-dec20.docx"
  }),
  buildOfficialIndexMetadataRecord({
    formNumber: "14A",
    officialTitle: "Affidavit (General)",
    versionDateRaw: "Sept. 1, 2005",
    effectiveDateRaw: "May 1, 2006",
    pdfFilename: "flr-14a-sept105-en-fil.pdf",
    docxFilename: "flr_14a_sept105_en_fil.docx"
  })
];

// ---------------------------------------------------------------------------
// Stage 9D-4B-1R — REAL ARTIFACT BYTE VERIFICATION LAYER.
//
// This section is deliberately kept SEPARATE from REAL_ONTARIO_FORM_CANDIDATES above rather than
// mutating those (frozen, index-only) records in place, for two reasons: (1) it preserves the
// index-vs-byte provenance distinction (A vs B in the task boundary) as two genuinely different
// data structures instead of one record silently gaining fields, and (2) it lets us leave the
// Form 8B and Form 14A index entries completely untouched, exactly as required, because no bytes
// were supplied for them in this round.
//
// PROVENANCE (B — ARTIFACT BYTES VERIFIED): these facts were established by actually running the
// exact supplied bytes for these three forms through officialFormRetrieval.ts's
// ingestTrustedDevelopmentArtifact() — the same frozen content-validation + SHA-256 pipeline used
// by automatic retrieval — in this sandbox, on 2026-09-22. See
// api/services/officialFormRealArtifactIntegration.test.ts for the harness that produced these
// values; the hashes below are asserted equal to that harness's own computed hashes.
//
// PROVENANCE (C — CURRENTNESS) IS DELIBERATELY NOT TOUCHED HERE: byte validity (the file parses
// as a structurally sound PDF/DOCX and hashes deterministically) says nothing about whether this
// is still the CURRENT official version of the form. currentnessStatus is "UNKNOWN" for every
// entry below and must stay that way unless separate, real evidence (e.g. a fresh comparison
// against the live index) establishes otherwise. Nothing here may ever be read as CURRENT.
//
// Source file paths are the local upload paths used in this sandbox for this ingestion run —
// recorded for traceability only, never treated as a live/production storage location, and the
// binary files themselves are intentionally NOT committed to this repository (copyright/licensing
// caution) — see the task's Step 7.
export type RealArtifactCurrentnessStatus = "UNKNOWN" | "CURRENT" | "SUPERSEDED";

export interface RealArtifactByteVerificationEntry {
  formNumber: string;
  format: "PDF" | "DOCX";
  suppliedFilename: string;
  suppliedFilePath: string; // local sandbox path only, not a production location
  byteLength: number;
  sha256Hex: string;
  contentValidationPassed: true;
  artifactBytesVerified: true;
  verifiedAt: string; // ISO timestamp of this ingestion run
  verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION";
  currentnessStatus: RealArtifactCurrentnessStatus; // always "UNKNOWN" here — see note above
}

export const REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP = "2026-09-22T00:00:00.000Z";

export const REAL_ARTIFACT_BYTE_VERIFICATIONS: RealArtifactByteVerificationEntry[] = [
  {
    formNumber: "35.1A",
    format: "PDF",
    suppliedFilename: "form-35-1a-en-dec20.pdf",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/33f4ddb3-form-35-1a-en-dec20.pdf",
    byteLength: 208594,
    sha256Hex: "288882fe64111160104f47ce9eeda758843b7d22d925bcb121f877a0ea711650",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "35.1A",
    format: "DOCX",
    suppliedFilename: "form-35-1a-en-dec20.docx",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/48d81005-form-35-1a-en-dec20.docx",
    byteLength: 39464,
    sha256Hex: "4efdb1baabe0e621caceb73b0b9924b414665d9872e5f280a29e3ff61b28fbcc",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "33C",
    format: "PDF",
    suppliedFilename: "form_33c_2018.pdf",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/89af8ff6-form_33c_2018.pdf",
    byteLength: 224841,
    sha256Hex: "73ff6adc549ae0fa70ec1de3f335058a7d7cdc80ac0c2918f87ad87993499bfe",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "33C",
    format: "DOCX",
    suppliedFilename: "form_33c_2018.docx",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/3bf6f793-form_33c_2018.docx",
    byteLength: 41730,
    sha256Hex: "d73d4f9d8641616fe502ec0dd2f67511e424e69a1a7fff68015d403f5645407b",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "33B.1",
    format: "DOCX",
    suppliedFilename: "form-33b-1-en-dec20.docx",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/df0e02ef-form-33b-1-en-dec20.docx",
    byteLength: 55033,
    sha256Hex: "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  // ---------------------------------------------------------------------------------------
  // Stage 9D-4B-1R (continuation) — second real-artifact batch, ingested 2026-09-22, same
  // sandbox session, same frozen ingestTrustedDevelopmentArtifact() pipeline. See
  // api/services/officialFormRealArtifactIntegration.test.ts (SUPPLIED_FILES_BATCH_2) for the
  // harness that produced these values.
  // ---------------------------------------------------------------------------------------
  {
    formNumber: "33B.1",
    format: "PDF",
    suppliedFilename: "form-33b-1-en-dec20.pdf",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/90196879-form-33b-1-en-dec20.pdf",
    byteLength: 456688,
    sha256Hex: "a78a4b2e337b5a08c4645c6744a2c5b57e892bcdcb7fb410d3ab9fd82dbfe52b",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "14A",
    format: "DOCX",
    suppliedFilename: "flr_14a_sept105_en_fil.docx",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/c01f056a-flr_14a_sept105_en_fil.docx",
    byteLength: 29561,
    sha256Hex: "bfc552bf54c5972700759e455e5782e5cdec7f8affaa5e822e89e07681801261",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "14A",
    format: "PDF",
    suppliedFilename: "flr-14a-sept105-en-fil.pdf",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/df9e829b-flr-14a-sept105-en-fil.pdf",
    byteLength: 150386,
    sha256Hex: "84d443426575f4a0e94e70fac73cd02106172fc00aa1578ca40db7628ef907fd",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "8B",
    format: "DOCX",
    suppliedFilename: "form-8b-feb_1_2022-en.docx",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/d39f83dd-form-8b-feb_1_2022-en.docx",
    byteLength: 59408,
    sha256Hex: "02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  },
  {
    formNumber: "8B",
    format: "PDF",
    suppliedFilename: "form-8b-feb-2022-en.pdf",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/4dcaaa3e-form-8b-feb-2022-en.pdf",
    byteLength: 549760,
    sha256Hex: "da5ed87cdf454c77af04c255b9b7be44a2f08aa837a6bb3715ab0d0dcb8bdd6c",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN"
  }
  // NOTE: Form 33C and Form 35.1A are fully covered from the prior pass (PDF+DOCX each), so no
  // further entries for those two forms are added in this batch.
  //
  // NOTE ON THE SIXTH SUPPLIED FILE ("b43d35f7-form_33b_2018.pdf", 276848 bytes,
  // SHA-256 acb30d488447bc1e044b5575d2d4a7e0d0ad0c227e58b413c35233ef21561b65): this file is
  // DELIBERATELY NOT added as a "33B.1" entry above. Its filename ("form_33b_2018" — no "-1",
  // no "dec20") does not match the Dec-2020 "form-33b-1-en-dec20" naming convention used for the
  // verified 33B.1 PDF/DOCX pair, and read-only field-name inspection (AcroForm /T names, via
  // pikepdf with the file's empty user password) confirms it is structurally a materially
  // DIFFERENT, SHORTER answer/plan-of-care form: 53 fields vs. 33B.1's 169, and critically it is
  // MISSING every "Is the Child First Nations, Inuk or Métis" / "Bands and First Nations, Inuit
  // or Métis Communities" field and every explicit "Form 8B" cross-reference field that the
  // verified 33B.1 (Dec 2020) PDF has. This is consistent with it being an EARLIER (2018-era)
  // "Form 33B" style answer/plan-of-care document that predates the Dec-2020 33B.1 revision,
  // but that identification could not be confirmed against an authoritative index in this
  // sandbox (network to Ontario government hosts is proxy-blocked). It is therefore registered
  // separately below as its own form-identity-uncertain candidate, never merged into the 33B.1
  // byte-verification entries.
];

// ---------------------------------------------------------------------------
// Form-identity-uncertain candidate — the sixth supplied file. Byte-verified (its bytes were
// actually run through ingestTrustedDevelopmentArtifact and hashed), but its official form
// number/identity could NOT be confirmed against the official index in this sandbox, and its
// structure differs materially from the verified Form 33B.1 (Dec 2020). See the note above.
// Deliberately a separate export/shape from REAL_ARTIFACT_BYTE_VERIFICATIONS so nothing here can
// be silently read as "a 33B.1 entry."
export interface UnidentifiedByteVerifiedArtifact {
  claimedOrSuspectedFormNumber: string; // best-effort label only, NOT an official-index-confirmed form number
  formIdentityConfirmed: false;
  format: "PDF" | "DOCX";
  suppliedFilename: string;
  suppliedFilePath: string;
  byteLength: number;
  sha256Hex: string;
  contentValidationPassed: true;
  artifactBytesVerified: true;
  verifiedAt: string;
  verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION";
  currentnessStatus: RealArtifactCurrentnessStatus;
  identityNote: string;
}

export const UNIDENTIFIED_BYTE_VERIFIED_ARTIFACTS: UnidentifiedByteVerifiedArtifact[] = [
  {
    claimedOrSuspectedFormNumber: "33B (possible pre-33B.1 / 2018-era answer & plan of care — unconfirmed)",
    formIdentityConfirmed: false,
    format: "PDF",
    suppliedFilename: "form_33b_2018.pdf",
    suppliedFilePath:
      "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/b43d35f7-form_33b_2018.pdf",
    byteLength: 276848,
    sha256Hex: "acb30d488447bc1e044b5575d2d4a7e0d0ad0c227e58b413c35233ef21561b65",
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: REAL_ARTIFACT_BYTE_VERIFICATION_TIMESTAMP,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus: "UNKNOWN",
    identityNote:
      "Filename and AcroForm field-name structure (53 fields, no Indigenous-identity fields, no " +
      "explicit Form 8B cross-references) differ materially from the verified Form 33B.1 " +
      "(Dec 2020) PDF (169 fields). Not merged with the 33B.1 byte-verification entries. Not " +
      "confirmed against an authoritative index in this sandbox."
  }
];
