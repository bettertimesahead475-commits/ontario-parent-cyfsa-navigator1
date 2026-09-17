import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync(new URL("../../supabase/migrations_pending_approval/create_navigator_m2e_intelligence_foundation.sql", import.meta.url), "utf8");

describe("Stage 5 M2-E pending migration structural contracts", () => {
  it("includes navigator_evidence_gap_findings table with correct constraints", () => {
    expect(sql).toContain("CREATE TABLE public.navigator_evidence_gap_findings");
    expect(sql).toContain("CHECK (category IN (");
    expect(sql).toContain("CHECK (state IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'SUPERSEDED'))");
    expect(sql).toContain("CHECK (materiality IN ('LOW', 'MEDIUM', 'HIGH'))");
  });

  it("includes navigator_evidence_gap_dependencies table with matter isolation", () => {
    expect(sql).toContain("CREATE TABLE public.navigator_evidence_gap_dependencies");
    expect(sql).toContain("matter_id UUID NOT NULL REFERENCES public.navigator_matters(id)");
    expect(sql).toContain("CHECK (dependency_type IN ('CLAIM', 'EVENT', 'RELATIONSHIP', 'ATTRIBUTION', 'SOURCE', 'ACTOR', 'LOCATION'))");
  });

  it("includes navigator_unanswered_questions table with matter isolation", () => {
    expect(sql).toContain("CREATE TABLE public.navigator_unanswered_questions");
    expect(sql).toContain("matter_id UUID NOT NULL REFERENCES public.navigator_matters(id)");
  });

  it("enables RLS on new tables", () => {
    expect(sql).toContain("ALTER TABLE public.navigator_evidence_gap_findings ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.navigator_evidence_gap_dependencies ENABLE ROW LEVEL SECURITY;");
  });

  it("grants least privilege to service_role matching established access model", () => {
    expect(sql).toContain("REVOKE ALL ON public.navigator_evidence_gap_findings FROM public, anon, authenticated;");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.navigator_evidence_gap_findings TO service_role;");
  });
});
