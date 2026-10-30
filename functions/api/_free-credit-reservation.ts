import type { CreditRpc } from './_paid-credit-reservation';

export async function reserveFreeScan(
  verifiedFirebaseUid: string, requestId: string, rpc: CreditRpc,
): Promise<{ status: string; reservation_id?: string | null }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(verifiedFirebaseUid) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  try {
    const result = await rpc('free_reserve_scan', {
      p_uid: verifiedFirebaseUid, p_request: requestId, p_limit: 3,
      p_now: new Date().toISOString(), p_ttl: '15 minutes',
    });
    if (!['reserved', 'joined', 'consumed', 'limit'].includes(result.status)) return { status: 'unavailable' };
    if (result.status === 'reserved' && (typeof result.reservation_id !== 'string' || !result.reservation_id)) return { status: 'unavailable' };
    return result;
  } catch { return { status: 'unavailable' }; }
}
