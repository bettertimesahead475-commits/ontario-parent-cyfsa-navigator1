import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync(new URL("../../supabase/migrations_pending_approval/create_navigator_m2d_intelligence_foundation.sql", import.meta.url), "utf8");

describe("Stage 5 M2-D pending migration structural contracts", () => {
  it("includes navigator_claim_relationships table with correct constraints", () => {
    expect(sql).toContain("create table public.navigator_claim_relationships");
    expect(sql).toContain("'DIRECT_CONTRADICTION', 'POTENTIAL_CONTRADICTION'");
  });

  it("includes independence status constraints", () => {
    expect(sql).toContain("'SAME_ORIGIN', 'DEPENDENT', 'INDEPENDENT', 'UNKNOWN_INDEPENDENCE'");
  });

  it("extends provenance constraint", () => {
    expect(sql).toContain("alter table public.navigator_intelligence_provenance drop constraint navigator_intelligence_provenance_object_type_check;");
    expect(sql).toContain("('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT','CLAIM','ATTRIBUTION','EVOLUTION','RELATIONSHIP')");
  });

  it("updates polymorphic target guard to cover M2-D", () => {
    expect(sql).toContain("elsif NEW.object_type = 'RELATIONSHIP' then");
    expect(sql).toContain("select matter_id into target_matter_id from public.navigator_claim_relationships where id = NEW.object_id;");
  });

  it("updates matter boundary guard for relationships", () => {
    expect(sql).toContain("elsif TG_TABLE_NAME = 'navigator_claim_relationships' then");
  });

  it("enables RLS on new tables", () => {
    expect(sql).toContain("alter table public.navigator_claim_relationships enable row level security;");
  });
});
