import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCaseBrief, finalizeCaseBrief, getWorkProductVersions, getWorkProductVersion } from './litigationWorkProduct.js';

const current = vi.hoisted(() => ({ db: null as any }));
vi.mock('./access.js', () => ({ getSupabase: () => current.db }));
vi.mock('./accounts.js', () => ({
  findAccount: vi.fn(async (uid: string) => {
    if (uid === 'REVIEWER_A_UID') return { id: 'acc-reviewer-a', primary_role: 'lawyer', status: 'active' };
    if (uid === 'REVIEWER_B_UID') return { id: 'acc-reviewer-b', primary_role: 'lawyer', status: 'active' };
    if (uid === 'UNAUTHORIZED_UID') return { id: 'acc-unauth', primary_role: 'lawyer', status: 'active' };
    if (uid === 'REVOKED_UID') return { id: 'acc-revoked', primary_role: 'lawyer', status: 'active' };
    return null;
  })
}));

vi.mock('./professionalWorkspace.js', () => ({
  requireProfessionalAccess: vi.fn(async (db, accountId, matterId) => {
    if (matterId === '22222222-2222-2222-2222-222222222222') {
      const { LifecycleError } = await import('./lifecycleErrors.js');
      throw new LifecycleError(403, 'UNAUTHORIZED', 'You do not have professional access to this matter.');
    }
    if (accountId === 'acc-unauth' || accountId === 'acc-revoked') {
      const { LifecycleError } = await import('./lifecycleErrors.js');
      throw new LifecycleError(403, 'UNAUTHORIZED', 'You do not have professional access to this matter.');
    }
  })
}));

