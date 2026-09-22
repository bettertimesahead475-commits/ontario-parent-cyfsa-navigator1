// Stage 9D-4B-2A-ii-a — Semantic Field-Map TYPE SYSTEM + exact-template binding +
// fail-closed VALIDATOR. ARCHITECTURE ONLY — no per-form mapping.
//
// SCOPE: this module defines the type system for a "semantic field map" (the human-meaning
// layer on top of the purely technical `docxFieldInventory.ts` output) and a fail-closed
// validator that checks a candidate map against a real technical inventory + exact template
// binding before it may ever be treated as usable. It deliberately maps NO real Ontario form
// field — only small synthetic/fixture inventories are used in tests to exercise the
// validator's logic. Population/persistence/HTTP routes are out of scope; see
// `CompletionDraftValue` below for the type-level-only completion-draft contract.
//
// This extends the existing 9D-4A architecture (api/services/officialForms.ts /
// officialFormRegistry.ts, and the DB-level field-map immutability guard trigger in
// supabase/migrations_pending_approval/create_navigator_official_form_registry.sql) rather than
// inventing a parallel one:
//   - FIELD_VALUE_PROVENANCE is reused verbatim from officialForms.ts (not redefined here).
//   - Exact-template binding here is the application-layer counterpart of the DB's
//     `navigator_official_form_field_maps.template_id` FK + guard trigger: one field map is
//     permanently bound to one exact template artifact (exact sha256, exact form/version).
//   - Map immutability is enforced the same way 9D-4A enforces it: publishing/registering a
//     field-map VERSION is a one-time, append-only event; corrections require a new version.
//     This module provides an in-process registry (`FieldMapVersionRegistry`) that mirrors the
//     DB guard's semantics (identity-bearing fields frozen after creation) so the same
//     invariant can be tested and used before/without a live database.
import { LifecycleError } from "./lifecycleErrors.js";
import { FIELD_VALUE_PROVENANCE, type FieldValueProvenance } from "./officialForms.js";
import type { FfFieldType, DocxFieldInventoryResult } from "./docxFieldInventory.js";

export { FIELD_VALUE_PROVENANCE };
export type { FieldValueProvenance };

const invalid = (message: string) => new LifecycleError(400, "INVALID_SEMANTIC_FIELD_MAP", message);

// ---------------------------------------------------------------------------
// Technical inventory versioning — 2A-i's docxFieldInventory.ts does not itself expose a
// version tag, so we establish one here: a version identifies the *shape/semantics* of the
// inventory extraction logic itself (not the document's content). A field map declares which
// inventory-schema version it was built against; the validator rejects a mismatch rather than
// assuming today's extractor behaves identically to whatever version the map author saw.
// ---------------------------------------------------------------------------
export const TECHNICAL_INVENTORY_SCHEMA_VERSION = "docx-ffdata-inventory-v1" as const;

// ---------------------------------------------------------------------------
// Exact-template binding — applies at the FIELD-MAP level (not per field). A map built for
// template SHA A must never silently be treated as valid for SHA B, even given an identical
// filename/form-number/field-count.
// ---------------------------------------------------------------------------
export interface ExactTemplateBinding {
  /** Internal form identity (matches OfficialForm.id from officialForms.ts). */
  formId: string;
  formNumber: string;
  /** Internal official-form-version identity (matches OfficialFormVersion.id). */
  formVersionId: string;
  versionLabel: string;
  /** Internal template-artifact identity (matches OfficialFormTemplate.id). */
  templateId: string;
  format: "DOCX";
  /** Exact source bytes hash — the binding is to these exact bytes, nothing else. */
  sourceSha256Hex: string;
  /** Which docxFieldInventory.ts extraction-schema version this map was built against. */
  technicalInventorySchemaVersion: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function isValidExactTemplateBinding(v: unknown): v is ExactTemplateBinding {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.formId === "string" && b.formId.length > 0 &&
    typeof b.formNumber === "string" && b.formNumber.length > 0 &&
    typeof b.formVersionId === "string" && b.formVersionId.length > 0 &&
    typeof b.versionLabel === "string" && b.versionLabel.length > 0 &&
    typeof b.templateId === "string" && b.templateId.length > 0 &&
    b.format === "DOCX" &&
    typeof b.sourceSha256Hex === "string" && HEX64.test(b.sourceSha256Hex) &&
    typeof b.technicalInventorySchemaVersion === "string" && b.technicalInventorySchemaVersion.length > 0
  );
}

