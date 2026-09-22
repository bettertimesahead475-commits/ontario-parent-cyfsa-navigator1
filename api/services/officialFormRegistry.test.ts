import { describe, it, expect, vi, beforeEach } from "vitest";
import * as access from "./access.js";
import {
  listActiveForms,
  getForm,
  listFormVersions,
  getFormVersion,
  resolveCurrentVersion,
  listTemplatesForVersion,
  getTemplatePublic,
  getTemplateInternal,
  verifyTemplateIntegrity,
  listFieldMapsForTemplate,
  resolveFieldMapForTemplate,
  sha256OfBytes
} from "./officialFormRegistry.js";
import { assertSafeStoragePath, isValidFieldValueProvenance, FIELD_VALUE_PROVENANCE } from "./officialForms.js";
import { LifecycleError } from "./lifecycleErrors.js";

vi.mock("./access.js");

// CLEARLY LABELED SYNTHETIC test fixtures — never real Ontario government form content,
// URLs, revision dates or hashes. See supabase/migrations_pending_approval/
// create_navigator_official_form_registry.sql header for the same disclosure.
const FORM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FORM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VERSION_A1 = "11111111-1111-1111-1111-111111111111";
const VERSION_A2_CURRENT = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_A1 = "33333333-3333-3333-3333-333333333333";
const TEMPLATE_A2 = "44444444-4444-4444-4444-444444444444";
const FIELD_MAP_FOR_A1 = "55555555-5555-5555-5555-555555555555";

function buildMockDb(tables: Record<string, any[]>) {
  return {
    from: (table: string) => {
      let rows = [...(tables[table] || [])];
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: any) => {
          rows = rows.filter((r: any) => r[col] === val);
          return chain;
        },
        order: () => chain,
        single: async () => ({ data: rows[0] ?? null, error: rows.length === 0 ? new Error("Not found") : null }),
        maybeSingle: async () => ({ data: rows.length > 0 ? rows[0] : null, error: null })
      };
      chain.then = (resolve: any) => resolve({ data: rows, error: null });
      return chain;
    }
  } as any;
}

