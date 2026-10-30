import type { CreditRpc } from './_paid-credit-reservation';

/** Free-scan completion is disabled until free RPC result semantics are verified. */
export async function finalizeFreeScan(
  verifiedFirebaseUid: string, requestId: string, rpc: CreditRpc,
): Promise<{ status: 'denied' | 'unavailable' }> {
  if (!verifiedFirebaseUid || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  void rpc;
  return { status: 'unavailable' };
}

export async function releaseFreeScan(
  verifiedFirebaseUid: string, requestId: string, reservationId: string, rpc: CreditRpc,
): Promise<{ status: 'denied' | 'unavailable' }> {
  if (!verifiedFirebaseUid || !reservationId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  void rpc;
  return { status: 'unavailable' };
}
