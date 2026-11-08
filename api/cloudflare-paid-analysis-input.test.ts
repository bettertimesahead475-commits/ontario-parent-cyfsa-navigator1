import { describe, expect, it, vi } from 'vitest';
import { runVerifiedPaidAnalysis } from '../functions/api/_paid-analysis-transaction';

describe('paid analysis input boundary', () => {
  it('rejects invalid request ids without running analysis', async () => {
    const analyze = vi.fn(async () => 'report');
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'r1' }));
    const result = await runVerifiedPaidAnalysis({}, 'u1', '11111111-1111-4111-8111-111111111111', 'bad', 'quick', rpc, analyze);
    expect(result.status).toBe('denied');
    expect(analyze).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
