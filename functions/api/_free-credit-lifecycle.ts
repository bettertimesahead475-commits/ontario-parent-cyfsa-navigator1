import type { CreditRpc } from './_paid-credit-reservation';

export async function finalizeFreeScan(uid: string, requestId: string, rpc: CreditRpc) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  try {
    const result = await rpc('free_finalize_scan', {
      p_uid: uid, p_request: requestId, p_now: new Date().toISOString(),
    });
    return { status: ['consumed', 'released', 'missing'].includes(result.status) ? result.status : 'unavailable' };
  } catch { return { status: 'unavailable' }; }
}

export async function releaseFreeScan(uid: string, requestId: string, reservationId: string, rpc: CreditRpc) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !reservationId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  try {
    const result = await rpc('free_release_scan', {
      p_uid: uid, p_request: requestId, p_reservation_id: reservationId,
      p_now: new Date().toISOString(),
    });
    return { status: ['released', 'noop'].includes(result.status) ? result.status : 'unavailable' };
  } catch { return { status: 'unavailable' }; }
}
