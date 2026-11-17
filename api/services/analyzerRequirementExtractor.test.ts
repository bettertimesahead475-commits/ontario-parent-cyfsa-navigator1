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
  analyzerRequirementId,
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
let mockPages: any[] = [];
let failInsert = false;
let insertAttempt = 0;
let failOnInsert = 0;
let failList = false;

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
            insertAttempt++;
            if (failInsert || insertAttempt === failOnInsert) return {select: () => ({single: async () => ({data: null, error: {code: 'XX000'}})})};
            if (mockRequirements.some(r => r.id === row.id)) return {select: () => ({single: async () => ({data: null, error: {code: '23505'}})})};
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

      if (table === 'navigator_document_pages') return {
        select: () => ({eq: (_field: string, value: string) => Promise.resolve({data: mockPages.filter(p => p.document_version_id === value), error: null})}),
      };
      // Handle default list query for requirements
      if (table === 'navigator_case_requirements') {
        return {
          ...builder,
          select: () => ({
            eq: (field: string, val: any) => {
              const matched = mockRequirements.filter((r) => r[field] === val);
              return Promise.resolve({ data: matched, error: failList ? {code: 'XX000'} : null });
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
    failInsert = false;
    insertAttempt = 0;
    failOnInsert = 0;
    failList = false;
    const source = [
      'CAS worker requested parent complete drug screening by 2026-10-30.',
      'IT IS ORDERED THAT the mother shall have supervised access on Saturdays.',
      'Parent to contact counselor as soon as possible.',
      'Parent must submit progress report.',
    ].join(' ');
    mockPages = [1, 2, 3].map(page_number => ({document_version_id: MOCK_VERSION_ID, page_number, text: source}));
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
      for (const date of ['October 15, 2026', '2026-02-30', '2026-02-30T12:00:00Z', '2026-10-30T24:00:00Z', '2026-13-01']) expect(parseExplicitDueDate(date)).toBeNull();
      expect(parseExplicitDueDate('2026-10-15T12:30:00-04:00')).toBe('2026-10-15T16:30:00.000Z');
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
            sourceExactQuote: 'CAS worker requested parent complete drug screening by 2026-10-30.',
            explicitDueDate: '2026-10-30',
          },
        ],
      });

      expect(result.extractedCount).toBe(1);
      expect(result.items[0].review_state).toBe('PROPOSED');
      expect(result.items[0].authority_type).toBe('CAS_REQUESTED');
      expect(result.items[0].source_document_id).toBe(MOCK_DOC_ID);
      expect(result.items[0].source_page_number).toBe(2);
      expect(result.items[0].source_exact_quote).toBe('CAS worker requested parent complete drug screening by 2026-10-30.');
      expect(result.items[0].due_at).toContain('2026-10-30');
    });

    it('extracts actual court-order language as PROPOSED COURT_ORDERED with exact quote preserved', async () => {
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
        documentId: MOCK_DOC_ID,
        documentVersionId: MOCK_VERSION_ID,
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
        documentVersionId: MOCK_VERSION_ID,
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
        documentVersionId: MOCK_VERSION_ID,
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
        documentVersionId: MOCK_VERSION_ID,
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
        documentVersionId: MOCK_VERSION_ID,
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

    const candidate = () => ({title: 'Submit Progress Report', sourceDocumentId: MOCK_DOC_ID, sourcePageNumber: 3, sourceExactQuote: 'Parent must submit progress report.'});
    const payload = () => ({documentId: MOCK_DOC_ID, documentVersionId: MOCK_VERSION_ID, candidates: [candidate()]});

    it('ignores forged browser text and rejects quotations absent from the stored page', async () => {
      const p = payload();
      p.candidates[0].sourceExactQuote = 'Forged source quote';
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {...p, documentText: 'Forged source quote'});
      expect(result.extractedCount).toBe(0);
      expect(result.rejectedCandidates).toBe(1);
    });

    it('does not borrow a quotation from a different page', async () => {
      mockPages.find(p => p.page_number === 3).text = 'Different page';
      expect((await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload())).extractedCount).toBe(0);
    });

    it('requires stored pages and an exact version, without falling back to browser text', async () => {
      mockPages = [];
      await expect(extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload())).rejects.toMatchObject({code: 'SOURCE_UNAVAILABLE'});
      await expect(extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {...payload(), documentVersionId: null})).rejects.toMatchObject({statusCode: 400});
    });

    it('preserves distinct claims with the same title and quotations on different versions', async () => {
      await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload());
      const p = payload();
      p.candidates[0].sourceExactQuote = 'Parent to contact counselor as soon as possible.';
      expect((await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, p)).extractedCount).toBe(1);
      mockDocumentVersions = mockDocumentVersions.filter(v => v.id !== MOCK_OTHER_VERSION_ID);
      mockDocumentVersions.push({id: MOCK_OTHER_VERSION_ID, document_id: MOCK_DOC_ID});
      mockPages.push({...mockPages[2], document_version_id: MOCK_OTHER_VERSION_ID});
      expect((await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {...payload(), documentVersionId: MOCK_OTHER_VERSION_ID})).extractedCount).toBe(1);
      expect(mockRequirements).toHaveLength(3);
    });

    it('rejects candidate document/version identity mismatches', async () => {
      const p = payload();
      p.candidates[0].sourceDocumentId = MOCK_OTHER_DOC_ID;
      expect((await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, p)).extractedCount).toBe(0);
      expect((await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {...payload(), candidates: [{...candidate(), sourceDocumentVersionId: MOCK_OTHER_VERSION_ID}]})).extractedCount).toBe(0);
    });

    it('reports insert failures and safely retries without overwriting reviewed records', async () => {
      failInsert = true;
      await expect(extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload())).rejects.toMatchObject({code: 'IMPORT_INCOMPLETE'});
      failInsert = false;
      await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload());
      mockRequirements[0].review_state = 'CONFIRMED';
      expect((await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload())).skippedDuplicates).toBe(1);
      expect(mockRequirements[0].review_state).toBe('CONFIRMED');
      failList = true;
      await expect(extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload())).rejects.toMatchObject({code: 'IMPORT_UNAVAILABLE'});
    });

    it('deduplicates concurrent imports through the primary key', async () => {
      const results = await Promise.all([
        extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload()),
        extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, payload()),
      ]);
      expect(mockRequirements).toHaveLength(1);
      expect(results.reduce((count, r) => count + r.extractedCount, 0)).toBe(1);
      expect(results.reduce((count, r) => count + r.skippedDuplicates, 0)).toBe(1);
    });

    it('recovers a partial batch without losing or duplicating saved findings', async () => {
      const p = {...payload(), candidates: [candidate(), {...candidate(), title: 'Contact counselor', sourceExactQuote: 'Parent to contact counselor as soon as possible.'}]};
      failOnInsert = 2;
      await expect(extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, p)).rejects.toMatchObject({code: 'IMPORT_INCOMPLETE'});
      expect(mockRequirements).toHaveLength(1);
      failOnInsert = 0;
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, p);
      expect(result.skippedDuplicates).toBe(1);
      expect(result.extractedCount).toBe(1);
      expect(mockRequirements).toHaveLength(2);
    });

    it('does not promote a valid ISO deadline absent from the source quotation', async () => {
      const result = await extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {...payload(), candidates: [{...candidate(), explicitDueDate: '2026-10-30'}]});
      expect(result.items[0].due_at).toBeNull();
    });

    it('has stable version- and location-specific IDs', () => {
      const key = (version = MOCK_VERSION_ID, page = 3, quote = 'a quote') => analyzerRequirementId(MOCK_MATTER_ID, MOCK_DOC_ID, version, page, quote, 'Same title');
      expect(key()).toBe(key());
      expect(key()).toBe(key(MOCK_VERSION_ID, 3, 'a  quote'));
      expect(key()).not.toBe(key(MOCK_OTHER_VERSION_ID));
      expect(key()).not.toBe(key(MOCK_VERSION_ID, 4));
    });

    it('blocks cross-matter document extraction', async () => {
      await expect(
        extractAnalyzerRequirements(MOCK_UID, MOCK_MATTER_ID, {
          documentId: MOCK_OTHER_DOC_ID,
          documentVersionId: MOCK_VERSION_ID, // Document belongs to MOCK_OTHER_MATTER_ID
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
