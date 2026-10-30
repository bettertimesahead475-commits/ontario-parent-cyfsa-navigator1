import { describe, expect, it, vi } from 'vitest';
import { reserveFreeScan } from '../functions/api/_free-credit-reservation';

describe('staging free credit reservation', () => {
  it('reserves exactly three scans with the verified UID', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'marker' }));
    expect((await reserveFreeScan('firebase-user', 'request_12345678', rpc)).status).toBe('reserved');
    expect(rpc).toHaveBeenCalledWith('free_reserve_scan', expect.objectContaining({
      p_uid: 'firebase-user', p_limit: 3, p_ttl: '15 minutes',
    }));
  });
  it('fails closed on invalid input or unexpected RPC status', async () => {
    const rpc = vi.fn(async () => ({ status: 'unexpected' }));
    expect((await reserveFreeScan('', 'request_12345678', rpc)).status).toBe('denied');
    expect((await reserveFreeScan('uid', 'request_12345678', rpc)).status).toBe('unavailable');
  });
});
