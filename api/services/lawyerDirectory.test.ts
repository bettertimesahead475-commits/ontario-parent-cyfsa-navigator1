import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPublicProfile, searchDirectory, claimProfile } from "./lawyerDirectory.js";
import { requireProfessionalAccess } from "./professionalWorkspace.js";

const __current = { db: null as any };

vi.mock('./access.js', () => {
  return {
    getSupabase: () => __current.db
  };
});

function fakeDatabase() {
  const tables: Record<string, any[]> = {
    accounts: [
      { id: "acc-1", firebase_uid: "LAWYER_1", primary_role: "lawyer", status: "active" },
      { id: "acc-2", firebase_uid: "LAWYER_2", primary_role: "lawyer", status: "active" },
      { id: "acc-3", firebase_uid: "LAWYER_3", primary_role: "lawyer", status: "active" }
    ],
    professional_profiles: [
      {
        id: "prof-1", account_id: "acc-1", display_name: "Jane Doe", professional_type: "LAWYER",
        lifecycle_state: "VERIFIED_LAWYER", identity_verified: true, licence_verified: true,
        practice_verified: true, platform_participating: false, public_phone: "555-0100"
      },
      {
        id: "prof-2", account_id: null, display_name: "Unclaimed List", professional_type: "LAWYER",
        lifecycle_state: "PUBLIC_LISTING", identity_verified: false, licence_verified: false,
        practice_verified: false, platform_participating: false
      },
      {
        id: "prof-3", account_id: "acc-3", display_name: "CYFSA Pro", professional_type: "LAWYER",
        lifecycle_state: "PARTICIPATING_PROFESSIONAL", identity_verified: true, licence_verified: true,
        practice_verified: true, platform_participating: true
      },
      {
        id: "prof-draft", account_id: null, display_name: "Draft", professional_type: "LAWYER",
        lifecycle_state: "DRAFT_INTERNAL"
      },
      {
        id: "prof-claimed", account_id: "acc-4", display_name: "Claimed Pro", professional_type: "LAWYER",
        lifecycle_state: "CLAIMED_PROFILE"
      }
    ],
    professional_office_locations: [
      { id: "loc-1", profile_id: "prof-1", locality: "Toronto", province: "ON" },
      { id: "loc-2", profile_id: "prof-1", locality: "Mississauga", province: "ON" },
      { id: "loc-3", profile_id: "prof-3", locality: "Ottawa", province: "ON" }
    ],
    professional_service_areas: [
      { id: "sa-1", profile_id: "prof-1", coverage_type: "LOCALITY", locality_name: "Brampton" },
      { id: "sa-2", profile_id: "prof-3", coverage_type: "ONTARIO_WIDE" },
      { id: "sa-3", profile_id: "prof-3", coverage_type: "VIRTUAL" },
      { id: "sa-reg", profile_id: "prof-1", coverage_type: "REGIONAL", region_name: "Eastern Ontario" }
    ],
    professional_practice_areas: [
      { id: "pa-1", profile_id: "prof-3", practice_area: "CYFSA", provenance_type: "SELF_REPORTED" },
      { id: "pa-2", profile_id: "prof-1", practice_area: "Real Estate", provenance_type: "SELF_REPORTED" }
    ],
    professional_profile_sources: [],
    navigator_matter_members: []
  };

  const db = {
    tables,
    from(table: string) {
      if (!tables[table]) throw new Error("Table " + table + " not found");
      let query = tables[table];
      let inFilters: any = {};

      const chain = {
        select: (fields: string) => {
          if (fields.includes("professional_office_locations")) {
            query = query.map(r => ({
              ...r,
              professional_office_locations: tables.professional_office_locations.filter((x: any) => x.profile_id === r.id),
              professional_service_areas: tables.professional_service_areas.filter((x: any) => x.profile_id === r.id),
              professional_practice_areas: tables.professional_practice_areas.filter((x: any) => x.profile_id === r.id)
            }));
          }
          return chain;
        },
        eq: (col: string, val: any) => {
          query = query.filter(r => r[col] === val);
          return chain;
        },
        is: (col: string, val: any) => {
          query = query.filter(r => r[col] === val);
          return chain;
        },
        in: (col: string, vals: any[]) => {
          inFilters[col] = vals;
          query = query.filter(r => vals.includes(r[col]));
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
        update: (updates: any) => {
          return {
            eq: (col: string, val: any) => ({
              is: (col2: string, val2: any) => ({
                then: (resolve: any) => resolve({ error: null })
              })
            })
          };
        },
        then: (resolve: any) => {
          resolve({ data: query, error: null });
        }
      };
      return chain;
    }
  };
  return db;
}

beforeEach(() => {
  __current.db = fakeDatabase();
});

describe("Lawyer Directory Data Foundation - Remediation", () => {
  it("arbitrary lawyer-role account cannot claim unclaimed listing (fails closed)", async () => {
    await expect(claimProfile("LAWYER_1", "prof-2")).rejects.toThrow(/Profile claiming is deferred/);
  });

  it("no claim race can report false ownership success (endpoint disabled)", async () => {
    await expect(claimProfile("LAWYER_2", "prof-2")).rejects.toThrow(/deferred until a verified claim workflow/);
  });

  it("only directory-visible lifecycle states appear publicly", async () => {
    const results = await searchDirectory({});
    const states = results.map(r => r.lifecycleState);
    expect(states).toContain("PUBLIC_LISTING");
    expect(states).toContain("VERIFIED_LAWYER");
    expect(states).toContain("PARTICIPATING_PROFESSIONAL");
    expect(states).toContain("CLAIMED_PROFILE");
    expect(states).not.toContain("DRAFT_INTERNAL");
  });

  it("non-public profile cannot be fetched through public profile endpoint", async () => {
    const prof = await getPublicProfile("prof-draft");
    expect(prof).toBeNull();
  });

  it("public DTO excludes private and internal metadata", async () => {
    const prof = await getPublicProfile("prof-1");
    expect(prof).not.toBeNull();
    // Prove it excludes internal IDs
    expect((prof as any).accountId).toBeUndefined();
    expect((prof as any).firebaseUid).toBeUndefined();
    expect((prof as any).verificationNotes).toBeUndefined();
    
    // Prove it excludes Stage 7B access data & 7C review data natively
    expect((prof as any).matterMemberships).toBeUndefined();
    expect((prof as any).professionalReviews).toBeUndefined();
    expect((prof as any).matterIntelligence).toBeUndefined();
  });

  it("PUBLIC_LISTING alone gives no matter access", async () => {
    await expect(requireProfessionalAccess(__current.db, "fake-acc", "matter-1")).rejects.toThrow();
  });

  it("CLAIMED_PROFILE alone gives no matter access", async () => {
    await expect(requireProfessionalAccess(__current.db, "acc-4", "matter-1")).rejects.toThrow();
  });

  it("VERIFIED_LAWYER alone gives no matter access", async () => {
    await expect(requireProfessionalAccess(__current.db, "acc-1", "matter-1")).rejects.toThrow();
  });

  it("PARTICIPATING_PROFESSIONAL alone gives no matter access", async () => {
    await expect(requireProfessionalAccess(__current.db, "acc-3", "matter-1")).rejects.toThrow();
  });

  it("REGIONAL behavior is explicitly deferred (does not match locality)", async () => {
    const results = await searchDirectory({ locality: "Eastern Ontario" });
    expect(results.find(r => r.id === "prof-1")).toBeUndefined(); // Explicitly deferred to Stage 7E
  });

  it("professional_profiles remains canonical", async () => {
    const prof = await getPublicProfile("prof-1");
    expect(prof?.displayName).toBe("Jane Doe");
    expect(prof?.professionalType).toBe("LAWYER");
  });

  it("office and service area are separate, same professional supports multiple offices", async () => {
    const prof = await getPublicProfile("prof-1");
    expect(prof?.officeLocations).toHaveLength(2);
    expect(prof?.serviceAreas).toHaveLength(2); // LOCALITY and REGIONAL
  });

  it("locality service-area matching works (Brampton) and match reason is accurate", async () => {
    const results = await searchDirectory({ locality: "Brampton" });
    expect(results).toHaveLength(2);
    const p1 = results.find(r => r.id === "prof-1");
    expect(p1?.matchReasons).toContain("SERVES_AREA");
  });

  it("arbitrary Ontario locality supported and matches office", async () => {
    const results = await searchDirectory({ locality: "Toronto" });
    expect(results).toHaveLength(2);
    const p1 = results.find(r => r.id === "prof-1");
    expect(p1?.matchReasons).toContain("OFFICE_NEARBY");
  });

  it("Ontario-wide and virtual representation works", async () => {
    const resultsVirtual = await searchDirectory({ isVirtual: true });
    expect(resultsVirtual).toHaveLength(1);
    expect(resultsVirtual[0].id).toBe("prof-3");
    expect(resultsVirtual[0].matchReasons).toContain("VIRTUAL");

    const resultsOW = await searchDirectory({ isOntarioWide: true });
    expect(resultsOW).toHaveLength(1);
    expect(resultsOW[0].id).toBe("prof-3");
    expect(resultsOW[0].matchReasons).toContain("ONTARIO_WIDE");
  });

  it("CYFSA/child-protection filtering works, non-CYFSA excluded", async () => {
    const results = await searchDirectory({ requiresCyfsa: true });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("prof-3");
    expect(results[0].matchReasons).toContain("CHILD_PROTECTION_PRACTICE");
  });

  it("match reasons are deterministic and no quality/win-rate ranking exists", async () => {
    const results = await searchDirectory({ locality: "Ottawa", requiresCyfsa: true });
    expect(results).toHaveLength(1);
    expect(results[0].matchReasons).toContain("OFFICE_NEARBY");
    expect(results[0].matchReasons).toContain("CHILD_PROTECTION_PRACTICE");
    expect(results[0].matchReasons).toContain("PARTICIPATING_PROFESSIONAL");
    expect((results[0] as any).score).toBeUndefined();
    expect((results[0] as any).winRate).toBeUndefined();
  });
});

