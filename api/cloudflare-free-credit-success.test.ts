import { describe, expect, it, vi } from 'vitest';
import { finalizeFreeScan, releaseFreeScan } from '../functions/api/_free-credit-lifecycle';

describe('free credit RPC success', () => {
  it('finalizes and releases through named RPCs', async () => {
    const rpc = vi.fn(async (name: string) => ({ status: name === 'free_finalize_scan' ? 'consumed' : 'released' }));
    expect((await finalizeFreeScan('uid', 'request_12345678', rpc)).status).toBe('consumed');
    expect((await releaseFreeScan('uid', 'request_12345678', 'marker', rpc)).status).toBe('released');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
