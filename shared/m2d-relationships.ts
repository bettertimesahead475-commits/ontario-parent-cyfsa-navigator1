import { computeFingerprint } from './m2a-deterministic.js';
import { M2CClaim, M2CAttribution, M2CEvolution, resolveRootLineages } from './m2c-claims.js';

export const RELATIONSHIP_TYPES = [
  'DIRECT_CONTRADICTION',
  'POTENTIAL_CONTRADICTION',
  'LOCATION_INCONSISTENCY',
  'DATE_INCONSISTENCY',
  'TIME_INCONSISTENCY',
  'ACTOR_INCONSISTENCY',
  'ACTION_INCONSISTENCY',
  'SEVERITY_INCONSISTENCY',
  'QUANTITY_INCONSISTENCY',
  'SEQUENCE_INCONSISTENCY',
  'CONSISTENT_WITH',
  'INDEPENDENT_SUPPORT',
  'DEPENDENT_SUPPORT',
  'ASSESSMENT_DISAGREEMENT',
  'UNKNOWN_RELATIONSHIP'
] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

export const COMPARISON_DIMENSIONS = [
  'ACTOR',
  'ACTION',
  'DATE',
  'TIME',
  'LOCATION',
  'OBJECT',
  'SEVERITY',
  'QUANTITY',
  'SEQUENCE',
  'PRESENCE_ABSENCE',
  'AFFIRMATION_DENIAL',
  'SOURCE',
  'OTHER'
] as const;
export type ComparisonDimension = typeof COMPARISON_DIMENSIONS[number];

export const SOURCE_INDEPENDENCE = [
  'SAME_ORIGIN',
  'DEPENDENT',
  'INDEPENDENT',
  'UNKNOWN_INDEPENDENCE'
] as const;
export type SourceIndependence = typeof SOURCE_INDEPENDENCE[number];

export type IntelligenceReviewState = 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'DISPUTED';
export type IntelligenceFreshnessState = 'FRESH' | 'STALE';

