/** Mutation gap M16: no test sent a verified non-Pro session to Final Case Assessment. Synthetic data only. */
import { describe, expect, it, vi } from 'vitest';
import { handleAssessment } from '../../functions/api/final-case-assessment';

const matter = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const env = { ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'fixture', STAGING_SUPABASE_URL: 'https://fixture.supabase.co', STAGING_SUPABASE_READ_KEY: 'synthetic-read', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };

describe('Final Case Assessment entitlement gate', () => {
  it.each(['Basic', 'Premium', 'AnalyzerPremium', 'Community5'])('refuses a verified %s session before matter access, credit or model call', async (tier) => {
    const fetcher = vi.fn(async (input: any) => {
      const table = new URL(String(input)).pathname.split('/').pop();
      if (table === 'navigator_paid_sessions') return Response.json([{ id: session, firebase_uid: 'parent', tier, issued_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null }]);
      if (table === 'accounts') return Response.json([{ id: 'account', status: 'active' }]);
      throw new Error('Unexpected access before the entitlement gate: ' + input);
    }) as unknown as typeof fetch;
    const rpc = vi.fn();
    const generate = vi.fn();
    const authenticate = vi.fn(async () => ({ status: 'verified' as const, uid: 'parent', email: null, emailVerified: true }));
    const request = new Request('https://preview.test/api/final-case-assessment?matterId=' + matter, { method: 'POST', headers: { 'X-PS-Session': session } });
    const res = await handleAssessment(request, env, { fetcher, rpc, generate, authenticate } as any);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('INDIVIDUAL_CASE_ACCESS_REQUIRED');
    expect(generate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