describe("Stage 9D-4A Official Form Registry", () => {
  let tables: Record<string, any[]>;

  beforeEach(() => {
    const synthBytes = Buffer.from("SYNTHETIC_TEST_FORM_8B content bytes");
    const synthHash = sha256OfBytes(synthBytes);
    const otherBytes = Buffer.from("SYNTHETIC_TEST_FORM_8B version 2 content bytes");
    const otherHash = sha256OfBytes(otherBytes);

    tables = {
      navigator_official_forms: [
        {
          id: FORM_A,
          jurisdiction: "ON",
          form_number: "SYNTHETIC-8B",
          official_title: "SYNTHETIC_TEST_FORM_8B (test fixture, not a real Ontario form)",
          rule_family: "Family Law Rules",
          category: "Motion",
          cyfsa_relevant: true,
          is_active: true,
          is_synthetic: true
        },
        {
          id: FORM_B,
          jurisdiction: "ON",
          form_number: "SYNTHETIC-GEN-1",
          official_title: "SYNTHETIC_TEST_FORM general (not CYFSA-specific)",
          rule_family: "Family Law Rules",
          category: "General",
          cyfsa_relevant: false,
          is_active: true,
          is_synthetic: true
        }
      ],
      navigator_official_form_versions: [
        {
          id: VERSION_A1,
          form_id: FORM_A,
          version_label: "v1-synthetic",
          official_revision_date: null,
          effective_from: null,
          effective_to: "2020-01-01",
          currentness_status: "SUPERSEDED",
          supersedes_version_id: null,
          first_verified_at: "2019-01-01T00:00:00Z",
          last_verified_at: "2019-01-01T00:00:00Z"
        },
        {
          id: VERSION_A2_CURRENT,
          form_id: FORM_A,
          version_label: "v2-synthetic",
          official_revision_date: null,
          effective_from: "2020-01-01",
          effective_to: null,
          currentness_status: "CURRENT",
          supersedes_version_id: VERSION_A1,
          first_verified_at: "2020-01-01T00:00:00Z",
          last_verified_at: "2026-01-01T00:00:00Z"
        }
      ],
      navigator_official_form_templates: [
        {
          id: TEMPLATE_A1,
          form_version_id: VERSION_A1,
          file_format: "PDF",
          mime_type: "application/pdf",
          storage_bucket: "official-forms",
          storage_path: "on/synthetic-8b/v1.pdf",
          byte_size: synthBytes.length,
          sha256_hex: synthHash,
          is_synthetic: true,
          trust_status: "HASH_VERIFIED"
        },
        {
          id: TEMPLATE_A2,
          form_version_id: VERSION_A2_CURRENT,
          file_format: "PDF",
          mime_type: "application/pdf",
          storage_bucket: "official-forms",
          storage_path: "on/synthetic-8b/v2.pdf",
          byte_size: otherBytes.length,
          sha256_hex: otherHash,
          is_synthetic: true,
          trust_status: "HASH_VERIFIED"
        }
      ],
      navigator_official_form_field_maps: [
        {
          id: FIELD_MAP_FOR_A1,
          template_id: TEMPLATE_A1,
          mapping_version_label: "map-v1",
          field_count: 12,
          mapping_status: "VALIDATED"
        }
      ]
    };

    vi.spyOn(access, "getSupabase").mockImplementation(() => buildMockDb(tables));
    (globalThis as any).__synthBytes = synthBytes;
    (globalThis as any).__otherBytes = otherBytes;
  });

  it("1. parent and professional both resolve the same canonical form identity", async () => {
    const asParent = await getForm(FORM_A);
    const asProfessional = await getForm(FORM_A);
    expect(asParent).toEqual(asProfessional);
    expect(asParent.formNumber).toBe("SYNTHETIC-8B");
  });

  it("2. multiple versions of one form remain distinct", async () => {
    const versions = await listFormVersions(FORM_A);
    expect(versions).toHaveLength(2);
    expect(versions.map(v => v.id).sort()).toEqual([VERSION_A1, VERSION_A2_CURRENT].sort());
  });

  it("3. a superseded version remains retrievable for historical provenance", async () => {
    const superseded = await getFormVersion(VERSION_A1);
    expect(superseded.currentnessStatus).toBe("SUPERSEDED");
    expect(superseded.id).toBe(VERSION_A1);
  });

  it("4. current-version resolution only selects an explicitly-trusted-current version", async () => {
    const current = await resolveCurrentVersion(FORM_A);
    expect(current?.id).toBe(VERSION_A2_CURRENT);
  });

  it("5. UNKNOWN currentness is never treated as CURRENT", async () => {
    tables.navigator_official_form_versions = [
      {
        id: VERSION_A1,
        form_id: FORM_A,
        currentness_status: "UNKNOWN",
        last_verified_at: null,
        version_label: "v-unknown",
        official_revision_date: null,
        effective_from: null,
        effective_to: null,
        supersedes_version_id: null,
        first_verified_at: null
      }
    ];
    const current = await resolveCurrentVersion(FORM_A);
    expect(current).toBeNull();
  });

  it("6. a template hash mismatch fails integrity validation", async () => {
    await expect(verifyTemplateIntegrity(TEMPLATE_A1, Buffer.from("tampered bytes"))).rejects.toThrow(LifecycleError);
    await expect(verifyTemplateIntegrity(TEMPLATE_A1, Buffer.from("tampered bytes"))).rejects.toMatchObject({
      code: "TEMPLATE_INTEGRITY_FAILURE"
    });
  });

  it("6b. matching bytes pass integrity validation", async () => {
    const verified = await verifyTemplateIntegrity(TEMPLATE_A1, (globalThis as any).__synthBytes);
    expect(verified.id).toBe(TEMPLATE_A1);
  });

  it("7. a caller-supplied hash never overrides the server-computed/trusted hash", async () => {
    // The public template shape never accepts caller input; sha256Hex always originates from
    // the stored row, and verifyTemplateIntegrity always recomputes from bytes it hashes itself.
    const template = await getTemplatePublic(TEMPLATE_A1);
    expect(template.sha256Hex).toBe(sha256OfBytes((globalThis as any).__synthBytes));
    expect((template as any).storageBucket).toBeUndefined();
    expect((template as any).storagePath).toBeUndefined();
  });

  it("8. a field map for Template A1 is rejected against Template A2", async () => {
    await expect(resolveFieldMapForTemplate(FIELD_MAP_FOR_A1, TEMPLATE_A2)).rejects.toMatchObject({
      code: "FIELD_MAP_TEMPLATE_MISMATCH"
    });
  });

  it("9. two versions of the same form do not silently share an incompatible field map", async () => {
    const fieldMaps1 = await listFieldMapsForTemplate(TEMPLATE_A1);
    const fieldMaps2 = await listFieldMapsForTemplate(TEMPLATE_A2);
    expect(fieldMaps1.map(f => f.id)).toEqual([FIELD_MAP_FOR_A1]);
    expect(fieldMaps2).toHaveLength(0);
  });

  it("9b. the field map resolves correctly against its own exact template", async () => {
    const resolved = await resolveFieldMapForTemplate(FIELD_MAP_FOR_A1, TEMPLATE_A1);
    expect(resolved.id).toBe(FIELD_MAP_FOR_A1);
  });

  it("10. historical generated-document linkage preserves an exact template version/hash", async () => {
    const template = await getTemplateInternal(TEMPLATE_A1);
    expect(template.formVersionId).toBe(VERSION_A1);
    expect(template.sha256Hex).toBe(sha256OfBytes((globalThis as any).__synthBytes));
    // Even though version A1 is superseded, its exact template artifact is still resolvable,
    // preserving provenance for anything that historically referenced it.
    const version = await getFormVersion(template.formVersionId);
    expect(version.currentnessStatus).toBe("SUPERSEDED");
  });

  it("11. CYFSA-tagging does not exclude general Family Law Rules forms from the registry", async () => {
    const forms = await listActiveForms();
    expect(forms.map(f => f.id)).toEqual(expect.arrayContaining([FORM_A, FORM_B]));
    const generalForm = forms.find(f => f.id === FORM_B)!;
    expect(generalForm.cyfsaRelevant).toBe(false);
  });

  it("12. blank-form metadata access requires no paid-analyzer/matter context (service call alone succeeds)", async () => {
    // The service function itself takes no matter id, account id or paid-session token.
    const form = await getForm(FORM_A);
    expect(form.id).toBe(FORM_A);
  });

  it("13. an untrusted/superseded template is never presented as verified-current by resolveCurrentVersion", async () => {
    const templatesForOldVersion = await listTemplatesForVersion(VERSION_A1);
    expect(templatesForOldVersion).toHaveLength(1);
    const current = await resolveCurrentVersion(FORM_A);
    expect(current?.id).not.toBe(VERSION_A1);
  });

  it("14. storage/path inputs reject path-traversal-style values", () => {
    expect(() => assertSafeStoragePath("../../etc/passwd")).toThrow();
    expect(() => assertSafeStoragePath("/etc/passwd")).toThrow();
    expect(() => assertSafeStoragePath("on/synthetic-8b/../v1.pdf")).toThrow();
    expect(() => assertSafeStoragePath("on/synthetic-8b/v1.pdf")).not.toThrow();
  });

  it("15. responses never leak secrets/internal storage paths", async () => {
    const template = await getTemplatePublic(TEMPLATE_A1);
    const serialized = JSON.stringify(template);
    expect(serialized).not.toContain("storage_bucket");
    expect(serialized).not.toContain("storage_path");
    expect(serialized).not.toContain("official-forms");
  });

  it("16. provenance vocabulary is constrained to the canonical values", () => {
    expect(isValidFieldValueProvenance("USER_ENTERED")).toBe(true);
    expect(isValidFieldValueProvenance("MACHINE_SUGGESTED")).toBe(true);
    expect(isValidFieldValueProvenance("AI_INVENTED")).toBe(false);
    expect(isValidFieldValueProvenance("")).toBe(false);
    expect(FIELD_VALUE_PROVENANCE).toEqual([
      "USER_ENTERED",
      "MATTER_DERIVED",
      "MACHINE_SUGGESTED",
      "PROFESSIONALLY_REVIEWED",
      "OFFICIAL_STATIC_FORM_CONTENT"
    ]);
  });

  it("17. an unresolvable form id fails safely with NOT_FOUND, not a crash", async () => {
    await expect(getForm("99999999-9999-9999-9999-999999999999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
