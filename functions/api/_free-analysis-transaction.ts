import { verifyFirebaseRequest } from './_auth-check';
import { reserveFreeScan } from './_free-credit-reservation';
import { finalizeFreeScan, releaseFreeScan } from './_free-credit-lifecycle';
import type { CreditRpc } from './_paid-credit-reservation';

type Result<T> = { status: 'delivered'; result: T } | { status: 'denied' | 'unavailable' | 'limit' | 'in_progress' | 'failed' };

/** Coordinates one free scan, without exposing analysis output before finalization. */
export async function runVerifiedFreeAnalysis<T>(
  uid: string, requestId: string, rpc: CreditRpc, analyze: () => Promise<T>,
): Promise<Result<T>> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId))
    return { status: 'denied' };
  const reservation = await reserveFreeScan(uid, requestId, rpc);
  if (reservation.status === 'limit') return { status: 'limit' };
  if (reservation.status === 'joined' || reservation.status === 'consumed') return { status: 'in_progress' };
  if (reservation.status !== 'reserved' || !reservation.reservation_id) return { status: 'unavailable' };
  let result: T;
  try { result = await analyze(); }
  catch {
    await releaseFreeScan(uid, requestId, reservation.reservation_id, rpc);
    return { status: 'failed' };
  }
  const finalized = await finalizeFreeScan(uid, requestId, rpc);
  if (finalized.status !== 'consumed') return { status: 'unavailable' };
  return { status: 'delivered', result };
}

export async function runAuthenticatedFreeAnalysis<T>(
  request: Request, env: { FIREBASE_PROJECT_ID?: string },
  requestId: string, rpc: CreditRpc, analyze: () => Promise<T>,
): Promise<Result<T>> {
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') return { status: identity.status };
  return runVerifiedFreeAnalysis(identity.uid, requestId, rpc, analyze);
}
