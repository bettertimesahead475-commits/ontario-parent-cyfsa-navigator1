import { describe, expect, it, vi } from 'vitest';
import { reserveVerifiedPaidCredit } from '../functions/api/_paid-credit-reservation';

const session = { sessionId: '11111111-1111-4111-8111-111111111111', ownerUid: 'u1', tier: 'Premium', issuedAt: '2026-01-01T00:00:00Z', expiresAt: null };
describe('Cloudflare staging paid reservation boundary', () => {
  it('cannot charge credits before billing parity is verified', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved' }));
    expect((await reserveVerifiedPaidCredit(session, 'quick', 'request_12345678', rpc)).status).toBe('migration_pending');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects forged tiers and forensic on basic', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved' }));
    expect((await reserveVerifiedPaidCredit({ ...session, tier: 'Unknown' }, 'quick', 'request_12345678', rpc)).status).toBe('denied');
    expect((await reserveVerifiedPaidCredit({ ...session, tier: 'Basic' }, 'forensic', 'request_12345678', rpc)).status).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
  });
});
