import { describe, expect, it, vi } from 'vitest';
import { runVerifiedFreeAnalysis } from '../functions/api/_free-analysis-transaction';

describe('free analysis transaction', () => {
  it('reserves, analyzes and finalizes before delivering output', async () => {
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan'
      ? { status: 'reserved', reservation_id: 'marker' } : { status: 'consumed' });
    const analyze = vi.fn(async () => 'report');
    expect(await runVerifiedFreeAnalysis('uid', 'request_12345678', rpc, analyze))
      .toEqual({ status: 'delivered', result: 'report' });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['free_reserve_scan', 'free_finalize_scan']);
  });
  it('releases a reservation after analysis fails', async () => {
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan'
      ? { status: 'reserved', reservation_id: 'marker' } : { status: 'released' });
    const analyze = vi.fn(async () => { throw Error('model failed'); });
    expect((await runVerifiedFreeAnalysis('uid', 'request_12345678', rpc, analyze)).status).toBe('failed');
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['free_reserve_scan', 'free_release_scan']);
  });
});
