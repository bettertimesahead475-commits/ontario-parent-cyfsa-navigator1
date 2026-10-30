import type { CreditRpc } from './_paid-credit-reservation';

/** Staging free-user accounting: fail closed until free RPC signatures and
 * ownership semantics have been verified against the deployed database. */
export async function reserveFreeScan(
  verifiedFirebaseUid: string,
  requestId: string,
  rpc: CreditRpc,
): Promise<{ status: 'denied' | 'unavailable' }> {
  if (!verifiedFirebaseUid || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  void rpc;
  return { status: 'unavailable' };
}
