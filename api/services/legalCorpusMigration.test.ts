import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Offline declaration/contract checks only. Never loads credentials, connects to a database,
// or executes SQL. PostgreSQL enforcement is a separate, explicitly-authorized gate.
// Line endings are normalized to LF immediately after reading: this file's assertions test SQL
// structure/content, never literal line-ending bytes, so a CRLF checkout (e.g. Windows git
// autocrlf) must not break a multiline substring match that would pass identically on LF.
const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, "\n");
const sql = normalizeLineEndings(
  readFileSync(new URL("../../supabase/migrations_pending_approval/create_navigator_legal_corpus_versioning.sql", import.meta.url), "utf8"),
);
const m1Sql = normalizeLineEndings(
  readFileSync(new URL("../../supabase/migrations_pending_approval/create_navigator_legal_authority_foundation.sql", import.meta.url), "utf8"),
);

describe("Stage 6 M2-A pending migration — structural contracts", () => {
  it("is wrapped in a single transaction", () => {
    expect(sql.trim().startsWith("-- PENDING APPROVAL")).toBe(true);
    expect(sql).toMatch(/\nbegin;/);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("declares exactly the three expected new tables", () => {
    expect(sql).toContain("create table public.navigator_legal_provision_versions");
    expect(sql).toContain("create table public.navigator_legal_source_snapshots");
    expect(sql).toContain("create table public.navigator_legal_provision_lineage");
  });

  it("does not recreate any Stage 6 M1 table", () => {
    for (const table of ["navigator_legal_sources", "navigator_legal_source_versions", "navigator_legal_provisions", "navigator_legal_mappings"]) {
      expect(sql).not.toContain(`create table public.${table}`);
    }
  });

  it("does not create a second legal-mapping table", () => {
    const mappingTables = [...sql.matchAll(/create table public\.(\w*mapping\w*)/gi)].map((m) => m[1]);
    expect(mappingTables).toHaveLength(0);
  });

  it("does not perform any destructive DROP", () => {
    expect(sql.toLowerCase()).not.toMatch(/drop\s+table/);
    expect(sql.toLowerCase()).not.toMatch(/drop\s+column/);
    expect(sql.toLowerCase()).not.toMatch(/truncate/);
  });

  it("declares the two-level provision-version identity scoped to the M1 provision and source-version tables", () => {
    expect(sql).toContain(
      "add constraint navigator_provision_version_provision_scope foreign key (provision_id, legal_source_id)\n    references public.navigator_legal_provisions(id, legal_source_id)",
    );
    expect(sql).toContain(
      "add constraint navigator_provision_version_source_version_scope foreign key (legal_source_version_id, legal_source_id)\n    references public.navigator_legal_source_versions(id, legal_source_id)",
    );
  });

  it("declares the verification-status constraint with exactly the four required states", () => {
    const body = sql.split("create table public.navigator_legal_provision_versions")[1].split(";\n\n")[0];
    expect(body).toContain("check (verification_status in ('UNVERIFIED','COMMITTED_INSPECTION','VERIFIED','REJECTED'))");
  });

  it("requires verification metadata exactly when VERIFIED, and forbids it otherwise", () => {
    const body = sql.split("create table public.navigator_legal_provision_versions")[1];
    expect(body).toContain("verification_status = 'VERIFIED' and verified_by is not null and verified_at is not null");
    expect(body).toContain("verification_status <> 'VERIFIED' and verified_by is null and verified_at is null");
  });

  it("declares the ingestion-status constraint with exactly the four required states", () => {
    const body = sql.split("create table public.navigator_legal_source_snapshots")[1].split(";\n")[0];
    expect(body).toContain("check (ingestion_status in ('RETRIEVED','PARSED','VALIDATED','REJECTED'))");
  });

  it("declares the lineage-type constraint with exactly the six required types", () => {
    const body = sql.split("create table public.navigator_legal_provision_lineage")[1].split(";\n")[0];
    expect(body).toContain("check (lineage_type in ('AMENDMENT','RENUMBERING','SPLIT','MERGE','REPEAL','REENACTMENT'))");
  });

  it("rejects self-lineage and duplicate lineage edges declaratively", () => {
    const body = sql.split("create table public.navigator_legal_provision_lineage")[1].split(";\n")[0];
    expect(body).toContain("check (predecessor_version_id <> successor_version_id)");
    expect(body).toContain("unique (predecessor_version_id, successor_version_id, lineage_type)");
  });

  it("declares half-open temporal constraints and an overlap-exclusion guard on provision_versions", () => {
    expect(sql).toContain("check (effective_to is null or effective_to > effective_from)");
    expect(sql).toContain("navigator_provision_version_no_overlap");
    expect(sql).toContain("exclude using gist (");
    expect(sql).toContain("provision_id with =,");
    expect(sql).toContain("daterange(effective_from, effective_to, '[)') with &&");
  });

  it("declares a VERIFIED-immutability trigger on provision_versions", () => {
    expect(sql).toContain("create function public.navigator_provision_version_immutable()");
    expect(sql).toContain("if old.verification_status = 'VERIFIED' then");
    expect(sql).toContain("create trigger navigator_provision_version_immutable before update on public.navigator_legal_provision_versions");
  });

  it("declares a provenance-freezing trigger on source_snapshots that only exempts ingestion_status", () => {
    const body = sql.split("create function public.navigator_source_snapshot_guard()")[1].split("end $$;")[0];
    for (const col of ["legal_source_id", "source_url", "retrieved_at", "raw_content", "content_sha256", "created_at"]) {
      expect(body).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(body).not.toContain("new.ingestion_status is distinct from old.ingestion_status");
  });

  it("enables RLS on all three new tables with no public policy created", () => {
    for (const table of ["navigator_legal_provision_versions", "navigator_legal_source_snapshots", "navigator_legal_provision_lineage"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).not.toMatch(/create policy/i);
  });

  it("revokes all default access before granting only service_role the minimum needed privileges", () => {
    expect(sql).toContain(
      "revoke all on public.navigator_legal_provision_versions, public.navigator_legal_source_snapshots,\n  public.navigator_legal_provision_lineage from public, anon, authenticated, service_role",
    );
    expect(sql).toContain("grant select, insert, update on public.navigator_legal_provision_versions to service_role");
    expect(sql).toContain("grant select, insert, update on public.navigator_legal_source_snapshots to service_role");
    expect(sql).toContain("grant select, insert on public.navigator_legal_provision_lineage to service_role");
    // Lineage never receives an update grant: edges are a historical record, not editable.
    expect(sql).not.toContain("grant select, insert, update on public.navigator_legal_provision_lineage");
  });

  it("pins search_path and uses SECURITY INVOKER (never DEFINER) on every new function", () => {
    const functionBlocks = [...sql.matchAll(/create function public\.\w+\([^)]*\) returns \w+[\s\S]*?\$\$;/g)].map((m) => m[0]);
    expect(functionBlocks.length).toBeGreaterThan(0);
    for (const fn of functionBlocks) {
      expect(fn).toContain("security invoker");
      expect(fn).toContain("set search_path = pg_catalog, public, pg_temp");
      expect(fn).not.toContain("security definer");
    }
  });

  it("revokes public execute on every new trigger function", () => {
    expect(sql).toContain("revoke all on function public.navigator_provision_version_immutable() from public, anon, authenticated, service_role");
    expect(sql).toContain("revoke all on function public.navigator_source_snapshot_guard() from public, anon, authenticated, service_role");
  });

  it("requires btree_gist in the extensions schema, matching the M1 pre-flight convention", () => {
    expect(sql).toContain("create extension if not exists btree_gist with schema extensions;");
  });

  it("does not insert any real legal text — infrastructure only, no corpus ingestion", () => {
    expect(sql.toLowerCase()).not.toMatch(/insert\s+into/);
  });

  it("does not modify the Stage 6 M1 migration file", () => {
    expect(m1Sql).not.toContain("navigator_legal_provision_versions");
    expect(m1Sql).not.toContain("navigator_legal_source_snapshots");
    expect(m1Sql).not.toContain("navigator_legal_provision_lineage");
  });
});
