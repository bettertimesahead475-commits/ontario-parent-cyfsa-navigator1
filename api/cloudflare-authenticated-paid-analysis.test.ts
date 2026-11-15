import { describe, expect, it, vi } from 'vitest';
import { runAuthenticatedPaidAnalysis } from '../functions/api/_paid-analysis-transaction';

describe('authenticated paid analysis boundary', () => {
  it('does not call analysis or credit RPC with missing Firebase authentication', async () => {
    const analyze = vi.fn(async () => 'report');
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'r1' }));
    const request = new Request('https://staging.example/api/analyze', { method: 'POST' });
    const result = await runAuthenticatedPaidAnalysis(
      request, { FIREBASE_PROJECT_ID: 'test' },
      '11111111-1111-4111-8111-111111111111',
      'request_12345678', 'quick', rpc, analyze,
    );
    expect(result.status).toBe('denied');
    expect(analyze).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
