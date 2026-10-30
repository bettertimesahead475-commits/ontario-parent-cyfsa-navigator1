import { describe, expect, it, vi } from 'vitest';
import { createStagingCreditRpc, StagingRpcError } from '../functions/api/_staging-credit-rpc';

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

  it('captures sanitized PostgreSQL error code and message on PostgREST error', async () => {
    const errorBody = {
      code: 'PGRST202',
      message: 'Could not find the function public.free_reserve_scan in the schema cache',
      details: 'Searched for the function with parameters: p_limit, p_now, p_request, p_ttl, p_uid',
      hint: 'Perhaps you meant to call the function free_reserve_scan',
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(errorBody), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' },
    }));

    const rpc = createStagingCreditRpc(env, fetcher as typeof fetch);
    await expect(rpc('free_reserve_scan', { p_uid: 'user_1' })).rejects.toMatchObject({
      name: 'StagingRpcError',
      httpStatus: 404,
      pgCode: 'PGRST202',
      pgMessage: 'Could not find the function public.free_reserve_scan in the schema cache',
      pgDetails: 'Searched for the function with parameters: p_limit, p_now, p_request, p_ttl, p_uid',
      pgHint: 'Perhaps you meant to call the function free_reserve_scan',
    });
  });

  it('captures network timeout errors gracefully as 503', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('Connection timed out');
    });

    const rpc = createStagingCreditRpc(env, fetcher as typeof fetch);
    await expect(rpc('free_reserve_scan', { p_uid: 'user_1' })).rejects.toMatchObject({
      name: 'StagingRpcError',
      httpStatus: 503,
      pgCode: 'NETWORK_TIMEOUT',
    });
  });
});
