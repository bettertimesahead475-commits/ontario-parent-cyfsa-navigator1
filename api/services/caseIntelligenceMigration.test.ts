import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, "\n");
const sql = normalizeLineEndings(
  readFileSync(new URL("../../supabase/migrations_pending_approval/create_navigator_m2a_intelligence_foundation.sql", import.meta.url), "utf8")
);

describe("Stage 5 M2-A pending migration structural contracts", () => {
  it("is wrapped in a single transaction", () => {
    expect(sql).toMatch(/\nbegin;/);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  describe("Polymorphic Provenance", () => {
    it("validates polymorphic targets via navigator_m2a_polymorphic_target_guard", () => {
      expect(sql).toContain("create function public.navigator_m2a_polymorphic_target_guard() returns trigger");
      expect(sql).toContain("create trigger navigator_provenance_target_boundary before insert on public.navigator_intelligence_provenance");
      expect(sql).toMatch(/if NEW\.object_type = 'ENTITY' then\s+select matter_id into target_matter_id from public\.navigator_entities where id = NEW\.object_id;/);
      expect(sql).toMatch(/if NEW\.object_type = 'MENTION' then\s+select matter_id into target_matter_id from public\.navigator_entity_mentions/);
      expect(sql).toMatch(/if NEW\.object_type = 'RESOLUTION' then\s+select matter_id into target_matter_id from public\.navigator_identity_resolutions/);
      expect(sql).toMatch(/if NEW\.object_type = 'EVENT' then\s+select matter_id into target_matter_id from public\.navigator_events/);
      expect(sql).toMatch(/if NEW\.object_type = 'PARTICIPANT' then\s+select matter_id into target_matter_id from public\.navigator_event_participants/);
    });

    it("rejects unknown target types and cross-matter linkage", () => {
      expect(sql).toContain("raise exception 'Invalid object_type';");
      expect(sql).toContain("if target_matter_id <> NEW.matter_id then raise exception 'Cross-matter target linkage denied';");
    });
    
    it("rejects cross-matter evidence linkage", () => {
        expect(sql).toContain("if ev_matter_id <> NEW.matter_id then raise exception 'Cross-matter evidence linkage denied';");
    });

    it("relationship type is preserved", () => {
      expect(sql).toContain("provenance_type text not null check(provenance_type in ('ASSERTS','SUPPORTS','DISPUTES','MENTIONS','DATES','IDENTIFIES','ATTRIBUTES','DERIVED_FROM'))");
    });

    it("provenance update is rejected", () => {
      expect(sql).toContain("create trigger navigator_provenance_immutable before update on public.navigator_intelligence_provenance");
      expect(sql).toContain("raise exception 'Provenance is immutable'");
    });

    it("prevent hard-deletes of intelligence objects if provenance or history exists", () => {
      expect(sql).toContain("create function public.navigator_m2a_orphan_guard() returns trigger");
      expect(sql).toContain("Cannot delete intelligence object with review history");
      expect(sql).toContain("Cannot delete intelligence object with provenance associations");
      expect(sql).toContain("before delete on public.navigator_entities");
    });
  });

  describe("Review Target", () => {
    it("validates polymorphic targets for review actions", () => {
      expect(sql).toContain("create trigger navigator_review_actions_target_boundary before insert on public.navigator_intelligence_review_actions");
    });

    it("rejects update or delete of historical action", () => {
      expect(sql).toContain("create trigger navigator_intelligence_review_action_immutable before update or delete on public.navigator_intelligence_review_actions");
      expect(sql).toContain("raise exception 'Review history is append only'");
    });
  });

  describe("Human Review Enforcement", () => {
    it("AI cannot insert CONFIRMED candidates directly", () => {
      expect(sql).toContain("create function public.navigator_m2a_review_state_guard() returns trigger");
      expect(sql).toContain("raise exception 'New candidates must start as PROPOSED and cannot be CONFIRMED directly'");
    });

    it("unauthenticated/arbitrary mutation cannot update to CONFIRMED", () => {
      expect(sql).toContain("if NEW.review_state not in ('CONFIRMED', 'REJECTED', 'DISPUTED') then");
    });

    it("controlled RPC sets human context and requires authenticated user", () => {
      expect(sql).toContain("create function public.navigator_intelligence_review_update(");
      expect(sql).toContain("select id into actor from public.accounts where firebase_uid=p_uid for update;");
      expect(sql).toContain("perform 1 from public.read_navigator_owned_matter(p_uid,p_matter_id);");
    });

    it("audit action is written within the RPC", () => {
      expect(sql).toContain("insert into public.navigator_intelligence_review_actions");
    });

    it("optimistic concurrency is enforced", () => {
      expect(sql).toContain("if tgt.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='Review conflict';");
    });
  });

  describe("Identity, Dates, Events safety", () => {
    it("identical names do not auto-merge declaratively", () => {
      // The schema doesn't have a unique constraint on display_name
      expect(sql).not.toMatch(/unique\s*\([^\)]*display_name[^\)]*\)/i);
    });

    it("dates reject fabricated precision", () => {
      expect(sql).toContain("(date_precision = 'UNKNOWN' and date_lower_bound is null and date_upper_bound is null)");
      expect(sql).toContain("(date_precision = 'BEFORE' and date_lower_bound is null and date_upper_bound is not null)");
      expect(sql).toContain("(date_precision = 'AFTER' and date_lower_bound is not null and date_upper_bound is null)");
    });

    it("events remain candidate by default", () => {
      expect(sql).toContain("review_state text not null check(review_state in ('PROPOSED','CONFIRMED','REJECTED','DISPUTED'))");
    });
  });

  describe("Security Definitions", () => {
    it("uses security definer for the RPC", () => {
      expect(sql).toContain("language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp set lock_timeout='5s' set timezone='UTC' as $$");
    });

    it("grants least privilege to service_role and dedicated role", () => {
      expect(sql).toContain("create role navigator_human_reviewer nologin;");
      expect(sql).toContain("grant usage on schema public to navigator_human_reviewer;");
      expect(sql).toContain("revoke all on function public.navigator_intelligence_review_update(text,uuid,text,uuid,text,timestamptz) from public,anon,authenticated,service_role,navigator_human_reviewer;");
      expect(sql).toContain("grant execute on function public.navigator_intelligence_review_update(text,uuid,text,uuid,text,timestamptz) to navigator_human_reviewer;");
      
      expect(sql).toContain("revoke all on public.navigator_entities from public,anon,authenticated,service_role;");
      expect(sql).toContain("grant select,insert on public.navigator_entities to service_role;");
      expect(sql).toContain("grant update (id, matter_id, entity_type, display_name, freshness_state, fingerprint, created_at, updated_at) on public.navigator_entities to service_role;");
      
      expect(sql).toContain("revoke all on public.navigator_intelligence_review_actions from public,anon,authenticated,service_role;");
      expect(sql).toContain("grant select on public.navigator_intelligence_review_actions to service_role;");
    });
  });
});
