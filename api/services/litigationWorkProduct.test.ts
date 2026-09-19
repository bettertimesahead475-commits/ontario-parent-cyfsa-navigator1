import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCaseBrief } from './litigationWorkProduct.js';

// Mock dependencies
const current = vi.hoisted(() => ({ db: null as any }));
vi.mock('./access.js', () => ({ getSupabase: () => current.db }));
vi.mock('./accounts.js', () => ({
  findAccount: vi.fn(async (uid: string) => {
    if (uid === 'AUTHORIZED_UID') return { id: 'acc-authorized', primary_role: 'lawyer', status: 'active' };
    if (uid === 'UNAUTHORIZED_UID') return { id: 'acc-unauthorized', primary_role: 'lawyer', status: 'active' };
    if (uid === 'REVOKED_UID') return { id: 'acc-revoked', primary_role: 'lawyer', status: 'active' };
    return null;
  })
}));
vi.mock('./professionalWorkspace.js', () => ({
  requireProfessionalAccess: vi.fn(async (db, accountId, matterId) => {
    if (accountId === 'acc-unauthorized' || accountId === 'acc-revoked') {
      const { LifecycleError } = await import('./lifecycleErrors.js');
      throw new LifecycleError(403, 'UNAUTHORIZED', 'You do not have professional access to this matter.');
    }
  })
}));

describe('Litigation Work Product - Case Brief', () => {
  const MATTER_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    current.db = {
      from: (table: string) => {
        let data: any = [];
        if (table === 'navigator_matters') data = { id: MATTER_A, title: 'Matter A Title' };
        else if (table === 'navigator_entities') data = [{ id: 'ent-1', entity_type: 'PERSON', display_name: 'John Doe', review_state: 'CONFIRMED' }];
        else if (table === 'navigator_events') data = [{ id: 'evt-1', description: 'Event 1', date_original_text: 'Jan 1', date_precision: 'EXACT_DATE', date_lower_bound: '2023-01-01', date_upper_bound: '2023-01-01', review_state: 'CONFIRMED' }];
        else if (table === 'navigator_evidence_items') data = [{ id: 'ev-1', document_id: 'doc-1', document_version_id: 'ver-1', page_number: 1, normalized_statement: 'The child was seen', exact_quote: 'child was seen', quote_verification: 'EXACT', classification: 'FACT', review_state: 'REVIEWED' }];
        else if (table === 'navigator_claims') data = [{ id: 'cl-1', claim_text: 'Claim 1', classification: 'UNVERIFIED_CLAIM', review_state: 'UNREVIEWED' }];
        else if (table === 'navigator_claim_relationships') data = [
          { id: 'rel-1', source_claim_id: 'cl-1', target_claim_id: 'cl-2', relationship_type: 'CORROBORATION' },
          { id: 'rel-2', source_claim_id: 'cl-1', target_claim_id: 'cl-3', relationship_type: 'CONTRADICTION' }
        ];
        else if (table === 'navigator_evidence_gap_findings') data = [{ id: 'gap-1', gap_type: 'MISSING_DOCUMENT', description: 'Missing Medical Record' }];
        else if (table === 'navigator_case_intelligence_snapshots') data = [{ id: 'leg-1', snapshot_type: 'CYFSA_ANALYSIS', content: 'Section 74 applicability' }];
        else if (table === 'professional_reviews') data = [{ id: 'rev-1', finding_type: 'CLAIMS', finding_id: 'cl-1', review_state: 'DISPUTED', review_note: 'Note' }];

        const chain: any = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          single: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
          maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
          then: (resolve: any) => resolve({ data, error: null })
        };
        return chain;
      }
    };
  });

  it('authorized CASE_BRIEF generation succeeds and returns structured sections', async () => {
    const brief = await generateCaseBrief('AUTHORIZED_UID', MATTER_A);
    expect(brief.type).toBe('CASE_BRIEF');
    expect(brief.matterId).toBe(MATTER_A);
    expect(brief.sections.matterOverview.title).toBe('Matter A Title');
    expect(brief.sections.keyPeopleAndOrganizations.length).toBe(1);
    expect(brief.sections.proceduralChronology.length).toBe(1);
    expect(brief.sections.materialEvidence.length).toBe(1);
    expect(brief.sections.materialClaims.length).toBe(1);
    expect(brief.sections.corroborationRelationships.length).toBe(1);
    expect(brief.sections.potentialInconsistencies.length).toBe(1);
    expect(brief.sections.evidenceGaps.length).toBe(1);
    expect(brief.sections.potentialLegalRelevanceFlags.length).toBe(1);
    expect(brief.sections.professionalReview.length).toBe(1);
    expect(brief.sections.sourceIndex).toContain('doc-1');
  });

  it('unauthorized professional is denied', async () => {
    await expect(generateCaseBrief('UNAUTHORIZED_UID', MATTER_A)).rejects.toThrow('You do not have professional access');
  });

  it('revoked reviewer is denied without re-login', async () => {
    await expect(generateCaseBrief('REVOKED_UID', MATTER_A)).rejects.toThrow('You do not have professional access');
  });

  it('preserves machine/human separation by keeping reviews separate from canonical data', async () => {
    const brief = await generateCaseBrief('AUTHORIZED_UID', MATTER_A);
    const claim = brief.sections.materialClaims[0];
    const review = brief.sections.professionalReview[0];
    expect(claim.reviewState).toBe('UNREVIEWED');
    expect(review.reviewState).toBe('DISPUTED');
    expect(review.findingId).toBe(claim.id);
  });

  it('preserves exact quote safety without fabricating one', async () => {
    // Override to return a paraphrase without an exact quote
    current.db = {
      from: (table: string) => {
        let data: any = [];
        if (table === 'navigator_evidence_items') {
          data = [{ id: 'ev-2', document_id: 'doc-1', document_version_id: 'ver-1', page_number: 1, normalized_statement: 'Paraphrased statement', exact_quote: '', quote_verification: 'ABSENT', classification: 'FACT', review_state: 'REVIEWED' }];
        }
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
          then: (resolve: any) => resolve({ data, error: null })
        };
        return chain;
      }
    };
    const brief = await generateCaseBrief('AUTHORIZED_UID', MATTER_A);
    const evidence = brief.sections.materialEvidence[0];
    expect(evidence.exactQuote).toBeNull(); // Do not fabricate
  });

  it('preserves potential inconsistency neutral language', async () => {
    const brief = await generateCaseBrief('AUTHORIZED_UID', MATTER_A);
    const inconsistency = brief.sections.potentialInconsistencies[0];
    expect(inconsistency.neutralDescription).toBe('Potential inconsistency requiring review.');
    expect(inconsistency.relationshipType).toBe('CONTRADICTION');
  });

  it('includes required provenance contract details', async () => {
    const brief = await generateCaseBrief('AUTHORIZED_UID', MATTER_A);
    const entity = brief.sections.keyPeopleAndOrganizations[0];
    expect(entity.provenance).toBeDefined();
    expect(entity.provenance.matterId).toBe(MATTER_A);
    expect(entity.provenance.canonicalId).toBe('ent-1');
    expect(entity.provenance.type).toBe('ENTITY');
  });
});
