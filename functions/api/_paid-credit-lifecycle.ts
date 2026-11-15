import type { CreditRpc } from './_paid-credit-reservation';

export type CreditLifecycleResult = { status: 'consumed' | 'released' | 'missing' | 'unavailable' };

/** Finalize only after the result is ready; do not deliver results if finalization fails. */
export async function finalizePaidReservation(
  sessionId: string, requestId: string, rpc: CreditRpc, now = new Date(),
): Promise<CreditLifecycleResult> {
  if (!sessionId || !requestId) return { status: 'missing' };
  try {
    const result = await rpc('paid_finalize_credit', {
      p_session: sessionId, p_request: requestId, p_now: now.toISOString(),
    });
    if (result.status === 'consumed' || result.status === 'released' || result.status === 'missing') {
      return { status: result.status };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Release only the reservation owned by this attempt; retries must not release another request's unit. */
export async function releasePaidReservation(
  sessionId: string, requestId: string, reservationId: string | null | undefined,
  rpc: CreditRpc, now = new Date(),
): Promise<CreditLifecycleResult> {
  if (!reservationId || !sessionId || !requestId) return { status: 'missing' };
  try {
    const result = await rpc('paid_release_credit', {
      p_session: sessionId, p_request: requestId,
      p_reservation_id: reservationId, p_now: now.toISOString(),
    });
    if (result.status === 'released' || result.status === 'consumed' || result.status === 'missing') {
      return { status: result.status };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
