// Stage 9D-4A — Official Ontario Court Form Registry + Template/Version Foundation.
// Supabase-backed read service. Mirrors the api/services/legalSources.ts pattern for
// "canonical external authority + version + hash + verification state" rather than
// reinventing one. No AI-assisted completion, template filling or populated-document
// generation is implemented here — see officialForms.ts header for the full scope note.
import crypto from "node:crypto";
import { getSupabase } from "./access.js";
import { LifecycleError, requireUuid } from "./lifecycleErrors.js";
import {
  OfficialForm,
  OfficialFormSource,
  OfficialFormVersion,
  OfficialFormTemplate,
  OfficialFormFieldMap,
  assertSafeStoragePath,
  isExplicitlyCurrent,
  assertFieldMapAppliesToTemplate,
  verifyTemplateHash
} from "./officialForms.js";

const notFound = (msg: string) => new LifecycleError(404, "NOT_FOUND", msg);
const invalid = (msg: string) => new LifecycleError(400, "INVALID_INPUT", msg);

/** SHA-256 of real artifact bytes, hex-encoded. The only place a template hash is computed. */
export function sha256OfBytes(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function mapForm(row: any): OfficialForm {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    formNumber: row.form_number,
    officialTitle: row.official_title,
    ruleFamily: row.rule_family,
    category: row.category,
    cyfsaRelevant: row.cyfsa_relevant,
    isActive: row.is_active,
    isSynthetic: row.is_synthetic
  };
}

function mapSource(row: any): OfficialFormSource {
  return {
    id: row.id,
    formId: row.form_id,
    sourceUrl: row.source_url,
    sourceAuthority: row.source_authority,
    verificationStatus: row.verification_status,
    lastVerifiedAt: row.last_verified_at
  };
}

function mapVersion(row: any): OfficialFormVersion {
  return {
    id: row.id,
    formId: row.form_id,
    versionLabel: row.version_label,
    officialRevisionDate: row.official_revision_date,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    currentnessStatus: row.currentness_status,
    supersedesVersionId: row.supersedes_version_id,
    firstVerifiedAt: row.first_verified_at,
    lastVerifiedAt: row.last_verified_at
  };
}

// Never includes storageBucket/storagePath — internal storage location metadata is not part
// of the public-facing template shape returned by the read API. sha256Hex is still exposed
// deliberately: it is the whole point of the trust boundary and leaks no internal path.
export function mapTemplatePublic(row: any): Omit<OfficialFormTemplate, "storageBucket" | "storagePath"> {
  return {
    id: row.id,
    formVersionId: row.form_version_id,
    fileFormat: row.file_format,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256Hex: row.sha256_hex,
    isSynthetic: row.is_synthetic,
    trustStatus: row.trust_status
  };
}

function mapTemplateInternal(row: any): OfficialFormTemplate {
  return {
    ...mapTemplatePublic(row),
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path
  };
}

function mapFieldMap(row: any): OfficialFormFieldMap {
  return {
    id: row.id,
    templateId: row.template_id,
    mappingVersionLabel: row.mapping_version_label,
    fieldCount: row.field_count,
    mappingStatus: row.mapping_status
  };
}

// ---------------------------------------------------------------------------
// List / read — deliberately decoupled from matter access and paid-analyzer/AI gating.
// A blank official form's identity and version metadata are public reference data; parents
// and professionals resolve to exactly this same registry, never separate copies.
// ---------------------------------------------------------------------------

export async function listActiveForms(filter?: { cyfsaRelevant?: boolean }): Promise<OfficialForm[]> {
  const db = getSupabase();
  let query = db.from("navigator_official_forms").select("*").eq("is_active", true);
  if (typeof filter?.cyfsaRelevant === "boolean") {
    query = query.eq("cyfsa_relevant", filter.cyfsaRelevant);
  }
  const { data, error } = await query.order("form_number", { ascending: true });
  if (error) throw notFound("Could not list official forms.");
  return (data || []).map(mapForm);
}

export async function getForm(formId: string): Promise<OfficialForm> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_forms")
    .select("*")
    .eq("id", requireUuid(formId, "formId"))
    .single();
  if (error || !data) throw notFound("Official form not found.");
  return mapForm(data);
}

export async function listFormSources(formId: string): Promise<OfficialFormSource[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_sources")
    .select("*")
    .eq("form_id", requireUuid(formId, "formId"));
  if (error) throw notFound("Could not list official form sources.");
  return (data || []).map(mapSource);
}

