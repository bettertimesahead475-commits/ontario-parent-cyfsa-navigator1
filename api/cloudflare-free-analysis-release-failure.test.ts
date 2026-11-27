import { describe, expect, it, vi } from 'vitest';
import { runVerifiedFreeAnalysis } from '../functions/api/_free-analysis-transaction';

describe('free credit release uncertainty', () => {
  it('fails closed if analysis fails and release is not confirmed', async () => {
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan'
      ? { status: 'reserved', reservation_id: 'marker' } : { status: 'noop' });
    const result = await runVerifiedFreeAnalysis('uid', 'request_12345678', rpc, async () => { throw Error('analysis'); });
    expect(result.status).toBe('unavailable');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
