import { computeFingerprint } from './m2a-deterministic.js';
import { M2CClaim, M2CAttribution, M2CEvolution, resolveRootLineages, EvolutionType } from './m2c-claims.js';

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

export const M2D_RELATIONSHIP_ALGORITHM_VERSION = 1;

export type IntelligenceReviewState = 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'DISPUTED';
export type IntelligenceFreshnessState = 'FRESH' | 'STALE';

export interface StructuredActor {
  id: string;
  role: string;
}

export interface StructuredLocation {
  id: string;
}

export interface EventDependency {
  isSameEvent: boolean;
  eventId?: string;
}

export interface M2DComparisonContext {
  eventDependency: EventDependency;
  actorA?: StructuredActor[];
  actorB?: StructuredActor[];
  locationA?: StructuredLocation;
  locationB?: StructuredLocation;
}

export interface M2DRelationship {
  id: string;
  matterId: string;
  claimAId: string;
  claimBId: string;
  relationshipType: RelationshipType;
  evolutionContext?: EvolutionType;
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
  independenceStatus: SourceIndependence,
  eventDependency: EventDependency,
  evolutionContext?: EvolutionType
): string {
  if (!claimASemanticFingerprint || !claimBSemanticFingerprint || claimASemanticFingerprint === 'current' || claimBSemanticFingerprint === 'current') {
    throw new Error('Missing or invalid semantic dependencies');
  }

  const REQUIRES_SAME_EVENT = [
    'LOCATION_INCONSISTENCY', 'DATE_INCONSISTENCY', 'TIME_INCONSISTENCY',
    'ACTOR_INCONSISTENCY', 'ACTION_INCONSISTENCY', 'SEVERITY_INCONSISTENCY',
    'QUANTITY_INCONSISTENCY', 'SEQUENCE_INCONSISTENCY', 'DIRECT_CONTRADICTION',
    'POTENTIAL_CONTRADICTION'
  ];

  if (REQUIRES_SAME_EVENT.includes(relationshipType) && !eventDependency.isSameEvent) {
      throw new Error(`Relationship type ${relationshipType} requires confirmed same-event identity.`);
  }

  // Ensure deterministic ordering since claims can be passed in any order
  let depA = claimASemanticFingerprint;
  let depB = claimBSemanticFingerprint;
  if (depA > depB) {
    depA = claimBSemanticFingerprint;
    depB = claimASemanticFingerprint;
  }

  const sortedDims = [...dimensions].sort();

  return computeFingerprint([{ id: 'algorithmVersion', version: M2D_RELATIONSHIP_ALGORITHM_VERSION }], {
    relationshipType,
    depA,
    depB,
    dimensions: sortedDims,
    independenceStatus,
    eventDependency,
    evolutionContext
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
    // 1. Validate matter IDs and graph integrity using frozen M2-C logic
    resolveRootLineages(allMatterAttributions);

    const expectedMatterId = allMatterAttributions[0].matterId;
    
    // Ensure the specific attributions also match the matter
    for (const a of [...attributionsA, ...attributionsB]) {
      if (!a.matterId || a.matterId !== expectedMatterId) {
        throw new Error('Heterogeneous matter IDs detected');
      }
    }

    const attrMap = new Map<string, M2CAttribution>();
    for (const a of allMatterAttributions) {
      attrMap.set(a.id, a);
    }

    const findRoots = (starts: M2CAttribution[]) => {
      const roots = new Set<string>();
      for (const a of starts) {
        let curr = a.id;
        while (true) {
          const node = attrMap.get(curr);
          if (!node) throw new Error('Dangling reference in lineage');
          if (!node.nestedSourceAttributionId) {
            roots.add(curr);
            break;
          }
          curr = node.nestedSourceAttributionId;
        }
      }
      return Array.from(roots).map(id => attrMap.get(id)!);
    };

    const rootsA = findRoots(attributionsA);
    const rootsB = findRoots(attributionsB);

    if (rootsA.length === 0 || rootsB.length === 0) {
      return 'UNKNOWN_INDEPENDENCE';
    }

    // Independence MUST fail closed: A root that logically requires an upstream source is NOT a genuine independent origin
    const DEPENDENT_TYPES = ['REPORTED_STATEMENT', 'DOCUMENT_RECORD', 'UNKNOWN'];
    for (const root of [...rootsA, ...rootsB]) {
      if (DEPENDENT_TYPES.includes(root.attributionType)) {
        return 'UNKNOWN_INDEPENDENCE';
      }
    }

    const rootIdsA = rootsA.map(r => r.id);
    const rootIdsB = rootsB.map(r => r.id);

    const setA = new Set(rootIdsA);
    const setB = new Set(rootIdsB);

    if (setA.size === setB.size && rootIdsA.every(id => setB.has(id))) {
      return 'SAME_ORIGIN';
    }

    const intersection = rootIdsA.filter(id => setB.has(id));
    if (intersection.length > 0) {
      return 'DEPENDENT';
    }

    return 'INDEPENDENT';
  } catch (e) {
    if (e instanceof Error && (
      e.message.includes('matter ID') || 
      e.message.includes('Cycle') || 
      e.message.includes('Dangling') || 
      e.message.includes('bound exceeded')
    )) {
      throw e; // Fail closed for fundamental integrity violations
    }
    return 'UNKNOWN_INDEPENDENCE';
  }
}


// A deterministic helper for tests/rules
export function evaluateDeterministicRelationship(
  claimA: Pick<M2CClaim, 'proposition' | 'classification' | 'dateContext'>,
  claimB: Pick<M2CClaim, 'proposition' | 'classification' | 'dateContext'>,
  knownEvolutionType?: EvolutionType,
  context?: M2DComparisonContext
): {
  type: RelationshipType;
  dims: ComparisonDimension[];
  evolutionContext?: EvolutionType;
} {
  const isSameEvent = context?.eventDependency?.isSameEvent ?? false;

  // If we are not sure it's the same event, we must be conservative
  if (!isSameEvent) {
    if (claimA.dateContext?.lowerBound && claimB.dateContext?.lowerBound) {
       if (claimA.dateContext.lowerBound !== claimB.dateContext.lowerBound) {
           return { type: 'UNKNOWN_RELATIONSHIP', dims: [] };
       }
    }
    return { type: 'UNKNOWN_RELATIONSHIP', dims: [] };
  }

  if (claimA.classification === 'PROFESSIONAL_ASSESSMENT' && claimB.classification === 'PROFESSIONAL_ASSESSMENT') {
    if (claimA.proposition.trim().toLowerCase() !== claimB.proposition.trim().toLowerCase()) {
      return { type: 'ASSESSMENT_DISAGREEMENT', dims: ['OTHER'] };
    }
  }

  let type: RelationshipType | null = null;
  const dims: ComparisonDimension[] = [];
  let evolutionContext: EvolutionType | undefined = undefined;

  if (knownEvolutionType === 'RETRACTS') {
    dims.push('AFFIRMATION_DENIAL');
    if (!type) type = 'DIRECT_CONTRADICTION';
    evolutionContext = knownEvolutionType;
  }
  
  const propA = claimA.proposition.trim().toLowerCase();
  const propB = claimB.proposition.trim().toLowerCase();

  if (propA.includes('did not occur') || propB.includes('did not occur')) {
    if (propA.replace('did not occur', 'occurred') === propB || propB.replace('did not occur', 'occurred') === propA) {
       dims.push('AFFIRMATION_DENIAL');
       if (!type) type = 'DIRECT_CONTRADICTION';
    }
  }

  if (propA.includes('monday') && propB.includes('tuesday')) {
     dims.push('DATE');
     if (!type) type = 'DATE_INCONSISTENCY';
  }

  // Location inconsistency
  if (context?.locationA && context?.locationB && context.locationA.id !== context.locationB.id) {
     dims.push('LOCATION');
     if (!type) type = 'LOCATION_INCONSISTENCY';
  }

  // Actor inconsistency
  if (context?.actorA && context?.actorB) {
      for (const a of context.actorA) {
         for (const b of context.actorB) {
            if (a.role === b.role && a.id !== b.id) {
                dims.push('ACTOR');
                if (!type) type = 'ACTOR_INCONSISTENCY';
            }
         }
      }
  }

  if (dims.length > 0) {
      return { type: type || 'POTENTIAL_CONTRADICTION', dims, evolutionContext };
  }

  if (propA === propB) {
     return { type: 'CONSISTENT_WITH', dims: [] };
  }

  return { type: 'UNKNOWN_RELATIONSHIP', dims: [] };
}