export async function listFormVersions(formId: string): Promise<OfficialFormVersion[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_versions")
    .select("*")
    .eq("form_id", requireUuid(formId, "formId"))
    .order("created_at", { ascending: false });
  if (error) throw notFound("Could not list official form versions.");
  return (data || []).map(mapVersion);
}

export async function getFormVersion(versionId: string): Promise<OfficialFormVersion> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_versions")
    .select("*")
    .eq("id", requireUuid(versionId, "versionId"))
    .single();
  if (error || !data) throw notFound("Official form version not found.");
  return mapVersion(data);
}

/**
 * Resolve the current version for a form. Returns null if no version is explicitly,
 * verifiably CURRENT — UNKNOWN, VERIFICATION_OVERDUE and SOURCE_UNAVAILABLE never resolve
 * as current, and a version marked CURRENT without a real verification timestamp is
 * rejected defensively even though the schema should already prevent that state existing.
 */
export async function resolveCurrentVersion(formId: string): Promise<OfficialFormVersion | null> {
  const versions = await listFormVersions(formId);
  const current = versions.find(v => v.currentnessStatus === "CURRENT");
  if (!current || !isExplicitlyCurrent(current)) return null;
  return current;
}

export async function listTemplatesForVersion(versionId: string): Promise<Array<Omit<OfficialFormTemplate, "storageBucket" | "storagePath">>> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_templates")
    .select("*")
    .eq("form_version_id", requireUuid(versionId, "versionId"));
  if (error) throw notFound("Could not list official form templates.");
  return (data || []).map(mapTemplatePublic);
}

export async function getTemplatePublic(templateId: string): Promise<Omit<OfficialFormTemplate, "storageBucket" | "storagePath">> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_templates")
    .select("*")
    .eq("id", requireUuid(templateId, "templateId"))
    .single();
  if (error || !data) throw notFound("Official form template not found.");
  return mapTemplatePublic(data);
}

/** Internal-only (never exposed via the read API): includes storage bucket/path. */
export async function getTemplateInternal(templateId: string): Promise<OfficialFormTemplate> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_templates")
    .select("*")
    .eq("id", requireUuid(templateId, "templateId"))
    .single();
  if (error || !data) throw notFound("Official form template not found.");
  return mapTemplateInternal(data);
}

/**
 * Structurally validate a template's stored hash against freshly-provided bytes. Never
 * accepts a caller-asserted hash as proof — bytes are hashed here, server-side, and compared
 * against the trusted stored value. Also rejects an UNTRUSTED-only template presented as
 * verified-current: callers must check trustStatus/currentness themselves before relying on
 * a template as the official current form (this function only proves byte integrity).
 */
export async function verifyTemplateIntegrity(templateId: string, actualBytes: Buffer): Promise<OfficialFormTemplate> {
  const template = await getTemplateInternal(templateId);
  const actualHash = sha256OfBytes(actualBytes);
  verifyTemplateHash(template, actualHash);
  return template;
}

export async function listFieldMapsForTemplate(templateId: string): Promise<OfficialFormFieldMap[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_field_maps")
    .select("*")
    .eq("template_id", requireUuid(templateId, "templateId"));
  if (error) throw notFound("Could not list field maps.");
  return (data || []).map(mapFieldMap);
}

/**
 * Resolve the field-map version for an EXACT template version. Fails safely (throws) rather
 * than silently applying a field map built for a different template artifact.
 */
export async function resolveFieldMapForTemplate(fieldMapId: string, templateId: string): Promise<OfficialFormFieldMap> {
  const db = getSupabase();
  const { data, error } = await db
    .from("navigator_official_form_field_maps")
    .select("*")
    .eq("id", requireUuid(fieldMapId, "fieldMapId"))
    .single();
  if (error || !data) throw notFound("Field map not found.");
  const fieldMap = mapFieldMap(data);
  const template = await getTemplatePublic(requireUuid(templateId, "templateId"));
  assertFieldMapAppliesToTemplate(fieldMap, template);
  return fieldMap;
}

// Re-exported for callers that need to validate a storage path before any (future) ingestion
// call; kept here rather than only in officialForms.ts so the service layer's public surface
// documents this as part of its trust boundary.
export { assertSafeStoragePath };
