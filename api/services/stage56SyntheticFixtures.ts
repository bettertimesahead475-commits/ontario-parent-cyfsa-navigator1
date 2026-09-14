/**
 * Safe Synthetic Test Fixtures for Stage 5 / Stage 6 Integration & QA Framework
 *
 * ABSOLUTELY NO real client data, real CAS files, personal information (PII),
 * production database exports, or secret credentials.
 */

import {
  ReviewedEvidenceReference,
  PotentialIssueReference,
  LegalAuthorityCandidate,
  LegalMappingReview,
  SourceProvenance
} from './stage56Contracts.js';

export const SYNTHETIC_MATTER_ALPHA = '00000000-0000-4000-8000-0000000000a1';
export const SYNTHETIC_MATTER_BETA = '00000000-0000-4000-8000-0000000000b2';

export const SYNTHETIC_DOC_1 = '11111111-1111-4000-8000-111111111111';
export const SYNTHETIC_DOC_2 = '22222222-2222-4000-8000-222222222222';
export const SYNTHETIC_DOC_CROSS_MATTER = '33333333-3333-4000-8000-333333333333';

export const SYNTHETIC_VERSION_1 = 'aaaa1111-1111-4000-8000-111111111111';
export const SYNTHETIC_VERSION_2 = 'bbbb2222-2222-4000-8000-222222222222';

export const SYNTHETIC_PAGE_1 = 'ffff1111-1111-4000-8000-111111111111';
export const SYNTHETIC_PAGE_2 = 'ffff2222-2222-4000-8000-222222222222';

export const SYNTHETIC_RUN_1 = 'eeee1111-1111-4000-8000-111111111111';

export const PROVENANCE_DOC1_PAGE1: SourceProvenance = {
  matterId: SYNTHETIC_MATTER_ALPHA,
  documentId: SYNTHETIC_DOC_1,
  documentVersionId: SYNTHETIC_VERSION_1,
  pageId: SYNTHETIC_PAGE_1,
  pageNumber: 1,
  extractionRunId: SYNTHETIC_RUN_1,
  exactQuote: 'Worker observed parent providing breakfast to child at 8:00 AM.',
  quoteStartOffset: 0,
  quoteEndOffset: 63,
  quoteVerification: 'EXACT'
};

export const PROVENANCE_DOC1_PAGE2_ALLEGATION: SourceProvenance = {
  matterId: SYNTHETIC_MATTER_ALPHA,
  documentId: SYNTHETIC_DOC_1,
  documentVersionId: SYNTHETIC_VERSION_1,
  pageId: SYNTHETIC_PAGE_2,
  pageNumber: 2,
  extractionRunId: SYNTHETIC_RUN_1,
  exactQuote: 'Anonymous caller alleged child was left unsupervised on May 12.',
  quoteStartOffset: 0,
  quoteEndOffset: 64,
  quoteVerification: 'EXACT'
};

export const PROVENANCE_BETA_CROSS_MATTER: SourceProvenance = {
  matterId: SYNTHETIC_MATTER_BETA,
  documentId: SYNTHETIC_DOC_CROSS_MATTER,
  documentVersionId: SYNTHETIC_VERSION_2,
  pageId: SYNTHETIC_PAGE_1,
  pageNumber: 1,
  extractionRunId: SYNTHETIC_RUN_1,
  exactQuote: 'Separate matter synthetic notes from secondary client file.',
  quoteStartOffset: 0,
  quoteEndOffset: 59,
  quoteVerification: 'EXACT'
};

export const SYNTHETIC_EVIDENCE_FACT_REVIEWED: ReviewedEvidenceReference = {
  evidenceId: 'ev-001-fact-reviewed',
  matterId: SYNTHETIC_MATTER_ALPHA,
  provenance: PROVENANCE_DOC1_PAGE1,
  originalClassification: 'UNVERIFIED_CLAIM',
  reviewState: 'CONFIRMED',
  reviewedByUserId: 'user-lawyer-001',
  reviewedAt: '2026-09-14T10:00:00Z',
  reviewerNotes: 'Verified against worker progress notes.',
  isConfirmedFact: true
};

