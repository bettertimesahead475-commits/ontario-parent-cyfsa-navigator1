import { verifyFirebaseRequest } from './_auth-check';
import { readVerifiedPaidSession, type SupabaseStagingConfig } from './_supabase-paid-session';
import { reserveVerifiedPaidCredit, type CreditRpc } from './_paid-credit-reservation';
import { finalizePaidReservation, releasePaidReservation } from './_paid-credit-lifecycle';

type AnalysisType = 'quick' | 'forensic';
type Result<T> = { status: 'delivered'; result: T } | { status: 'denied' | 'unavailable' | 'limit' | 'in_progress' | 'failed' };

/**
 * Server-only staging transaction coordinator. The uid MUST come from a
 * cryptographically verified Firebase token, not request JSON.
 * Analysis output is never returned until the credit is finalized.
 */
export async function runVerifiedPaidAnalysis<T>(
  env: SupabaseStagingConfig,
  verifiedFirebaseUid: string,
  sessionId: string,
  requestId: string,
  analysisType: AnalysisType,
  rpc: CreditRpc,
  analyze: () => Promise<T>,
): Promise<Result<T>> {
  if (!verifiedFirebaseUid || !['quick', 'forensic'].includes(analysisType) || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return { status: 'denied' };
  const lookup = await readVerifiedPaidSession(env, verifiedFirebaseUid, sessionId);
  if (lookup.status !== 'verified') return { status: lookup.status };
  const reservation = await reserveVerifiedPaidCredit(lookup.session, analysisType, requestId, rpc);
  if (reservation.status === 'limit') return { status: 'limit' };
  if (reservation.status === 'joined' || reservation.status === 'consumed' || reservation.status === 'in_progress') return { status: 'in_progress' };
  if (reservation.status !== 'reserved' || !reservation.reservation_id) return { status: reservation.status === 'denied' ? 'denied' : 'unavailable' };
  let result: T;
  try {
    result = await analyze();
  } catch {
    await releasePaidReservation(sessionId, requestId, reservation.reservation_id, rpc);
    return { status: 'failed' };
  }
  const finalized = await finalizePaidReservation(sessionId, requestId, rpc);
  if (finalized.status !== 'consumed') return { status: 'unavailable' };
  return { status: 'delivered', result };
}

/** Authenticated wrapper; never accepts a UID from JSON. */
export async function runAuthenticatedPaidAnalysis<T>(
  request: Request,
  env: SupabaseStagingConfig & { FIREBASE_PROJECT_ID?: string },
  sessionId: string,
  requestId: string,
  analysisType: AnalysisType,
  rpc: CreditRpc,
  analyze: () => Promise<T>,
): Promise<Result<T>> {
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') return { status: identity.status };
  return runVerifiedPaidAnalysis(env, identity.uid, sessionId, requestId, analysisType, rpc, analyze);
}
