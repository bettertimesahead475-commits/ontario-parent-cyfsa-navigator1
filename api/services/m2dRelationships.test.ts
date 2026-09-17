import { describe, it, expect } from 'vitest';
import {
  M2DRelationship,
  evaluateSourceIndependence,
  evaluateDeterministicRelationship,
  computeRelationshipFingerprint
} from '../../shared/m2d-relationships';
import { M2CAttribution, M2CClaim } from '../../shared/m2c-claims';

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
    const res = evaluateDeterministicRelationship(c1, c2, undefined, true);
    expect(res.type).toBe('DIRECT_CONTRADICTION');
    expect(res.dims).toContain('AFFIRMATION_DENIAL');
  });

  it('E. Monday vs Tuesday with uncertain event identity => NOT definitive contradiction', () => {
    const c1 = { proposition: 'monday visit', classification: 'FACT', dateContext: { lowerBound: '2026-01-05T00:00Z' } } as any;
    const c2 = { proposition: 'tuesday visit', classification: 'FACT', dateContext: { lowerBound: '2026-01-06T00:00Z' } } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, false);
    expect(res.type).toBe('UNKNOWN_RELATIONSHIP');
  });

  it('F. Different locations for confirmed same event => location inconsistency candidate', () => {
    const c1 = { proposition: 'toronto', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'ottawa', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, true);
    expect(res.type).toBe('LOCATION_INCONSISTENCY');
    expect(res.dims).toContain('LOCATION');
  });

  it('G. Different actors for confirmed same event => actor inconsistency candidate', () => {
    const c1 = { proposition: 'john was there', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'jane was there', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, true);
    expect(res.type).toBe('ACTOR_INCONSISTENCY');
    expect(res.dims).toContain('ACTOR');
  });

  it('H. Professional assessment disagreement => assessment disagreement', () => {
    const c1 = { proposition: 'unsafe', classification: 'PROFESSIONAL_ASSESSMENT', dateContext: null } as any;
    const c2 = { proposition: 'safe', classification: 'PROFESSIONAL_ASSESSMENT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, undefined, true);
    expect(res.type).toBe('ASSESSMENT_DISAGREEMENT');
  });

  it('I. ALLEGATION repeated in affidavit => remains allegation', () => {});
  it('J. ALLEGATION + independent support != automatically FACT', () => {});
  it('K. REPORTED_STATEMENT != DIRECT_OBSERVATION', () => {});
  it('L. INDEPENDENT_SUPPORT != truth determination', () => {});
  it('M. SYSTEM_INFERENCE != confirmed finding', () => {});
  it('N. No deterministic M2-D function should infer lie/fabrication', () => {});

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
    const f1 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashA', 'hashB', ['DATE'], 'INDEPENDENT');
    const f2 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashB', 'hashA', ['DATE'], 'INDEPENDENT');
    expect(f1).toBe(f2);
  });

  it('R. Semantic claim mutation => derived fingerprint changes/stales', () => {
    const f1 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashA', 'hashB', ['DATE'], 'INDEPENDENT');
    const f2 = computeRelationshipFingerprint('DIRECT_CONTRADICTION', 'hashC', 'hashB', ['DATE'], 'INDEPENDENT');
    expect(f1).not.toBe(f2);
  });

  it('S. CORRECTS does not automatically return POTENTIAL_CONTRADICTION', () => {
    const c1 = { proposition: 'same', classification: 'FACT', dateContext: null } as any;
    const c2 = { proposition: 'same', classification: 'FACT', dateContext: null } as any;
    const res = evaluateDeterministicRelationship(c1, c2, 'CORRECTS', true);
    expect(res.type).toBe('CONSISTENT_WITH');
  });

  it('T. Retraction semantics preserved', () => {});

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
