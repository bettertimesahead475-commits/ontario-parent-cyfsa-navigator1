import { describe, expect, it, vi } from 'vitest';
import { runVerifiedFreeAnalysis } from '../functions/api/_free-analysis-transaction';

describe('free scan quota and retry safeguards', () => {
  it.each(['limit', 'joined', 'consumed'])('does not rerun model on %s', async status => {
    const rpc = vi.fn(async () => ({ status }));
    const analyze = vi.fn(async () => 'report');
    const result = await runVerifiedFreeAnalysis('uid', 'request_12345678', rpc, analyze);
    expect(result.status).toBe(status === 'limit' ? 'limit' : 'in_progress');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('does not deliver output when finalization fails', async () => {
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan'
      ? { status: 'reserved', reservation_id: 'marker' } : { status: 'missing' });
    const result = await runVerifiedFreeAnalysis('uid', 'request_12345678', rpc, async () => 'report');
    expect(result.status).toBe('unavailable');
  });
});
