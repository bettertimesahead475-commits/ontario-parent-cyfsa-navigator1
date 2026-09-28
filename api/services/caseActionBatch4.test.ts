/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Post-Launch Case-Action Workspace (Batch 4) Test Suite
 * Professional Collaboration + Case Output Integration + Privacy & Lifecycle Security
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getIntelligenceCategory,
  getMatterOverview,
  saveProfessionalReview,
  listProfessionalReviewsForFindingType,
} from './professionalWorkspace.js';
import { generateCaseBrief } from './litigationWorkProduct.js';
import {
  listRequirements,
  getRequirement,
  createRequirement,
} from './caseActionWorkspace.js';

// Mocks
vi.mock('./access.js', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('./accounts.js', () => ({
  findAccount: vi.fn(),
}));

import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';

describe('Case-Action Workspace — Batch 4 Integration & Security', () => {
  const mockFirebaseUidParent = 'parent-uid-123';
  const mockFirebaseUidLawyer = 'lawyer-uid-456';
  const mockParentAccountId = 'acc-parent-1111';
  const mockLawyerAccountId = 'acc-lawyer-2222';
  const mockMatterId = '11111111-1111-4111-a111-111111111111';
  const mockOtherMatterId = '99999999-9999-4999-a999-999999999999';
  const mockReqId = '33333333-3333-4333-a333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Professional Workspace Integration & Overview', () => {
    it('returns caseRequirements count in getMatterOverview', async () => {
      (findAccount as any).mockResolvedValue({ id: mockLawyerAccountId });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            count: 5,
            head: true,
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };
      (getSupabase as any).mockReturnValue(mockSupabase);

      const overview = await getMatterOverview(mockFirebaseUidLawyer, mockMatterId);
      expect(overview).toHaveProperty('caseRequirements');
      expect(overview.caseRequirements).toBe(5);
    });

    it('fetches CASE_ACTIONS category with requirement items and attached actions/evidence', async () => {
      (findAccount as any).mockResolvedValue({ id: mockLawyerAccountId });

      const mockReq = {
        id: mockReqId,
        matter_id: mockMatterId,
        title: 'Complete Drug Screening',
        authority_type: 'CAS_REQUESTED',
        review_state: 'PROPOSED',
        completion_state: 'NOT_STARTED',
        dispute_state: 'NOT_DISPUTED',
        lawyer_notes: 'CONFIDENTIAL LAWYER STRATEGY NOTE',
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null }),
            };
          }
          if (table === 'navigator_case_requirements') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [mockReq], error: null }),
            };
          }
          if (table === 'navigator_case_actions' || table === 'navigator_action_evidence_links') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          if (table === 'professional_reviews') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              mockResolvedValue: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          };
        }),
      };
      (getSupabase as any).mockReturnValue(mockSupabase);

      const res = await getIntelligenceCategory(mockFirebaseUidLawyer, mockMatterId, 'CASE_ACTIONS');
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe(mockReqId);
      expect(res.items[0].lawyer_notes).toBeUndefined(); // Stripped from general category items
    });
  });

  describe('2. Case Output & Case Brief Integration', () => {
    it('includes caseActions in generateCaseBrief output', async () => {
      (findAccount as any).mockResolvedValue({ id: mockLawyerAccountId });

      const mockReq = {
        id: mockReqId,
        matter_id: mockMatterId,
        title: 'Supervised Access Plan',
        authority_type: 'COURT_ORDERED',
        review_state: 'CONFIRMED',
        completion_state: 'IN_PROGRESS',
        dispute_state: 'NOT_DISPUTED',
        source_exact_quote: 'Access shall be supervised twice weekly',
        source_page_number: 3,
        lawyer_notes: 'Private legal assessment',
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null }),
            };
          }
          if (table === 'navigator_matters') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { title: 'Smith Matter' }, error: null }),
            };
          }
          if (table === 'navigator_case_requirements') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockResolvedValue({ data: [mockReq], error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      };
      (getSupabase as any).mockReturnValue(mockSupabase);

      const brief = await generateCaseBrief(mockFirebaseUidLawyer, mockMatterId);
      expect(brief.sections).toHaveProperty('caseActions');
      expect(brief.sections.caseActions).toHaveLength(1);
      const reqOutput = brief.sections.caseActions[0];
      expect(reqOutput.title).toBe('Supervised Access Plan');
      expect(reqOutput.authorityType).toBe('COURT_ORDERED');
      expect(reqOutput.sourceExactQuote).toBe('Access shall be supervised twice weekly');
      expect((reqOutput as any).lawyerNotes).toBeUndefined(); // Private lawyer notes excluded from brief
    });
  });

  describe('3. Privacy Boundary & Lawyer Notes Protection', () => {
    it('strips lawyer_notes when parent lists requirements', async () => {
      (findAccount as any).mockResolvedValue({ id: mockParentAccountId });

      const mockDbReq = {
        id: mockReqId,
        matter_id: mockMatterId,
        title: 'Counseling Requirement',
        authority_type: 'CAS_REQUESTED',
        review_state: 'CONFIRMED',
        completion_state: 'NOT_STARTED',
        lawyer_notes: 'CONFIDENTIAL STRATEGY NOTE FOR LAWYER ONLY',
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'OWNER' }, error: null }),
            };
          }
          if (table === 'navigator_case_requirements') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: [mockDbReq], error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
        }),
      };
      (getSupabase as any).mockReturnValue(mockSupabase);

      const result = await listRequirements(mockFirebaseUidParent, mockMatterId);
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('lawyer_notes');
    });

    it('retains lawyer_notes when authorized REVIEWER lists requirements', async () => {
      (findAccount as any).mockResolvedValue({ id: mockLawyerAccountId });

      const mockDbReq = {
        id: mockReqId,
        matter_id: mockMatterId,
        title: 'Counseling Requirement',
        authority_type: 'CAS_REQUESTED',
        review_state: 'CONFIRMED',
        completion_state: 'NOT_STARTED',
        lawyer_notes: 'CONFIDENTIAL STRATEGY NOTE FOR LAWYER ONLY',
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null }),
            };
          }
          if (table === 'navigator_case_requirements') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: [mockDbReq], error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
        }),
      };
      (getSupabase as any).mockReturnValue(mockSupabase);

      const result = await listRequirements(mockFirebaseUidLawyer, mockMatterId);
      expect(result).toHaveLength(1);
      expect(result[0].lawyer_notes).toBe('CONFIDENTIAL STRATEGY NOTE FOR LAWYER ONLY');
    });
  });

  describe('4. Cross-Matter Isolation & Professional Access Security', () => {
    it('denies professional access to a matter where professional has no active grant', async () => {
      (findAccount as any).mockResolvedValue({ id: mockLawyerAccountId });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matter_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
            };
          }
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
        }),
      };
      (getSupabase as any).mockReturnValue(mockSupabase);

      await expect(getMatterOverview(mockFirebaseUidLawyer, mockOtherMatterId)).rejects.toThrow(/professional access/i);
    });
  });
});
