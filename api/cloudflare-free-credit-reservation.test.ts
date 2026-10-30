import { describe, expect, it, vi } from 'vitest';
import { reserveFreeScan } from '../functions/api/_free-credit-reservation';

describe('staging free credit boundary', () => {
  it('never calls credit RPC before free authorization is ready', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved' }));
    expect((await reserveFreeScan('firebase-user', 'request_12345678', rpc)).status).toBe('unavailable');
    expect((await reserveFreeScan('', 'request_12345678', rpc)).status).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
  });
});
