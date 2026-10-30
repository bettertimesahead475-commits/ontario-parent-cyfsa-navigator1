import { describe, expect, it, vi } from 'vitest';
import { onRequestGet, type UsageEnv } from '../functions/api/analyzer-usage';

const mockAuth = vi.fn();
const mockSessionRead = vi.fn();

vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: (req: Request, env: any) => mockAuth(req, env),
  onRequestGet: vi.fn(),
}));

vi.mock('../functions/api/_supabase-paid-session', () => ({
  readVerifiedPaidSession: (env: any, uid: string, sessionId: string) => mockSessionRead(env, uid, sessionId),
}));

describe('Cloudflare Analyzer Usage Endpoint (/api/analyzer-usage)', () => {
  const env: UsageEnv = {
    FIREBASE_PROJECT_ID: 'test-project',
  };

  it('returns default free allowance for anonymous users', async () => {
    mockAuth.mockResolvedValueOnce({ status: 'denied' });
    const request = new Request('https://staging.example/api/analyzer-usage', { method: 'GET' });

    const response = await onRequestGet({ request, env });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.type).toBe('free');
    expect(json.tier).toBe('Free');
    expect(json.remaining).toBe(3);
    expect(json.quickReviewsLimit).toBe(3);
  });

  it('returns free allowance for authenticated free users', async () => {
    mockAuth.mockResolvedValueOnce({ status: 'verified', uid: 'user_free_123' });
    const request = new Request('https://staging.example/api/analyzer-usage', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid_token' },
    });

    const response = await onRequestGet({ request, env });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.type).toBe('free');
    expect(json.tier).toBe('Free');
    expect(json.quickReviewsLimit).toBe(3);
  });

  it('returns paid limits for verified paid session', async () => {
    const uid = 'user_paid_456';
    const sessionId = '11111111-2222-4333-8444-555555555555';

    mockAuth.mockResolvedValueOnce({ status: 'verified', uid });
    mockSessionRead.mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId,
        ownerUid: uid,
        tier: 'Premium',
        issuedAt: new Date().toISOString(),
      },
    });

    const request = new Request(`https://staging.example/api/analyzer-usage?sessionId=${sessionId}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer valid_token' },
    });

    const response = await onRequestGet({ request, env });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.type).toBe('paid');
    expect(json.tier).toBe('Premium');
    expect(json.quickReviewsLimit).toBe(5);
    expect(json.forensicAnalysesLimit).toBe(5);
  });
});
