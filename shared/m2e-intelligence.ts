import { computeFingerprint } from './m2a-deterministic.js';
import { M2CClaim, M2CAttribution } from './m2c-claims.js';
import { M2DRelationship } from './m2d-relationships.js';

export const M2E_ALGORITHM_VERSION = '1.0.0';

export const FINDING_CATEGORIES = [
  'SUPPORT_GAP',
  'INDEPENDENCE_GAP',
  'SOURCE_GAP',
  'DATE_GAP',
  'ACTOR_GAP',
  'LOCATION_GAP',
  'UNRESOLVED_CONFLICT',
  'UNRESOLVED_CLAIM_EVOLUTION',
  'ATTRIBUTION_GAP',
  'EVIDENCE_QUALITY_REVIEW',
  'UNANSWERED_QUESTION',
  'HUMAN_REVIEW_REQUIRED'
] as const;
export type FindingCategory = typeof FINDING_CATEGORIES[number];

export const MATERIALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type MaterialityLevel = typeof MATERIALITY_LEVELS[number];

export const FINDING_STATES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'SUPERSEDED'] as const;
export type FindingState = typeof FINDING_STATES[number];

export interface FindingProvenance {
  claimIds?: string[];
  eventIds?: string[];
  relationshipIds?: string[];
  attributionIds?: string[];
  sourceIds?: string[];
  actorIds?: string[];
  locationIds?: string[];
}

