import { describe, expect, it, vi } from 'vitest';
import { runVerifiedPaidAnalysis } from '../functions/api/_paid-analysis-transaction';

describe('paid analysis transaction coordinator', () => {
  it('does not run analysis without verified database session', async () => {
    const analyze = vi.fn(async () => 'secret report');
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation-1' }));
    const result = await runVerifiedPaidAnalysis({}, 'u1', '11111111-1111-4111-8111-111111111111', 'request_12345678', 'quick', rpc, analyze);
    expect(result.status).toBe('unavailable');
    expect(analyze).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