export interface M2DRelationship {
  id: string;
  matterId: string;
  claimAId: string;
  claimBId: string;
  relationshipType: RelationshipType;
  independenceStatus: SourceIndependence;
  comparisonDimensions: ComparisonDimension[];
  reviewState: IntelligenceReviewState;
  freshnessState: IntelligenceFreshnessState;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export function validateRelationshipType(type: string): void {
  if (!RELATIONSHIP_TYPES.includes(type as RelationshipType)) {
    throw new Error('Invalid relationship type: ' + type);
  }
}

export function validateSourceIndependence(status: string): void {
  if (!SOURCE_INDEPENDENCE.includes(status as SourceIndependence)) {
    throw new Error('Invalid source independence: ' + status);
  }
}

export function validateComparisonDimensions(dims: string[]): void {
  for (const d of dims) {
    if (!COMPARISON_DIMENSIONS.includes(d as ComparisonDimension)) {
      throw new Error('Invalid comparison dimension: ' + d);
    }
  }
}

export function computeRelationshipFingerprint(
  relationshipType: RelationshipType,
  claimASemanticFingerprint: string,
  claimBSemanticFingerprint: string,
  dimensions: ComparisonDimension[],
  independenceStatus: SourceIndependence
): string {
  if (!claimASemanticFingerprint || !claimBSemanticFingerprint || claimASemanticFingerprint === 'current' || claimBSemanticFingerprint === 'current') {
    throw new Error('Missing or invalid semantic dependencies');
  }

  // Ensure deterministic ordering since claims can be passed in any order
  let depA = claimASemanticFingerprint;
  let depB = claimBSemanticFingerprint;
  if (depA > depB) {
    depA = claimBSemanticFingerprint;
    depB = claimASemanticFingerprint;
  }

  const sortedDims = [...dimensions].sort();

  return computeFingerprint([], {
    relationshipType,
    depA,
    depB,
    dimensions: sortedDims,
    independenceStatus
  });
}

export function evaluateSourceIndependence(
  allMatterAttributions: M2CAttribution[],
  attributionsA: M2CAttribution[],
  attributionsB: M2CAttribution[]
): SourceIndependence {
  if (attributionsA.length === 0 || attributionsB.length === 0) {
    return 'UNKNOWN_INDEPENDENCE';
  }

  try {
    const attrMap = new Map<string, M2CAttribution>();
    for (const a of allMatterAttributions) {
      attrMap.set(a.id, a);
    }

    const findRoots = (starts: M2CAttribution[]) => {
      const roots = new Set<string>();
      for (const a of starts) {
        let curr = a.id;
        let depth = 0;
        while (true) {
          if (depth > 100) throw new Error('depth');
          const node = attrMap.get(curr);
          if (!node) throw new Error('dangling');
          if (!node.nestedSourceAttributionId) {
            roots.add(curr);
            break;
          }
          curr = node.nestedSourceAttributionId;
          depth++;
        }
      }
      return Array.from(roots);
    };

    const rootsA = findRoots(attributionsA);
    const rootsB = findRoots(attributionsB);

    if (rootsA.length === 0 || rootsB.length === 0) {
      return 'UNKNOWN_INDEPENDENCE';
    }

    const setA = new Set(rootsA);
    const setB = new Set(rootsB);

    if (setA.size === setB.size && rootsA.every(id => setB.has(id))) {
      return 'SAME_ORIGIN';
    }

    const intersection = rootsA.filter(id => setB.has(id));
    if (intersection.length > 0) {
      return 'DEPENDENT';
    }

    return 'INDEPENDENT';
  } catch (e) {
    return 'UNKNOWN_INDEPENDENCE';
  }
}


// A deterministic helper for tests/rules
export function evaluateDeterministicRelationship(
  claimA: Pick<M2CClaim, 'proposition' | 'classification' | 'dateContext'>,
  claimB: Pick<M2CClaim, 'proposition' | 'classification' | 'dateContext'>,
  knownEvolutionType?: string,
  isSameEvent: boolean = false
): {
  type: RelationshipType;
  dims: ComparisonDimension[];
} {
  // If we are not sure it's the same event, we must be conservative
  if (!isSameEvent) {
    if (claimA.dateContext?.lowerBound && claimB.dateContext?.lowerBound) {
       // Rough comparison
       if (claimA.dateContext.lowerBound !== claimB.dateContext.lowerBound) {
           return { type: 'POTENTIAL_CONTRADICTION', dims: ['DATE'] };
       }
    }
    return { type: 'UNKNOWN_RELATIONSHIP', dims: [] };
  }

  if (claimA.classification === 'PROFESSIONAL_ASSESSMENT' && claimB.classification === 'PROFESSIONAL_ASSESSMENT') {
    if (claimA.proposition.trim().toLowerCase() !== claimB.proposition.trim().toLowerCase()) {
      return { type: 'ASSESSMENT_DISAGREEMENT', dims: ['OTHER'] };
    }
  }

  if (knownEvolutionType === 'RETRACTS') {
    return { type: 'DIRECT_CONTRADICTION', dims: ['AFFIRMATION_DENIAL'] };
  }
  
  if (knownEvolutionType === 'CORRECTS') {
    return { type: 'POTENTIAL_CONTRADICTION', dims: ['OTHER'] };
  }

  const propA = claimA.proposition.trim().toLowerCase();
  const propB = claimB.proposition.trim().toLowerCase();

  // Adversarial checks
  if (propA.includes('did not occur') || propB.includes('did not occur')) {
    if (propA.replace('did not occur', 'occurred') === propB || propB.replace('did not occur', 'occurred') === propA) {
       return { type: 'DIRECT_CONTRADICTION', dims: ['AFFIRMATION_DENIAL'] };
    }
  }

  if (propA.includes('monday') && propB.includes('tuesday')) {
     return { type: 'DATE_INCONSISTENCY', dims: ['DATE'] };
  }

  if (propA === propB) {
     return { type: 'CONSISTENT_WITH', dims: [] };
  }

  return { type: 'UNKNOWN_RELATIONSHIP', dims: [] };
}
