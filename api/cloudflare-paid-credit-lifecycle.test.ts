import { describe, expect, it, vi } from 'vitest';
import { finalizePaidReservation, releasePaidReservation } from '../functions/api/_paid-credit-lifecycle';

describe('Cloudflare paid credit lifecycle', () => {
  it('finalizes using the canonical atomic RPC', async () => {
    const rpc = vi.fn(async () => ({ status: 'consumed' }));
    expect((await finalizePaidReservation('s1', 'r1', rpc)).status).toBe('consumed');
    expect(rpc).toHaveBeenCalledWith('paid_finalize_credit', expect.objectContaining({ p_session: 's1', p_request: 'r1' }));
  });
  it('releases only when the owning reservation id is present', async () => {
    const rpc = vi.fn(async () => ({ status: 'released' }));
    expect((await releasePaidReservation('s1', 'r1', '', rpc)).status).toBe('missing');
    expect(rpc).not.toHaveBeenCalled();
    expect((await releasePaidReservation('s1', 'r1', 'reservation-1', rpc)).status).toBe('released');
    expect(rpc).toHaveBeenCalledWith('paid_release_credit', expect.objectContaining({ p_reservation_id: 'reservation-1' }));
  });
  it('fails closed on RPC failures and unknown statuses', async () => {
    const broken = vi.fn(async () => { throw new Error('network'); });
    expect((await finalizePaidReservation('s1', 'r1', broken)).status).toBe('unavailable');
    expect((await releasePaidReservation('s1', 'r1', 'reservation-1', broken)).status).toBe('unavailable');
    expect((await finalizePaidReservation('s1', 'r1', async () => ({ status: 'unknown' }))).status).toBe('unavailable');
  });
});
