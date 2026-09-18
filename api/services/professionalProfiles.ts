import { getSupabase } from "./access.js";
import { findAccount } from "./accounts.js";

export interface ProfessionalProfileBase {
  id: string;
  accountId: string | null;
  displayName: string;
  professionalType: "LAWYER" | "PARALEGAL" | "OTHER";
  publicPhone: string | null;
  publicEmail: string | null;
  officeAddress: string | null;
  city: string | null;
  region: string | null;
  serviceAreas: string[] | null;
  isVirtualProvinceWide: boolean;
  indicatesFamilyLaw: boolean;
  indicatesCyfsa: boolean;
  profileSource: string;
  lifecycleState: "PUBLIC_LISTING" | "CLAIMED_PROFILE" | "VERIFIED_LAWYER" | "PARTICIPATING_PROFESSIONAL";
}

export interface ProfessionalProfileInternal extends ProfessionalProfileBase {
  identityVerified: boolean;
  licenceVerified: boolean;
  practiceVerified: boolean;
  platformParticipating: boolean;
  verificationNotes: string | null;
}

export type SelfManagedProfileUpdate = Pick<ProfessionalProfileBase, 
  "displayName" | "publicPhone" | "publicEmail" | "officeAddress" | "city" | "region" | 
  "serviceAreas" | "isVirtualProvinceWide" | "indicatesFamilyLaw" | "indicatesCyfsa" | "professionalType"
>;

// Projections
function toPublicProfile(row: any): ProfessionalProfileBase {
  return {
    id: row.id,
    accountId: row.account_id,
    displayName: row.display_name,
    professionalType: row.professional_type,
    publicPhone: row.public_phone,
    publicEmail: row.public_email,
    officeAddress: row.office_address,
    city: row.city,
    region: row.region,
    serviceAreas: row.service_areas,
    isVirtualProvinceWide: row.is_virtual_province_wide,
    indicatesFamilyLaw: row.indicates_family_law,
    indicatesCyfsa: row.indicates_cyfsa,
    profileSource: row.profile_source,
    lifecycleState: row.lifecycle_state,
  };
}

function toInternalProfile(row: any): ProfessionalProfileInternal {
  return {
    ...toPublicProfile(row),
    identityVerified: row.identity_verified,
    licenceVerified: row.licence_verified,
    practiceVerified: row.practice_verified,
    platformParticipating: row.platform_participating,
    verificationNotes: row.verification_notes,
  };
}

// Services
export async function getProfessionalProfile(accountId: string): Promise<ProfessionalProfileInternal | null> {
  const { data, error } = await getSupabase().from("professional_profiles")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw new Error("Failed to fetch professional profile.");
  if (!data) return null;
  return toInternalProfile(data);
}

export async function createOrClaimProfile(firebaseUid: string, details: SelfManagedProfileUpdate): Promise<ProfessionalProfileInternal> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new Error("Account not found.");
  
  if (account.primaryRole !== "lawyer") {
    throw new Error("Only lawyer accounts can claim a professional profile.");
  }

  const existing = await getProfessionalProfile(account.id);
  if (existing) {
    throw new Error("Profile already exists. Use update instead.");
  }

  const { data, error } = await getSupabase().from("professional_profiles").insert({
    account_id: account.id,
    display_name: details.displayName,
    professional_type: details.professionalType,
    public_phone: details.publicPhone,
    public_email: details.publicEmail,
    office_address: details.officeAddress,
    city: details.city,
    region: details.region,
    service_areas: details.serviceAreas,
    is_virtual_province_wide: details.isVirtualProvinceWide,
    indicates_family_law: details.indicatesFamilyLaw,
    indicates_cyfsa: details.indicatesCyfsa,
    profile_source: 'USER_CREATED',
    lifecycle_state: 'CLAIMED_PROFILE',
    // Hardcode verification fields to false/null to prevent self-escalation
    identity_verified: false,
    licence_verified: false,
    practice_verified: false,
    platform_participating: false,
    verification_notes: null
  }).select("*").single();

  if (error) throw new Error("Failed to create professional profile: " + error.message);
  return toInternalProfile(data);
}

export async function updateOwnProfile(firebaseUid: string, updates: Partial<SelfManagedProfileUpdate>): Promise<ProfessionalProfileInternal> {
  const account = await findAccount(firebaseUid);
  if (!account) throw new Error("Account not found.");

  const profile = await getProfessionalProfile(account.id);
  if (!profile) throw new Error("Profile not found.");

  const { data, error } = await getSupabase().from("professional_profiles").update({
    display_name: updates.displayName ?? profile.displayName,
    professional_type: updates.professionalType ?? profile.professionalType,
    public_phone: updates.publicPhone ?? profile.publicPhone,
    public_email: updates.publicEmail ?? profile.publicEmail,
    office_address: updates.officeAddress ?? profile.officeAddress,
    city: updates.city ?? profile.city,
    region: updates.region ?? profile.region,
    service_areas: updates.serviceAreas ?? profile.serviceAreas,
    is_virtual_province_wide: updates.isVirtualProvinceWide ?? profile.isVirtualProvinceWide,
    indicates_family_law: updates.indicatesFamilyLaw ?? profile.indicatesFamilyLaw,
    indicates_cyfsa: updates.indicatesCyfsa ?? profile.indicatesCyfsa,
    updated_at: new Date().toISOString()
  }).eq("id", profile.id).select("*").single();

  if (error) throw new Error("Failed to update professional profile: " + error.message);
  return toInternalProfile(data);
}

// An admin endpoint to verify the profile. Not exposed to self-managed update.
export async function adminVerifyProfile(adminFirebaseUid: string, profileId: string, verificationUpdates: {
  identityVerified?: boolean;
  licenceVerified?: boolean;
  practiceVerified?: boolean;
  platformParticipating?: boolean;
  lifecycleState?: "PUBLIC_LISTING" | "CLAIMED_PROFILE" | "VERIFIED_LAWYER" | "PARTICIPATING_PROFESSIONAL";
  verificationNotes?: string;
}): Promise<ProfessionalProfileInternal> {
  const account = await findAccount(adminFirebaseUid);
  if (!account || account.primaryRole !== "admin") throw new Error("Admin access required.");

  const { data, error } = await getSupabase().from("professional_profiles").update({
    identity_verified: verificationUpdates.identityVerified,
    licence_verified: verificationUpdates.licenceVerified,
    practice_verified: verificationUpdates.practiceVerified,
    platform_participating: verificationUpdates.platformParticipating,
    lifecycle_state: verificationUpdates.lifecycleState,
    verification_notes: verificationUpdates.verificationNotes,
    updated_at: new Date().toISOString()
  }).eq("id", profileId).select("*").single();

  if (error) throw new Error("Failed to verify professional profile: " + error.message);
  return toInternalProfile(data);
}
