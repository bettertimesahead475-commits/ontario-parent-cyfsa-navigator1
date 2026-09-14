import { describe, it, expect } from 'vitest';
import {
  CONTRACT_VERSION,
  validateSourceProvenance,
  validateFactPromotionInvariant,
  validateLegalMappingContract,
  validateLegalLanguageSafety
} from './stage56Contracts.js';
import {
  SYNTHETIC_MATTER_ALPHA,
  SYNTHETIC_MATTER_BETA,
  PROVENANCE_DOC1_PAGE1,
  PROVENANCE_DOC1_PAGE2_ALLEGATION,
  PROVENANCE_BETA_CROSS_MATTER,
  SYNTHETIC_EVIDENCE_FACT_REVIEWED,
  SYNTHETIC_EVIDENCE_ALLEGATION_UNREVIEWED,
  SYNTHETIC_EVIDENCE_CROSS_MATTER,
  SYNTHETIC_ISSUE_BEST_INTERESTS,
  SYNTHETIC_AUTHORITY_CURRENT,
  SYNTHETIC_AUTHORITY_HISTORICAL,
  SYNTHETIC_MAPPING_VALID
} from './stage56SyntheticFixtures.js';
import {
  PerformanceCounterTracker,
  calculateBenchmarkSummary,
  ModelBenchmarkResult
} from './benchmarkHarness.js';

