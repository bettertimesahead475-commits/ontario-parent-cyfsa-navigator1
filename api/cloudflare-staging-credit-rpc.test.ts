import { describe, expect, it, vi } from 'vitest';
import { createStagingCreditRpc } from '../functions/api/_staging-credit-rpc';

const env = { STAGING_SUPABASE_URL: 'https://staging.example.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-secret' };
describe('staging credit RPC transport', () => {
  it('calls only allowlisted RPC names with server credentials', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-secret');
      return Response.json({ status: 'consumed' });
    });
    const rpc = createStagingCreditRpc(env, fetcher as typeof fetch);
    expect((await rpc('paid_finalize_credit', { p_session: 's1' })).status).toBe('consumed');
    await expect(rpc('unapproved_rpc', {})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects missing credentials and malformed responses', async () => {
    await expect(createStagingCreditRpc({})('paid_reserve_credit', {})).rejects.toThrow();
    const rpc = createStagingCreditRpc(env, vi.fn(async () => Response.json([])) as typeof fetch);
    await expect(rpc('paid_reserve_credit', {})).rejects.toThrow();
  });
});
