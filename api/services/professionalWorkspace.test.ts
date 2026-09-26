import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ db: null as any }));
vi.mock("./access.js", () => ({ getSupabase: () => current.db }));

import {
  getProfessionalMatters,
  getMatterOverview,
  getIntelligenceCategory,
  saveProfessionalReview,
  requireProfessionalAccess
} from "./professionalWorkspace.js";

function fakeDatabase() {
  const tables: Record<string, any[]> = {
    accounts: [
      { id: "acc-parent", firebase_uid: "PARENT_UID", primary_role: "parent", status: "active" },
      { id: "acc-lawyer", firebase_uid: "LAWYER_UID", primary_role: "lawyer", status: "active" },
      { id: "acc-revoked", firebase_uid: "REVOKED_UID", primary_role: "lawyer", status: "active" },
      { id: "acc-unauthorized", firebase_uid: "UNAUTH_UID", primary_role: "lawyer", status: "active" },
    ],
    navigator_matters: [
      { id: "11111111-1111-1111-1111-111111111111", title: "Matter 1" },
      { id: "22222222-2222-2222-2222-222222222222", title: "Matter 2" }
    ],
    navigator_matter_members: [
      { matter_id: "11111111-1111-1111-1111-111111111111", account_id: "acc-parent", role: "OWNER" },
      { matter_id: "11111111-1111-1111-1111-111111111111", account_id: "acc-lawyer", role: "REVIEWER" },
      { matter_id: "22222222-2222-2222-2222-222222222222", account_id: "acc-parent", role: "OWNER" }
    ],
    navigator_documents: [ { id: "d1", matter_id: "11111111-1111-1111-1111-111111111111" } ],
    navigator_events: [ { id: "e1", matter_id: "11111111-1111-1111-1111-111111111111" } ],
    navigator_claims: [ { id: "33333333-3333-3333-3333-333333333333", matter_id: "11111111-1111-1111-1111-111111111111" } ],
    navigator_claim_relationships: [ { id: "r1", matter_id: "11111111-1111-1111-1111-111111111111" } ],
    navigator_evidence_gap_findings: [ { id: "g1", matter_id: "11111111-1111-1111-1111-111111111111" } ],
    navigator_case_intelligence_snapshots: [ { id: "l1", matter_id: "11111111-1111-1111-1111-111111111111" } ],
    professional_reviews: [
      { id: "pr1", matter_id: "11111111-1111-1111-1111-111111111111", finding_id: "33333333-3333-3333-3333-333333333333", finding_type: "CLAIMS", reviewer_account_id: "acc-lawyer", review_state: "CONFIRMED_RELEVANT", review_note: "My note" }
    ],
    navigator_evidence_items: []
  };

  const db = {
    tables,
    from(table: string) {
      if (!tables[table]) throw new Error(`Table ${table} not found`);
      let query = tables[table];
      let countReq = false;

      const chain = {
        select: (fields: string, opts?: any) => {
          if (opts && opts.count === 'exact') countReq = true;
          return chain;
        },
        eq: (col: string, val: any) => {
          query = query.filter(r => r[col] === val);
          return chain;
        },
        in: (col: string, vals: any[]) => {
          query = query.filter(r => vals.includes(r[col]));
          return chain;
        },
        limit: (n: number) => {
          query = query.slice(0, n);
          return chain;
        },
        single: async () => {
          if (query.length === 0) return { data: null, error: { message: "No rows" } };
          if (query.length > 1) return { data: null, error: { message: "Multiple rows" } };
          return { data: query[0], error: null };
        },
        maybeSingle: async () => {
          if (query.length === 0) return { data: null, error: null };
          if (query.length > 1) return { data: null, error: { message: "Multiple rows" } };
          return { data: query[0], error: null };
        },
        upsert: (record: any, opts: any) => {
          const match = query.find(r => r.finding_type === record.finding_type && r.finding_id === record.finding_id && r.reviewer_account_id === record.reviewer_account_id);
          if (match) {
            Object.assign(match, record);
          } else {
            record.id = "new-id-" + Math.random();
            tables[table].push(record);
            query = [record];
          }
          return chain;
        },
        then: (resolve: any) => {
          if (countReq) {
            resolve({ data: null, count: query.length, error: null });
          } else {
            resolve({ data: query, error: null });
          }
        }
      };
      return chain;
    }
  };
  return db;
}

beforeEach(() => {
  current.db = fakeDatabase();
});

