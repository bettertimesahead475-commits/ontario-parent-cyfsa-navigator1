/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backend Unit Tests for Analyzer Requirement Extractor (Batch 3)
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  extractAnalyzerRequirements,
  parseExplicitDueDate,
  verifyQuoteInDocumentText,
  sanitizeAuthorityType,
} from './analyzerRequirementExtractor.js';
import * as accessModule from './access.js';
import * as accountsModule from './accounts.js';

const MOCK_MATTER_ID = '11111111-1111-4111-a111-111111111111';
const MOCK_OTHER_MATTER_ID = '99999999-9999-4999-a999-999999999999';
const MOCK_DOC_ID = '22222222-2222-4222-a222-222222222222';
const MOCK_OTHER_DOC_ID = '88888888-8888-4888-a888-888888888888';
const MOCK_VERSION_ID = '33333333-3333-4333-a333-333333333333';
const MOCK_OTHER_VERSION_ID = '77777777-7777-4777-a777-777777777777';
const MOCK_ACCOUNT_ID = 'acc-123';
const MOCK_UID = 'uid-123';

// Mock DB State
let mockRequirements: any[] = [];
let mockDocuments: any[] = [];
let mockDocumentVersions: any[] = [];
let mockEvents: any[] = [];

vi.mock('./access.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      let filterEqs: Record<string, any> = {};
      const builder: any = {
        select: () => builder,
        eq: (field: string, val: any) => {
          filterEqs[field] = val;
          return builder;
        },
        single: async () => {
          if (table === 'navigator_matter_members') {
            if (filterEqs.matter_id === MOCK_MATTER_ID && filterEqs.account_id === MOCK_ACCOUNT_ID) {
              return { data: { role: 'OWNER' }, error: null };
            }
            return { data: null, error: { message: 'Not found' } };
          }
          if (table === 'navigator_documents') {
            const found = mockDocuments.find((d) => d.id === filterEqs.id);
            if (found && (!filterEqs.matter_id || found.matter_id === filterEqs.matter_id)) {
              return { data: found, error: null };
            }
            return { data: null, error: { message: 'Document not found' } };
          }
          if (table === 'navigator_document_versions') {
            const found = mockDocumentVersions.find((v) => v.id === filterEqs.id);
            if (found && (!filterEqs.matter_id || found.matter_id === filterEqs.matter_id)) {
              return { data: found, error: null };
            }
            return { data: null, error: { message: 'Version not found' } };
          }
          return { data: null, error: { message: 'Not found' } };
        },
        order: () => builder,
        insert: (row: any) => {
          if (table === 'navigator_case_requirements') {
            const newReq = { id: `req-${Date.now()}-${Math.random()}`, ...row };
            mockRequirements.push(newReq);
            return {
              select: () => ({
                single: async () => ({ data: newReq, error: null }),
              }),
            };
          }
          if (table === 'navigator_events') {
            mockEvents.push(row);
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          }
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
      };

      // Handle default list query for requirements
      if (table === 'navigator_case_requirements') {
        return {
          ...builder,
          select: () => ({
            eq: (field: string, val: any) => {
              const matched = mockRequirements.filter((r) => r[field] === val);
              return Promise.resolve({ data: matched, error: null });
            },
          }),
        };
      }

      return builder;
    },
  }),
}));

vi.mock('./accounts.js', () => ({
  findAccount: async (uid: string) => {
    if (uid === MOCK_UID) return { id: MOCK_ACCOUNT_ID, firebase_uid: uid };
    return null;
  },
}));

