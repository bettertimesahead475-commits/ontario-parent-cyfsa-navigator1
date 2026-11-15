import { describe, expect, it, vi } from 'vitest';
import { runAuthenticatedFreeAnalysis } from '../functions/api/_free-analysis-transaction';

describe('authenticated free scan', () => {
  it('never reserves or analyzes without a verified Firebase token', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'marker' }));
    const analyze = vi.fn(async () => 'report');
    const request = new Request('https://staging.example/api/analyze', { method: 'POST' });
    const result = await runAuthenticatedFreeAnalysis(request, { FIREBASE_PROJECT_ID: 'test-project' },
      'request_12345678', rpc, analyze);
    expect(result.status).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });
});
