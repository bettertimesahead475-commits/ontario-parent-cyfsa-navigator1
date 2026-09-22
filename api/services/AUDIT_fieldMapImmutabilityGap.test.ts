// AUDIT-ONLY REGRESSION (not production code) — Stage 9D-4A independent audit.
//
// ORIGINAL PURPOSE (preserved for history): this file originally proved that
// navigator_official_form_field_maps had NO immutability guard trigger, unlike
// navigator_official_form_versions / navigator_official_form_templates. That meant the
// migration's own claim ("the binding is structural, not just service-layer checked") was
// overstated: template_id on an existing field_map row was NOT frozen at the DB level, so a
// service-role write (or any future ingestion/admin code path) could repoint an existing
// field_map id at a different template without any trigger blocking it. This was a real gap on
// PRIMARY BOUNDARY #11 (field-map binding) — the independent audit BLOCKED Stage 9D-4A on it.
//
// CURRENT PURPOSE (post-remediation): the gap has been fixed by adding
// navigator_official_form_field_map_guard, matching the existing version/template guard
// pattern. This file now confirms the CORRECTED state — the trigger is present, freezes the
// right columns, and leaves the right columns mutable — instead of asserting the gap's
// continued absence. It stays in place as the regression that keeps this boundary honest going
// forward: if the guard trigger or its protected-column set ever regresses, these tests fail.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../supabase/migrations_pending_approval/create_navigator_official_form_registry.sql", import.meta.url),
  "utf8"
);

// Pulls the body of a `create function public.<name>() ... $$ ... $$` block out of the raw
// migration SQL so we can assert on exactly which columns it freezes, without needing a live
// Postgres instance (see LIVE DB LIMITATION note in HANDOFF.md — this is a static structural
// check, not a runtime proof against real Postgres).
function extractFunctionBody(functionName: string): string {
  const pattern = new RegExp(
    `create function public\\.${functionName}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`
  );
  const match = sql.match(pattern);
  if (!match) {
    throw new Error(`function ${functionName} not found in migration SQL`);
  }
  return match[1];
}

describe("AUDIT: field-map immutability trigger gap (9D-4A) — REMEDIATED", () => {
  it("versions table still has its BEFORE UPDATE guard trigger (unregressed)", () => {
    expect(sql).toMatch(/create trigger navigator_official_form_version_guard before update/);
  });

  it("templates table still has its BEFORE UPDATE guard trigger (unregressed)", () => {
    expect(sql).toMatch(/create trigger navigator_official_form_template_guard before update/);
  });

  it("field_maps table now has a BEFORE UPDATE guard trigger — template_id is frozen at the DB level", () => {
    expect(sql).toMatch(/create trigger navigator_official_form_field_map_guard before update on public\.navigator_official_form_field_maps/);
  });

  it("the field-map guard function is registered on the field_maps table specifically", () => {
    expect(sql).toMatch(
      /create trigger navigator_official_form_field_map_guard before update on public\.navigator_official_form_field_maps\s+for each row execute function public\.navigator_official_form_field_map_guard\(\)/
    );
  });

  describe("field-map guard protected (frozen) columns", () => {
    const body = extractFunctionBody("navigator_official_form_field_map_guard");

    it("freezes template_id — an existing field map can never be repointed at a different template (Template A -> B rejected)", () => {
      expect(body).toMatch(/new\.template_id is distinct from old\.template_id/);
    });

    it("freezes template_id regardless of whether the new template shares the same form number (same-form/different-template repoint still rejected)", () => {
      // The guard has no exception carved out for same-form_number targets — template_id is
      // compared directly, so any repoint (same form or not, same version or not) is blocked.
      expect(body).toMatch(/new\.template_id is distinct from old\.template_id/);
      expect(body).not.toMatch(/form_number/);
    });

    it("freezes template_id regardless of version (same-form/different-version repoint still rejected)", () => {
      // template_id is a direct FK to one immutable template row (which is itself bound to one
      // immutable form_version_id), so there is no version-scoped carve-out in this guard.
      expect(body).toMatch(/new\.template_id is distinct from old\.template_id/);
    });

    it("freezes mapping_version_label (identity label, same pattern as version_label/form_version_id on the other guards)", () => {
      expect(body).toMatch(/new\.mapping_version_label is distinct from old\.mapping_version_label/);
    });

    it("freezes created_at (matches the version and template guards' treatment of created_at)", () => {
      expect(body).toMatch(/new\.created_at is distinct from old\.created_at/);
    });

    it("raises an exception (hard DB-level rejection, not a soft/logged violation)", () => {
      expect(body).toMatch(/raise exception/);
    });
  });

  describe("field-map guard intentionally-mutable columns", () => {
    const body = extractFunctionBody("navigator_official_form_field_map_guard");

    it("does NOT freeze mapping_status — it is genuine lifecycle state (DRAFT -> VALIDATED -> DEPRECATED) that must remain updatable, matching how the template guard leaves trust_status mutable", () => {
      expect(body).not.toMatch(/mapping_status/);
    });

    it("does NOT freeze field_count — it may legitimately be recalculated against the same immutable template", () => {
      expect(body).not.toMatch(/field_count/);
    });

    it("mapping_status remains declared as a normal updatable column at the table level (positive contract check, not just absence of a guard clause)", () => {
      const tableMatch = sql.match(/create table public\.navigator_official_form_field_maps \(([\s\S]*?)\);/);
      expect(tableMatch).not.toBeNull();
      const tableBody = tableMatch![1];
      expect(tableBody).toMatch(/mapping_status text not null default 'DRAFT' check \(mapping_status in \('DRAFT', 'VALIDATED', 'DEPRECATED'\)\)/);
    });

    it("field_count remains declared as a normal updatable column at the table level (positive contract check)", () => {
      const tableMatch = sql.match(/create table public\.navigator_official_form_field_maps \(([\s\S]*?)\);/);
      expect(tableMatch).not.toBeNull();
      const tableBody = tableMatch![1];
      expect(tableBody).toMatch(/field_count integer not null check \(field_count >= 0\)/);
    });
  });

  describe("existing guards remain intact/unregressed", () => {
    it("version guard still freezes form_id, version_label, official_revision_date, effective_from, created_at", () => {
      const body = extractFunctionBody("navigator_official_form_version_guard");
      expect(body).toMatch(/new\.form_id is distinct from old\.form_id/);
      expect(body).toMatch(/new\.version_label is distinct from old\.version_label/);
      expect(body).toMatch(/new\.official_revision_date is distinct from old\.official_revision_date/);
      expect(body).toMatch(/new\.effective_from is distinct from old\.effective_from/);
      expect(body).toMatch(/new\.created_at is distinct from old\.created_at/);
    });

    it("template guard still freezes form_version_id, storage location, bytes, hash, created_at", () => {
      const body = extractFunctionBody("navigator_official_form_template_guard");
      expect(body).toMatch(/new\.form_version_id is distinct from old\.form_version_id/);
      expect(body).toMatch(/new\.storage_bucket is distinct from old\.storage_bucket/);
      expect(body).toMatch(/new\.storage_path is distinct from old\.storage_path/);
      expect(body).toMatch(/new\.byte_size is distinct from old\.byte_size/);
      expect(body).toMatch(/new\.sha256_hex is distinct from old\.sha256_hex/);
      expect(body).toMatch(/new\.created_at is distinct from old\.created_at/);
    });
  });
});