describe("Professional Workspace Authorization & Access", () => {
  it("authorized REVIEWER can list authorized matters", async () => {
    const matters = await getProfessionalMatters("LAWYER_UID");
    expect(matters).toHaveLength(1);
    expect(matters[0].id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("unauthorized professional cannot list another user's matter", async () => {
    const matters = await getProfessionalMatters("UNAUTH_UID");
    expect(matters).toHaveLength(0);
  });

  it("revoked reviewer cannot open workspace", async () => {
    // Revoke access (remove from matter_members)
    current.db.tables.navigator_matter_members = current.db.tables.navigator_matter_members.filter((m: any) => m.account_id !== "acc-lawyer");
    await expect(getMatterOverview("LAWYER_UID", "11111111-1111-1111-1111-111111111111")).rejects.toThrow(/professional access/);
  });

  it("authorized reviewer can read existing matter intelligence", async () => {
    const overview = await getMatterOverview("LAWYER_UID", "11111111-1111-1111-1111-111111111111");
    expect(overview.documents).toBe(1);
    expect(overview.claims).toBe(1);
    expect(overview.reviewedItems).toBe(1);
  });

  it("cross-matter isolation: Reviewer A cannot access Matter B", async () => {
    await expect(getMatterOverview("LAWYER_UID", "22222222-2222-2222-2222-222222222222")).rejects.toThrow(/professional access/);
  });

  it("professional review persists separately from machine finding", async () => {
    const result = await saveProfessionalReview("LAWYER_UID", "11111111-1111-1111-1111-111111111111", "CLAIMS", "44444444-4444-4444-4444-444444444444", "POSSIBLY_RELEVANT", "test note");
    expect(result.review_state).toBe("POSSIBLY_RELEVANT");
    
    // Original claim is unaffected, review is stored in professional_reviews
    const reviews = current.db.tables.professional_reviews.filter((r: any) => r.finding_id === "44444444-4444-4444-4444-444444444444");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reviewer_account_id).toBe("acc-lawyer");
  });
  
  it("multiple reviewers can maintain separate reviews of same finding", async () => {
    // Add another reviewer to matter 1
    current.db.tables.accounts.push({ id: "acc-other-lawyer", firebase_uid: "OTHER_LAWYER_UID", primary_role: "lawyer", status: "active" });
    current.db.tables.navigator_matter_members.push({ matter_id: "11111111-1111-1111-1111-111111111111", account_id: "acc-other-lawyer", role: "REVIEWER" });
    
    // First reviewer saves review
    await saveProfessionalReview("LAWYER_UID", "11111111-1111-1111-1111-111111111111", "CLAIMS", "33333333-3333-3333-3333-333333333333", "CONFIRMED", "note 1");
    
    // Second reviewer saves review
    await saveProfessionalReview("OTHER_LAWYER_UID", "11111111-1111-1111-1111-111111111111", "CLAIMS", "33333333-3333-3333-3333-333333333333", "DISPUTED", "note 2");
    
    // Should have 2 distinct reviews
    const reviews = current.db.tables.professional_reviews.filter((r: any) => r.finding_id === "33333333-3333-3333-3333-333333333333" && r.finding_type === "CLAIMS");
    expect(reviews).toHaveLength(2);
    expect(reviews.find((r: any) => r.reviewer_account_id === "acc-lawyer")?.review_state).toBe("CONFIRMED");
    expect(reviews.find((r: any) => r.reviewer_account_id === "acc-other-lawyer")?.review_state).toBe("DISPUTED");
  });

  it("empty intelligence categories render safely (overview zero)", async () => {
    // matter-1 has no evidence items
    const overview = await getMatterOverview("LAWYER_UID", "11111111-1111-1111-1111-111111111111");
    expect(overview.evidenceGaps).toBe(1);
    
    const category = await getIntelligenceCategory("LAWYER_UID", "11111111-1111-1111-1111-111111111111", "EVIDENCE");
    expect(category.items).toHaveLength(0);
  });

  it("guessed matter ID fails", async () => {
    await expect(getMatterOverview("LAWYER_UID", "99999999-9999-9999-9999-999999999999")).rejects.toThrow(/professional access/);
  });

  it("authorized user can retrieve DOCUMENTS category for document inventory", async () => {
    const category = await getIntelligenceCategory("LAWYER_UID", "11111111-1111-1111-1111-111111111111", "DOCUMENTS");
    expect(category.items).toHaveLength(1);
    expect(category.items[0].id).toBe("d1");
  });

  it("owner without REVIEWER role cannot access professional workspace endpoints", async () => {
    await expect(getMatterOverview("PARENT_UID", "11111111-1111-1111-1111-111111111111")).rejects.toThrow(/professional access/);
  });

  it("data minimization: no raw token digests or internal firebase credentials exposed", async () => {
    const matters = await getProfessionalMatters("LAWYER_UID");
    expect(matters[0]).not.toHaveProperty("token_digest");
    expect(matters[0]).not.toHaveProperty("firebase_uid");
  });
});

