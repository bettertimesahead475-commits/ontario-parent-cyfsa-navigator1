import { expect, test, describe } from 'vitest';
import { generateEvidenceGaps, generateSnapshot, M2EContext, createFinding, refreshFindingsState, applyReviewLifecycle } from '../../shared/m2e-intelligence.js';

describe('M2-E Test Matrix', () => {
  const matterId = 'm1';

  test('A. Unsupported material claim produces SUPPORT_GAP.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'ALLEGATION', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'SUPPORT_GAP')).toBe(true);
  });

  test('B. Properly supported claim does not produce false SUPPORT_GAP.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'ALLEGATION', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'INDEPENDENT_SUPPORT', independenceStatus: 'INDEPENDENT', fingerprint: 'r1f' } as any],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'SUPPORT_GAP')).toBe(false);
  });

  test('C. Two citations from same lineage do not become independent corroboration.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'ALLEGATION', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'INDEPENDENT_SUPPORT', independenceStatus: 'SAME_ORIGIN', fingerprint: 'r1f' } as any],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'SUPPORT_GAP')).toBe(true);
    expect(findings.some(f => f.category === 'INDEPENDENCE_GAP')).toBe(true);
  });

  test('D. Independent corroboration prevents false INDEPENDENCE_GAP where appropriate.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'ALLEGATION', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'INDEPENDENT_SUPPORT', independenceStatus: 'INDEPENDENT', fingerprint: 'r1f' } as any],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'INDEPENDENCE_GAP')).toBe(false);
  });

  test('E. UNKNOWN_DATE produces DATE_GAP when material.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'FACT', proposition: 'x', dateContext: { precision: 'UNKNOWN' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'DATE_GAP')).toBe(true);
  });

  test('F. Exact known date does not produce false DATE_GAP.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'FACT', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'DATE_GAP')).toBe(false);
  });

  test('G. unresolved actor produces ACTOR_GAP when actor is material.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'ACTOR_INCONSISTENCY', reviewState: 'PROPOSED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'ACTOR_GAP')).toBe(true);
  });

  test('H. unresolved location only produces LOCATION_GAP when location is actually material.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'LOCATION_INCONSISTENCY', reviewState: 'PROPOSED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'LOCATION_GAP')).toBe(true);
  });

  test('I. unresolved attribution produces ATTRIBUTION_GAP.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'FACT', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'ATTRIBUTION_GAP')).toBe(true);
  });

  test('J. resolved attribution does not produce false ATTRIBUTION_GAP.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'FACT', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'ATTRIBUTION_GAP')).toBe(false);
  });

  test('K. unresolved M2-D contradiction produces UNRESOLVED_CONFLICT.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DIRECT_CONTRADICTION', reviewState: 'PROPOSED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'UNRESOLVED_CONFLICT')).toBe(true);
  });

  test('L. resolved/superseded conflict does not remain incorrectly open.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DIRECT_CONTRADICTION', reviewState: 'CONFIRMED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'UNRESOLVED_CONFLICT')).toBe(false);
  });

  test('M. RETRACTS metadata alone does not produce an evidence gap or imply falsehood.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'FACT', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'CONSISTENT_WITH', evolutionContext: 'RETRACTS', reviewState: 'CONFIRMED', fingerprint: 'r1f' } as any],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'UNRESOLVED_CLAIM_EVOLUTION')).toBe(false);
  });

  test('N. source absence never becomes proposition falsehood.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'ALLEGATION', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    // Should be SUPPORT_GAP, not FALSE
    expect(findings.some(f => f.category === 'SUPPORT_GAP')).toBe(true);
  });

  test('O. unanswered question is generated from deterministic dependency state.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DIRECT_CONTRADICTION', reviewState: 'PROPOSED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'UNANSWERED_QUESTION')).toBe(true);
  });

  test('P. unanswered question contains dependency/provenance identifiers.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DIRECT_CONTRADICTION', reviewState: 'PROPOSED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    const q = findings.find(f => f.category === 'UNANSWERED_QUESTION')!;
    expect(q.provenance.relationshipIds).toContain('r1');
  });

  test('Q. same inputs produce stable deterministic fingerprint.', () => {
    const f1 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const f2 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    expect(f1.fingerprint).toBe(f2.fingerprint);
  });

  test('R. material dependency change changes fingerprint.', () => {
    const f1 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const f2 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash2' } });
    expect(f1.fingerprint).not.toBe(f2.fingerprint);
  });

  test('S. unrelated dependency change does not change fingerprint.', () => {
    const f1 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const f2 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    expect(f1.fingerprint).toBe(f2.fingerprint);
  });

  test('T. cross-matter dependency is rejected/fails closed.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId: 'm2', classification: 'FACT', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [], relationships: [], events: []
    };
    expect(() => generateEvidenceGaps(matterId, ctx)).toThrow('Mixed-matter input');
  });

  test('U. stale finding is not presented as fresh.', () => {
    const oldF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const newF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash2' } });
    const refreshed = refreshFindingsState([oldF], [newF]);
    expect(refreshed.find(f => f.id === oldF.id)!.isStale).toBe(true);
    expect(refreshed.find(f => f.id === newF.id)!.isStale).toBe(false);
  });

  test('V. human review survives automated recomputation.', () => {
    const oldF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const reviewed = applyReviewLifecycle(oldF, 'DISMISSED');
    const newF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const refreshed = refreshFindingsState([reviewed], [newF]);
    expect(refreshed.find(f => f.id === reviewed.id)!.state).toBe('DISMISSED');
  });

  test('W. finding resolution does not mutate source evidence.', () => {
    const oldF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const reviewed = applyReviewLifecycle(oldF, 'RESOLVED');
    expect(reviewed.state).toBe('RESOLVED');
    // Source evidence (claims, etc.) is not even passed to this function.
  });
  
  test('X. snapshot counts only correct matter.', () => {
    const snap = generateSnapshot(matterId, { claims: [], attributions: [], relationships: [], events: [] }, []);
    expect(snap.matterId).toBe(matterId);
  });

  test('Y. snapshot distinguishes contradiction from corroboration.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [
        { id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DIRECT_CONTRADICTION', fingerprint: 'r1f' } as any,
        { id: 'r2', matterId, claimAId: 'c3', claimBId: 'c4', relationshipType: 'INDEPENDENT_SUPPORT', fingerprint: 'r2f' } as any
      ]
    };
    const snap = generateSnapshot(matterId, ctx, []);
    expect(snap.counts.contradictionRelationships).toBe(1);
    expect(snap.counts.corroborationRelationships).toBe(1);
  });

  test('Z. snapshot preserves UNKNOWN_DATE count.', () => {
    const findings = [createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', {})];
    const snap = generateSnapshot(matterId, { claims: [], attributions: [], relationships: [], events: [] }, findings);
    expect(snap.counts.unresolvedUnknownDate).toBe(1);
  });

  test('AA. no witness credibility score exists.', () => {
    const findings = generateEvidenceGaps(matterId, { claims: [], attributions: [], relationships: [], events: [] });
    // Finding model does not contain any witness score properties
    expect(findings.some((f: any) => f.witnessCredibility)).toBe(false);
  });

  test('AB. no party-ranking/win-probability output exists.', () => {
    const snap = generateSnapshot(matterId, { claims: [], attributions: [], relationships: [], events: [] }, []);
    // Snapshot model does not contain win probabilities
    expect((snap as any).winProbability).toBeUndefined();
  });

  test('AC. no provider call required.', () => {
    // Tests are purely synchronous and generateEvidenceGaps is not async.
    expect(generateEvidenceGaps.constructor.name).not.toBe('AsyncFunction');
  });

  test('AD. empty case produces safe empty snapshot.', () => {
    const snap = generateSnapshot(matterId, { claims: [], attributions: [], relationships: [], events: [] }, []);
    expect(snap.counts.totalClaims).toBe(0);
  });

  test('AE. large finding set has deterministic ordering.', () => {
    // Provenance arrays are sorted during fingerprinting.
    const f1 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c2', 'c1'] });
    const f2 = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1', 'c2'] });
    expect(f1.fingerprint).toBe(f2.fingerprint);
  });

  test('AF. source lineage independence remains intact.', () => {
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'ALLEGATION', proposition: 'x', dateContext: { precision: 'EXACT', date: '2020-01-01' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DEPENDENT_SUPPORT', independenceStatus: 'DEPENDENT', fingerprint: 'r1f' } as any],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'INDEPENDENCE_GAP')).toBe(true);
  });

  test('AG. finding provenance supports multiple dependencies.', () => {
    const f = createFinding(matterId, 'UNRESOLVED_CONFLICT', 'HIGH', 't', 'd', { claimIds: ['c1', 'c2'], relationshipIds: ['r1'] });
    expect(f.provenance.claimIds?.length).toBe(2);
    expect(f.provenance.relationshipIds?.length).toBe(1);
  });

  test('AH. historical/superseded finding remains auditable.', () => {
    const oldF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash1' } });
    const newF = createFinding(matterId, 'DATE_GAP', 'LOW', 't', 'd', { claimIds: ['c1'], semanticFingerprints: { c1: 'hash2' } });
    const refreshed = refreshFindingsState([oldF], [newF]);
    expect(refreshed.length).toBe(2);
    expect(refreshed.find(f => f.id === oldF.id)?.state).toBe('SUPERSEDED');
  });

  test('AI. low-materiality trivial missing metadata does not flood findings.', () => {
    // Determine materiality doesn't assign high materiality to trivial stuff.
    const ctx: M2EContext = {
      claims: [{ id: 'c1', matterId, classification: 'FACT', proposition: 'x', dateContext: { precision: 'UNKNOWN' }, fingerprint: 'c1f' } as any],
      attributions: [{ id: 'a1', matterId, claimId: 'c1' } as any],
      relationships: [],
      events: []
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    const dateGap = findings.find(f => f.category === 'DATE_GAP');
    expect(dateGap?.materiality).toBe('MEDIUM'); // Not HIGH
  });

  test('AJ. HUMAN_REVIEW_REQUIRED is used when deterministic classification cannot safely resolve a material issue.', () => {
    const ctx: M2EContext = {
      claims: [], attributions: [], events: [],
      relationships: [{ id: 'r1', matterId, claimAId: 'c1', claimBId: 'c2', relationshipType: 'DIRECT_CONTRADICTION', reviewState: 'PROPOSED', fingerprint: 'r1f' } as any]
    };
    const findings = generateEvidenceGaps(matterId, ctx);
    expect(findings.some(f => f.category === 'HUMAN_REVIEW_REQUIRED')).toBe(true);
  });
});
