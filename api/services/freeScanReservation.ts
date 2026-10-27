// Atomic reservation of free-tier scans. One free scan is reserved before its analysis runs, by a single database
// function under a per-account lock (see supabase/migrations_pending_approval/free_scan_reservation_functions.sql).
// Concurrent requests on any number of serverless instances therefore cannot take more scans than the allowance.
// Every database failure fails closed: the analysis does not start.
import { getSupabase } from "./access.js";
import { usageUnavailable } from "./freeUsageStore.js";

// A reservation not finished within this time is released. The analysis function's time limit is far shorter,
// so the attempt that held it has certainly ended.
export const FREE_SCAN_RESERVATION_TTL = "15 minutes";

export type FreeScanStatus = "reserved" | "joined" | "consumed" | "limit";

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

/** Marks a reserved scan as delivered. Called only after the report has been handed to the parent. */
export async function finalizeFreeScan(params: { uid: string; requestId: string }): Promise<void> {
  await rpc("free_finalize_scan", {
    p_uid: params.uid,
    p_request: params.requestId,
    p_now: new Date().toISOString(),
  });
}

/**
 * Returns a reserved scan's unit when the analysis fails or delivery does not complete. A delivered scan is never
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
