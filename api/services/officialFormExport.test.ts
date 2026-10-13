// Gate tests. Synthetic DOCX fixtures and an injected synthetic manifest entry exercise the
// logic only. Nothing here verifies a real Ontario court form.
import { describe, it, expect } from "vitest";
import { zipSync, strToU8, strFromU8, unzipSync } from "fflate";
import { prepareOfficialFormExport, sha256Hex, bindOfficialTemplate, TemplateBindingError } from "./officialFormExport.js";
import { createReviewedFormDraft, reviewFormField, type FieldSuggestion } from "./officialFormReviewedDraft.js";
import { readLegacyFieldValues } from "./docxFormPopulator.js";
import type { RealArtifactByteVerificationEntry } from "./officialFormSourceManifest.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const SYNTHETIC_FORM = "TEST-FORM";

function syntheticTemplate(): Buffer {
  const body =
    `<w:p><w:r><w:t>Applicant: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="applicant_name"/><w:enabled/><w:textInput/></w:ffData></w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>ph</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` +
    `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="consent"/><w:enabled/><w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`)
    })
  );
}

function manifestFor(bytes: Buffer, currentnessStatus: RealArtifactByteVerificationEntry["currentnessStatus"]): RealArtifactByteVerificationEntry[] {
  return [{
    formNumber: SYNTHETIC_FORM,
    format: "DOCX",
    suppliedFilename: "synthetic-fixture.docx",
    suppliedFilePath: "synthetic",
    byteLength: bytes.length,
    sha256Hex: sha256Hex(bytes),
    contentValidationPassed: true,
    artifactBytesVerified: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    currentnessStatus
  }];
}

function reviewedDraft(bytes: Buffer, accept: boolean) {
  const suggestions: FieldSuggestion[] = [
    { fieldKey: "applicant_name", value: "Jordan Lee", provenance: "MACHINE_SUGGESTED", sourceReference: "document:1 page:2" },
    { fieldKey: "consent", value: "true", provenance: "USER_ENTERED" }
  ];
  let draft = createReviewedFormDraft(SYNTHETIC_FORM, sha256Hex(bytes), suggestions);
  if (accept) {
    draft = reviewFormField(draft, "applicant_name", "ACCEPTED");
    draft = reviewFormField(draft, "consent", "ACCEPTED");
  }
  return draft;
}

