/**
 * Account state, derived only from facts the server reports. Nothing the browser sends about its own
 * role is an input: there is no parameter for "I am a lawyer". Choosing a role in the page cannot
 * change the result.
 */

export type AccountState = "PARENT" | "PROFESSIONAL_APPLICANT_UNVERIFIED" | "PROFESSIONAL_VERIFIED" | "ADMINISTRATOR";

export interface ServerAccountFacts {
  /** From the server's account record. "admin" grants administrator state. */
  primaryRole: string | null;
  /** From the server's professional profile. Null when no profile exists. */
  professionalProfile: {
    identityVerified: boolean;
    licenceVerified: boolean;
    practiceVerified: boolean;
  } | null;
}

export function deriveAccountState(facts: ServerAccountFacts): AccountState {
  if (facts.primaryRole === "admin") return "ADMINISTRATOR";
  const p = facts.professionalProfile;
  if (!p) return "PARENT";
  if (p.identityVerified && p.licenceVerified && p.practiceVerified) return "PROFESSIONAL_VERIFIED";
  return "PROFESSIONAL_APPLICANT_UNVERIFIED";
}

/** Areas each state may open in the interface. The server still checks every request. */
export const AREAS = ["PARENT_WORKSPACE", "PROFESSIONAL_WORKSPACE", "ADMIN_APPROVALS", "VERIFICATION_REQUEST"] as const;
export type Area = (typeof AREAS)[number];

const PERMITTED: Record<AccountState, readonly Area[]> = {
  PARENT: ["PARENT_WORKSPACE", "VERIFICATION_REQUEST"],
  PROFESSIONAL_APPLICANT_UNVERIFIED: ["PARENT_WORKSPACE", "VERIFICATION_REQUEST"],
  PROFESSIONAL_VERIFIED: ["PARENT_WORKSPACE", "PROFESSIONAL_WORKSPACE", "VERIFICATION_REQUEST"],
  ADMINISTRATOR: ["PARENT_WORKSPACE", "ADMIN_APPROVALS", "VERIFICATION_REQUEST"],
};

export function areasFor(state: AccountState): readonly Area[] {
  return PERMITTED[state];
}

export function canOpen(state: AccountState, area: Area): boolean {
  return PERMITTED[state].includes(area);
}

export const STATE_LABEL: Record<AccountState, string> = {
  PARENT: "Parent account",
  PROFESSIONAL_APPLICANT_UNVERIFIED: "Professional application: not yet verified",
  PROFESSIONAL_VERIFIED: "Verified professional",
  ADMINISTRATOR: "Administrator",
};