export const SYNTHETIC_EVIDENCE_ALLEGATION_UNREVIEWED: ReviewedEvidenceReference = {
  evidenceId: 'ev-002-allegation-unreviewed',
  matterId: SYNTHETIC_MATTER_ALPHA,
  provenance: PROVENANCE_DOC1_PAGE2_ALLEGATION,
  originalClassification: 'ALLEGATION',
  reviewState: 'UNREVIEWED',
  reviewedByUserId: null,
  reviewedAt: null,
  reviewerNotes: null,
  isConfirmedFact: false
};

export const SYNTHETIC_EVIDENCE_CROSS_MATTER: ReviewedEvidenceReference = {
  evidenceId: 'ev-003-cross-matter-beta',
  matterId: SYNTHETIC_MATTER_BETA,
  provenance: PROVENANCE_BETA_CROSS_MATTER,
  originalClassification: 'FACT',
  reviewState: 'UNREVIEWED',
  reviewedByUserId: null,
  reviewedAt: null,
  reviewerNotes: null,
  isConfirmedFact: false
};

export const SYNTHETIC_ISSUE_BEST_INTERESTS: PotentialIssueReference = {
  issueId: 'issue-001-best-interests',
  matterId: SYNTHETIC_MATTER_ALPHA,
  issueCategory: 'BEST_INTERESTS_OF_CHILD',
  supportingEvidenceIds: ['ev-001-fact-reviewed', 'ev-002-allegation-unreviewed'],
  relevantDates: [
    {
      rawText: '2024-05-12',
      isoDate: '2024-05-12',
      precision: 'EXACT_DAY',
      isAmbiguous: false,
      ambiguityNotes: null
    },
    {
      rawText: 'early June 2024',
      isoDate: null,
      precision: 'MONTH_YEAR',
      isAmbiguous: true,
      ambiguityNotes: 'Exact day not stated in intake notes'
    }
  ],
  summaryStatement: 'Assessment of parental care and supervision during May-June 2024.'
};

export const SYNTHETIC_AUTHORITY_CURRENT: LegalAuthorityCandidate = {
  authorityId: 'auth-cyfsa-74-2',
  authorityType: 'STATUTE_SECTION',
  citation: 'CYFSA 2017, S.O. 2017, c. 14, Sched. 1, s. 74(2)',
  title: 'Child and Family Services Act 2017 - Best Interests Principle',
  sectionNumber: '74(2)',
  inEffectDate: '2018-04-30',
  repealedDate: null,
  isCurrentLaw: true,
  ambiguityReason: null
};

export const SYNTHETIC_AUTHORITY_HISTORICAL: LegalAuthorityCandidate = {
  authorityId: 'auth-cfsa-37-2-historical',
  authorityType: 'STATUTE_SECTION',
  citation: 'CFSA 1990, R.S.O. 1990, c. C.11, s. 37(2) [Repealed]',
  title: 'Child and Family Services Act 1990 (Historical)',
  sectionNumber: '37(2)',
  inEffectDate: '1990-01-01',
  repealedDate: '2018-04-29',
  isCurrentLaw: false,
  ambiguityReason: 'MULTIPLE_HISTORICAL_VERSIONS_APPLY'
};

export const SYNTHETIC_MAPPING_VALID: LegalMappingReview = {
  mappingId: 'map-001-valid',
  matterId: SYNTHETIC_MATTER_ALPHA,
  issueReference: SYNTHETIC_ISSUE_BEST_INTERESTS,
  authorityCandidate: SYNTHETIC_AUTHORITY_CURRENT,
  mappedEvidenceReferences: [SYNTHETIC_EVIDENCE_FACT_REVIEWED, SYNTHETIC_EVIDENCE_ALLEGATION_UNREVIEWED],
  legalConclusionType: 'CANDIDATE_ISSUE',
  reviewState: 'UNREVIEWED',
  isDefinitiveConclusion: false,
  generatedAt: '2026-09-14T10:05:00Z'
};
