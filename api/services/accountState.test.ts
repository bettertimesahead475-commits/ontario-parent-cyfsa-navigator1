import { describe, expect, it } from "vitest";
import { AREAS, areasFor, canOpen, deriveAccountState } from "../../shared/accountState.js";

const verified = { identityVerified: true, licenceVerified: true, practiceVerified: true };

describe("account state comes only from server facts", () => {
  it("is a parent with no professional profile", () => {
    expect(deriveAccountState({ primaryRole: null, professionalProfile: null })).toBe("PARENT");
  });

  it("stays an unverified applicant when a profile exists but is not fully verified", () => {
    expect(deriveAccountState({ primaryRole: null, professionalProfile: { ...verified, licenceVerified: false } })).toBe("PROFESSIONAL_APPLICANT_UNVERIFIED");
    expect(deriveAccountState({ primaryRole: null, professionalProfile: { identityVerified: false, licenceVerified: false, practiceVerified: false } })).toBe("PROFESSIONAL_APPLICANT_UNVERIFIED");
  });

  it("is verified only when identity, licence, and practice are all verified", () => {
    expect(deriveAccountState({ primaryRole: null, professionalProfile: verified })).toBe("PROFESSIONAL_VERIFIED");
  });

  it("is administrator only from the server's admin role", () => {
    expect(deriveAccountState({ primaryRole: "admin", professionalProfile: null })).toBe("ADMINISTRATOR");
  });

  it("ignores any browser-supplied role claim, because the function takes no such input", () => {
    // Extra fields a browser might add are not read: the result depends on server facts only.
    const withClaim = { primaryRole: null, professionalProfile: null, claimedRole: "lawyer", isLawyer: true } as any;
    expect(deriveAccountState(withClaim)).toBe("PARENT");
  });
});

describe("areas by state", () => {
  it("never opens the professional workspace to a parent or an unverified applicant", () => {
    expect(canOpen("PARENT", "PROFESSIONAL_WORKSPACE")).toBe(false);
    expect(canOpen("PROFESSIONAL_APPLICANT_UNVERIFIED", "PROFESSIONAL_WORKSPACE")).toBe(false);
    expect(canOpen("PROFESSIONAL_APPLICANT_UNVERIFIED", "ADMIN_APPROVALS")).toBe(false);
  });

  it("opens the professional workspace only to a verified professional", () => {
    expect(canOpen("PROFESSIONAL_VERIFIED", "PROFESSIONAL_WORKSPACE")).toBe(true);
    expect(canOpen("PROFESSIONAL_VERIFIED", "ADMIN_APPROVALS")).toBe(false);
  });

  it("gives administrator approvals only to administrators", () => {
    for (const state of ["PARENT", "PROFESSIONAL_APPLICANT_UNVERIFIED", "PROFESSIONAL_VERIFIED"] as const) {
      expect(canOpen(state, "ADMIN_APPROVALS")).toBe(false);
    }
    expect(canOpen("ADMINISTRATOR", "ADMIN_APPROVALS")).toBe(true);
  });

  it("gives every state the parent workspace and a way to request verification", () => {
    for (const state of ["PARENT", "PROFESSIONAL_APPLICANT_UNVERIFIED", "PROFESSIONAL_VERIFIED", "ADMINISTRATOR"] as const) {
      expect(areasFor(state)).toContain("PARENT_WORKSPACE");
      expect(areasFor(state)).toContain("VERIFICATION_REQUEST");
    }
  });

  it("names only known areas", () => {
    for (const state of ["PARENT", "PROFESSIONAL_VERIFIED", "ADMINISTRATOR"] as const) {
      for (const a of areasFor(state)) expect(AREAS).toContain(a);
    }
  });
});