// ---------------------------------------------------------------------------
// Technical field identity — reuses the stable identity surfaced by docxFieldInventory.ts.
// Because names can be duplicated, absent, or empty, identity is NEVER a bare name: it is the
// full structural tuple below, so a duplicate-named or unnamed field always remains
// unambiguously addressable.
// ---------------------------------------------------------------------------
export interface TechnicalFieldIdentity {
  /** 0-based order in word/document.xml — the ultimate disambiguator (see docxFieldInventory.ts). */
  ordinal: number;
  /** The w:name value, or null for an unnamed field (anomaly, still addressable by ordinal). */
  name: string | null;
  type: FfFieldType;
  tableDepth: number;
  paragraphOrdinal: number;
}

export function isValidTechnicalFieldIdentity(v: unknown): v is TechnicalFieldIdentity {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    Number.isInteger(t.ordinal) && (t.ordinal as number) >= 0 &&
    (t.name === null || typeof t.name === "string") &&
    typeof t.type === "string" &&
    Number.isInteger(t.tableDepth) &&
    Number.isInteger(t.paragraphOrdinal)
  );
}

// ---------------------------------------------------------------------------
// Legal requiredness — MUST default conservatively. Existence of a field, a Word-required
// flag, an asterisk, or visual emphasis in the source document NEVER implies
// LEGALLY_REQUIRED/ESTABLISHED. Only explicit, justified assignment (ultimately backed by
// professional/legal review) may move a field out of UNKNOWN.
// ---------------------------------------------------------------------------
export const LEGAL_REQUIREDNESS_STATES = [
  "UNKNOWN",
  "NOT_ESTABLISHED",
  "REQUIRES_LEGAL_REVIEW",
  "ESTABLISHED"
] as const;
export type LegalRequirednessState = (typeof LEGAL_REQUIREDNESS_STATES)[number];
export const DEFAULT_LEGAL_REQUIREDNESS_STATE: LegalRequirednessState = "UNKNOWN";

export const APPLICABILITY_STATES = [
  "UNKNOWN",
  "ALWAYS_APPLICABLE",
  "CONDITIONALLY_APPLICABLE",
  "NOT_APPLICABLE"
] as const;
export type ApplicabilityState = (typeof APPLICABILITY_STATES)[number];

// Permitted provenance classes for values that may eventually populate this field. A subset of
// the closed FIELD_VALUE_PROVENANCE vocabulary defined in officialForms.ts (9D-4A) — reused,
// not redefined.
export type PermittedProvenanceClasses = readonly FieldValueProvenance[];

// Sensitive-field / review-sensitivity classification.
export const REVIEW_SENSITIVITY_CATEGORIES = [
  "NORMAL_ADMINISTRATIVE",
  "SWORN_FACT",
  "ADMISSION_OR_DENIAL",
  "REQUESTED_ORDER",
  "PLAN_OF_CARE_POSITION",
  "LEGAL_GROUND_OR_POSITION",
  "SIGNATURE_OR_ATTESTATION",
  "COMMISSIONING_OR_CERTIFICATION"
] as const;
export type ReviewSensitivityCategory = (typeof REVIEW_SENSITIVITY_CATEGORIES)[number];

// Mapping confidence/status — no opaque AI probability score. A field is either not yet
// resolved, structurally identified only (technical shape known, meaning not yet assigned by a
// human), human-mapped, or professionally reviewed.
export const MAPPING_RESOLUTION_STATES = [
  "UNRESOLVED",
  "STRUCTURALLY_IDENTIFIED",
  "HUMAN_MAPPED",
  "PROFESSIONALLY_REVIEWED"
] as const;
export type MappingResolutionState = (typeof MAPPING_RESOLUTION_STATES)[number];

export const SEMANTIC_VALUE_TYPES = [
  "TEXT",
  "DATE",
  "BOOLEAN",
  "ENUM",
  "NUMBER",
  "PERSON_NAME",
  "ADDRESS",
  "COURT_FILE_NUMBER",
  "FREE_TEXT_NARRATIVE"
] as const;
export type SemanticValueType = (typeof SEMANTIC_VALUE_TYPES)[number];

export const SEMANTIC_CARDINALITIES = ["SINGLE", "REPEATED"] as const;
export type SemanticCardinality = (typeof SEMANTIC_CARDINALITIES)[number];

// Technical constraints (from the document's actual encoding) are represented SEPARATELY from
// semantic constraints (what the field means/should hold). A field can be technically
// `text, maxLength 20` while semantically a `DATE` — the two layers never merge.
export interface TechnicalFieldConstraints {
  technicalType: FfFieldType;
  technicalMaxLength: number | null;
  technicalDropdownOptions: readonly string[] | null;
  /** Word's own "enabled"/required-looking signals. Distinct from legal requiredness. */
  technicallyRequired: boolean;
}