describe("prepareOfficialFormExport gate", () => {
  it("blocks when no template is supplied", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({ formNumber: "14A", format: "DOCX", templateBytes: null, draft: reviewedDraft(bytes, true), fieldMapValidated: false });
    expect(r.docx).toBeNull();
    expect(r.preflight.canExportAsOfficial).toBe(false);
    expect(r.preflight.blockers.join(" ")).toMatch(/No official template has been supplied/);
  });

  it("blocks bytes that match no verified manifest entry", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({ formNumber: "14A", format: "DOCX", templateBytes: bytes, draft: reviewedDraft(bytes, true), fieldMapValidated: true });
    expect(r.docx).toBeNull();
    expect(r.preflight.blockers.join(" ")).toMatch(/do not match any verified/);
  });

  it("blocks PDF because PDF population is not implemented", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({ formNumber: SYNTHETIC_FORM, format: "PDF", templateBytes: bytes, draft: reviewedDraft(bytes, true), fieldMapValidated: true });
    expect(r.docx).toBeNull();
    expect(r.preflight.blockers.join(" ")).toMatch(/PDF population is not implemented/);
  });

  it("blocks a verified template whose currentness has not been verified, even with full review", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({
      formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes, draft: reviewedDraft(bytes, true), fieldMapValidated: true,
      verifiedEntries: manifestFor(bytes, "UNKNOWN")
    });
    expect(r.docx).toBeNull();
    expect(r.preflight.canExportAsOfficial).toBe(false);
    expect(r.preflight.blockers).toContain("Current version has not been verified.");
  });

  it("blocks unreviewed or unaccepted fields and never releases them", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({
      formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes, draft: reviewedDraft(bytes, false), fieldMapValidated: true,
      verifiedEntries: manifestFor(bytes, "CURRENT")
    });
    expect(r.docx).toBeNull();
    expect(r.preflight.blockers.join(" ")).toMatch(/explicitly accepted/);
  });

  it("blocks a draft bound to a different template hash", () => {
    const bytes = syntheticTemplate();
    const other = Buffer.from(strToU8("different"));
    const draft = createReviewedFormDraft(SYNTHETIC_FORM, sha256Hex(other), [{ fieldKey: "applicant_name", value: "x", provenance: "USER_ENTERED" }]);
    const r = prepareOfficialFormExport({
      formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes, draft: reviewFormField(draft, "applicant_name", "ACCEPTED"), fieldMapValidated: true,
      verifiedEntries: manifestFor(bytes, "CURRENT")
    });
    expect(r.docx).toBeNull();
    expect(r.preflight.blockers.join(" ")).toMatch(/different template hash/);
  });

  it("reports template fields that have no reviewed value as missing", () => {
    const bytes = syntheticTemplate();
    const draft = reviewFormField(
      createReviewedFormDraft(SYNTHETIC_FORM, sha256Hex(bytes), [{ fieldKey: "applicant_name", value: "Jordan", provenance: "USER_ENTERED" }]),
      "applicant_name", "ACCEPTED"
    );
    const r = prepareOfficialFormExport({ formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes, draft, fieldMapValidated: true, verifiedEntries: manifestFor(bytes, "CURRENT") });
    expect(r.missingFields).toEqual(["consent"]);
    expect(r.docx).toBeNull();
  });

  it("refuses a checkbox reviewed as free text", () => {
    const bytes = syntheticTemplate();
    const draft = reviewFormField(
      createReviewedFormDraft(SYNTHETIC_FORM, sha256Hex(bytes), [
        { fieldKey: "applicant_name", value: "Jordan", provenance: "USER_ENTERED" },
        { fieldKey: "consent", value: "yes", provenance: "USER_ENTERED" }
      ]),
      "applicant_name", "ACCEPTED"
    );
    const r = prepareOfficialFormExport({
      formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes,
      draft: reviewFormField(draft, "consent", "ACCEPTED"), fieldMapValidated: true, verifiedEntries: manifestFor(bytes, "CURRENT")
    });
    expect(r.docx).toBeNull();
    expect(r.preflight.blockers.join(" ")).toMatch(/"true" or "false"/);
  });

  it("with a verified, current, fully reviewed synthetic template, populates and re-verifies the DOCX", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({
      formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes, draft: reviewedDraft(bytes, true), fieldMapValidated: true,
      verifiedEntries: manifestFor(bytes, "CURRENT")
    });
    expect(r.preflight.blockers).toEqual([]);
    expect(r.preflight.canExportAsOfficial).toBe(true);
    expect(r.docx).not.toBeNull();
    expect(readLegacyFieldValues(r.docx!)).toEqual({ applicant_name: "Jordan Lee", consent: true });
    expect(strFromU8(unzipSync(new Uint8Array(r.docx!))["[Content_Types].xml"])).toBe("<Types/>");
  });

  it("requires commissioning before an affidavit can be described as filing-ready", () => {
    const bytes = syntheticTemplate();
    const r = prepareOfficialFormExport({
      formNumber: SYNTHETIC_FORM, format: "DOCX", templateBytes: bytes, draft: reviewedDraft(bytes, true), fieldMapValidated: true,
      verifiedEntries: manifestFor(bytes, "CURRENT"), affidavit: { requiresCommissioner: true, commissioned: false }
    });
    expect(r.preflight.canDescribeAsFilingReady).toBe(false);
    expect(r.preflight.warnings.join(" ")).toMatch(/do not present as executed/);
  });
});

describe("bindOfficialTemplate", () => {
  it("rejects a form-number or format mismatch even when bytes are otherwise matched", () => {
    const bytes = syntheticTemplate();
    const entries = manifestFor(bytes, "CURRENT");
    expect(() => bindOfficialTemplate("OTHER", "DOCX", bytes, entries)).toThrow(TemplateBindingError);
    expect(() => bindOfficialTemplate(SYNTHETIC_FORM, "PDF", bytes, entries)).toThrow(TemplateBindingError);
  });
});
