import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  getIntelligenceCategory, 
  saveProfessionalReview, 
  getProfessionalSourcePage 
} from './professionalWorkspace.js';
import { getWorkProductVersions, finalizeCaseBrief } from './litigationWorkProduct.js';

// Mock dependencies
vi.mock('./access.js', () => ({
  getSupabase: vi.fn()
}));

vi.mock('./accounts.js', () => ({
  findAccount: vi.fn()
}));

import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';

describe('Stage 11 Slice 2: Professional Review & Work Product Invariants', () => {
  const mockFirebaseUid = 'firebase-user-123';
  const mockAccountId = 'acc-123-uuid';
  const mockMatterId = '00000000-0000-4000-a000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    (findAccount as any).mockResolvedValue({ id: mockAccountId });
  });

  it('1. Separation Invariant: professional reviews do not overwrite underlying machine intelligence', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'navigator_matter_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null })
          };
        }
        if (table === 'navigator_evidence_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                { id: 'ev-1', matter_id: mockMatterId, normalized_statement: 'Machine extracted fact', classification: 'FACT' }
              ],
              error: null
            })
          };
        }
        if (table === 'professional_reviews') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: vi.fn().mockImplementation((cb: any) => cb({
              data: [
                { finding_id: 'ev-1', review_state: 'CONFIRMED_RELEVANT', review_note: 'Lawyer work product note' }
              ],
              error: null
            }))
          };
        }
        return {};
      })
    };

    (getSupabase as any).mockReturnValue(mockDb);

    const result = await getIntelligenceCategory(mockFirebaseUid, mockMatterId, 'EVIDENCE');
    
    // Check machine items remain intact
    expect(result.items.length).toBe(1);
    expect(result.items[0].normalized_statement).toBe('Machine extracted fact');
    
    // Check lawyer review state is kept separate
    expect(result.reviews.length).toBe(1);
    expect(result.reviews[0].review_state).toBe('CONFIRMED_RELEVANT');
    expect(result.reviews[0].review_note).toBe('Lawyer work product note');
  });

  it('2. Review Disposition Upsert: allows saving lawyer annotations non-destructively', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'rev-99',
        matter_id: mockMatterId,
        finding_id: 'finding-1',
        finding_type: 'EVIDENCE',
        reviewer_account_id: mockAccountId,
        review_state: 'CONFIRMED_RELEVANT',
        review_note: 'Verified against source document'
      },
      error: null
    });

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'navigator_matter_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null })
          };
        }
        if (table === 'professional_reviews') {
          return {
            upsert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: mockSingle
          };
        }
        return {};
      })
    };

    (getSupabase as any).mockReturnValue(mockDb);

    const saved = await saveProfessionalReview(
      mockFirebaseUid,
      mockMatterId,
      'EVIDENCE',
      '00000000-0000-4000-a000-000000000002',
      'CONFIRMED_RELEVANT',
      'Verified against source document'
    );

    expect(saved.review_state).toBe('CONFIRMED_RELEVANT');
    expect(saved.review_note).toBe('Verified against source document');
  });

  it('3. Source Jump-Back Invariant: resolves source page text cleanly for evidence items', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'navigator_matter_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'REVIEWER' }, error: null })
          };
        }
        if (table === 'navigator_evidence_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: '00000000-0000-4000-a000-000000000003',
                matter_id: mockMatterId,
                document_id: 'doc-1',
                document_version_id: 'ver-1',
                page_id: 'page-10',
                page_number: 4
              },
              error: null
            })
          };
        }
        if (table === 'navigator_document_pages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'page-10',
                page_number: 4,
                text: 'The parent provided regular care and structure for the child.'
              },
              error: null
            })
          };
        }
        return {};
      })
    };

    (getSupabase as any).mockReturnValue(mockDb);

    const sourceData = await getProfessionalSourcePage(
      mockFirebaseUid,
      mockMatterId,
      '00000000-0000-4000-a000-000000000003'
    );

    expect(sourceData.page.page_number).toBe(4);
    expect(sourceData.page.text).toContain('regular care and structure');
  });
});
