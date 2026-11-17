import { describe, expect, it } from 'vitest';
import { jobFailureHttpStatus } from '../functions/api/analyze/job/[jobId]';

describe('forensic job failure status mapping', () => {
  it.each([
    ['UPGRADE_REQUIRED', false, 403],
    ['SESSION_INVALID', false, 403],
    ['FREE_LIMIT_REACHED', false, 402],
    ['CREDIT_LIMIT_REACHED', false, 402],
    ['INVALID_REQUEST', false, 400],
    ['DOCUMENT_UNEXTRACTED', false, 400],
    ['ANALYSIS_TIMED_OUT', false, 408],
    ['AI_RESPONSE_INVALID', false, 422],
    ['AI_RESPONSE_INVALID', true, 503],
  ] as const)('%s retryable=%s yields %s', (code, retryable, expected) => {
    expect(jobFailureHttpStatus(code, retryable)).toBe(expected);
  });
});
