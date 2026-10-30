/**
 * Server-only paid-credit reservation boundary for Cloudflare staging.
 * The verified session must come from _supabase-paid-session, not a client body.
 * Never infer entitlement from the read-only policy's preview response.
 */
import type { VerifiedSession } from './_paid-session-validation';

export type CreditReservation = { status: string; reservation_id?: string | null };
export type CreditRpc = (name: string, args: Record<string, unknown>) => Promise<CreditReservation>;

const LIMITS: Record<string, { limit: number; monthly: boolean; forensic: boolean }> = {
  Basic: { limit: 3, monthly: false, forensic: false },
  AnalyzerBasic: { limit: 3, monthly: false, forensic: false },
  Premium: { limit: 5, monthly: false, forensic: true },
  AnalyzerPremium: { limit: 5, monthly: false, forensic: true },
  Pro: { limit: 5, monthly: true, forensic: true },
  Community5: { limit: 5, monthly: true, forensic: true },
  Community10: { limit: 5, monthly: true, forensic: true },
  Community25: { limit: 5, monthly: true, forensic: true },
};

export async function reserveVerifiedPaidCredit(
  session: VerifiedSession,
  analysisType: 'quick' | 'forensic',
  requestId: string,
  rpc: CreditRpc,
  now = new Date(),
): Promise<CreditReservation> {
  const tier = LIMITS[session.tier];
  if (!tier || !session.sessionId || !session.ownerUid ||
      !/^[0-9a-f-]{36}$/i.test(session.sessionId) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(requestId) ||
      (analysisType === 'forensic' && !tier.forensic) ||
      (session.expiresAt && Date.parse(session.expiresAt) <= now.getTime())) {
    return { status: 'denied' };
  }
  // The production accounting implementation owns monthly scope anchoring,
  // unlimited quick-review semantics, and exact RPC arguments. Until parity
  // is verified, deny reservations rather than invent a billing rule.
  try {
    const result = await rpc('paid_reserve_credit', {
    p_session: session.sessionId,
    p_request: requestId,
    p_scope: tier.monthly ? 'none' : 'total',
    p_granted: tier.limit,
    p_now: now.toISOString(),
    p_ttl: '15 minutes',
    p_claim_window: '60 seconds',
    });
    if (!['reserved', 'joined', 'consumed', 'in_progress', 'limit'].includes(result.status)) return { status: 'unavailable' };
    if (result.status === 'reserved' && !result.reservation_id) return { status: 'unavailable' };
    return result;
  } catch {
    return { status: 'unavailable' };
  }
}
