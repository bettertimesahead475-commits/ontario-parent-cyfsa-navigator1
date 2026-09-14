/**
 * Stage 5/6 Benchmark Harness & Performance Baseline Counter Framework
 *
 * Interface definitions and synthetic evaluation metrics for comparing:
 * - CYFSA Navigator Pipeline
 * - Baseline ChatGPT
 * - Baseline Claude
 *
 * Does NOT call external AI providers.
 */

export interface BenchmarkMetrics {
  readonly factualAccuracyScore: number; // 0.0 to 1.0
  readonly importantFactRecallScore: number; // 0.0 to 1.0
  readonly unsupportedClaimRate: number; // 0.0 to 1.0 (lower is better)
  readonly namesAndDatesAccuracyScore: number; // 0.0 to 1.0
  readonly allegationVsFactAccuracyScore: number; // 0.0 to 1.0
  readonly chronologyAccuracyScore: number; // 0.0 to 1.0
  readonly sourcePageAttributionScore: number; // 0.0 to 1.0
  readonly contradictionIdentificationScore: number; // 0.0 to 1.0
  readonly legalIssueSpottingScore: number; // 0.0 to 1.0
  readonly lawyerUsefulnessRating: number; // 1 to 5 scale
  readonly totalLatencyMs: number;
  readonly totalEstimatedCostUsd: number;
}

export interface SystemPerformanceCounters {
  pageExtractionTimeMs: number;
  evidenceRetrievalTimeMs: number;
  matterReviewQueryTimeMs: number;
  legalResolutionTimeMs: number;
  numberOfAiCalls: number;
  tokensPerAnalysisInput: number;
  tokensPerAnalysisOutput: number;
  cacheReuseHits: number;
  repeatedOcrAvoidedCount: number;
  paginationEfficiencyRatio: number; // e.g. fetched items vs total items
  detectedNPlus1QueriesCount: number;
}

export interface BenchmarkSuiteDefinition {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly suiteType: 'SINGLE_DOCUMENT' | 'SAME_MATTER_MULTI_DOC' | 'CROSS_MATTER_ISOLATION';
  readonly testFixtureCaseIds: readonly string[];
}

export interface ModelBenchmarkResult {
  readonly modelIdentifier: 'CYFSA_NAVIGATOR' | 'CHATGPT_BASE' | 'CLAUDE_BASE';
  readonly suiteId: string;
  readonly evaluatedAt: string;
  readonly metrics: BenchmarkMetrics;
  readonly performanceCounters: SystemPerformanceCounters;
}

export class PerformanceCounterTracker {
  private counters: SystemPerformanceCounters = {
    pageExtractionTimeMs: 0,
    evidenceRetrievalTimeMs: 0,
    matterReviewQueryTimeMs: 0,
    legalResolutionTimeMs: 0,
    numberOfAiCalls: 0,
    tokensPerAnalysisInput: 0,
    tokensPerAnalysisOutput: 0,
    cacheReuseHits: 0,
    repeatedOcrAvoidedCount: 0,
    paginationEfficiencyRatio: 1.0,
    detectedNPlus1QueriesCount: 0
  };

  public recordExtraction(durationMs: number, wasCached: boolean) {
    this.counters.pageExtractionTimeMs += durationMs;
    if (wasCached) {
      this.counters.cacheReuseHits++;
      this.counters.repeatedOcrAvoidedCount++;
    }
  }

  public recordAiCall(inputTokens: number, outputTokens: number) {
    this.counters.numberOfAiCalls++;
    this.counters.tokensPerAnalysisInput += inputTokens;
    this.counters.tokensPerAnalysisOutput += outputTokens;
  }

  public recordQueryTime(type: 'EVIDENCE' | 'MATTER_REVIEW' | 'LEGAL_RESOLUTION', durationMs: number) {
    if (type === 'EVIDENCE') this.counters.evidenceRetrievalTimeMs += durationMs;
    else if (type === 'MATTER_REVIEW') this.counters.matterReviewQueryTimeMs += durationMs;
    else if (type === 'LEGAL_RESOLUTION') this.counters.legalResolutionTimeMs += durationMs;
  }

  public recordPotentialNPlus1Query() {
    this.counters.detectedNPlus1QueriesCount++;
  }

  public getSnapshot(): SystemPerformanceCounters {
    return { ...this.counters };
  }
}

/**
 * Calculates synthetic benchmark score summary for evaluation harness.
 */
export function calculateBenchmarkSummary(result: ModelBenchmarkResult): {
  overallQualityScore: number;
  efficiencyScore: number;
  safetyScore: number;
} {
  const m = result.metrics;
  const overallQualityScore = (
    m.factualAccuracyScore * 0.25 +
    m.allegationVsFactAccuracyScore * 0.20 +
    m.sourcePageAttributionScore * 0.20 +
    m.legalIssueSpottingScore * 0.20 +
    m.chronologyAccuracyScore * 0.15
  );

  const safetyScore = (1.0 - m.unsupportedClaimRate) * 0.5 + m.allegationVsFactAccuracyScore * 0.5;

  const efficiencyScore = Math.max(0, 1.0 - (result.performanceCounters.detectedNPlus1QueriesCount * 0.1));

  return {
    overallQualityScore: Number(overallQualityScore.toFixed(4)),
    efficiencyScore: Number(efficiencyScore.toFixed(4)),
    safetyScore: Number(safetyScore.toFixed(4))
  };
}
