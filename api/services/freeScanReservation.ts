// Atomic reservation of free-tier scans. One free scan is reserved before its analysis runs, by a single database
// function under a per-account lock (see supabase/migrations_pending_approval/free_scan_reservation_functions.sql).
// Concurrent requests on any number of serverless instances therefore cannot take more scans than the allowance.
// Every database failure fails closed: the analysis does not start, and a report is never delivered without its
// scan being recorded.
import { getSupabase } from "./access.js";
import { usageUnavailable } from "./freeUsageStore.js";

// A reservation not finished within this time is released. The analysis function's time limit is far shorter,
// so the attempt that held it has certainly ended.
export const FREE_SCAN_RESERVATION_TTL = "15 minutes";

// Recording a delivered scan is retried briefly before the caller gives up. Giving up never releases the scan: the
// report is already saved as completed, and the client settles the same analysis id on its retry.
const FINALIZE_ATTEMPT_DELAYS_MS = [0, 150, 500];

export type FreeScanStatus = "reserved" | "joined" | "consumed" | "limit";
export type FreeScanFinalStatus = "consumed" | "released" | "missing";

export interface FreeScanReservation {
  status: FreeScanStatus;
  // Non-null only for the attempt that owns the reservation. Only that attempt may release or finalize it.
  reservationId: string | null;
  // The scans counted for this account after this call.
  used: number;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: any };
  try {
    result = await getSupabase().rpc(name, args);
  } catch (err) {
    throw usageUnavailable(name, err);
  }
  if (result.error) {
    throw usageUnavailable(name, result.error);
  }
  return result.data as T;
}

/**
 * Reserves one free scan for an analysis request. Throws a 503 LifecycleError if the database cannot answer,
 * so no analysis starts without a reservation.
 */
export async function reserveFreeScan(params: {
  uid: string;
  requestId: string;
  limit: number;
}): Promise<FreeScanReservation> {
  const data = await rpc<{ status: FreeScanStatus; reservation_id: string | null; used: number }>("free_reserve_scan", {
    p_uid: params.uid,
    p_request: params.requestId,
    p_limit: params.limit,
    p_now: new Date().toISOString(),
    p_ttl: FREE_SCAN_RESERVATION_TTL,
  });
  return { status: data.status, reservationId: data.reservation_id ?? null, used: Number(data.used ?? 0) };
}

/**
 * Marks a reserved scan as delivered. Idempotent: a repeat returns "consumed". Retried briefly; throws the last
 * error if every attempt fails. Returns "released" or "missing" when the reservation was already returned (it expired
 * and was reconciled): the caller must then reserve again rather than deliver for free.
 */
export async function finalizeFreeScan(params: { uid: string; requestId: string }): Promise<FreeScanFinalStatus> {
  let lastError: unknown;
  for (const delay of FINALIZE_ATTEMPT_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const data = await rpc<{ status: FreeScanFinalStatus }>("free_finalize_scan", {
        p_uid: params.uid,
        p_request: params.requestId,
        p_now: new Date().toISOString(),
      });
      return data.status;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Makes the scan of a report that is already saved as completed count as delivered. Safe to repeat:
 * - "delivered": the scan is consumed (it was recorded now, or earlier), so the report may be handed over;
 * - "limit": the reservation was returned and the allowance is now used up, so the report must not be handed over;
 * - "in_progress": a live reservation still holds this request.
 * Throws if the database cannot answer, so nothing is delivered on an unknown outcome.
 */
export async function settleFreeScan(params: {
  uid: string;
  requestId: string;
  limit: number;
}): Promise<"delivered" | "limit" | "in_progress"> {
  if ((await finalizeFreeScan(params)) === "consumed") return "delivered";

  const scan = await reserveFreeScan({ uid: params.uid, requestId: params.requestId, limit: params.limit });
  if (scan.status === "consumed") return "delivered";
  if (scan.status === "limit") return "limit";
  if (scan.status === "joined") return "in_progress";

  await finalizeFreeScan(params);
  return "delivered";
}

/**
 * Returns a reserved scan's unit when the analysis fails before its report is saved. A recorded scan is never
 * returned, and a caller that does not own the reservation changes nothing.
 */
export async function releaseFreeScan(params: { uid: string; requestId: string; reservationId: string }): Promise<void> {
  await rpc("free_release_scan", {
    p_uid: params.uid,
    p_request: params.requestId,
    p_reservation_id: params.reservationId,
    p_now: new Date().toISOString(),
  });
}