describe('Stage 5 & Stage 6 Cross-Stage Integration & Contract Audits', () => {
  it('exposes the contract version marker', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0-stage56-contract');
  });

  describe('Invariant 1: Provenance IDs and Integrity', () => {
    it('requires complete provenance IDs (matter, doc, version, page, run)', () => {
      const validRes = validateSourceProvenance(PROVENANCE_DOC1_PAGE1);
      expect(validRes.isValid).toBe(true);
      expect(validRes.errors).toHaveLength(0);

      const invalidProv = { ...PROVENANCE_DOC1_PAGE1, matterId: '' };
      const invalidRes = validateSourceProvenance(invalidProv);
      expect(invalidRes.isValid).toBe(false);
      expect(invalidRes.errors).toContain('matterId is required');
    });

    it('rejects verified quotes with invalid or negative offset bounds', () => {
      const badOffsets = { ...PROVENANCE_DOC1_PAGE1, quoteStartOffset: -5 };
      const res = validateSourceProvenance(badOffsets);
      expect(res.isValid).toBe(false);
      expect(res.errors).toContain('quoteStartOffset must be >= 0 for verified quotes');
    });

    it('requires null offsets for unverified or ambiguous quotes', () => {
      const unverifiedWithOffsets = {
        ...PROVENANCE_DOC1_PAGE1,
        quoteVerification: 'ABSENT',
        quoteStartOffset: 0,
        quoteEndOffset: 10
      };
      const res = validateSourceProvenance(unverifiedWithOffsets);
      expect(res.isValid).toBe(false);
      expect(res.errors).toContain('Unverified/ambiguous quotes must have null offsets');
    });
  });

  describe('Invariant 2: Fact vs Allegation Promotion Protection', () => {
    it('prevents promoting an ALLEGATION to confirmed fact without human review and confirmation', () => {
      const res = validateFactPromotionInvariant('ALLEGATION', 'REVIEWED', true);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain('INVARIANT VIOLATION: Allegation cannot be promoted to confirmed fact');
    });

    it('prevents treating UNREVIEWED evidence as a confirmed fact', () => {
      const res = validateFactPromotionInvariant('FACT', 'UNREVIEWED', true);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain('INVARIANT VIOLATION: Unreviewed evidence cannot be treated as confirmed fact');
    });

    it('allows confirmed fact status for verified fact classification after human review', () => {
      const res = validateFactPromotionInvariant('FACT', 'CONFIRMED', true);
      expect(res.isValid).toBe(true);
    });
  });

  describe('Invariant 3: Legal Mapping Traceability & Ambiguity', () => {
    it('validates a complete, source-traceable legal mapping', () => {
      const res = validateLegalMappingContract(SYNTHETIC_MAPPING_VALID);
      expect(res.isValid).toBe(true);
    });

    it('rejects legal mappings without supporting evidence references', () => {
      const noEvidence = { ...SYNTHETIC_MAPPING_VALID, mappedEvidenceReferences: [] };
      const res = validateLegalMappingContract(noEvidence);
      expect(res.isValid).toBe(false);
      expect(res.errors).toContain('INVARIANT VIOLATION: Legal mapping cannot exist without supporting evidence references');
    });

    it('rejects legal mappings marked as definitive conclusions', () => {
      const definitive = { ...SYNTHETIC_MAPPING_VALID, isDefinitiveConclusion: true };
      const res = validateLegalMappingContract(definitive);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain('INVARIANT VIOLATION: Legal mappings must never be marked as definitive conclusions');
    });

    it('rejects cross-matter evidence leakage inside a legal mapping', () => {
      const crossMatterMapping = {
        ...SYNTHETIC_MAPPING_VALID,
        mappedEvidenceReferences: [SYNTHETIC_EVIDENCE_FACT_REVIEWED, SYNTHETIC_EVIDENCE_CROSS_MATTER]
      };
      const res = validateLegalMappingContract(crossMatterMapping);
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.includes('does not match mapping matterId'))).toBe(true);
    });

    it('requires ambiguity reason when matching against historical/repealed legal authority', () => {
      const historicalWithoutReason = {
        ...SYNTHETIC_MAPPING_VALID,
        authorityCandidate: { ...SYNTHETIC_AUTHORITY_HISTORICAL, ambiguityReason: null }
      };
      const res = validateLegalMappingContract(historicalWithoutReason);
      expect(res.isValid).toBe(false);
      expect(res.errors).toContain('INVARIANT VIOLATION: Historical/repealed legal authority must specify an ambiguityReason');
    });
  });

  describe('Invariant 4: AI Safety & Prohibited Language Checks', () => {
    it('detects and rejects prohibited definitive legal statements', () => {
      const unsafeOutput = 'Based on page 2, this proves that the parent lied about employment.';
      const res = validateLegalLanguageSafety(unsafeOutput);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]).toContain('PROHIBITED DEFINITIVE LANGUAGE DETECTED');
    });

    it('passes neutral, source-attributed language', () => {
      const safeOutput = 'Progress notes on page 2 record worker observations regarding employment statements.';
      const res = validateLegalLanguageSafety(safeOutput);
      expect(res.isValid).toBe(true);
    });
  });

  describe('Benchmark Harness & Performance Baseline Counters', () => {
    it('tracks system performance metrics cleanly', () => {
      const tracker = new PerformanceCounterTracker();
      tracker.recordExtraction(150, true);
      tracker.recordAiCall(500, 150);
      tracker.recordQueryTime('EVIDENCE', 25);
      tracker.recordQueryTime('LEGAL_RESOLUTION', 40);

      const snapshot = tracker.getSnapshot();
      expect(snapshot.pageExtractionTimeMs).toBe(150);
      expect(snapshot.cacheReuseHits).toBe(1);
      expect(snapshot.repeatedOcrAvoidedCount).toBe(1);
      expect(snapshot.numberOfAiCalls).toBe(1);
      expect(snapshot.evidenceRetrievalTimeMs).toBe(25);
      expect(snapshot.legalResolutionTimeMs).toBe(40);
    });

    it('calculates benchmark summary scores for evaluation suite', () => {
      const mockResult: ModelBenchmarkResult = {
        modelIdentifier: 'CYFSA_NAVIGATOR',
        suiteId: 'suite-001',
        evaluatedAt: '2026-09-14T10:00:00Z',
        metrics: {
          factualAccuracyScore: 0.95,
          importantFactRecallScore: 0.90,
          unsupportedClaimRate: 0.02,
          namesAndDatesAccuracyScore: 0.98,
          allegationVsFactAccuracyScore: 0.96,
          chronologyAccuracyScore: 0.92,
          sourcePageAttributionScore: 1.0,
          contradictionIdentificationScore: 0.88,
          legalIssueSpottingScore: 0.94,
          lawyerUsefulnessRating: 4.8,
          totalLatencyMs: 450,
          totalEstimatedCostUsd: 0.005
        },
        performanceCounters: {
          pageExtractionTimeMs: 120,
          evidenceRetrievalTimeMs: 30,
          matterReviewQueryTimeMs: 50,
          legalResolutionTimeMs: 60,
          numberOfAiCalls: 2,
          tokensPerAnalysisInput: 1200,
          tokensPerAnalysisOutput: 300,
          cacheReuseHits: 1,
          repeatedOcrAvoidedCount: 1,
          paginationEfficiencyRatio: 1.0,
          detectedNPlus1QueriesCount: 0
        }
      };

      const summary = calculateBenchmarkSummary(mockResult);
      expect(summary.overallQualityScore).toBeGreaterThan(0.90);
      expect(summary.safetyScore).toBeGreaterThan(0.90);
      expect(summary.efficiencyScore).toBe(1.0);
    });
  });
});
