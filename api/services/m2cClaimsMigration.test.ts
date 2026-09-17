import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync(new URL("../../supabase/migrations_pending_approval/create_navigator_m2c_claims_foundation.sql", import.meta.url), "utf8");

describe("Stage 5 M2-C pending migration structural contracts", () => {
  it("includes navigator_claims table with correct constraints", () => {
    expect(sql).toContain("create table public.navigator_claims");
    expect(sql).toContain("classification text not null check(classification in ('FACT','ALLEGATION','OPINION','PROFESSIONAL_ASSESSMENT','INFERENCE','UNVERIFIED_CLAIM','UNKNOWN'))");
  });

  it("includes navigator_attributions table", () => {
    expect(sql).toContain("create table public.navigator_attributions");
    expect(sql).toContain("attribution_type text not null check(attribution_type in ('DIRECT_STATEMENT','DIRECT_OBSERVATION','REPORTED_STATEMENT','DOCUMENT_RECORD','PROFESSIONAL_ASSESSMENT','AUTHOR_INFERENCE','SYSTEM_INFERENCE','UNKNOWN'))");
  });

  it("includes navigator_claim_evolutions table with exact types", () => {
    expect(sql).toContain("create table public.navigator_claim_evolutions");
    expect(sql).toContain("evolution_type text not null check(evolution_type in ('REPEATS','EXPANDS','NARROWS','CHANGES_DATE','CHANGES_LOCATION','CHANGES_ACTOR','CHANGES_ACTION','CHANGES_SEVERITY','RETRACTS','DENIES','DISPUTES','CORRECTS','INDETERMINATE'))");
  });

  it("extends provenance constraint", () => {
    expect(sql).toContain("alter table public.navigator_intelligence_provenance drop constraint navigator_intelligence_provenance_object_type_check;");
    expect(sql).toContain("alter table public.navigator_intelligence_provenance add constraint navigator_intelligence_provenance_object_type_check check(object_type in ('ENTITY','MENTION','RESOLUTION','EVENT','PARTICIPANT','CLAIM','ATTRIBUTION','EVOLUTION'));");
  });

  it("updates polymorphic target guard to cover M2-C", () => {
    expect(sql).toContain("elsif NEW.object_type = 'CLAIM' then");
    expect(sql).toContain("elsif NEW.object_type = 'ATTRIBUTION' then");
    expect(sql).toContain("elsif NEW.object_type = 'EVOLUTION' then");
  });

  it("enables RLS on new tables", () => {
    expect(sql).toContain("alter table public.navigator_claims enable row level security;");
    expect(sql).toContain("alter table public.navigator_attributions enable row level security;");
    expect(sql).toContain("alter table public.navigator_claim_evolutions enable row level security;");
  });
});