describe('Stage 8D Integration and Security Closure', () => {
  const MATTER_A = '11111111-1111-1111-1111-111111111111';
  const MATTER_B = '22222222-2222-2222-2222-222222222222';

  let matter_a_title = 'Matter A Initial';
  let evidence_data: any[] = [];
  let versions_data: any[] = [];

  beforeEach(() => {
    matter_a_title = 'Matter A Initial';
    evidence_data = [
      { matter_id: MATTER_A, id: 'ev-1', normalized_statement: 'Initial evidence', classification: 'FACT', review_state: 'REVIEWED' }
    ];
    versions_data = [
      { id: '33333333-3333-3333-3333-333333333333', matter_id: MATTER_A, reviewer_account_id: 'acc-reviewer-b', work_product_type: 'CASE_BRIEF', version_number: 1, status: 'FINALIZED', snapshot: { title: 'B Brief' } }
    ];

    current.db = {
      from: (table: string) => {
        let query: any[] = [];
        if (table === 'navigator_matters') query = [{ id: MATTER_A, title: matter_a_title }];
        else if (table === 'navigator_evidence_items') query = [...evidence_data];
        else if (table === 'professional_reviews') query = [
            { matter_id: MATTER_A, id: 'rev-a', finding_id: 'ev-1', review_state: 'CONFIRMED', reviewer_account_id: 'acc-reviewer-a' },
            { matter_id: MATTER_A, id: 'rev-b', finding_id: 'ev-1', review_state: 'DISPUTED', reviewer_account_id: 'acc-reviewer-b' }
        ];
        else if (table === 'professional_work_product_versions') query = [...versions_data];

        const chain: any = {
          select: () => chain,
          eq: (col: string, val: any) => {
            query = query.filter(r => r[col] === val);
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          single: async () => ({ data: query[0], error: query.length === 0 ? { code: 'PGRST116' } : null }),
          maybeSingle: async () => ({ data: query[0] || null, error: null }),
          then: (resolve: any) => resolve({ data: query, error: null }),
          insert: (record: any) => {
            const newRecord = { ...record, id: '44444444-4444-4444-4444-444444444444' };
            versions_data.push(newRecord);
            return {
              select: () => ({
                single: async () => ({ data: newRecord, error: null })
              })
            };
          }
        };
        return chain;
      }
    };
  });

  it('End-to-End Lifecycle: Generates, finalizes, mutates current intelligence, and retrieves history immutably', async () => {
    // 1. Reviewer A opens matter, generates current case brief
    const currentBrief = await generateCaseBrief('REVIEWER_A_UID', MATTER_A);
    expect(currentBrief.sections.matterOverview.title).toBe('Matter A Initial');
    expect(currentBrief.sections.materialEvidence[0].content).toBe('Initial evidence');
    
    // 2. Finalize Case Brief (Version 1)
    const ver1 = await finalizeCaseBrief('REVIEWER_A_UID', MATTER_A);
    expect(ver1.version_number).toBe(1);
    expect(ver1.snapshot.sections.matterOverview.title).toBe('Matter A Initial');

    // 3. Mutate underlying intelligence
    matter_a_title = 'Matter A Updated';
    evidence_data[0].normalized_statement = 'Updated evidence';

    // 4. Current Case Brief reflects new intelligence
    const updatedCurrentBrief = await generateCaseBrief('REVIEWER_A_UID', MATTER_A);
    expect(updatedCurrentBrief.sections.matterOverview.title).toBe('Matter A Updated');
    expect(updatedCurrentBrief.sections.materialEvidence[0].content).toBe('Updated evidence');

    // 5. Finalize again (Version 2)
    const ver2 = await finalizeCaseBrief('REVIEWER_A_UID', MATTER_A);
    expect(ver2.version_number).toBe(2);
    expect(ver2.snapshot.sections.matterOverview.title).toBe('Matter A Updated');

    // 6. Retrieve Version 1, ensure it's immutable
    const retrievedVer1 = await getWorkProductVersion('REVIEWER_A_UID', MATTER_A, ver1.id);
    expect(retrievedVer1.snapshot.sections.matterOverview.title).toBe('Matter A Initial'); // Unchanged
    expect(retrievedVer1.snapshot.sections.materialEvidence[0].content).toBe('Initial evidence');
  });

  it('Cross-Reviewer Privacy: Reviewer A cannot access Reviewer B work product and vice-versa', async () => {
    const briefA = await generateCaseBrief('REVIEWER_A_UID', MATTER_A);
    // Reviewer A sees their review (CONFIRMED) but not B's
    expect(briefA.sections.professionalReview.length).toBe(1);
    expect(briefA.sections.professionalReview[0].reviewState).toBe('CONFIRMED');

    const briefB = await generateCaseBrief('REVIEWER_B_UID', MATTER_A);
    expect(briefB.sections.professionalReview.length).toBe(1);
    expect(briefB.sections.professionalReview[0].reviewState).toBe('DISPUTED');

    // B has finalized ver-b-1 in DB. A should not see it in versions list.
    const versionsA = await getWorkProductVersions('REVIEWER_A_UID', MATTER_A);
    expect(versionsA.length).toBe(0); // A has no versions initially

    const versionsB = await getWorkProductVersions('REVIEWER_B_UID', MATTER_A);
    expect(versionsB.length).toBe(1);
    expect(versionsB[0].id).toBe('33333333-3333-3333-3333-333333333333');

    // A attempting to access B's version by direct ID should fail
    await expect(getWorkProductVersion('REVIEWER_A_UID', MATTER_A, '33333333-3333-3333-3333-333333333333')).rejects.toThrow('Work product version not found');
  });

  it('Cross-Matter and Revocation Hardening: Denies operations on unauthorized or revoked matter access', async () => {
    // Cross-matter
    await expect(generateCaseBrief('REVIEWER_A_UID', MATTER_B)).rejects.toThrow('You do not have professional access to this matter.');
    await expect(finalizeCaseBrief('REVIEWER_A_UID', MATTER_B)).rejects.toThrow('You do not have professional access to this matter.');
    await expect(getWorkProductVersions('REVIEWER_A_UID', MATTER_B)).rejects.toThrow('You do not have professional access to this matter.');
    await expect(getWorkProductVersion('REVIEWER_A_UID', MATTER_B, '55555555-5555-5555-5555-555555555555')).rejects.toThrow('You do not have professional access to this matter.');

    // Revocation (session valid but matter access revoked)
    await expect(generateCaseBrief('REVOKED_UID', MATTER_A)).rejects.toThrow('You do not have professional access to this matter.');
    await expect(finalizeCaseBrief('REVOKED_UID', MATTER_A)).rejects.toThrow('You do not have professional access to this matter.');
    await expect(getWorkProductVersions('REVOKED_UID', MATTER_A)).rejects.toThrow('You do not have professional access to this matter.');
    await expect(getWorkProductVersion('REVOKED_UID', MATTER_A, '55555555-5555-5555-5555-555555555555')).rejects.toThrow('You do not have professional access to this matter.');
  });

  it('Classification and Fact Separation: Preserves intent without conflating to FACT', async () => {
    evidence_data.push({
      matter_id: MATTER_A, id: 'ev-2', normalized_statement: 'Unverified rumor', classification: 'UNVERIFIED_CLAIM'
    });
    const brief = await generateCaseBrief('REVIEWER_A_UID', MATTER_A);
    const rumor = brief.sections.materialEvidence.find((e: any) => e.id === 'ev-2');
    expect(rumor.classification).toBe('UNVERIFIED_CLAIM'); // Not silently changed to FACT
  });
});
