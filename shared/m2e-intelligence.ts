import { computeFingerprint } from './m2a-deterministic.js';
import { M2CClaim, M2CAttribution } from './m2c-claims.js';
import { M2DRelationship } from './m2d-relationships.js';

export const M2E_ALGORITHM_VERSION = '1.0.1';

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
  semanticFingerprints?: Record<string, string>;
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
    locationIds: [...(provenance.locationIds || [])].sort(),
    semanticFingerprints: provenance.semanticFingerprints || {}
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

export function determineMateriality(category: FindingCategory, deps: any[]): MaterialityLevel {
  let materialCount = deps.length;
  if (category === 'UNRESOLVED_CONFLICT') return 'HIGH';
  if (category === 'ATTRIBUTION_GAP' || category === 'SOURCE_GAP') return 'HIGH';
  if (category === 'HUMAN_REVIEW_REQUIRED') return 'HIGH';
  if (category === 'SUPPORT_GAP') return 'MEDIUM';
  if (materialCount >= 2) return 'HIGH';
  if (category === 'DATE_GAP' || category === 'ACTOR_GAP' || category === 'LOCATION_GAP') return 'MEDIUM';
  return 'LOW';
}

export function generateEvidenceGaps(matterId: string, ctx: M2EContext): M2EFinding[] {
  const findings: M2EFinding[] = [];

  const allIds = [
    ...ctx.claims.map(c => c.matterId),
    ...ctx.attributions.map(a => a.matterId),
    ...ctx.relationships.map(r => r.matterId),
  ];
  if (allIds.some(id => id !== matterId)) {
    throw new Error("Mixed-matter input detected. Cross-matter data is strictly prohibited.");
  }

  const claimFingerprints = new Map<string, string>();
  for (const claim of ctx.claims) {
    claimFingerprints.set(claim.id, claim.fingerprint);
  }
  const relFingerprints = new Map<string, string>();
  for (const rel of ctx.relationships) {
    relFingerprints.set(rel.id, rel.fingerprint);
  }

  for (const claim of ctx.claims) {
    if (claim.classification === 'UNKNOWN' || claim.classification === 'UNVERIFIED_CLAIM') continue;
    
    const semanticFingerprints: Record<string, string> = {};
    semanticFingerprints[claim.id] = claim.fingerprint;

    const claimAttributions = ctx.attributions.filter(a => a.claimId === claim.id);
    
    if (claimAttributions.length === 0) {
      findings.push(createFinding(
        matterId,
        'ATTRIBUTION_GAP',
        'HIGH', 
        'Claim ' + claim.id + ' lacks attribution',
        'The available record does not currently contain a source establishing the original attribution for this claim.',
        { claimIds: [claim.id], semanticFingerprints }
      ));
    } else {
      // Check for source gaps (unresolvable source)
      // Suppose an attribution has speakerEntityId missing or unknown for DIRECT_STATEMENT
      for (const attr of claimAttributions) {
        if (attr.attributionType === 'DIRECT_STATEMENT' && !attr.speakerEntityId) {
           findings.push(createFinding(
             matterId,
             'SOURCE_GAP',
             'HIGH',
             'Unresolved source for claim ' + claim.id,
             'The structured case state references a source that should be resolvable but the available record cannot resolve it.',
             { claimIds: [claim.id], attributionIds: [attr.id], semanticFingerprints }
           ));
        }
      }
    }

    if (claim.classification === 'ALLEGATION') {
      const supports = ctx.relationships.filter(r => 
        (r.claimAId === claim.id || r.claimBId === claim.id) &&
        (r.relationshipType === 'INDEPENDENT_SUPPORT' || r.relationshipType === 'DEPENDENT_SUPPORT' || r.relationshipType === 'CONSISTENT_WITH')
      );
      
      let hasIndependentSupport = false;
      for (const r of supports) {
         if (r.independenceStatus === 'INDEPENDENT' && r.relationshipType === 'INDEPENDENT_SUPPORT') {
            hasIndependentSupport = true;
         }
      }

      if (!hasIndependentSupport) {
        findings.push(createFinding(
          matterId,
          'SUPPORT_GAP',
          'MEDIUM',
          'Claim ' + claim.id + ' lacks independent support',
          'No independent supporting source is currently linked to this claim.',
          { claimIds: [claim.id], semanticFingerprints }
        ));

        // If there is support, but it's not independent, generate INDEPENDENCE_GAP
        if (supports.length > 0) {
           const relIds = supports.map(r => r.id);
           const sFingerprints = { ...semanticFingerprints };
           supports.forEach(r => sFingerprints[r.id] = r.fingerprint);
           findings.push(createFinding(
             matterId,
             'INDEPENDENCE_GAP',
             'MEDIUM',
             'Support for Claim ' + claim.id + ' lacks independence',
             'Purported support resolves to the same lineage or cannot establish independence.',
             { claimIds: [claim.id], relationshipIds: relIds, semanticFingerprints: sFingerprints }
           ));
        }
      }
    }

    if (!claim.dateContext || claim.dateContext.precision === 'UNKNOWN') {
      findings.push(createFinding(
        matterId,
        'DATE_GAP',
        'MEDIUM',
        'Claim ' + claim.id + ' date unknown',
        'Date information remains incomplete.',
        { claimIds: [claim.id], semanticFingerprints }
      ));
      
      findings.push(createUnansweredQuestion(
        matterId,
        'MEDIUM',
        'The date of Claim ' + claim.id + ' remains UNKNOWN_DATE. What source, if any, establishes when this occurred?',
        { claimIds: [claim.id], semanticFingerprints }
      ));
    }

    // Check claim evolution
    const isMateriallyConnected = ctx.relationships.some(r => r.claimAId === claim.id || r.claimBId === claim.id);
    
    if (isMateriallyConnected) {
        if (claim.reviewState === 'PROPOSED' || claim.reviewState === 'DISPUTED') {
            findings.push(createFinding(
              matterId,
              'EVIDENCE_QUALITY_REVIEW',
              'HIGH',
              'Quality review required for claim ' + claim.id,
              'Material evidence requires human quality review before it can be relied upon.',
              { claimIds: [claim.id], semanticFingerprints: { ...semanticFingerprints } }
            ));
        }

        for (const attr of claimAttributions) {
            if (attr.attributionType === 'UNKNOWN') {
                findings.push(createFinding(
                  matterId,
                  'EVIDENCE_QUALITY_REVIEW',
                  'HIGH',
                  'Provenance quality review required for claim ' + claim.id,
                  'Material evidence has incomplete structured provenance (UNKNOWN attribution).',
                  { claimIds: [claim.id], attributionIds: [attr.id], semanticFingerprints: { ...semanticFingerprints } }
                ));
            }
        }
    }

    const evolutions = ctx.relationships.filter(r => 
        (r.claimAId === claim.id || r.claimBId === claim.id) && r.evolutionContext !== undefined
    );
    for (const evo of evolutions) {
        if (evo.evolutionContext === 'RETRACTS' || evo.evolutionContext === 'CORRECTS') {
            if (evo.reviewState !== 'CONFIRMED' && evo.reviewState !== 'REJECTED') {
                const sFingerprints = { ...semanticFingerprints };
                sFingerprints[evo.id] = evo.fingerprint;
                findings.push(createFinding(
                    matterId,
                    'UNRESOLVED_CLAIM_EVOLUTION',
                    'MEDIUM',
                    'Unresolved evolution for claim ' + claim.id,
                    'Structured evolution state genuinely remains unresolved and materially affects case-record interpretation.',
                    { claimIds: [claim.id], relationshipIds: [evo.id], semanticFingerprints: sFingerprints }
                ));
            }
        }
    }
  }

  for (const rel of ctx.relationships) {
    if (rel.relationshipType === 'DIRECT_CONTRADICTION' || rel.relationshipType === 'POTENTIAL_CONTRADICTION' || rel.relationshipType.endsWith('_INCONSISTENCY')) {
      if (rel.reviewState !== 'CONFIRMED' && rel.reviewState !== 'REJECTED') {
        const semanticFingerprints: Record<string, string> = {};
        semanticFingerprints[rel.id] = rel.fingerprint;
        if (claimFingerprints.has(rel.claimAId)) semanticFingerprints[rel.claimAId] = claimFingerprints.get(rel.claimAId)!;
        if (claimFingerprints.has(rel.claimBId)) semanticFingerprints[rel.claimBId] = claimFingerprints.get(rel.claimBId)!;

        findings.push(createFinding(
          matterId,
          'UNRESOLVED_CONFLICT',
          'HIGH',
          'Unresolved conflict between claims ' + rel.claimAId + ' and ' + rel.claimBId,
          'The available record does not currently contain a source resolving this conflict.',
          { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort(), semanticFingerprints }
        ));
        
        findings.push(createUnansweredQuestion(
          matterId,
          'HIGH',
          'Claims ' + rel.claimAId + ' and ' + rel.claimBId + ' contain an unresolved contradiction. Is there an independent source in the available case record that resolves which account is supported?',
          { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort(), semanticFingerprints }
        ));
      }
    }

    if (rel.relationshipType === 'ACTOR_INCONSISTENCY' && rel.reviewState === 'PROPOSED') {
        const semanticFingerprints: Record<string, string> = { [rel.id]: rel.fingerprint };
        findings.push(createFinding(
          matterId,
          'ACTOR_GAP',
          'MEDIUM',
          'Actor inconsistency requires resolution',
          'Actor identity or role is material to a structured claim/event and remains unresolved or ambiguous.',
          { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort(), semanticFingerprints }
        ));
    }

    if (rel.relationshipType === 'LOCATION_INCONSISTENCY' && rel.reviewState === 'PROPOSED') {
        const semanticFingerprints: Record<string, string> = { [rel.id]: rel.fingerprint };
        findings.push(createFinding(
          matterId,
          'LOCATION_GAP',
          'MEDIUM',
          'Location inconsistency requires resolution',
          'Location is material to the structured event/claim and remains unresolved or ambiguous.',
          { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort(), semanticFingerprints }
        ));
    }

    const isSupport = rel.relationshipType === 'INDEPENDENT_SUPPORT' || rel.relationshipType === 'DEPENDENT_SUPPORT' || rel.relationshipType === 'CONSISTENT_WITH';
    if (isSupport) {
        let needsReview = false;
        let reason = '';
        
        if (rel.independenceStatus === 'UNKNOWN_INDEPENDENCE') {
            needsReview = true;
            reason = 'Important support has unresolved source/attribution quality (UNKNOWN_INDEPENDENCE).';
        } else if (rel.reviewState === 'PROPOSED' || rel.reviewState === 'DISPUTED') {
            needsReview = true;
            reason = 'Important support relationship explicitly requires human verification.';
        }

        if (needsReview) {
            const semanticFingerprints: Record<string, string> = { [rel.id]: rel.fingerprint };
            if (claimFingerprints.has(rel.claimAId)) semanticFingerprints[rel.claimAId] = claimFingerprints.get(rel.claimAId)!;
            if (claimFingerprints.has(rel.claimBId)) semanticFingerprints[rel.claimBId] = claimFingerprints.get(rel.claimBId)!;
            
            findings.push(createFinding(
                matterId,
                'EVIDENCE_QUALITY_REVIEW',
                'HIGH',
                'Quality review required for support relationship ' + rel.id,
                reason,
                { relationshipIds: [rel.id], claimIds: [rel.claimAId, rel.claimBId].sort(), semanticFingerprints }
            ));
        }
    }
  }

  // Check for Human Review Required
  for (const f of findings) {
    if (f.category === 'EVIDENCE_QUALITY_REVIEW' || f.category === 'UNRESOLVED_CONFLICT') {
      const hrrFinding = createFinding(
        matterId,
        'HUMAN_REVIEW_REQUIRED',
        'HIGH',
        'Human review required for finding ' + f.id,
        'A material structured issue cannot safely be deterministically classified and requires human review.',
        { ...f.provenance }
      );
      // add it to array if not already added
      findings.push(hrrFinding);
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

export function refreshFindingsState(existingFindings: M2EFinding[], newFindings: M2EFinding[]): M2EFinding[] {
    const updated = [...existingFindings];
    const newFingerprints = new Set(newFindings.map(f => f.fingerprint));

    for (const f of updated) {
        if (!newFingerprints.has(f.fingerprint)) {
            f.isStale = true;
            if (f.state === 'OPEN' || f.state === 'UNDER_REVIEW') {
                f.state = 'SUPERSEDED';
            }
        } else {
            f.isStale = false;
        }
    }

    const existingFingerprints = new Set(updated.map(f => f.fingerprint));
    for (const nf of newFindings) {
        if (!existingFingerprints.has(nf.fingerprint)) {
            updated.push(nf);
        }
    }
    return updated;
}

export function applyReviewLifecycle(finding: M2EFinding, newState: FindingState): M2EFinding {
    if (finding.state === 'SUPERSEDED') {
        throw new Error('Cannot change state of a superseded finding');
    }
    if (newState === 'OPEN' || newState === 'UNDER_REVIEW' || newState === 'RESOLVED' || newState === 'DISMISSED') {
        return { ...finding, state: newState, updatedAt: new Date().toISOString() };
    }
    throw new Error('Invalid state transition');
}

export function generateSnapshot(matterId: string, ctx: M2EContext, findings: M2EFinding[]): CaseIntelligenceSnapshot {
  const foreignInputs = [
      ...ctx.claims.filter(c => c.matterId !== matterId),
      ...ctx.attributions.filter(a => a.matterId !== matterId),
      ...ctx.relationships.filter(r => r.matterId !== matterId)
  ];
  if (foreignInputs.length > 0) {
      throw new Error("Snapshot rejects foreign-matter objects");
  }

  const matterFindings = findings.filter(f => f.matterId === matterId);

  const counts = {
    totalClaims: ctx.claims.length,
    claimsByClassification: {} as Record<string, number>,
    unresolvedAttribution: matterFindings.filter(f => f.category === 'ATTRIBUTION_GAP' && f.state === 'OPEN').length,
    corroborationRelationships: ctx.relationships.filter(r => ['INDEPENDENT_SUPPORT', 'DEPENDENT_SUPPORT', 'CONSISTENT_WITH'].includes(r.relationshipType)).length,
    contradictionRelationships: ctx.relationships.filter(r => ['DIRECT_CONTRADICTION', 'POTENTIAL_CONTRADICTION'].includes(r.relationshipType) || r.relationshipType.endsWith('_INCONSISTENCY')).length,
    openEvidenceGapsByCategory: {} as Record<FindingCategory, number>,
    unansweredQuestions: matterFindings.filter(f => f.category === 'UNANSWERED_QUESTION' && f.state === 'OPEN').length,
    humanReviewRequired: matterFindings.filter(f => f.category === 'HUMAN_REVIEW_REQUIRED' && f.state === 'OPEN').length,
    staleIntelligence: matterFindings.filter(f => f.isStale).length,
    unresolvedUnknownDate: matterFindings.filter(f => f.category === 'DATE_GAP' && f.state === 'OPEN').length
  };

  for (const c of FINDING_CATEGORIES) {
    counts.openEvidenceGapsByCategory[c] = matterFindings.filter(f => f.category === c && f.state === 'OPEN').length;
  }

  const sortedClaims = [...ctx.claims].sort((a, b) => a.id.localeCompare(b.id));

  for (const claim of sortedClaims) {
    counts.claimsByClassification[claim.classification] = (counts.claimsByClassification[claim.classification] || 0) + 1;
  }

  return {
    matterId,
    timestamp: new Date().toISOString(),
    counts
  };
}