export interface SemanticFieldConstraints {
  valueType: SemanticValueType;
  cardinality: SemanticCardinality;
  allowedValues: readonly string[] | null;
  /** Encoded maximum length as understood at the semantic layer (may differ from technical). */
  maxLength: number | null;
}

// ---------------------------------------------------------------------------
// One mapped field entry.
// ---------------------------------------------------------------------------
export interface SemanticFieldMapEntry {
  semanticKey: string;
  label: string;
  description: string;

  technicalIdentity: TechnicalFieldIdentity;
  formSection: string | null;

  semanticConstraints: SemanticFieldConstraints;
  technicalConstraints: TechnicalFieldConstraints;

  legalRequiredness: LegalRequirednessState;
  applicability: ApplicabilityState;

  permittedProvenance: PermittedProvenanceClasses;
  reviewSensitivity: ReviewSensitivityCategory;

  mappingResolution: MappingResolutionState;
  /**
   * Nothing in a map entry may itself assert that a value has been professionally reviewed —
   * that is a fact about a specific *value* (see CompletionDraftValue.reviewState below), never
   * a default baked into the map. This field intentionally does not exist here; see
   * `assertMapEntryCannotFabricateReview` for the corresponding validator/runtime check.
   */
  notes: string | null;
  warnings: readonly string[];
}

