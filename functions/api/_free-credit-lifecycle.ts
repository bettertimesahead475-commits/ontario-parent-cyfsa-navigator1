import type { CreditRpc } from './_paid-credit-reservation';
import { StagingRpcError } from './_staging-credit-rpc';

export async function finalizeFreeScan(uid: string, requestId: string, rpc: CreditRpc) {
  if (!uid || !/^[A-Za-z0-9_.:|@-]{1,128}$/.test(uid) || !requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    return { status: 'denied' };
  }
  try {
    const result = await rpc('free_finalize_scan', {
      p_uid: uid, p_request: requestId, p_now: new Date().toISOString(),
    });
    return { status: ['consumed', 'released', 'missing'].includes(result.status) ? result.status : 'unavailable' };
  } catch (err: any) {
    console.error(JSON.stringify({
      tag: '[FREE_FINALIZE_SCAN_FAILED]',
      error: err?.message || String(err),
      pgCode: err?.pgCode || null,
    }));
    return { status: 'unavailable', pgCode: err?.pgCode || null };
  }
}

export async function releaseFreeScan(uid: string, requestId: string, reservationId: string, rpc: CreditRpc) {
  if (!uid || !/^[A-Za-z0-9_.:|@-]{1,128}$/.test(uid) || !reservationId || !requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    return { status: 'denied' };
  }
  try {
    const result = await rpc('free_release_scan', {
      p_uid: uid, p_request: requestId, p_reservation_id: reservationId,
      p_now: new Date().toISOString(),
    });
    return { status: ['released', 'noop'].includes(result.status) ? result.status : 'unavailable' };
  } catch (err: any) {
    console.error(JSON.stringify({
      tag: '[FREE_RELEASE_SCAN_FAILED]',
      error: err?.message || String(err),
      pgCode: err?.pgCode || null,
    }));
    return { status: 'unavailable', pgCode: err?.pgCode || null };
  }
}
