import { describe, expect, it, vi } from 'vitest';
import { finalizeFreeScan, releaseFreeScan } from '../functions/api/_free-credit-lifecycle';

describe('staging free credit lifecycle guard', () => {
  it('never mutates free usage before verified RPC integration', async () => {
    const rpc = vi.fn(async () => ({ status: 'consumed' }));
    expect((await finalizeFreeScan('uid', 'request_12345678', rpc)).status).toBe('consumed');
    expect((await releaseFreeScan('uid', 'request_12345678', 'reservation', rpc)).status).toBe('unavailable');
    expect((await releaseFreeScan('uid', 'request_12345678', '', rpc)).status).toBe('denied');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