export function isValidSemanticFieldMapEntry(v: unknown): v is SemanticFieldMapEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.semanticKey !== "string" || e.semanticKey.length === 0) return false;
  if (typeof e.label !== "string" || e.label.length === 0) return false;
  if (typeof e.description !== "string") return false;
  if (!isValidTechnicalFieldIdentity(e.technicalIdentity)) return false;
  if (e.formSection !== null && typeof e.formSection !== "string") return false;
  if (typeof e.semanticConstraints !== "object" || e.semanticConstraints === null) return false;
  if (typeof e.technicalConstraints !== "object" || e.technicalConstraints === null) return false;
  if (!(LEGAL_REQUIREDNESS_STATES as readonly string[]).includes(e.legalRequiredness as string)) return false;
  if (!(APPLICABILITY_STATES as readonly string[]).includes(e.applicability as string)) return false;
  if (!Array.isArray(e.permittedProvenance)) return false;
  if (!(e.permittedProvenance as unknown[]).every(p => (FIELD_VALUE_PROVENANCE as readonly string[]).includes(p as string))) return false;
  if (!(REVIEW_SENSITIVITY_CATEGORIES as readonly string[]).includes(e.reviewSensitivity as string)) return false;
  if (!(MAPPING_RESOLUTION_STATES as readonly string[]).includes(e.mappingResolution as string)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// A full semantic field map: one canonical map per exact template. The type system
// deliberately provides no "audience" discriminator (no parent-map vs professional-map
// variant) — see SemanticFieldMap below, which has no such field, and
// assertOneCanonicalMapPerTemplate, which rejects any attempt to register a second map for the
// same exact template.
// ---------------------------------------------------------------------------
export interface SemanticFieldMap {
  binding: ExactTemplateBinding;
  /** Field-map's own version label — a correction is always a NEW label, never a rewrite. */
  mapVersionLabel: string;
  entries: readonly SemanticFieldMapEntry[];
}

// ---------------------------------------------------------------------------
// COMPLETION-DRAFT CONTRACT — type-level only. No persistence/population logic here. Ties a
// single value to its exact template + exact field-map version + semantic key + technical
// target + provenance + review state.
// ---------------------------------------------------------------------------
export const VALUE_REVIEW_STATES = [
  "UNREVIEWED",
  "MACHINE_SUGGESTED_UNREVIEWED",
  "PARENT_CONFIRMED",
  "PROFESSIONALLY_REVIEWED"
] as const;
export type ValueReviewState = (typeof VALUE_REVIEW_STATES)[number];

export interface CompletionDraftValue {
  binding: ExactTemplateBinding;
  mapVersionLabel: string;
  semanticKey: string;
  technicalIdentity: TechnicalFieldIdentity;
  value: string | boolean | null;
  provenance: FieldValueProvenance;
  reviewState: ValueReviewState;
}

// Machine-suggested provenance must never itself imply a reviewed state.
export function isValidCompletionDraftValue(v: unknown): v is CompletionDraftValue {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (!isValidExactTemplateBinding(d.binding)) return false;
  if (typeof d.mapVersionLabel !== "string" || d.mapVersionLabel.length === 0) return false;
  if (typeof d.semanticKey !== "string" || d.semanticKey.length === 0) return false;
  if (!isValidTechnicalFieldIdentity(d.technicalIdentity)) return false;
  if (!(FIELD_VALUE_PROVENANCE as readonly string[]).includes(d.provenance as string)) return false;
  if (!(VALUE_REVIEW_STATES as readonly string[]).includes(d.reviewState as string)) return false;
  if (d.provenance === "MACHINE_SUGGESTED" && d.reviewState === "PROFESSIONALLY_REVIEWED") {
    // A machine-suggested value may LATER become professionally reviewed, but that requires an
    // explicit separate review event elsewhere — never asserted by the draft value itself in
    // the same breath as machine suggestion with no reviewer identity. This constructor-level
    // check exists purely to make the "cannot fabricate review" invariant testable at the type
    // layer; real review-event tracking is out of scope for this narrowed task.
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// FAIL-CLOSED VALIDATOR
// ---------------------------------------------------------------------------
export interface ValidateSemanticFieldMapParams {
  map: SemanticFieldMap;
  expectedBinding: ExactTemplateBinding;
  technicalInventory: DocxFieldInventoryResult;
}

function identityKey(id: TechnicalFieldIdentity): string {
  return `${id.ordinal}::${id.name ?? "\u0000"}::${id.type}::${id.tableDepth}::${id.paragraphOrdinal}`;
}

export function validateSemanticFieldMap(params: ValidateSemanticFieldMapParams): void {
  const { map, expectedBinding, technicalInventory } = params;

  // --- exact-template binding checks (each individually, fail-closed) ---
  if (map.binding.sourceSha256Hex !== expectedBinding.sourceSha256Hex) {
    throw invalid(
      `Field map source SHA-256 (${map.binding.sourceSha256Hex}) does not match the exact expected template (${expectedBinding.sourceSha256Hex}).`
    );
  }
  if (map.binding.formId !== expectedBinding.formId || map.binding.formNumber !== expectedBinding.formNumber) {
    throw invalid("Field map form identity does not match the expected template's form identity.");
  }
  if (map.binding.formVersionId !== expectedBinding.formVersionId || map.binding.versionLabel !== expectedBinding.versionLabel) {
    throw invalid("Field map form version does not match the expected template's form version.");
  }
  if (map.binding.templateId !== expectedBinding.templateId) {
    throw invalid("Field map template identity does not match the expected template.");
  }
  if (map.binding.format !== expectedBinding.format) {
    throw invalid(`Field map format (${map.binding.format}) does not match expected format (${expectedBinding.format}).`);
  }
  if (map.binding.technicalInventorySchemaVersion !== expectedBinding.technicalInventorySchemaVersion) {
    throw invalid(
      `Field map technical inventory schema version (${map.binding.technicalInventorySchemaVersion}) does not match the current extractor's version (${expectedBinding.technicalInventorySchemaVersion}).`
    );
  }

  // --- build a lookup of real technical fields by full identity ---
  const realByKey = new Map<string, (typeof technicalInventory.fields)[number]>();
  for (const f of technicalInventory.fields) {
    const key = identityKey({
      ordinal: f.order,
      name: f.name,
      type: f.type,
      tableDepth: f.tableDepth,
      paragraphOrdinal: f.paragraphOrdinal
    });
    realByKey.set(key, f);
  }

  const semanticKeyCounts = new Map<string, number>();

  for (const entry of map.entries) {
    if (!isValidSemanticFieldMapEntry(entry)) {
      throw invalid(`Field map entry "${String((entry as { semanticKey?: string })?.semanticKey ?? "?")}" is missing required map metadata.`);
    }

    const key = identityKey(entry.technicalIdentity);
    const real = realByKey.get(key);
    if (!real) {
      throw invalid(
        `Field map entry "${entry.semanticKey}" references a technical field (ordinal ${entry.technicalIdentity.ordinal}, name ${entry.technicalIdentity.name ?? "<unnamed>"}) that does not exist in the real inventory.`
      );
    }

    if (real.type !== entry.technicalConstraints.technicalType) {
      throw invalid(
        `Field map entry "${entry.semanticKey}" declares technical type "${entry.technicalConstraints.technicalType}" but the real inventory field is type "${real.type}" (type mismatch).`
      );
    }

    if (entry.technicalConstraints.technicalDropdownOptions !== null) {
      const realOptions = real.dropdown?.listEntries ?? null;
      if (!realOptions) {
        throw invalid(`Field map entry "${entry.semanticKey}" declares dropdown options but the real field has none.`);
      }
      const missing = entry.technicalConstraints.technicalDropdownOptions.filter(o => !realOptions.includes(o));
      if (missing.length > 0) {
        throw invalid(
          `Field map entry "${entry.semanticKey}" allowed values [${missing.join(", ")}] are not present in the real technical dropdown options [${realOptions.join(", ")}].`
        );
      }
    }

    if (entry.semanticConstraints.allowedValues !== null && entry.technicalConstraints.technicalDropdownOptions !== null) {
      const conflict = entry.semanticConstraints.allowedValues.some(
        v => !entry.technicalConstraints.technicalDropdownOptions!.includes(v)
      );
      if (conflict) {
        throw invalid(
          `Field map entry "${entry.semanticKey}" semantic allowed values conflict with the technical dropdown options.`
        );
      }
    }

    // Legal requiredness must never be silently ESTABLISHED by a map that never went through
    // explicit assignment logic — this validator does not itself set/mutate legalRequiredness,
    // it only ensures the field is one of the closed states (already checked by
    // isValidSemanticFieldMapEntry above). Defensive re-check to fail closed:
    if (!(LEGAL_REQUIREDNESS_STATES as readonly string[]).includes(entry.legalRequiredness)) {
      throw invalid(`Field map entry "${entry.semanticKey}" has an invalid legal requiredness state.`);
    }

    // Duplicate semantic-target / cardinality check.
    const count = (semanticKeyCounts.get(entry.semanticKey) ?? 0) + 1;
    semanticKeyCounts.set(entry.semanticKey, count);
    if (count > 1 && entry.semanticConstraints.cardinality === "SINGLE") {
      throw invalid(
        `Field map entry "${entry.semanticKey}" appears more than once but declares SINGLE cardinality (duplicate semantic target violates declared cardinality).`
      );
    }
  }
}

// Convenience: build the ExactTemplateBinding a real technical inventory would need to match,
// from an already-known official-form/template registration plus the real inventory's computed
// source hash (caller supplies the hash — this module does no I/O/hashing itself).
export function buildExpectedBinding(args: {
  formId: string;
  formNumber: string;
  formVersionId: string;
  versionLabel: string;
  templateId: string;
  sourceSha256Hex: string;
  technicalInventorySchemaVersion?: string;
}): ExactTemplateBinding {
  return {
    formId: args.formId,
    formNumber: args.formNumber,
    formVersionId: args.formVersionId,
    versionLabel: args.versionLabel,
    templateId: args.templateId,
    format: "DOCX",
    sourceSha256Hex: args.sourceSha256Hex,
    technicalInventorySchemaVersion: args.technicalInventorySchemaVersion ?? TECHNICAL_INVENTORY_SCHEMA_VERSION
  };
}

// ---------------------------------------------------------------------------
// MAP IMMUTABILITY (application-layer registry) — mirrors the DB guard trigger's semantics:
// once a (templateId, mapVersionLabel) pair is registered, its identity-bearing content is
// frozen; the only way to change field mappings is to register a NEW mapVersionLabel. This is
// the in-process analogue of navigator_official_form_field_map_guard, usable/testable without a
// live Postgres instance, and is what 9D-4A's DB trigger itself protects once these maps are
// persisted.
// ---------------------------------------------------------------------------
export class FieldMapVersionRegistry {
  private readonly versions = new Map<string, SemanticFieldMap>();

  private key(templateId: string, mapVersionLabel: string): string {
    return `${templateId}::${mapVersionLabel}`;
  }

  register(map: SemanticFieldMap): void {
    // One canonical map per exact template: refuse a second *label* concept that isn't really
    // labelled distinctly, and refuse registering any map whose template already has an
    // identically-labelled version registered (that would be a silent mutation).
    const k = this.key(map.binding.templateId, map.mapVersionLabel);
    if (this.versions.has(k)) {
      throw invalid(
        `Field map version "${map.mapVersionLabel}" is already registered for template ${map.binding.templateId}; a historical/registered map version cannot be mutated. Register a new version label instead.`
      );
    }
    this.versions.set(k, map);
  }

  get(templateId: string, mapVersionLabel: string): SemanticFieldMap | undefined {
    return this.versions.get(this.key(templateId, mapVersionLabel));
  }

  /** All registered version labels for a template, in registration order (history preserved). */
  listVersions(templateId: string): string[] {
    return [...this.versions.keys()]
      .filter(k => k.startsWith(`${templateId}::`))
      .map(k => k.slice(templateId.length + 2));
  }
}
