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
    // Only these literal tokens resolve to a real identity -- anything else (including a
    // caller-forged uid string in a header, body, or query) fails closed.
    const known = ['uid-A', 'uid-B', 'uid-professional-only', 'uid-lawyer-only'];
    if (known.includes(match[1])) {
      return { uid: match[1], email: `${match[1]}@example.test` };
    }
    return null;
  })
}));

import { registerMatterLegalResearchCandidatesRoutes } from './matterLegalResearchCandidatesRoutes.js';

describe('Stage 9D-3 remediation -- GET /api/matters/:matterId/legal-research/candidates', () => {
  let mockTables: any;

  const matterA = randomUUID();
  const matterB = randomUUID();
  const candidateAId = randomUUID();
  const candidateBId = randomUUID();
  const nonexistentMatterId = randomUUID();
  const malformedMatterId = 'not-a-uuid';

  function freshTables() {
    return {
      navigator_matter_members: [
        { matter_id: matterA, account_id: 'test-account-A', role: 'OWNER' },
        { matter_id: matterB, account_id: 'test-account-B', role: 'OWNER' }
      ],
      navigator_matter_legal_research_candidates: [
        {
          id: candidateAId, matter_id: matterA, evidence_item_id: null, event_id: null,
          evidence_classification: 'ALLEGATION', legal_source_id: randomUUID(), legal_source_version_id: randomUUID(),
          provision_id: randomUUID(), authority_identifier: 'CYFSA s. 74 (Matter A)', reason_for_relevance: 'reason',
          retrieval_basis: 'CLAIM_TEXT', effective_date_context: '2020-01-01', source_provenance: 'https://example.com/a',
          content_integrity_status: 'VERIFIED', created_at: '2025-01-01T00:00:00Z'
        },
        {
          id: candidateBId, matter_id: matterB, evidence_item_id: null, event_id: null,
          evidence_classification: 'ALLEGATION', legal_source_id: randomUUID(), legal_source_version_id: randomUUID(),
          provision_id: randomUUID(), authority_identifier: 'CYFSA s. 74 (Matter B)', reason_for_relevance: 'reason',
          retrieval_basis: 'CLAIM_TEXT', effective_date_context: '2020-01-01', source_provenance: 'https://example.com/b',
          content_integrity_status: 'VERIFIED', created_at: '2025-01-01T00:00:00Z'
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
      if (uid === 'uid-B') return { id: 'test-account-B', email: 'uid-B@example.test' } as any;
      if (uid === 'uid-professional-only') return { id: 'test-account-professional', email: 'p@example.test' } as any;
      if (uid === 'uid-lawyer-only') return { id: 'test-account-lawyer', email: 'l@example.test' } as any;
      return null;
    });
  });

  const app = express();
  app.use(express.json());
  registerMatterLegalResearchCandidatesRoutes(app);

  const getCandidates = (matterId: string, uid = 'uid-A', query = '') =>
    request(app).get(`/api/matters/${matterId}/legal-research/candidates${query}`).set('Authorization', `Bearer ${uid}`);

  // 1. User A + Matter A -> allowed
  it('allows User A to list candidates for Matter A', async () => {
    const res = await getCandidates(matterA, 'uid-A');
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(candidateAId);
    expect(res.body.candidates[0].authorityIdentifier).toBe('CYFSA s. 74 (Matter A)');
  });

  // 2. User A + Matter B -> denied
  it('denies User A access to Matter B candidates', async () => {
    const res = await getCandidates(matterB, 'uid-A');
    expect(res.status).toBe(403);
  });

  // 3. User B + Matter A -> denied
  it('denies User B access to Matter A candidates', async () => {
    const res = await getCandidates(matterA, 'uid-B');
    expect(res.status).toBe(403);
  });

  // 4. Professional-profile-only, no membership -> denied
  it('denies a professional-profile-only account with no matter membership', async () => {
    const res = await getCandidates(matterA, 'uid-professional-only');
    expect(res.status).toBe(403);
  });

  // 5. Verified-lawyer-only, no membership -> denied
  it('denies a verified-lawyer-only account with no matter membership', async () => {
    const res = await getCandidates(matterA, 'uid-lawyer-only');
    expect(res.status).toBe(403);
  });

  // 6. Nonexistent matter -> safe failure
  it('fails safely for a well-formed but nonexistent matter id', async () => {
    const res = await getCandidates(nonexistentMatterId, 'uid-A');
    expect(res.status).toBe(403);
    expect(res.body.error).not.toMatch(/stack|at Object|at async/i);
  });

  // 7. Malformed matter id -> safe failure
  it('fails safely (400) for a malformed matter id, never a raw 500', async () => {
    const res = await getCandidates(malformedMatterId, 'uid-A');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
  });

  // 8. Matter A response never contains a Matter B candidate
  it('never includes a Matter B candidate in the Matter A response', async () => {
    const res = await getCandidates(matterA, 'uid-A');
    expect(res.status).toBe(200);
    const ids = res.body.candidates.map((c: any) => c.id);
    expect(ids).not.toContain(candidateBId);
    for (const c of res.body.candidates) expect(c.matterId).toBe(matterA);
  });

  // 9. Caller-supplied identity fields cannot override the authenticated uid
  it('ignores caller-supplied identity fields in query string; authorization uses only the verified token', async () => {
    // uid-B has no access to matterA; attempting to smuggle uid-A via query params must not help.
    const res = await getCandidates(matterA, 'uid-B', '?uid=uid-A&accountId=test-account-A&firebaseUid=uid-A');
    expect(res.status).toBe(403);
  });

  // 10. Knowing a candidate ID alone doesn't expand access
  it('knowing a Matter B candidate id does not grant User A access via the matterA path', async () => {
    // The route is matter-scoped, not candidate-id-scoped -- there is no way to pass a candidate
    // id to broaden the query, and User A still only sees matterA's own candidates.
    const res = await getCandidates(matterA, 'uid-A', `?candidateId=${candidateBId}`);
    expect(res.status).toBe(200);
    const ids = res.body.candidates.map((c: any) => c.id);
    expect(ids).not.toContain(candidateBId);
  });

  it('denies an unauthenticated request', async () => {
    const res = await request(app).get(`/api/matters/${matterA}/legal-research/candidates`);
    expect(res.status).toBe(401);
  });
});
