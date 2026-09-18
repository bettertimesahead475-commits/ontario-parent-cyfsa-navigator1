import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";

export interface PublicDirectoryProfile {
  id: string;
  displayName: string;
  professionalType: string;
  publicPhone: string | null;
  publicEmail: string | null;
  publicWebsite: string | null;
  lifecycleState: string;
  identityVerified: boolean;
  licenceVerified: boolean;
  practiceVerified: boolean;
  platformParticipating: boolean;
  
  officeLocations: any[];
  serviceAreas: any[];
  practiceAreas: any[];
  
  matchReasons?: string[];
}

const PUBLIC_DIRECTORY_STATES = [
  'PUBLIC_LISTING',
  'CLAIMED_PROFILE',
  'VERIFIED_LAWYER',
  'PARTICIPATING_PROFESSIONAL'
];

export async function searchDirectory(filters: {
  locality?: string;
  isVirtual?: boolean;
  isOntarioWide?: boolean;
  requiresCyfsa?: boolean;
}): Promise<PublicDirectoryProfile[]> {
  const db = getSupabase();

  let query = db.from('professional_profiles').select("id, account_id, display_name, professional_type, public_phone, public_email, lifecycle_state, identity_verified, licence_verified, practice_verified, platform_participating, professional_office_locations ( id, address, locality, province, postal_code, lat, lng ), professional_service_areas ( id, coverage_type, locality_name, region_name ), professional_practice_areas ( id, practice_area, provenance_type )")
    .in('lifecycle_state', PUBLIC_DIRECTORY_STATES);

  const { data, error } = await query;
  if (error) throw new Error("Search failed: " + error.message);

  const results: PublicDirectoryProfile[] = [];

  for (const row of data || []) {
    const matchReasons: string[] = [];
    let matchedLocality = false;
    let matchedCyfsa = false;
    let matchedVirtual = false;
    let matchedOntarioWide = false;

    if (filters.requiresCyfsa) {
      const cyfsaPractice = row.professional_practice_areas?.some((p: any) => 
        ['CYFSA', 'Child Protection'].includes(p.practice_area)
      );
      if (cyfsaPractice) {
        matchedCyfsa = true;
        matchReasons.push('CHILD_PROTECTION_PRACTICE');
      }
    }

    if (filters.locality) {
      const officeMatches = row.professional_office_locations?.some((o: any) => o.locality?.toLowerCase() === filters.locality?.toLowerCase());
      if (officeMatches) {
        matchedLocality = true;
        matchReasons.push('OFFICE_NEARBY');
      } else {
        const serviceAreaMatches = row.professional_service_areas?.some((s: any) => 
          (s.coverage_type === 'LOCALITY' && s.locality_name?.toLowerCase() === filters.locality?.toLowerCase())
        );
        if (serviceAreaMatches) {
          matchedLocality = true;
          matchReasons.push('SERVES_AREA');
        }
      }
    }

    // REGIONAL matching is explicitly deferred to Stage 7E.
    // It is supported in schema but not yet exposed in the search logic.

    const isOW = row.professional_service_areas?.some((s: any) => s.coverage_type === 'ONTARIO_WIDE');
    if (isOW) {
      matchedOntarioWide = true;
      if (filters.isOntarioWide || filters.locality || filters.isVirtual) {
        matchReasons.push('ONTARIO_WIDE');
      }
    }

    const isVirt = row.professional_service_areas?.some((s: any) => s.coverage_type === 'VIRTUAL');
    if (isVirt) {
      matchedVirtual = true;
      if (filters.isVirtual) {
        matchReasons.push('VIRTUAL');
      }
    }

    if (row.lifecycle_state === 'VERIFIED_LAWYER') matchReasons.push('VERIFIED_LAWYER');
    if (row.lifecycle_state === 'PARTICIPATING_PROFESSIONAL') matchReasons.push('PARTICIPATING_PROFESSIONAL');

    if (filters.requiresCyfsa && !matchedCyfsa) continue;
    if (filters.locality && !matchedLocality && !matchedOntarioWide) continue;
    if (filters.isVirtual && !matchedVirtual && !matchedOntarioWide) continue;
    if (filters.isOntarioWide && !matchedOntarioWide) continue;

    results.push({
      id: row.id,
      displayName: row.display_name,
      professionalType: row.professional_type,
      publicPhone: row.public_phone,
      publicEmail: row.public_email,
      publicWebsite: null,
      lifecycleState: row.lifecycle_state,
      identityVerified: row.identity_verified,
      licenceVerified: row.licence_verified,
      practiceVerified: row.practice_verified,
      platformParticipating: row.platform_participating,
      officeLocations: row.professional_office_locations || [],
      serviceAreas: row.professional_service_areas || [],
      practiceAreas: row.professional_practice_areas || [],
      matchReasons: Array.from(new Set(matchReasons))
    });
  }

  return results;
}

export async function getPublicProfile(profileId: string): Promise<PublicDirectoryProfile | null> {
  const db = getSupabase();
  const { data, error } = await db.from('professional_profiles').select("id, account_id, display_name, professional_type, public_phone, public_email, lifecycle_state, identity_verified, licence_verified, practice_verified, platform_participating, professional_office_locations ( id, address, locality, province, postal_code, lat, lng ), professional_service_areas ( id, coverage_type, locality_name, region_name ), professional_practice_areas ( id, practice_area, provenance_type )")
    .eq('id', profileId)
    .in('lifecycle_state', PUBLIC_DIRECTORY_STATES)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    professionalType: data.professional_type,
    publicPhone: data.public_phone,
    publicEmail: data.public_email,
    publicWebsite: null,
    lifecycleState: data.lifecycle_state,
    identityVerified: data.identity_verified,
    licenceVerified: data.licence_verified,
    practiceVerified: data.practice_verified,
    platformParticipating: data.platform_participating,
    officeLocations: data.professional_office_locations || [],
    serviceAreas: data.professional_service_areas || [],
    practiceAreas: data.professional_practice_areas || []
  };
}

export async function claimProfile(firebaseUid: string, profileId: string) {
  // NARROW REMEDIATION: Profile claiming is deferred until a verified claim workflow is implemented.
  // Fails closed to prevent unsafe ownership acquisition.
  throw new LifecycleError(403, 'FORBIDDEN', 'Profile claiming is deferred until a verified claim workflow is implemented.');
}