export interface M2EFinding {
  id: string;
  matterId: string;
  category: FindingCategory;
  materiality: MaterialityLevel;
  state: FindingState;
  title: string;
  description: string;
  provenance: FindingProvenance;
  fingerprint: string;
  isStale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnansweredQuestion extends M2EFinding {
  category: 'UNANSWERED_QUESTION';
  question: string;
}

export interface CaseIntelligenceSnapshot {
  matterId: string;
  timestamp: string;
  counts: {
    totalClaims: number;
    claimsByClassification: Record<string, number>;
    unresolvedAttribution: number;
    corroborationRelationships: number;
    contradictionRelationships: number;
    openEvidenceGapsByCategory: Record<FindingCategory, number>;
    unansweredQuestions: number;
    humanReviewRequired: number;
    staleIntelligence: number;
    unresolvedUnknownDate: number;
  };
}

export function computeFindingFingerprint(
  category: FindingCategory,
  materiality: MaterialityLevel,
  provenance: FindingProvenance
): string {
  const sortedProv = {
    claimIds: [...(provenance.claimIds || [])].sort(),
    eventIds: [...(provenance.eventIds || [])].sort(),
    relationshipIds: [...(provenance.relationshipIds || [])].sort(),
    attributionIds: [...(provenance.attributionIds || [])].sort(),
    sourceIds: [...(provenance.sourceIds || [])].sort(),
    actorIds: [...(provenance.actorIds || [])].sort(),
    locationIds: [...(provenance.locationIds || [])].sort()
  };

  return computeFingerprint([{ id: 'algorithmVersion', version: M2E_ALGORITHM_VERSION }], {
    category,
    materiality,
    provenance: sortedProv
  });
}

export interface M2EContext {
  claims: M2CClaim[];
  attributions: M2CAttribution[];
  relationships: M2DRelationship[];
  events: any[]; 
}

export function generateEvidenceGaps(ctx: M2EContext): M2EFinding[] {
  const findings: M2EFinding[] = [];

  for (const claim of ctx.claims) {
    if (claim.classification === 'UNKNOWN' || claim.classification === 'UNVERIFIED_CLAIM') continue;
    
    const claimAttributions = ctx.attributions.filter(a => a.claimId === claim.id);
    
    if (claimAttributions.length === 0) {
      findings.push(createFinding(
        claim.matterId,
        'ATTRIBUTION_GAP',
        'HIGH', 
        'Claim ' + claim.id + ' lacks attribution',
        'The available record does not currently contain a source establishing the original attribution for this claim.',
        { claimIds: [claim.id] }
      ));
    }

    if (claim.classification === 'ALLEGATION') {
      const hasSupport = ctx.relationships.some(r => 
        (r.claimAId === claim.id || r.claimBId === claim.id) &&
        (r.relationshipType === 'INDEPENDENT_SUPPORT' || r.relationshipType === 'DEPENDENT_SUPPORT' || r.relationshipType === 'CONSISTENT_WITH')
      );
      if (!hasSupport) {
        findings.push(createFinding(
          claim.matterId,
          'SUPPORT_GAP',
          'MEDIUM',
          'Claim ' + claim.id + ' lacks support',
          'No independent supporting source is currently linked to this claim.',
          { claimIds: [claim.id] }
        ));
      }
    }

    if (!claim.dateContext || claim.dateContext.precision === 'UNKNOWN') {
      findings.push(createFinding(
        claim.matterId,
        'DATE_GAP',
        'MEDIUM',
        'Claim ' + claim.id + ' date unknown',
        'Date information remains incomplete.',
        { claimIds: [claim.id] }
      ));
      
      findings.push(createUnansweredQuestion(
        claim.matterId,
        'MEDIUM',
        'The date of Claim ' + claim.id + ' remains UNKNOWN_DATE. What source, if any, establishes when this occurred?',
        { claimIds: [claim.id] }
      ));
    }
  }

  for (const rel of ctx.relationships) {
    if (rel.relationshipType === 'DIRECT_CONTRADICTION' || rel.relationshipType === 'POTENTIAL_CONTRADICTION' || rel.relationshipType.endsWith('_INCONSISTENCY')) {
      findings.push(createFinding(
        rel.matterId,
        'UNRESOLVED_CONFLICT',
        'HIGH',
        'Unresolved conflict between claims ' + rel.claimAId + ' and ' + rel.claimBId,
        'The available record does not currently contain a source resolving this conflict.',
        { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort() }
      ));
      
      findings.push(createUnansweredQuestion(
        rel.matterId,
        'HIGH',
        'Claims ' + rel.claimAId + ' and ' + rel.claimBId + ' contain an unresolved contradiction. Is there an independent source in the available case record that resolves which account is supported?',
        { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort() }
      ));
    }
  }

  return findings;
}

export function createFinding(
  matterId: string,
  category: FindingCategory,
  materiality: MaterialityLevel,
  title: string,
  description: string,
  provenance: FindingProvenance
): M2EFinding {
  const fingerprint = computeFindingFingerprint(category, materiality, provenance);
  return {
    id: 'finding-' + fingerprint.substring(0, 8),
    matterId,
    category,
    materiality,
    state: 'OPEN',
    title,
    description,
    provenance,
    fingerprint,
    isStale: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function createUnansweredQuestion(
  matterId: string,
  materiality: MaterialityLevel,
  question: string,
  provenance: FindingProvenance
): UnansweredQuestion {
  const finding = createFinding(matterId, 'UNANSWERED_QUESTION', materiality, 'Unanswered Question', question, provenance);
  return {
    ...(finding as any),
    category: 'UNANSWERED_QUESTION',
    question
  };
}

export function generateSnapshot(matterId: string, ctx: M2EContext, findings: M2EFinding[]): CaseIntelligenceSnapshot {
  const counts = {
    totalClaims: ctx.claims.length,
    claimsByClassification: {} as Record<string, number>,
    unresolvedAttribution: findings.filter(f => f.category === 'ATTRIBUTION_GAP' && f.state === 'OPEN').length,
    corroborationRelationships: ctx.relationships.filter(r => ['INDEPENDENT_SUPPORT', 'DEPENDENT_SUPPORT', 'CONSISTENT_WITH'].includes(r.relationshipType)).length,
    contradictionRelationships: ctx.relationships.filter(r => ['DIRECT_CONTRADICTION', 'POTENTIAL_CONTRADICTION'].includes(r.relationshipType) || r.relationshipType.endsWith('_INCONSISTENCY')).length,
    openEvidenceGapsByCategory: {} as Record<FindingCategory, number>,
    unansweredQuestions: findings.filter(f => f.category === 'UNANSWERED_QUESTION' && f.state === 'OPEN').length,
    humanReviewRequired: findings.filter(f => f.category === 'HUMAN_REVIEW_REQUIRED' && f.state === 'OPEN').length,
    staleIntelligence: findings.filter(f => f.isStale).length,
    unresolvedUnknownDate: findings.filter(f => f.category === 'DATE_GAP' && f.state === 'OPEN').length
  };

  for (const c of FINDING_CATEGORIES) {
    counts.openEvidenceGapsByCategory[c] = findings.filter(f => f.category === c && f.state === 'OPEN').length;
  }

  for (const claim of ctx.claims) {
    counts.claimsByClassification[claim.classification] = (counts.claimsByClassification[claim.classification] || 0) + 1;
  }

  return {
    matterId,
    timestamp: new Date().toISOString(),
    counts
  };
}
