import { describe, expect, it, vi } from 'vitest';
import { reserveVerifiedPaidCredit } from '../functions/api/_paid-credit-reservation';

const session = { sessionId: '11111111-1111-4111-8111-111111111111', ownerUid: 'u1', tier: 'Premium', issuedAt: '2026-01-01T00:00:00Z', expiresAt: null };
describe('Cloudflare staging paid reservation boundary', () => {
  it('reserves a fixed-tier quick credit using the atomic RPC', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation-1' }));
    expect((await reserveVerifiedPaidCredit(session, 'quick', 'request_12345678', rpc)).status).toBe('reserved');
    expect(rpc).toHaveBeenCalledWith('paid_reserve_credit', expect.objectContaining({ p_scope: 'total', p_granted: 5 }));
  });
  it('reserves monthly forensic using the session billing cycle', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation-1' }));
    expect((await reserveVerifiedPaidCredit({ ...session, tier: 'Pro' }, 'forensic', 'request_12345678', rpc, new Date('2026-03-15T00:00:00Z'))).status).toBe('reserved');
    expect(rpc).toHaveBeenCalledWith('paid_reserve_credit', expect.objectContaining({ p_scope: 'period:2026-03-01', p_granted: 5 }));
  });
  it('rejects unexpected analysis modes', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation-1' }));
    expect((await reserveVerifiedPaidCredit(session, 'admin' as 'quick', 'request_12345678', rpc)).status).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects forged tiers and forensic on basic', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation-1' }));
    expect((await reserveVerifiedPaidCredit({ ...session, tier: 'Unknown' }, 'quick', 'request_12345678', rpc)).status).toBe('denied');
    expect((await reserveVerifiedPaidCredit({ ...session, tier: 'Basic' }, 'forensic', 'request_12345678', rpc)).status).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
  });
});