describe('Analyzer Requirement Extractor (Batch 3)', () => {
  beforeEach(() => {
    mockRequirements = [];
    mockEvents = [];
    mockDocuments = [
      { id: MOCK_DOC_ID, matter_id: MOCK_MATTER_ID, title: 'CAS Report.pdf' },
      { id: MOCK_OTHER_DOC_ID, matter_id: MOCK_OTHER_MATTER_ID, title: 'Other Case.pdf' },
    ];
    mockDocumentVersions = [
      { id: MOCK_VERSION_ID, document_id: MOCK_DOC_ID, matter_id: MOCK_MATTER_ID },
      { id: MOCK_OTHER_VERSION_ID, document_id: MOCK_OTHER_DOC_ID, matter_id: MOCK_OTHER_MATTER_ID },
    ];
  });

  describe('Helper functions & safety invariants', () => {
    it('parseExplicitDueDate preserves valid ISO dates and rejects vague phrases', () => {
      expect(parseExplicitDueDate('2026-10-15')).toContain('2026-10-15');
      expect(parseExplicitDueDate('as soon as possible')).toBeNull();
      expect(parseExplicitDueDate('immediately')).toBeNull();
      expect(parseExplicitDueDate('shortly upon request')).toBeNull();
      expect(parseExplicitDueDate(null)).toBeNull();
    });

    it('verifyQuoteInDocumentText correctly verifies exact or normalized quotes', () => {
      const docText = 'The parent shall attend a 6-week parenting course starting October 1.';
      expect(verifyQuoteInDocumentText(docText, 'attend a 6-week parenting course')).toBe(true);
      expect(verifyQuoteInDocumentText(docText, 'attend  a   6-week  parenting')).toBe(true); // normalized whitespace
      expect(verifyQuoteInDocumentText(docText, 'parent must go to anger management')).toBe(false);
    });

    it('sanitizeAuthorityType prevents CAS requests from becoming COURT_ORDERED or STATUTORY_REGULATORY', () => {
      expect(sanitizeAuthorityType('COURT_ORDERED', 'CAS worker recommended parenting class')).toBe('CAS_REQUESTED');
      expect(sanitizeAuthorityType('STATUTORY_REGULATORY', 'CAS letter states worker advice')).toBe('CAS_REQUESTED');
      expect(sanitizeAuthorityType('CAS_REQUESTED', 'CAS worker email')).toBe('CAS_REQUESTED');
      expect(sanitizeAuthorityType('COURT_ORDERED', 'Court Order by Justice Smith')).toBe('COURT_ORDERED');
    });
  });

  describe('extractAnalyzerRequirements integration', () => {
    it('extracts CAS request as PROPOSED item with review_state = PROPOSED (never auto-confirmed)', async () => {
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentVersionId: MOCK_VERSION_ID,
        documentText: 'CAS worker requested parent complete drug screening by October 30.',
        candidates: [
          {
            title: 'Complete Drug Screening',
            description: 'CAS worker request for weekly screening',
            proposedAuthorityType: 'CAS_REQUESTED',
            sourceDocumentId: MOCK_DOC_ID,
            sourceDocumentVersionId: MOCK_VERSION_ID,
            sourcePageNumber: 2,
            sourceExactQuote: 'CAS worker requested parent complete drug screening',
            explicitDueDate: '2026-10-30',
          },
        ],
      });

      expect(result.extractedCount).toBe(1);
      expect(result.items[0].review_state).toBe('PROPOSED');
      expect(result.items[0].authority_type).toBe('CAS_REQUESTED');
      expect(result.items[0].source_document_id).toBe(MOCK_DOC_ID);
      expect(result.items[0].source_page_number).toBe(2);
      expect(result.items[0].source_exact_quote).toBe('CAS worker requested parent complete drug screening');
      expect(result.items[0].due_at).toContain('2026-10-30');
    });

    it('extracts actual court-order language as PROPOSED COURT_ORDERED with exact quote preserved', async () => {
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentText: 'IT IS ORDERED THAT the mother shall have supervised access on Saturdays.',
        candidates: [
          {
            title: 'Supervised Access Schedule',
            proposedAuthorityType: 'COURT_ORDERED',
            sourceDocumentId: MOCK_DOC_ID,
            sourcePageNumber: 1,
            sourceExactQuote: 'IT IS ORDERED THAT the mother shall have supervised access on Saturdays.',
          },
        ],
      });

      expect(result.extractedCount).toBe(1);
      expect(result.items[0].review_state).toBe('PROPOSED');
      expect(result.items[0].authority_type).toBe('COURT_ORDERED');
    });

    it('rejects AI paraphrase when source quote containment fails', async () => {
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentText: 'Actual document content text.',
        candidates: [
          {
            title: 'Paraphrased Item',
            sourceDocumentId: MOCK_DOC_ID,
            sourcePageNumber: 1,
            sourceExactQuote: 'AI GENERATED PARAPHRASED TEXT THAT IS NOT IN SOURCE',
          },
        ],
      });

      expect(result.extractedCount).toBe(0);
    });

    it('rejects vague deadline and sets due_at to null', async () => {
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentText: 'Parent to contact counselor as soon as possible.',
        candidates: [
          {
            title: 'Contact Counselor',
            sourceDocumentId: MOCK_DOC_ID,
            sourcePageNumber: 1,
            sourceExactQuote: 'Parent to contact counselor as soon as possible.',
            explicitDueDate: 'as soon as possible',
          },
        ],
      });

      expect(result.extractedCount).toBe(1);
      expect(result.items[0].due_at).toBeNull();
    });

    it('prevents duplicate extraction when same document and quote are re-analyzed', async () => {
      // First run
      await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentText: 'Parent must submit progress report.',
        candidates: [
          {
            title: 'Submit Progress Report',
            sourceDocumentId: MOCK_DOC_ID,
            sourcePageNumber: 3,
            sourceExactQuote: 'Parent must submit progress report.',
          },
        ],
      });

      // Second run with duplicate payload
      const result2 = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentText: 'Parent must submit progress report.',
        candidates: [
          {
            title: 'Submit Progress Report',
            sourceDocumentId: MOCK_DOC_ID,
            sourcePageNumber: 3,
            sourceExactQuote: 'Parent must submit progress report.',
          },
        ],
      });

      expect(result2.extractedCount).toBe(0);
      expect(result2.skippedDuplicates).toBe(1);
    });

    it('blocks cross-matter document extraction', async () => {
      await expect(
        extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
          documentId: MOCK_OTHER_DOC_ID, // Document belongs to MOCK_OTHER_MATTER_ID
          candidates: [
            {
              title: 'Cross matter attempt',
              sourceDocumentId: MOCK_OTHER_DOC_ID,
              sourcePageNumber: 1,
              sourceExactQuote: 'quote',
            },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REFERENCE' });
    });

    it('blocks cross-matter document version extraction', async () => {
      await expect(
        extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
          documentId: MOCK_DOC_ID,
          documentVersionId: MOCK_OTHER_VERSION_ID, // Version belongs to other matter
          candidates: [
            {
              title: 'Cross matter version attempt',
              sourceDocumentId: MOCK_DOC_ID,
              sourcePageNumber: 1,
              sourceExactQuote: 'quote',
            },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REFERENCE' });
    });
  });
});
