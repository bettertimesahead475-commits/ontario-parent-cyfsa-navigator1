import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getParentCollaborationSummary } from './parentProfessionalCollaboration.js';
import { requireProfessionalAccess, getMatterOverview, saveProfessionalReview } from './professionalWorkspace.js';
import { revokeProfessionalGrant } from './professionalMatterAccess.js';

// Mock dependencies
vi.mock('./access.js', () => ({
  getSupabase: vi.fn()
}));

vi.mock('./accounts.js', () => ({
  findAccount: vi.fn()
}));

import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';

describe('Stage 11 Slice 3: Parent <-> Professional Collaboration & Isolation Invariants', () => {
  const mockParentUid = 'firebase-parent-123';
  const mockParentAccountId = 'acc-parent-uuid-001';
  const mockProUid = 'firebase-pro-456';
  const mockProAccountId = 'acc-pro-uuid-002';
  
  const mockMatterA = '00000000-0000-4000-a000-00000000000a';
  const mockMatterB = '00000000-0000-4000-a000-00000000000b';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Owner Access & Permission Gate', () => {
    it('allows matter owner to access collaboration summary', async () => {
      (findAccount as any).mockImplementation((uid: string) => {
        if (uid === mockParentUid) return Promise.resolve({ id: mockParentAccountId });
        return Promise.resolve(null);
      });

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'OWNER' }, error: null })
            };
          }
          if (table === 'navigator_matter_access_grants') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation(() => Promise.resolve({
                data: [
                  {
                    id: 'grant-1',
                    recipient_email: 'lawyer@example.com',
                    status: 'ACCEPTED',
                    expires_at: '2027-01-01T00:00:00Z',
                    created_at: '2026-09-01T00:00:00Z',
                    accepted_at: '2026-09-02T00:00:00Z',
                    revoked_at: null
                  }
                ],
                error: null
              }))
            };
          }
          if (table === 'professional_reviews') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation(() => Promise.resolve({
                data: [
                  { id: 'rev-1', finding_type: 'EVIDENCE', finding_id: 'ev-1', review_state: 'CONFIRMED_RELEVANT', updated_at: '2026-09-10T00:00:00Z' },
                  { id: 'rev-2', finding_type: 'CLAIMS', finding_id: 'cl-1', review_state: 'POSSIBLY_RELEVANT', updated_at: '2026-09-11T00:00:00Z' }
                ],
                error: null
              }))
            };
          }
          if (table === 'professional_work_product_versions') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockImplementation(() => Promise.resolve({
                data: [
                  { id: 'ver-1', version_number: 1, work_product_type: 'CASE_BRIEF', status: 'FINALIZED', created_at: '2026-09-15T00:00:00Z', finalized_at: '2026-09-15T00:00:00Z' }
                ],
                error: null
              }))
            };
          }
          return {};
        })
      };

      (getSupabase as any).mockReturnValue(mockDb);

      const summary = await getParentCollaborationSummary(mockParentUid, mockMatterA);

      expect(summary.matterId).toBe(mockMatterA);
      expect(summary.collaborators.length).toBe(1);
      expect(summary.collaborators[0].recipientEmail).toBe('lawyer@example.com');
      expect(summary.reviewProgressSummary.totalReviewed).toBe(2);
      expect(summary.reviewProgressSummary.confirmedRelevant).toBe(1);
      expect(summary.reviewProgressSummary.possiblyRelevant).toBe(1);
      expect(summary.finalizedWorkProducts.length).toBe(1);
      expect(summary.finalizedWorkProducts[0].versionNumber).toBe(1);
    });

    it('denies collaboration summary access to non-owners (e.g. professional reviewer or unauthorized user)', async () => {
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });

      const mockDb = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } })
        }))
      };

      (getSupabase as any).mockReturnValue(mockDb);

      await expect(getParentCollaborationSummary(mockProUid, mockMatterA))
        .rejects.toThrow('Only the matter owner can view collaboration status.');
    });
  });

  describe('2. Stale Client Revocation & Workspace Access Collapse', () => {
    it('immediately denies professional read/write access after server-side revocation', async () => {
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });
      let isRevoked = false;

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockImplementation(() => {
                if (isRevoked) {
                  return Promise.resolve({ data: null, error: { message: 'No row' } });
                }
                return Promise.resolve({ data: { role: 'REVIEWER' }, error: null });
              })
            };
          }
          if (table === 'navigator_documents' || table === 'navigator_events' || table === 'navigator_claims' ||
              table === 'navigator_claim_relationships' || table === 'navigator_evidence_gap_findings' ||
              table === 'navigator_case_intelligence_snapshots' || table === 'professional_reviews') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              then: vi.fn().mockImplementation((cb: any) => cb({ count: 5, data: [], error: null }))
            };
          }
          return {};
        }),
        rpc: vi.fn().mockImplementation((fn: string) => {
          if (fn === 'navigator_matter_access_lifecycle_contract_v4') {
            return Promise.resolve({ data: 'navigator_matter_access_lifecycle_v4', error: null });
          }
          if (fn === 'revoke_matter_grant') {
            isRevoked = true;
            return Promise.resolve({
              data: { grant_id: '00000000-0000-4000-a000-000000000101', status: 'REVOKED', membership_removed: true },
              error: null
            });
          }
          return Promise.resolve({ data: null, error: null });
        })
      };

      (getSupabase as any).mockReturnValue(mockDb);

      // Before revocation: professional overview call succeeds
      const overviewBefore = await getMatterOverview(mockProUid, mockMatterA);
      expect(overviewBefore.documents).toBe(5);

      // Owner performs revocation
      (findAccount as any).mockResolvedValue({ id: mockParentAccountId });
      const revokeResult = await revokeProfessionalGrant(mockParentUid, '00000000-0000-4000-a000-000000000101');
      expect(revokeResult.membershipRemoved).toBe(true);

      // After revocation: stale professional client attempts protected read -> rejected with 403
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });
      await expect(getMatterOverview(mockProUid, mockMatterA))
        .rejects.toThrow('You do not have professional access to this matter.');

      // Stale professional client attempts protected write -> rejected with 403
      await expect(saveProfessionalReview(mockProUid, mockMatterA, 'EVIDENCE', '00000000-0000-4000-a000-000000000005', 'CONFIRMED_RELEVANT', 'Note'))
        .rejects.toThrow('You do not have professional access to this matter.');
    });
  });

  describe('3. Multi-Grant & Multi-Matter Isolation', () => {
    it('isolates a professional with access to Matter A from Matter B if not granted on Matter B', async () => {
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            let checkedMatterId: string | null = null;
            const builder = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === 'matter_id') checkedMatterId = val;
                return builder;
              }),
              single: vi.fn().mockImplementation(() => {
                if (checkedMatterId === mockMatterA) {
                  return Promise.resolve({ data: { role: 'REVIEWER' }, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              })
            };
            return builder;
          }
          return {};
        })
      };

      (getSupabase as any).mockReturnValue(mockDb);

      // Access to Matter A succeeds
      await expect(requireProfessionalAccess(mockDb, mockProAccountId, mockMatterA)).resolves.not.toThrow();

      // Access to Matter B fails
      await expect(requireProfessionalAccess(mockDb, mockProAccountId, mockMatterB))
        .rejects.toThrow('You do not have professional access to this matter.');
    });
  });
});
