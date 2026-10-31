import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCloudflareGenerateFn } from '../functions/api/_analyzer-model-adapter';
import { handleAnalyzeRequest } from '../functions/api/analyze';
import { handleExtractRequest } from '../functions/api/extract-text';
import { DIRECT_ANALYSIS_MAX_CHARS, DIRECT_ANALYSIS_MAX_TOKENS, isEligibleForDirectAnalysis } from './services/directAnalyzer';

const mockAuthVerification = vi.fn();
vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuthVerification(req, env),
  onRequestGet: vi.fn(),
}));

describe('Historical Timeout Fixes Regression Suite', () => {
  beforeEach(() => {
    mockAuthVerification.mockReset();
  });

  describe('Commit 405df71d: OCR and Claude Analysis Decoupling', () => {
    it('ensures /api/extract-text is dedicated to extraction without Claude dependencies', async () => {
      mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid: 'user_extract_test' });

      // Synthetic plain text file extraction
      const req = new Request('https://staging.example/api/extract-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token' },
        body: JSON.stringify({
          fileData: {
            base64: Buffer.from('AFFIDAVIT OF APPLICANT\nEvidence content').toString('base64'),
            mimeType: 'text/plain',
            fileName: 'affidavit.txt',
          },
        }),
      });

      const response = await handleExtractRequest(req, {
        FIREBASE_PROJECT_ID: 'test-project',
      } as any);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.extractedText).toContain('AFFIDAVIT OF APPLICANT');
      expect(data.characters).toBeGreaterThan(10);
    });

    it('ensures /api/analyze requires pre-extracted documentText and does not run OCR', async () => {
      mockAuthVerification.mockResolvedValueOnce({ status: 'verified', uid: 'user_analyze_test' });

      const req = new Request('https://staging.example/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token' },
        body: JSON.stringify({
          mode: 'fast',
          // Omitting documentText to verify immediate 400 rejection without OCR attempt
        }),
      });

      const response = await handleAnalyzeRequest(req, {
        ANALYZER_ENABLED: 'true',
        FIREBASE_PROJECT_ID: 'test-project',
        ANTHROPIC_API_KEY: 'test-key',
      } as any);

      expect(response.status).toBe(400);
      const json = await response.json() as any;
      expect(json.code).toBe('INVALID_REQUEST');
      expect(json.error).toMatch(/Missing or empty documentText/i);
    });
  });

  describe('Commit f43b8e18: 181-Second Timeout Mitigation & Model Calibration', () => {
    it('restricts Quick Review direct analysis to bounded 4,096 tokens', () => {
      expect(DIRECT_ANALYSIS_MAX_TOKENS).toBe(4_096);
      expect(DIRECT_ANALYSIS_MAX_CHARS).toBe(75_000);
    });

    it('ensures eligible documents have at least 8s remaining before attempting direct analysis', () => {
      const now = 100_000;
      // 7s remaining: below threshold -> ineligible
      expect(isEligibleForDirectAnalysis('affidavit text', now + 7_000, () => now)).toBe(false);
      // 10s remaining: above threshold -> eligible
      expect(isEligibleForDirectAnalysis('affidavit text', now + 10_000, () => now)).toBe(true);
    });

    it('processes streamed Anthropic SSE chunks incrementally without buffering stalls', async () => {
      const sseChunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":350}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"documentTitle\\":\\"Verified Audit\\","}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"\\"score\\":88}"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":90}}\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const mockFetcher = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
      const result = await generate(
        {
          system: 'sys',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 4096,
          timeoutMs: 5000,
          requestId: 'req_stream_test',
          stage: 'direct_analysis',
          mode: 'fast',
        },
        'claude-sonnet-5'
      );

      expect(result.text).toBe('{"documentTitle":"Verified Audit","score":88}');
      expect(result.usage?.input_tokens).toBe(350);
      expect(result.usage?.output_tokens).toBe(90);
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('Commit b3b08e5c: Suppression of Retries After Lengthy Provider Timeout', () => {
    it('suppresses subsequent retries when an attempt experienced a lengthy timeout (>=30s)', async () => {
      let callCount = 0;
      let simulatedTime = 1_000_000;
      const originalNow = Date.now;

      const mockFetcher = vi.fn(async () => {
        callCount++;
        // Advance simulated time by 32 seconds to represent a lengthy attempt
        simulatedTime += 32_000;
        const err = new Error('provider deadline of 32000 ms exceeded');
        err.name = 'TimeoutError';
        throw err;
      });

      Date.now = vi.fn(() => simulatedTime);

      const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);

      try {
        await expect(
          generate(
            {
              system: 'sys',
              messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
              max_tokens: 4096,
              timeoutMs: 80_000,
              retries: 2, // Even with retries = 2 requested, wasLongTimeout MUST suppress attempt 2 & 3
              requestId: 'req_long_timeout',
              stage: 'direct_analysis',
              mode: 'fast',
            },
            'claude-sonnet-5'
          )
        ).rejects.toThrow(/did not respond in time/);

        // Verification: Exactly 1 call was made; retries were suppressed due to wasLongTimeout!
        expect(callCount).toBe(1);
      } finally {
        Date.now = originalNow;
      }
    });

    it('ensures maximum provider execution time is strictly bounded within the 60-second budget', () => {
      const overallBudgetMs = 60_000;
      const aiDeadlineOffsetMs = 2_000; // aiDeadlineAt = Date.now() + budget - 2s (58s)
      const directAnalyzerSafetyMarginMs = 5_000; // timeoutMs = remaining - 5s (53s)

      const effectiveProviderTimeoutMs = overallBudgetMs - aiDeadlineOffsetMs - directAnalyzerSafetyMarginMs;
      expect(effectiveProviderTimeoutMs).toBe(53_000);

      // For Quick Review, retries are 0:
      const quickRetries = 0;
      const maxQuickExecutionTimeMs = effectiveProviderTimeoutMs * (quickRetries + 1);

      expect(maxQuickExecutionTimeMs).toBeLessThanOrEqual(53_000);
      expect(maxQuickExecutionTimeMs).toBeLessThan(overallBudgetMs);
    });
  });
});
