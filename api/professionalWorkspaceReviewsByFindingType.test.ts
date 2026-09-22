import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import * as access from './services/access.js';
import * as accounts from './services/accounts.js';

vi.mock('./services/access.js');
vi.mock('./services/accounts.js');
vi.mock('./services/firebaseAdmin.js', () => ({
  verifyFirebaseToken: vi.fn(async (header: string | undefined) => {
    if (!header) return null;
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return null;
    const known = ['uid-A', 'uid-A2', 'uid-B', 'uid-professional-only', 'uid-lawyer-only'];
    if (known.includes(match[1])) {
      return { uid: match[1], email: `${match[1]}@example.test` };
    }
    return null;
  })
}));

import { registerProfessionalWorkspaceRoutes } from './professionalWorkspaceRoutes.js';

const FINDING_TYPE = 'LEGAL_RESEARCH_RESULT';

describe('Stage 9D-3 remediation -- GET /api/professional-workspace/matters/:matterId/reviews/:findingType', () => {
  let mockTables: any;

  const matterA = randomUUID();
  const matterB = randomUUID();
  const reviewAId = randomUUID();
  const reviewA2Id = randomUUID();
  const reviewBId = randomUUID();
  const findingIdA = randomUUID();
  const findingIdA2 = randomUUID();
  const findingIdB = randomUUID();
  const nonexistentMatterId = randomUUID();
  const malformedMatterId = 'not-a-uuid';

  function freshTables() {
    return {
      navigator_matter_members: [
        // Two different REVIEWER-authorized professionals on the same Matter A.
        { matter_id: matterA, account_id: 'test-account-A', role: 'OWNER' },
        { matter_id: matterA, account_id: 'test-account-A', role: 'REVIEWER' },
        { matter_id: matterA, account_id: 'test-account-A2', role: 'REVIEWER' },
        { matter_id: matterB, account_id: 'test-account-B', role: 'OWNER' },
        { matter_id: matterB, account_id: 'test-account-B', role: 'REVIEWER' }
      ],
      professional_reviews: [
        {
          id: reviewAId, matter_id: matterA, finding_type: FINDING_TYPE, finding_id: findingIdA,
          reviewer_account_id: 'test-account-A', review_state: 'CONFIRMED_RELEVANT', review_note: null,
          updated_at: '2025-01-01T00:00:00Z'
        },
        {
          // A different professional's PRIVATE review of a different finding on the SAME Matter A.
          id: reviewA2Id, matter_id: matterA, finding_type: FINDING_TYPE, finding_id: findingIdA2,
          reviewer_account_id: 'test-account-A2', review_state: 'NOT_RELEVANT', review_note: null,
          updated_at: '2025-01-01T00:00:00Z'
        },
        {
          id: reviewBId, matter_id: matterB, finding_type: FINDING_TYPE, finding_id: findingIdB,
          reviewer_account_id: 'test-account-B', review_state: 'CONFIRMED_RELEVANT', review_note: null,
          updated_at: '2025-01-01T00:00:00Z'
        }
      ]
    };
  }

  function installFakeDb() {
    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        let rows = mockTables[table] || [];
        const chain: any = {
          select: () => chain,
          eq: (col: string, val: any) => { rows = rows.filter((r: any) => r[col] === val); return chain; },
          single: async () => ({ data: rows[0], error: rows.length === 0 ? new Error('Not found') : null }),
          maybeSingle: async () => ({ data: rows.length > 0 ? rows[0] : null, error: null })
        };
        chain.then = (resolve: any) => resolve({ data: rows, error: null });
        return chain;
      }
    } as any);
  }

  beforeEach(() => {
    mockTables = freshTables();
    installFakeDb();
    vi.spyOn(accounts, 'findAccount').mockImplementation(async (uid: string) => {
      if (uid === 'uid-A') return { id: 'test-account-A', email: 'uid-A@example.test' } as any;
      if (uid === 'uid-A2') return { id: 'test-account-A2', email: 'uid-A2@example.test' } as any;
      if (uid === 'uid-B') return { id: 'test-account-B', email: 'uid-B@example.test' } as any;
      if (uid === 'uid-professional-only') return { id: 'test-account-professional', email: 'p@example.test' } as any;
      if (uid === 'uid-lawyer-only') return { id: 'test-account-lawyer', email: 'l@example.test' } as any;
      return null;
    });
  });

  const app = express();
  app.use(express.json());
  registerProfessionalWorkspaceRoutes(app);

  const getReviews = (matterId: string, findingType: string, uid = 'uid-A', query = '') =>
    request(app).get(`/api/professional-workspace/matters/${matterId}/reviews/${findingType}${query}`).set('Authorization', `Bearer ${uid}`);

  // 1. User A + Matter A -> allowed, canonical LEGAL_RESEARCH_RESULT reviews, reviewer-scoped
  it('allows User A to see their own LEGAL_RESEARCH_RESULT reviews for Matter A', async () => {
    const res = await getReviews(matterA, FINDING_TYPE, 'uid-A');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(reviewAId);
    expect(res.body[0].reviewer_account_id).toBe('test-account-A');
  });

  // 2. User A + Matter B -> denied
  it('denies User A access to Matter B reviews', async () => {
    const res = await getReviews(matterB, FINDING_TYPE, 'uid-A');
    expect(res.status).toBe(403);
  });

  // 3. User B + Matter A -> denied
  it('denies User B access to Matter A reviews', async () => {
    const res = await getReviews(matterA, FINDING_TYPE, 'uid-B');
    expect(res.status).toBe(403);
  });

  // 4. Professional-profile-only, no membership -> denied
  it('denies a professional-profile-only account with no matter membership', async () => {
    const res = await getReviews(matterA, FINDING_TYPE, 'uid-professional-only');
    expect(res.status).toBe(403);
  });

  // 5. Verified-lawyer-only, no membership -> denied
  it('denies a verified-lawyer-only account with no matter membership', async () => {
    const res = await getReviews(matterA, FINDING_TYPE, 'uid-lawyer-only');
    expect(res.status).toBe(403);
  });

  // 6. Nonexistent matter -> safe failure
  it('fails safely for a well-formed but nonexistent matter id', async () => {
    const res = await getReviews(nonexistentMatterId, FINDING_TYPE, 'uid-A');
    expect(res.status).toBe(403);
  });

  // 7. Malformed matter id -> safe failure
  it('fails safely (400) for a malformed matter id, never a raw 500', async () => {
    const res = await getReviews(malformedMatterId, FINDING_TYPE, 'uid-A');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  // 8. Unsupported/arbitrary findingType -> safe validation failure, not a raw DB error or leak
  it('returns zero rows for an unsupported/arbitrary findingType, never a raw DB error or cross-scope leak', async () => {
    const res = await getReviews(matterA, 'SOME_ARBITRARY_TYPE', 'uid-A');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // 9. A known Matter B finding/review id does not become accessible via the Matter A path
  it('a Matter B review is never returned by supplying Matter A in the path', async () => {
    const res = await getReviews(matterA, FINDING_TYPE, 'uid-A');
    expect(res.status).toBe(200);
    const ids = res.body.map((r: any) => r.id);
    expect(ids).not.toContain(reviewBId);
    for (const r of res.body) expect(r.matter_id).toBe(matterA);
  });

  // 10. Reviewer-scoped/private visibility model: a different authorized professional on the
  // SAME Matter A does NOT see User A's private review (confirmed by reading professionalWorkspace.ts:
  // listProfessionalReviewsForFindingType filters .eq('reviewer_account_id', account.id)).
  it('a different authorized reviewer on the same Matter A does not see another reviewer\'s private review', async () => {
    const resA = await getReviews(matterA, FINDING_TYPE, 'uid-A');
    expect(resA.status).toBe(200);
    expect(resA.body.map((r: any) => r.id)).toEqual([reviewAId]);

    const resA2 = await getReviews(matterA, FINDING_TYPE, 'uid-A2');
    expect(resA2.status).toBe(200);
    expect(resA2.body.map((r: any) => r.id)).toEqual([reviewA2Id]);

    // Neither reviewer's response contains the other's private review.
    expect(resA.body.map((r: any) => r.id)).not.toContain(reviewA2Id);
    expect(resA2.body.map((r: any) => r.id)).not.toContain(reviewAId);
  });

  it('denies an unauthenticated request', async () => {
    const res = await request(app).get(`/api/professional-workspace/matters/${matterA}/reviews/${FINDING_TYPE}`);
    expect(res.status).toBe(401);
  });
});
