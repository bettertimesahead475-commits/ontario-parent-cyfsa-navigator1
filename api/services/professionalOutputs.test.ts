import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LEGAL_DISCLAIMER,
  getProfessionalCaseBriefOutput,
  getChronologyOutput,
  getEvidenceIssuesPackageOutput
} from './professionalOutputs.js';
import { LifecycleError } from './lifecycleErrors.js';

// Mock dependencies
vi.mock('./access.js', () => ({
  getSupabase: vi.fn()
}));

vi.mock('./accounts.js', () => ({
  findAccount: vi.fn()
}));

vi.mock('./professionalWorkspace.js', () => ({
  requireProfessionalAccess: vi.fn()
}));

vi.mock('./litigationWorkProduct.js', () => ({
  generateCaseBrief: vi.fn()
}));

import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { requireProfessionalAccess } from './professionalWorkspace.js';
import { generateCaseBrief } from './litigationWorkProduct.js';

function createMockQuery(data: any) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] || null : data, error: null })),
    then: (onfulfilled?: ((value: any) => any) | null) => Promise.resolve({ data, error: null }).then(onfulfilled)
  };
  return query;
}

describe('Stage 11 Slice 4: Professional Outputs Layer', () => {
  const mockProUid = 'firebase-pro-uid-123';
  const mockProAccountId = 'acc-pro-uuid-001';
  const mockMatterId = '00000000-0000-4000-a000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Output A: Case Brief Output', () => {
    it('returns generated case brief with appended legal disclaimer', async () => {
      (generateCaseBrief as any).mockResolvedValue({
        matterId: mockMatterId,
        title: 'Case Brief Title',
        summary: 'Brief summary'
      });

      const res = await getProfessionalCaseBriefOutput(mockProUid, mockMatterId);

      expect(generateCaseBrief).toHaveBeenCalledWith(mockProUid, mockMatterId);
      expect(res.disclaimer).toBe(LEGAL_DISCLAIMER);
      expect(res.title).toBe('Case Brief Title');
    });
  });

  describe('2. Output B: Chronology Output', () => {
    it('returns chronology events with source provenance and professional review', async () => {
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });
      (requireProfessionalAccess as any).mockResolvedValue({ role: 'PROFESSIONAL' });

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matters') {
            return createMockQuery({ title: 'Test CYFSA Matter' });
          }
          if (table === 'navigator_events') {
            return createMockQuery([
              {
                id: 'evt-1',
                date_original_text: '2025-01-15',
                date_precision: 'DAY',
                date_lower_bound: '2025-01-15T00:00:00Z',
                date_upper_bound: '2025-01-15T23:59:59Z',
                description: 'Society initial visit',
                document_id: 'doc-101',
                page_number: 2
              }
            ]);
          }
          if (table === 'professional_reviews') {
            return createMockQuery([
              {
                finding_type: 'CHRONOLOGY',
                finding_id: 'evt-1',
                review_state: 'CONFIRMED_RELEVANT',
                review_note: 'Verified against Society notes',
                updated_at: '2026-09-20T10:00:00Z'
              }
            ]);
          }
          return createMockQuery([]);
        })
      };

      (getSupabase as any).mockReturnValue(mockDb);

      const res = await getChronologyOutput(mockProUid, mockMatterId);

      expect(requireProfessionalAccess).toHaveBeenCalledWith(mockDb, mockProAccountId, mockMatterId);
      expect(res.outputType).toBe('CHRONOLOGY');
      expect(res.matterTitle).toBe('Test CYFSA Matter');
      expect(res.disclaimer).toBe(LEGAL_DISCLAIMER);
      expect(res.events.length).toBe(1);
      expect(res.events[0].aiClassification).toBe('AI-ASSISTED CHRONOLOGY (DRAFT)');
      expect(res.events[0].provenance.hasSourceProvenance).toBe(true);
      expect(res.events[0].professionalReview?.reviewState).toBe('CONFIRMED_RELEVANT');
    });
  });

  describe('3. Output C: Evidence & Issues Package Output (Exact Quote Contract)', () => {
    it('returns exact quote only when verified (EXACT / NORMALIZED_WHITESPACE), null otherwise', async () => {
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });
      (requireProfessionalAccess as any).mockResolvedValue({ role: 'PROFESSIONAL' });

      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'navigator_matters') {
            return createMockQuery({ title: 'Test CYFSA Matter' });
          }
          if (table === 'navigator_evidence_items') {
            return createMockQuery([
              {
                id: 'ev-1',
                classification: 'FACT',
                normalized_statement: 'Parent attended all scheduled visits.',
                exact_quote: 'The parent attended every scheduled visit without delay.',
                quote_verification: 'EXACT',
                document_id: 'doc-1',
                page_number: 4
              },
              {
                id: 'ev-2',
                classification: 'ALLEGATION',
                normalized_statement: 'Worker observed dirty dishes.',
                exact_quote: 'Worker observed dishes in the sink.',
                quote_verification: 'FAILED_MATCH',
                document_id: 'doc-1',
                page_number: 5
              }
            ]);
          }
          if (table === 'navigator_claims') {
            return createMockQuery([
              {
                id: 'cl-1',
                claim_text: 'Society failed to provide adequate family support services.',
                classification: 'UNVERIFIED_CLAIM'
              }
            ]);
          }
          if (table === 'navigator_evidence_gap_findings') {
            return createMockQuery([
              {
                id: 'gap-1',
                gap_type: 'MISSING_RECORD',
                description: 'Supervised visit log for February missing.'
              }
            ]);
          }
          if (table === 'professional_reviews') {
            return createMockQuery([]);
          }
          return createMockQuery([]);
        })
      };

      (getSupabase as any).mockReturnValue(mockDb);

      const res = await getEvidenceIssuesPackageOutput(mockProUid, mockMatterId);

      expect(res.outputType).toBe('EVIDENCE_ISSUES_PACKAGE');
      expect(res.disclaimer).toBe(LEGAL_DISCLAIMER);
      expect(res.evidenceItems.length).toBe(2);

      // Verified exact quote returned
      expect(res.evidenceItems[0].exactQuote).toBe('The parent attended every scheduled visit without delay.');
      expect(res.evidenceItems[0].quoteVerificationStatus).toBe('EXACT');

      // Unverified quote masked to null for legal safety
      expect(res.evidenceItems[1].exactQuote).toBeNull();
      expect(res.evidenceItems[1].quoteVerificationStatus).toBe('FAILED_MATCH');

      // Claims and Gaps present
      expect(res.materialClaims.length).toBe(1);
      expect(res.evidenceGaps.length).toBe(1);
    });
  });

  describe('4. Authorization & Revocation Safeguard', () => {
    it('rejects access if requireProfessionalAccess throws 403 FORBIDDEN', async () => {
      (findAccount as any).mockResolvedValue({ id: mockProAccountId });
      (requireProfessionalAccess as any).mockRejectedValue(
        new LifecycleError(403, 'FORBIDDEN', 'Access to this matter is not granted or has been revoked.')
      );

      (getSupabase as any).mockReturnValue({});

      await expect(getChronologyOutput(mockProUid, mockMatterId)).rejects.toThrow('Access to this matter is not granted or has been revoked.');
    });
  });
});
