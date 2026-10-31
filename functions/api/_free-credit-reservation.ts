import type { CreditRpc } from './_paid-credit-reservation';
import { StagingRpcError } from './_staging-credit-rpc';

/** Free Quick Reviews per signed-in account. Reservation and the usage display both read this. */
export const FREE_SCAN_LIMIT = 3;

export interface FreeReservationResult {
  status: 'reserved' | 'joined' | 'consumed' | 'limit' | 'denied' | 'unavailable' | string;
  reservation_id?: string | null;
  slot?: number;
  used?: number;
  httpStatus?: number;
  pgCode?: string | null;
  pgMessage?: string | null;
  pgDetails?: string | null;
  pgHint?: string | null;
}

export async function reserveFreeScan(
  verifiedFirebaseUid: string, requestId: string, rpc: CreditRpc,
): Promise<FreeReservationResult> {
  // Allow standard Firebase UIDs (alphanumeric, underscore, hyphen, colon, dot, pipe, at) up to 128 chars
  if (!verifiedFirebaseUid || !/^[A-Za-z0-9_.:|@-]{1,128}$/.test(verifiedFirebaseUid) ||
      !requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    console.error(JSON.stringify({
      tag: '[FREE_RESERVE_DENIED]',
      reason: 'invalid_format',
      uidValid: Boolean(verifiedFirebaseUid && /^[A-Za-z0-9_.:|@-]{1,128}$/.test(verifiedFirebaseUid)),
      reqValid: Boolean(requestId && /^[A-Za-z0-9_-]{8,128}$/.test(requestId)),
    }));
    return { status: 'denied', httpStatus: 400, pgCode: 'INVALID_IDENTIFIER_FORMAT' };
  }

  try {
    const result = await rpc('free_reserve_scan', {
      p_uid: verifiedFirebaseUid,
      p_request: requestId,
      p_limit: FREE_SCAN_LIMIT,
      p_now: new Date().toISOString(),
      p_ttl: '15 minutes',
    });

    if (!['reserved', 'joined', 'consumed', 'limit'].includes(result.status)) {
      console.error(JSON.stringify({
        tag: '[FREE_RESERVE_UNEXPECTED_STATUS]',
        status: result.status,
      }));
      return { status: 'unavailable', pgCode: 'UNEXPECTED_STATUS', pgMessage: `Unknown status: ${result.status}` };
    }

    if (result.status === 'reserved' && (typeof result.reservation_id !== 'string' || !result.reservation_id)) {
      console.error(JSON.stringify({
        tag: '[FREE_RESERVE_MISSING_MARKER]',
        result,
      }));
      return { status: 'unavailable', pgCode: 'MISSING_RESERVATION_ID', pgMessage: 'Reservation marker missing' };
    }

    return result as FreeReservationResult;
  } catch (err: any) {
    const httpStatus = err instanceof StagingRpcError ? err.httpStatus : (typeof err?.httpStatus === 'number' ? err.httpStatus : 503);
    const pgCode = err instanceof StagingRpcError ? err.pgCode : (typeof err?.pgCode === 'string' ? err.pgCode : 'UNKNOWN_RPC_ERROR');
    const pgMessage = err instanceof StagingRpcError ? err.pgMessage : (err?.pgMessage || err?.message || String(err));
    const pgDetails = err?.pgDetails || null;
    const pgHint = err?.pgHint || null;

    console.error(JSON.stringify({
      tag: '[FREE_RESERVE_SCAN_RPC_ERROR]',
      httpStatus,
      pgCode,
      pgMessage,
      pgDetails,
      pgHint,
    }));

    return {
      status: 'unavailable',
      httpStatus,
      pgCode,
      pgMessage,
      pgDetails,
      pgHint,
    };
  }
}
