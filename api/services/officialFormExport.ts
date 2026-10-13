// Stage 9D — official court-form export gate.
//
// Composes the existing safeguards in the order a real export must use them:
//   1. bind the supplied template bytes to a manifest entry by SHA-256 (format and form must match);
//   2. require the reviewed draft to be bound to that exact template hash;
//   3. release values only when every field is explicitly accepted by the user;
//   4. report template fields that have no reviewed value as missing;
//   5. run the filing-safety preflight;
//   6. populate the DOCX only if the preflight passes, then re-verify the output.
// A successful export is a populated copy of the prescribed form. It is not a claim of court
// acceptance, legal sufficiency, or execution of any affidavit.
import { createHash } from "node:crypto";
import { REAL_ARTIFACT_BYTE_VERIFICATIONS, type RealArtifactByteVerificationEntry } from "./officialFormSourceManifest.js";
import { getReviewedValuesForPopulation, type ReviewedFormDraft } from "./officialFormReviewedDraft.js";
import { checkOfficialCourtFormExport, type OfficialExportPreflight } from "./officialCourtFormExportPreflight.js";
import { buildDocxFieldInventory } from "./docxFieldInventory.js";
import { populateLegacyFormFields, type LegacyFieldValue } from "./docxFormPopulator.js";

export type OfficialFormFormat = "PDF" | "DOCX";

export class TemplateBindingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TemplateBindingError";
    this.code = code;
  }
}

export interface VerifiedTemplateBinding {
  formNumber: string;
  format: OfficialFormFormat;
  sha256Hex: string;
  byteLength: number;
  suppliedFilename: string;
  currentnessStatus: RealArtifactByteVerificationEntry["currentnessStatus"];
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Bind bytes to a previously verified manifest entry. Matching is by exact SHA-256 AND form number
 * AND format, so a renamed, re-saved or superseded file cannot pass as the verified template.
 */
export function bindOfficialTemplate(
  formNumber: string,
  format: OfficialFormFormat,
  bytes: Buffer,
  verifiedEntries: readonly RealArtifactByteVerificationEntry[] = REAL_ARTIFACT_BYTE_VERIFICATIONS
): VerifiedTemplateBinding {
  const sha = sha256Hex(bytes);
  const entry = verifiedEntries.find(
    e => e.formNumber === formNumber && e.format === format && e.sha256Hex === sha
  );
  if (!entry) {
    throw new TemplateBindingError("TEMPLATE_NOT_VERIFIED", `Bytes do not match any verified ${format} template for Form ${formNumber}.`);
  }
  if (entry.byteLength !== bytes.length) {
    throw new TemplateBindingError("TEMPLATE_LENGTH_MISMATCH", "Template length does not match the verified record.");
  }
  return {
    formNumber,
    format,
    sha256Hex: sha,
    byteLength: bytes.length,
    suppliedFilename: entry.suppliedFilename,
    currentnessStatus: entry.currentnessStatus
  };
}

export interface OfficialFormExportRequest {
  formNumber: string;
  format: OfficialFormFormat;
  /** Template bytes supplied by the operator. Null when no template is available. */
  templateBytes: Buffer | null;
  draft: ReviewedFormDraft;
  /** True only when a field map has been validated against this exact template hash. */
  fieldMapValidated: boolean;
  /** Test seam only. Production callers omit this and bind against the built-in manifest. */
  verifiedEntries?: readonly RealArtifactByteVerificationEntry[];
  affidavit?: { requiresCommissioner: boolean; commissioned: boolean };
}

export interface OfficialFormExportResult {
  preflight: OfficialExportPreflight;
  binding: VerifiedTemplateBinding | null;
  missingFields: string[];
  /** Populated DOCX. Present only when preflight.canExportAsOfficial is true. */
  docx: Buffer | null;
}

export function prepareOfficialFormExport(req: OfficialFormExportRequest): OfficialFormExportResult {
  const blockers: string[] = [];
  let binding: VerifiedTemplateBinding | null = null;
  let bindingFailure: string | null = null;

  if (req.templateBytes === null) {
    bindingFailure = "No official template has been supplied for this export.";
  } else if (req.format !== "DOCX") {
    bindingFailure = "PDF population is not implemented; only DOCX templates can be populated.";
  } else {
    try {
      binding = bindOfficialTemplate(req.formNumber, req.format, req.templateBytes, req.verifiedEntries);
    } catch (e: any) {
      bindingFailure = e instanceof TemplateBindingError ? e.message : "Template could not be verified.";
    }
  }

  if (binding && req.draft.templateSha256Hex !== binding.sha256Hex) {
    bindingFailure = "The reviewed draft is bound to a different template hash.";
    binding = null;
  }
  if (binding && req.draft.formNumber !== req.formNumber) {
    bindingFailure = "The reviewed draft belongs to a different form.";
    binding = null;
  }
  if (bindingFailure) blockers.push(bindingFailure);

  let values: Record<string, string> | null = null;
  try {
    values = getReviewedValuesForPopulation(req.draft);
  } catch (e: any) {
    blockers.push(e?.message ?? "Reviewed values are not available for population.");
  }

  let missingFields: string[] = [];
  const populationValues: Record<string, LegacyFieldValue> = {};
  if (binding && req.templateBytes && values) {
    const fields = buildDocxFieldInventory(req.templateBytes).fields.filter(f => f.name !== null);
    const byName = new Map(fields.map(f => [f.name as string, f]));
    for (const [name, raw] of Object.entries(values)) {
      const entry = byName.get(name);
      if (!entry) {
        blockers.push(`A reviewed value targets "${name}", which is not a field in this template.`);
      } else if (entry.type === "checkbox") {
        if (raw === "true" || raw === "false") populationValues[name] = raw === "true";
        else blockers.push(`Checkbox "${name}" must be reviewed as "true" or "false".`);
      } else {
        populationValues[name] = raw;
      }
    }
    const provided = new Set(Object.keys(values));
    missingFields = fields.map(f => f.name as string).filter(n => !provided.has(n));
  }

  // populatedFromExactTemplate is asserted here because populateLegacyFormFields() either returns a
  // read-back-verified document or throws. If it throws, no export result is produced.
  const preflight = checkOfficialCourtFormExport({
    formNumber: req.formNumber,
    officialTemplate: binding !== null,
    sourceVerified: binding !== null,
    versionCurrent: binding?.currentnessStatus === "CURRENT",
    templateHashVerified: binding !== null,
    fieldMapValidated: req.fieldMapValidated && binding !== null,
    populatedFromExactTemplate: binding !== null && values !== null,
    userReviewed: values !== null,
    unresolvedFields: missingFields,
    affidavitRequiresCommissioner: req.affidavit?.requiresCommissioner,
    commissioned: req.affidavit?.commissioned
  });
  const allBlockers = [...new Set([...blockers, ...preflight.blockers])];
  const canPopulate = preflight.canExportAsOfficial && allBlockers.length === 0 && binding !== null && values !== null && req.templateBytes !== null;

  if (!canPopulate) {
    return {
      preflight: { ...preflight, canExportAsOfficial: false, canDescribeAsFilingReady: false, blockers: allBlockers },
      binding,
      missingFields,
      docx: null
    };
  }

  const docx = populateLegacyFormFields(req.templateBytes!, populationValues);
  return {
    preflight: { ...preflight, blockers: [], canExportAsOfficial: true, canDescribeAsFilingReady: preflight.canDescribeAsFilingReady },
    binding,
    missingFields,
    docx
  };
}
