import { describe, expect, it, vi } from 'vitest';
import { reserveFreeScan } from '../functions/api/_free-credit-reservation';
import { StagingRpcError } from '../functions/api/_staging-credit-rpc';

describe('staging free credit reservation', () => {
  it('reserves exactly three scans with the verified UID', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'marker' }));
    expect((await reserveFreeScan('firebase-user', 'request_12345678', rpc)).status).toBe('reserved');
    expect(rpc).toHaveBeenCalledWith('free_reserve_scan', expect.objectContaining({
      p_uid: 'firebase-user', p_limit: 3, p_ttl: '15 minutes',
    }));
  });

  it('accepts UIDs with email, dots, colons, or pipes from federated auth', async () => {
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'marker' }));
    const res = await reserveFreeScan('google-oauth2|105737183.user@example.com', 'request_12345678', rpc);
    expect(res.status).toBe('reserved');
  });

  it('fails closed on invalid input or unexpected RPC status', async () => {
    const rpc = vi.fn(async () => ({ status: 'unexpected' }));
    expect((await reserveFreeScan('', 'request_12345678', rpc)).status).toBe('denied');
    expect((await reserveFreeScan('uid', 'request_12345678', rpc)).status).toBe('unavailable');
  });

  it('preserves sanitized PostgreSQL error diagnostics when RPC throws StagingRpcError', async () => {
    const rpcError = new StagingRpcError({
      rpcName: 'free_reserve_scan',
      httpStatus: 404,
      pgCode: 'PGRST202',
      pgMessage: 'Could not find the function public.free_reserve_scan in the schema cache',
      pgDetails: 'Searched for the function with parameters...',
      pgHint: 'Reload schema cache',
    });
    const rpc = vi.fn(async () => {
      throw rpcError;
    });

    const result = await reserveFreeScan('test-user-123', 'request_12345678', rpc);
    expect(result).toMatchObject({
      status: 'unavailable',
      httpStatus: 404,
      pgCode: 'PGRST202',
      pgMessage: 'Could not find the function public.free_reserve_scan in the schema cache',
      pgDetails: 'Searched for the function with parameters...',
      pgHint: 'Reload schema cache',
    });
  });

  it('handles limit and joined statuses properly', async () => {
    const limitRpc = vi.fn(async () => ({ status: 'limit' }));
    expect((await reserveFreeScan('user_limit', 'req_limit_1234', limitRpc)).status).toBe('limit');

    const joinedRpc = vi.fn(async () => ({ status: 'joined' }));
    expect((await reserveFreeScan('user_joined', 'req_joined_1234', joinedRpc)).status).toBe('joined');
  });
});
