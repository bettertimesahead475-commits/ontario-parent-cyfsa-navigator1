// AUDIT-ONLY REGRESSION (not production code) — Stage 9D-4A independent audit.
// Proves: navigator_official_form_field_maps has NO immutability guard trigger, unlike
// navigator_official_form_versions / navigator_official_form_templates. This means the
// migration's own claim ("the binding is structural, not just service-layer checked") is
// overstated: template_id on an existing field_map row is NOT frozen at the DB level, so a
// service-role write (or any future ingestion/admin code path) could repoint an existing
// field_map id at a different template without any trigger blocking it. This is a real gap on
// PRIMARY BOUNDARY #11 (field-map binding) — not proof of an actual exploited path, since no
// current service function performs such an UPDATE, but the schema does not structurally
// prevent one the way it does for versions/templates.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../../supabase/migrations_pending_approval/create_navigator_official_form_registry.sql", import.meta.url),
  "utf8"
);

describe("AUDIT: field-map immutability trigger gap (9D-4A)", () => {
  it("versions table has a BEFORE UPDATE guard trigger", () => {
    expect(sql).toMatch(/create trigger navigator_official_form_version_guard before update/);
  });

  it("templates table has a BEFORE UPDATE guard trigger", () => {
    expect(sql).toMatch(/create trigger navigator_official_form_template_guard before update/);
  });

  it("FAILS: field_maps table has NO guard trigger — template_id is not frozen at the DB level", () => {
    const hasFieldMapGuardTrigger = /create trigger navigator_official_form_field_map_guard/.test(sql);
    // This assertion is expected to currently be false, demonstrating the gap. If a future fix
    // adds the trigger, this line should be updated to expect(true).
    expect(hasFieldMapGuardTrigger).toBe(false);
  });
});
