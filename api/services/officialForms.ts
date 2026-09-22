// Stage 9D-4A — Official Ontario Court Form Registry + Template/Version Foundation.
// Deterministic, provider-independent types and pure logic only. No live model calls, no
// database access here (see officialFormRegistry.ts for the Supabase-backed service layer).
//
// SCOPE: this file (and the whole of 9D-4A) builds ONLY the identity/versioning/verification
// foundation for official court-form templates. It does not implement AI-assisted form
// completion, template filling, or populated-document generation — those are 9D-4B and 9D-4C,
// explicitly out of scope here.
import { LifecycleError } from "./lifecycleErrors.js";

const invalid = (message: string) => new LifecycleError(400, "INVALID_OFFICIAL_FORM", message);

// ---------------------------------------------------------------------------
// Form identity / source / version / template / field-map model
// ---------------------------------------------------------------------------

export const FORM_JURISDICTIONS = ["ON", "CA"] as const;
export type FormJurisdiction = (typeof FORM_JURISDICTIONS)[number];

// A form is registered once and resolved identically for parents and professionals — there
// is exactly one canonical registry, never a parent-registry and a professional-registry.
export interface OfficialForm {
  id: string;
  jurisdiction: FormJurisdiction;
  formNumber: string;
  officialTitle: string;
  ruleFamily: string;
  category: string;
  // A tag, not a filter: general Family Law Rules forms are first-class registry members,
  // not excluded because they are not CYFSA-specific.
  cyfsaRelevant: boolean;
  isActive: boolean;
  isSynthetic: boolean;
}

export const SOURCE_VERIFICATION_STATES = ["VERIFIED", "UNVERIFIED", "SOURCE_UNAVAILABLE"] as const;
export type SourceVerificationState = (typeof SOURCE_VERIFICATION_STATES)[number];

export interface OfficialFormSource {
  id: string;
  formId: string;
  sourceUrl: string;
  sourceAuthority: string;
  verificationStatus: SourceVerificationState;
  lastVerifiedAt: string | null;
}

// Currentness is explicit and distinct from "we have a stored copy". UNKNOWN must never be
// treated as CURRENT; only an explicitly-verified-current version may resolve as current.
export const FORM_VERSION_CURRENTNESS = [
  "CURRENT",
  "SUPERSEDED",
  "UNKNOWN",
  "VERIFICATION_OVERDUE",
  "SOURCE_UNAVAILABLE"
] as const;
export type FormVersionCurrentness = (typeof FORM_VERSION_CURRENTNESS)[number];

export interface OfficialFormVersion {
  id: string;
  formId: string;
  versionLabel: string;
  officialRevisionDate: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  currentnessStatus: FormVersionCurrentness;
  supersedesVersionId: string | null;
  firstVerifiedAt: string | null;
  lastVerifiedAt: string | null;
}

export const TEMPLATE_FILE_FORMATS = ["PDF", "DOCX"] as const;
export type TemplateFileFormat = (typeof TEMPLATE_FILE_FORMATS)[number];

export const TEMPLATE_TRUST_STATES = ["UNTRUSTED", "HASH_VERIFIED"] as const;
export type TemplateTrustState = (typeof TEMPLATE_TRUST_STATES)[number];

// storageBucket/storagePath are opaque Supabase Storage references, never a caller-supplied
// filesystem path. sha256Hex is always computed server-side from real bytes during ingestion
// — nothing in this model lets a caller assert a hash as proof of integrity.
export interface OfficialFormTemplate {
  id: string;
  formVersionId: string;
  fileFormat: TemplateFileFormat;
  mimeType: string;
  storageBucket: string;
  storagePath: string;
  byteSize: number;
  sha256Hex: string;
  isSynthetic: boolean;
  trustStatus: TemplateTrustState;
}

export const FIELD_MAP_STATUSES = ["DRAFT", "VALIDATED", "DEPRECATED"] as const;
export type FieldMapStatus = (typeof FIELD_MAP_STATUSES)[number];

// Bound to one exact template artifact id (and therefore one exact form version + hash).
// Using this field map against any other template id must fail, never silently apply.
export interface OfficialFormFieldMap {
  id: string;
  templateId: string;
  mappingVersionLabel: string;
  fieldCount: number;
  mappingStatus: FieldMapStatus;
}

// ---------------------------------------------------------------------------
// Provenance vocabulary for FUTURE field values (9D-4B/9D-4C). Recorded here as the
// canonical, closed vocabulary so later stages build against one contract; no completion
// logic is implemented in 9D-4A.
// ---------------------------------------------------------------------------
export const FIELD_VALUE_PROVENANCE = [
  "USER_ENTERED",
  "MATTER_DERIVED",
  "MACHINE_SUGGESTED",
  "PROFESSIONALLY_REVIEWED",
  "OFFICIAL_STATIC_FORM_CONTENT"
] as const;
export type FieldValueProvenance = (typeof FIELD_VALUE_PROVENANCE)[number];

export function isValidFieldValueProvenance(value: unknown): value is FieldValueProvenance {
  return typeof value === "string" && (FIELD_VALUE_PROVENANCE as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Pure structural checks — no I/O.
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
// Reject path traversal / absolute paths / caller-controlled arbitrary filesystem targets.
const SAFE_STORAGE_PATH = /^[A-Za-z0-9._\-/]+$/;

export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === "string" && HEX64.test(value);
}

export function assertSafeStoragePath(path: string): void {
  if (typeof path !== "string" || path.length === 0 || path.length > 400) {
    throw invalid("Storage path is required.");
  }
  if (path.includes("..") || path.startsWith("/") || !SAFE_STORAGE_PATH.test(path)) {
    throw invalid("Storage path is not a valid, safe relative path.");
  }
}

// A version resolves as CURRENT only when it is explicitly marked CURRENT AND carries a
// real verification timestamp. Every other status (including UNKNOWN) is never current.
export function isExplicitlyCurrent(version: Pick<OfficialFormVersion, "currentnessStatus" | "lastVerifiedAt">): boolean {
  return version.currentnessStatus === "CURRENT" && !!version.lastVerifiedAt;
}

// Structural template/field-map binding check: a field map is only usable against the exact
// template id it was built for.
export function fieldMapAppliesToTemplate(fieldMap: Pick<OfficialFormFieldMap, "templateId">, templateId: string): boolean {
  return fieldMap.templateId === templateId;
}

export function assertFieldMapAppliesToTemplate(
  fieldMap: Pick<OfficialFormFieldMap, "templateId" | "id">,
  template: Pick<OfficialFormTemplate, "id">
): void {
  if (!fieldMapAppliesToTemplate(fieldMap, template.id)) {
    throw new LifecycleError(
      409,
      "FIELD_MAP_TEMPLATE_MISMATCH",
      "This field map was built for a different template version and cannot be applied here."
    );
  }
}

// Structural hash-integrity check: the caller may report what it computed, but the trusted
// value is always the server-stored sha256Hex from ingestion; a caller-supplied hash can
// never override it, it can only be checked against it.
export function verifyTemplateHash(template: Pick<OfficialFormTemplate, "sha256Hex">, actualSha256Hex: string): void {
  if (!isValidSha256Hex(actualSha256Hex)) {
    throw invalid("Computed hash is not a valid sha256 hex digest.");
  }
  if (actualSha256Hex !== template.sha256Hex) {
    throw new LifecycleError(409, "TEMPLATE_INTEGRITY_FAILURE", "Template artifact hash mismatch: integrity verification failed.");
  }
}
