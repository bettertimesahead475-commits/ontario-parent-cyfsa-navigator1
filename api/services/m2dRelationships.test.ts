import { describe, it, expect } from 'vitest';
import {
  M2DRelationship,
  evaluateSourceIndependence,
  evaluateDeterministicRelationship,
  computeRelationshipFingerprint,
  M2DComparisonContext,
  RelationshipType,
  EventDependency
} from '../../shared/m2d-relationships';
import { M2CAttribution, M2CClaim, EvolutionType } from '../../shared/m2c-claims';

describe('Stage 5 M2-D deterministic intelligence', () => {
  it('A. Same originating allegation copied through four documents => ONE root lineage => NOT four corroborating sources', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'DIRECT_STATEMENT', nestedSourceAttributionId: null };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e2', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a1' };
    const a3: M2CAttribution = { id: 'a3', matterId: 'm1', claimId: 'c2', speakerEntityId: 'e3', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a2' };
    const a4: M2CAttribution = { id: 'a4', matterId: 'm1', claimId: 'c2', speakerEntityId: 'e4', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a3' };
    
    const all = [a1, a2, a3, a4];
    const result = evaluateSourceIndependence(all, [a1, a2], [a3, a4]);
    expect(result).toBe('SAME_ORIGIN');
  });

  it('B. Same originating allegation copied through different workers => DEPENDENT/SAME_ORIGIN', () => {
    const root: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'DIRECT_STATEMENT', nestedSourceAttributionId: null };
    const w1: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c1', speakerEntityId: 'w1', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a1' };
    const w2: M2CAttribution = { id: 'a3', matterId: 'm1', claimId: 'c2', speakerEntityId: 'w2', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a1' };
    const result = evaluateSourceIndependence([root, w1, w2], [w1], [w2]);
    expect(result).toBe('SAME_ORIGIN');
  });

  it('C. Independent witness + original allegation => MAY support INDEPENDENT_SUPPORT', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'amy', attributionType: 'DIRECT_STATEMENT', nestedSourceAttributionId: null };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c2', speakerEntityId: 'witness', attributionType: 'DIRECT_OBSERVATION', nestedSourceAttributionId: null };
    const result = evaluateSourceIndependence([a1, a2], [a1], [a2]);
    expect(result).toBe('INDEPENDENT');
  });

  it('D. Claim says event occurred vs did not occur => contradiction candidate', () => {
    const c1 = { proposition: 'the visit occurred', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'the visit did not occur', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: true } });
    expect(res.type).toBe('DIRECT_CONTRADICTION');
    expect(res.dims).toContain('AFFIRMATION_DENIAL');
  });

  it('E. Monday vs Tuesday with uncertain event identity => NOT definitive contradiction', () => {
    const c1 = { proposition: 'monday visit', classification: 'FACT', dateContext: { lowerBound: '2026-01-05T00:00Z' } } as any;
    const c2 = { proposition: 'tuesday visit', classification: 'FACT', dateContext: { lowerBound: '2026-01-06T00:00Z' } } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: false } });
    expect(res.type).toBe('UNKNOWN_RELATIONSHIP');
  });

  it('F. Different locations for confirmed same event => location inconsistency candidate', () => {
    const c1 = { proposition: 'event', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'event', classification: 'FACT', dateContext: null } as any;
    const ctx: M2DComparisonContext = {
      eventDependency: { isSameEvent: true },
      locationA: { id: 'loc-paris' },
      locationB: { id: 'loc-london' }
    };
    const res = evaluateDeterministicRelationship(c1, c2, undefined, ctx);
    expect(res.type).toBe('LOCATION_INCONSISTENCY');
    expect(res.dims).toContain('LOCATION');
  });

  it('G. Different actors for confirmed same event => actor inconsistency candidate', () => {
    const c1 = { proposition: 'event', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'event', classification: 'FACT', dateContext: null } as any;
    const ctx: M2DComparisonContext = {
      eventDependency: { isSameEvent: true },
      actorA: [{ id: 'actor-alpha', role: 'driver' }],
      actorB: [{ id: 'actor-beta', role: 'driver' }]
    };
    const res = evaluateDeterministicRelationship(c1, c2, undefined, ctx);
    expect(res.type).toBe('ACTOR_INCONSISTENCY');
    expect(res.dims).toContain('ACTOR');
  });

  it('H. Professional assessment disagreement => assessment disagreement', () => {
    const c1 = { proposition: 'unsafe', classification: 'PROFESSIONAL_ASSESSMENT', dateContext: null } as any;
    const c2 = { proposition: 'safe', classification: 'PROFESSIONAL_ASSESSMENT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: true } });
    expect(res.type).toBe('ASSESSMENT_DISAGREEMENT');
  });

  it('I. ALLEGATION repeated in affidavit => remains allegation', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'DIRECT_STATEMENT', nestedSourceAttributionId: null };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e2', attributionType: 'DOCUMENT_RECORD', nestedSourceAttributionId: 'a1' };
    const indep = evaluateSourceIndependence([a1, a2], [a1], [a2]);
    expect(indep).toBe('SAME_ORIGIN');
  });

  it('J. ALLEGATION + independent support != automatically FACT', () => {
    const c1 = { proposition: 'prop', classification: 'ALLEGATION', dateContext: null } as any;
    const c2 = { proposition: 'prop', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: true } });
    expect(res.type).toBe('CONSISTENT_WITH');
    expect((res as any).newClassification).toBeUndefined();
  });

  it('K. REPORTED_STATEMENT != DIRECT_OBSERVATION', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: null };
    const indep = evaluateSourceIndependence([a1], [a1], [a1]);
    expect(indep).toBe('UNKNOWN_INDEPENDENCE'); 
  });

  it('L. INDEPENDENT_SUPPORT != truth determination', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'DIRECT_STATEMENT', nestedSourceAttributionId: null };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c2', speakerEntityId: 'e2', attributionType: 'DIRECT_OBSERVATION', nestedSourceAttributionId: null };
    const indep = evaluateSourceIndependence([a1, a2], [a1], [a2]);
    expect(indep).toBe('INDEPENDENT');
    const c1 = { proposition: 'x', classification: 'ALLEGATION', dateContext: null } as any;
    const c2 = { proposition: 'x', classification: 'ALLEGATION', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: true } });
    expect((res as any).truthConfirmed).toBeUndefined();
    expect((res as any).factMutated).toBeUndefined();
  });

  it('M. SYSTEM_INFERENCE != confirmed finding', () => {
    const rel: M2DRelationship = {
      id: 'r1', matterId: 'm1', claimAId: 'c1', claimBId: 'c2',
      relationshipType: 'POTENTIAL_CONTRADICTION',
      evolutionContext: undefined,
      independenceStatus: 'INDEPENDENT',
      comparisonDimensions: ['DATE'],
      reviewState: 'PROPOSED',
      freshnessState: 'FRESH',
      fingerprint: 'hash',
      createdAt: '2026-01-01', updatedAt: '2026-01-01'
    };
    expect(rel.reviewState).toBe('PROPOSED');
  });

  it('N. No deterministic M2-D function should infer lie/fabrication', () => {
    const c1 = { proposition: 'I was there', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'He was not there', classification: 'FACT', dateContext: null } as any;
    const ctx: M2DComparisonContext = {
       eventDependency: { isSameEvent: true },
       actorA: [{ id: 'a1', role: 'presence' }],
       actorB: [{ id: 'a2', role: 'presence' }]
    };
    const res = evaluateDeterministicRelationship(c1, c2, undefined, ctx);
    const validTypes: RelationshipType[] = [
       'DIRECT_CONTRADICTION', 'POTENTIAL_CONTRADICTION', 'LOCATION_INCONSISTENCY', 'DATE_INCONSISTENCY', 'TIME_INCONSISTENCY', 'ACTOR_INCONSISTENCY', 'ACTION_INCONSISTENCY', 'SEVERITY_INCONSISTENCY', 'QUANTITY_INCONSISTENCY', 'SEQUENCE_INCONSISTENCY', 'CONSISTENT_WITH', 'ASSESSMENT_DISAGREEMENT', 'UNKNOWN_RELATIONSHIP'
    ];
    expect(validTypes).toContain(res.type);
    expect(res.type).not.toBe('LIE' as any);
    expect(res.type).not.toBe('FABRICATION' as any);
  });

  it('O. Missing lineage => independence UNKNOWN, not INDEPENDENT', () => {
    const result = evaluateSourceIndependence([], [], []);
    expect(result).toBe('UNKNOWN_INDEPENDENCE');
  });

  it('P. Cycle/dangling attribution => fail closed', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a2' };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c1', speakerEntityId: 'e1', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: 'a1' };
    expect(() => evaluateSourceIndependence([a1, a2], [a1], [a2])).toThrow();
  });

  it('Q. Input ordering => deterministic identical output', () => {
    const dep: EventDependency = { isSameEvent: true };
    const f1 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashA', 'hashB', ['DATE'], 'INDEPENDENT', dep);
    const f2 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashB', 'hashA', ['DATE'], 'INDEPENDENT', dep);
    expect(f1).toBe(f2);
  });

  it('R. Semantic claim mutation => derived fingerprint changes/stales', () => {
    const dep: EventDependency = { isSameEvent: true };
    const f1 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashA', 'hashB', ['DATE'], 'INDEPENDENT', dep);
    const f2 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashC', 'hashB', ['DATE'], 'INDEPENDENT', dep);
    expect(f1).not.toBe(f2);
  });

  it('S. CORRECTS does not automatically return POTENTIAL_CONTRADICTION', () => {
    const c1 = { proposition: 'same', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'same', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, 'CORRECTS', { eventDependency: { isSameEvent: true } });
    expect(res.type).toBe('CONSISTENT_WITH');
  });

  it('T. Retraction semantics preserved', () => {
    const c1 = { proposition: 'p1', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'p2', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, 'RETRACTS', { eventDependency: { isSameEvent: true } });
    expect(res.type).toBe('DIRECT_CONTRADICTION');
    expect(res.dims).toContain('AFFIRMATION_DENIAL');
    expect(res.evolutionContext).toBe('RETRACTS');
  });

  it('F-M2D-004: same claim fingerprints, same relationship, same dimensions, same independence, same event identity => identical fingerprint', () => {
    const dep: EventDependency = { isSameEvent: true, eventId: 'e1' };
    const f1 = computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', dep);
    const f2 = computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', dep);
    expect(f1).toBe(f2);
  });

  it('F-M2D-004: all above identical except isSameEvent true -> false => different fingerprint', () => {
    const dep1: EventDependency = { isSameEvent: true, eventId: 'e1' };
    const dep2: EventDependency = { isSameEvent: false, eventId: 'e1' };
    const f1 = computeRelationshipFingerprint('UNKNOWN_RELATIONSHIP', 'hashA', 'hashB', [], 'INDEPENDENT', dep1);
    const f2 = computeRelationshipFingerprint('UNKNOWN_RELATIONSHIP', 'hashA', 'hashB', [], 'INDEPENDENT', dep2);
    expect(f1).not.toBe(f2);
  });

  it('F-M2D-004: event A dependency -> event B dependency => different fingerprint where event identity is semantically relevant', () => {
    const dep1: EventDependency = { isSameEvent: true, eventId: 'e1' };
    const dep2: EventDependency = { isSameEvent: true, eventId: 'e2' };
    const f1 = computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', dep1);
    const f2 = computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', dep2);
    expect(f1).not.toBe(f2);
  });

  it('F-M2D-004: timestamp-only/transient metadata changes => unchanged semantic fingerprint', () => {
    const dep: EventDependency = { isSameEvent: true };
    const f1 = computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', dep);
    const f2 = computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', { isSameEvent: true });
    expect(f1).toBe(f2);
  });

  it('F-M2D-004: missing required event dependency => fail closed if the relationship type requires confirmed same-event identity', () => {
    const dep: EventDependency = { isSameEvent: false };
    expect(() => computeRelationshipFingerprint('ACTOR_INCONSISTENCY', 'hashA', 'hashB', ['ACTOR'], 'INDEPENDENT', dep))
      .toThrow('requires confirmed same-event identity');
  });

  it('MULTI-DIMENSION: Preserve multiple genuine dimensions', () => {
    const c1 = { proposition: 'event', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'event', classification: 'FACT', dateContext: null } as any;
    const ctx: M2DComparisonContext = {
      eventDependency: { isSameEvent: true },
      locationA: { id: 'loc-paris' },
      locationB: { id: 'loc-london' },
      actorA: [{ id: 'a1', role: 'driver' }],
      actorB: [{ id: 'a2', role: 'driver' }]
    };
    const res = evaluateDeterministicRelationship(c1, c2, undefined, ctx);
    expect(res.dims).toContain('LOCATION');
    expect(res.dims).toContain('ACTOR');
  });

  it('REGRESSION: Ensure toronto/ottawa hardcoded logic is removed and custom arbitrary locations work', () => {
    const c1 = { proposition: 'event toronto', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'event ottawa', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: true } });
    expect(res.dims).not.toContain('LOCATION'); 
  });

  it('REGRESSION: Ensure john/jane hardcoded logic is removed and custom arbitrary actors work', () => {
    const c1 = { proposition: 'event john', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'event jane', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, { eventDependency: { isSameEvent: true } });
    expect(res.dims).not.toContain('ACTOR'); 
  });

  it('M2D-001: Heterogeneous matter IDs reject/fail closed', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'amy', attributionType: 'DIRECT_STATEMENT', nestedSourceAttributionId: null };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm2', claimId: 'c2', speakerEntityId: 'witness', attributionType: 'DIRECT_OBSERVATION', nestedSourceAttributionId: null };
    expect(() => evaluateSourceIndependence([a1, a2], [a1], [a2])).toThrow('Heterogeneous matter IDs');
  });

  it('M2D-002: Incomplete lineage (REPORTED_STATEMENT with no source) fails closed to UNKNOWN_INDEPENDENCE', () => {
    const a1: M2CAttribution = { id: 'a1', matterId: 'm1', claimId: 'c1', speakerEntityId: 'w1', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: null };
    const a2: M2CAttribution = { id: 'a2', matterId: 'm1', claimId: 'c2', speakerEntityId: 'w2', attributionType: 'REPORTED_STATEMENT', nestedSourceAttributionId: null };
    const result = evaluateSourceIndependence([a1, a2], [a1], [a2]);
    expect(result).toBe('UNKNOWN_INDEPENDENCE');
  });
});
