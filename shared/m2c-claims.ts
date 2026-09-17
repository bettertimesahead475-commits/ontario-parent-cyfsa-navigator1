import { computeFingerprint, StructuredDate } from './m2a-deterministic.js';

export const CLAIM_CLASSIFICATIONS = [
  'FACT',
  'ALLEGATION',
  'OPINION',
  'PROFESSIONAL_ASSESSMENT',
  'INFERENCE',
  'UNVERIFIED_CLAIM',
  'UNKNOWN'
] as const;
export type ClaimClassification = typeof CLAIM_CLASSIFICATIONS[number];

export const ATTRIBUTION_TYPES = [
  'DIRECT_STATEMENT',
  'DIRECT_OBSERVATION',
  'REPORTED_STATEMENT',
  'DOCUMENT_RECORD',
  'PROFESSIONAL_ASSESSMENT',
  'AUTHOR_INFERENCE',
  'SYSTEM_INFERENCE',
  'UNKNOWN'
] as const;
export type AttributionType = typeof ATTRIBUTION_TYPES[number];

export const EVOLUTION_TYPES = [
  'REPEATS',
  'EXPANDS',
  'NARROWS',
  'CHANGES_DATE',
  'CHANGES_LOCATION',
  'CHANGES_ACTOR',
  'CHANGES_ACTION',
  'CHANGES_SEVERITY',
  'RETRACTS',
  'DENIES',
  'DISPUTES',
  'CORRECTS',
  'INDETERMINATE'
] as const;
export type EvolutionType = typeof EVOLUTION_TYPES[number];

export type IntelligenceReviewState = 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'DISPUTED';
export type IntelligenceFreshnessState = 'FRESH' | 'STALE';

export interface M2CClaim {
  id: string;
  matterId: string;
  proposition: string;
  classification: ClaimClassification;
  dateContext: StructuredDate | null;
  reviewState: IntelligenceReviewState;
  freshnessState: IntelligenceFreshnessState;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface M2CAttribution {
  id: string;
  matterId: string;
  claimId: string;
  speakerEntityId: string | null;
  attributionType: AttributionType;
  // For nested attribution chains: the id of the attribution this derives from
  nestedSourceAttributionId: string | null; 
}

export interface M2CEvolution {
  id: string;
  sourceClaimId: string;
  targetClaimId: string;
  evolutionType: EvolutionType;
  reviewState: IntelligenceReviewState;
  freshnessState: IntelligenceFreshnessState;
  fingerprint: string;
}

export function validateClaimClassification(type: string): void {
  if (!CLAIM_CLASSIFICATIONS.includes(type as ClaimClassification)) {
    throw new Error('Invalid claim classification: ' + type);
  }
}

export function validateAttributionType(type: string): void {
  if (!ATTRIBUTION_TYPES.includes(type as AttributionType)) {
    throw new Error('Invalid attribution type: ' + type);
  }
}

export function validateEvolutionType(type: string): void {
  if (!EVOLUTION_TYPES.includes(type as EvolutionType)) {
    throw new Error('Invalid evolution type: ' + type);
  }
}

export function computeClaimFingerprint(claim: Pick<M2CClaim, 'proposition' | 'classification' | 'dateContext'>): string {
  // Fingerprinting must not depend on insertion order, created_at, updated_at, or random IDs.
  // We use the normalized proposition text, classification, and date.
  return computeFingerprint([], {
    proposition: claim.proposition.trim(), 
    classification: claim.classification,
    dateContext: claim.dateContext
  });
}

export function computeEvolutionFingerprint(
  evolutionType: EvolutionType,
  sourceSemanticFingerprint: string,
  targetSemanticFingerprint: string
): string {
  if (!sourceSemanticFingerprint || !targetSemanticFingerprint || sourceSemanticFingerprint === 'current' || targetSemanticFingerprint === 'current') {
    throw new Error('Missing or invalid semantic dependencies');
  }

  // Ensure order independence for symmetric relationships like REPEATS or INDETERMINATE
  const isSymmetric = evolutionType === 'REPEATS' || evolutionType === 'INDETERMINATE';
  let dep1 = sourceSemanticFingerprint;
  let dep2 = targetSemanticFingerprint;

  if (isSymmetric && dep1 > dep2) {
    dep1 = targetSemanticFingerprint;
    dep2 = sourceSemanticFingerprint;
  }

  return computeFingerprint(
    [], 
    { evolutionType, source: dep1, target: dep2 }
  );
}

export function determineEvolutionRelationship(sourceProposition: string, targetProposition: string): EvolutionType {
  // 17. unsafe/ambiguous comparison returns INDETERMINATE
  // 19. input ordering does not change semantic fingerprint
  // 20. semantic change changes fingerprint
  
  const src = sourceProposition.trim().toLowerCase();
  const tgt = targetProposition.trim().toLowerCase();
  if (src === tgt) {
    return 'REPEATS'; // 10. repeated allegation can be classified REPEATS
  }
  
  // Real determinism requires NLP or LLMs, but this deterministic function 
  // is just a baseline for exact matches or explicitly requested logic from the prompt.
  // We'll leave heuristics simple and return INDETERMINATE if we can't safely tell.
  return 'INDETERMINATE';
}

export function resolveRootLineages(attributions: M2CAttribution[]): M2CAttribution[] {
  if (attributions.length === 0) return [];
  
  const expectedMatterId = attributions[0].matterId;
  if (!expectedMatterId || expectedMatterId.trim() === '') {
    throw new Error('Missing or empty matterId');
  }

  const attrMap = new Map<string, M2CAttribution>();
  for (const a of attributions) {
    if (!a.matterId || a.matterId.trim() === '') {
      throw new Error('Missing or empty matterId');
    }
    if (a.matterId !== expectedMatterId) {
      throw new Error('Heterogeneous matter IDs detected');
    }
    attrMap.set(a.id, a);
  }

  const roots = new Set<string>();

  for (const a of attributions) {
    let currentId = a.id;
    const seen = new Set<string>();
    let depth = 0;

    while (true) {
      if (depth > 100) {
        throw new Error('Lineage traversal bound exceeded');
      }
      if (seen.has(currentId)) {
        throw new Error('Cycle detected in lineage');
      }
      seen.add(currentId);

      const currentAttr = attrMap.get(currentId);
      if (!currentAttr) {
        throw new Error('Dangling reference in lineage');
      }

      if (currentAttr.matterId !== expectedMatterId) {
        throw new Error('Heterogeneous matter IDs detected');
      }

      if (!currentAttr.nestedSourceAttributionId) {
        roots.add(currentId);
        break;
      }

      currentId = currentAttr.nestedSourceAttributionId;
      depth++;
    }
  }

  const result = Array.from(roots).map(id => attrMap.get(id)!);
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
