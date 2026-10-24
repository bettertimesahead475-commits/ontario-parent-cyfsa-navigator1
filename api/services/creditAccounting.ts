// ---------------------------------------------------------------------------
// Server-Authoritative Credit Accounting
//
// Enforces non-negotiable CYFSA Navigator commercial limits:
// - Document Analyzer Basic ($19.99 CAD): Exactly 3 analyses. 4th blocked server-side.
// - Document Analyzer Premium ($49.99 CAD): Exactly 5 analyses. 6th blocked server-side.
// - Individual / Family Case Access ($149 CAD/mo): 5 Forensic Analyses per monthly billing cycle.
// - Community Sponsorships (Community 5/10/25): 5 Forensic Analyses per family per month.
//
// Source of truth: one counter per paid session, paid_session_<id>_total, in free_usage.
// Reserving an analysis increments it with a compare-and-set update, so two instances can never
// both take the last credit. Each request also has a marker row (keyed by a hash of its request id)
// that records whether it is reserved, consumed or released. Markers make retries idempotent and
// let a release return exactly the unit that was taken.
//
// Pipeline: Authenticate -> Validate Entitlement -> Reserve (claim counter + marker) -> Process
//           -> Finalize (marker: reserved -> consumed), or Release on failure (marker -> released, counter -1).
// Fail-closed: if the reservation cannot be written, AI processing never begins.
// A reservation whose request never finished is released automatically after RESERVATION_TTL_MS.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { withTransientRetry } from "./transientRetry.js";
import {
  backoff,
  claimUsageRow,
  compareAndSetCounter,
  decrementCounter,
  listMarkers,
  readUsageRow,
  setMarkerSlot,
  transitionMarker,
  usageUnavailable,
  type UsageRow,
} from "./freeUsageStore.js";

export const BASIC_ANALYSES_LIMIT = 3;
export const PREMIUM_ANALYSES_LIMIT = 5;
export const CASE_ACCESS_FORENSIC_LIMIT = 5;

// Longer than the 300 s function limit in vercel.json, so a live analysis is never reclaimed.
export const RESERVATION_TTL_MS = 15 * 60 * 1000;

const MARKER_RESERVED = "reservation:reserved";
const MARKER_CONSUMED = "reservation:consumed";
const MARKER_RELEASED = "reservation:released";
const MAX_CLAIM_ATTEMPTS = 5;

export interface PackageAllowance {
  tier: string;
  totalLimit: number;
  allowsForensic: boolean;
  isMonthly: boolean;
}

export function getPackageAllowance(tier: string): PackageAllowance {
  switch (tier) {
    case "Basic":
    case "AnalyzerBasic":
      return { tier: "Basic", totalLimit: 3, allowsForensic: false, isMonthly: false };
    case "Premium":
    case "AnalyzerPremium":
      return { tier: "Premium", totalLimit: 5, allowsForensic: true, isMonthly: false };
    case "Pro":
      return { tier: "Pro", totalLimit: 5, allowsForensic: true, isMonthly: true };
    case "Community5":
    case "Community10":
    case "Community25":
      return { tier, totalLimit: 5, allowsForensic: true, isMonthly: true };
    default:
      return { tier, totalLimit: 3, allowsForensic: false, isMonthly: false };
  }
}

export interface CreditBalance {
  sessionId: string;
  tier: string;
  creditsGranted: number;
  creditsConsumed: number;
  creditsRemaining: number;
  isSuspended: boolean;
  suspendedReason?: string | null;
  allowsForensic: boolean;
  isMonthly: boolean;
}

export interface ReservationResult {
  reservationId: string;
  sessionId: string;
  requestId: string;
  slotIndex: number;
  tier: string;
  creditsRemainingAfterReservation: number;
  alreadyFinalized?: boolean;
}

export function resetCreditAccountingCachesForTesting(): void {
  // Nothing is cached in memory: every decision reads the shared database.
}

export function usageCounterKey(sessionId: string): string {
  return `paid_session_${sessionId}_total`;
}

function markerPrefix(sessionId: string): string {
  return `paid_res_${sessionId}_`;
}

function markerKey(sessionId: string, requestId: string): string {
  const digest = createHash("sha256").update(requestId).digest("hex").slice(0, 32);
  return `${markerPrefix(sessionId)}${digest}`;
}

function isStale(row: UsageRow): boolean {
  const touched = Date.parse(row.last_analysis_at ?? row.first_analysis_at ?? "") || 0;
  return Date.now() - touched > RESERVATION_TTL_MS;
}

function limitReached(): LifecycleError {
  return new LifecycleError(
    402,
    "ANALYSIS_LIMIT_REACHED",
    "You've used all analyses included in your package. Purchase additional analyses to continue."
  );
}

/** Reads the session row. Any failure other than "no such row" fails closed. */
async function readSessionRevocation(sessionId: string): Promise<{ revoked: boolean }> {
  try {
    return await withTransientRetry(async () => {
      const { data, error } = await getSupabase()
        .from("navigator_paid_sessions")
        .select("id, tier, revoked_at")
        .eq("id", sessionId)
        .retry(false)
        .maybeSingle();
      if (error) {
        throw Object.assign(new Error(`navigator_paid_sessions read failed: ${error.message}`), { supabaseError: error, statusCode: 503 });
      }
      return { revoked: Boolean(data?.revoked_at) };
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    throw usageUnavailable("navigator_paid_sessions read", err?.supabaseError ?? err);
  }
}

/**
 * Returns the current credit balance for a paid session.
 * Suspension is recorded as a suspended_<id> row (the administrative fallback used while
 * navigator_paid_sessions has no suspension columns).
 */
export async function getCreditBalance(sessionId: string, tier: string): Promise<CreditBalance> {
  const allowance = getPackageAllowance(tier);
  const base = { sessionId, tier: allowance.tier, allowsForensic: allowance.allowsForensic, isMonthly: allowance.isMonthly };

  const session = await readSessionRevocation(sessionId);
  if (session.revoked) {
    return { ...base, creditsGranted: 0, creditsConsumed: 0, creditsRemaining: 0, isSuspended: true, suspendedReason: "Session revoked" };
  }

  const suspension = await readUsageRow(`suspended_${sessionId}`);
  if (suspension) {
    return {
      ...base,
      creditsGranted: 0,
      creditsConsumed: 0,
      creditsRemaining: 0,
      isSuspended: true,
      suspendedReason: suspension.email || "Account suspended",
    };
  }

  const usage = await readUsageRow(usageCounterKey(sessionId));
  const consumed = usage?.analyses_used ?? 0;
  const granted = allowance.totalLimit;
  return {
    ...base,
    creditsGranted: granted,
    creditsConsumed: consumed,
    creditsRemaining: Math.max(0, granted - consumed),
    isSuspended: false,
    suspendedReason: null,
  };
}

function reservationFor(sessionId: string, requestId: string, tier: string, slotIndex: number, remaining: number, alreadyFinalized: boolean): ReservationResult {
  return {
    reservationId: markerKey(sessionId, requestId),
    sessionId,
    requestId,
    slotIndex,
    tier,
    creditsRemainingAfterReservation: remaining,
    alreadyFinalized,
  };
}

/**
 * Releases one reservation: marker reserved -> released, then counter -1 if it had claimed a unit.
 * Only the caller whose marker transition succeeds gives a unit back, so a release never happens twice.
 */
async function releaseMarker(sessionId: string, key: string): Promise<boolean> {
  const marker = await readUsageRow(key);
  if (!marker || marker.email !== MARKER_RESERVED) return false;
  if (!(await transitionMarker(key, MARKER_RESERVED, MARKER_RELEASED))) return false;
  if (marker.analyses_used > 0) {
    await decrementCounter(usageCounterKey(sessionId));
  }
  return true;
}

/** Releases reservations left by requests that never finished. Returns how many were released. */
async function releaseStaleReservations(sessionId: string, exceptKey: string): Promise<number> {
  const stale = (await listMarkers(markerPrefix(sessionId), MARKER_RESERVED)).filter(
    (row) => row.uid !== exceptKey && isStale(row)
  );
  let released = 0;
  for (const row of stale) {
    if (await releaseMarker(sessionId, row.uid)) released++;
  }
  return released;
}

/**
 * Atomically reserves 1 credit for an analysis request.
 * MUST be called BEFORE any AI processing begins.
 * Throws 'ANALYSIS_LIMIT_REACHED' if no credits remain, 'ACCOUNT_SUSPENDED' if the account is suspended,
 * and 503 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE' if the reservation cannot be recorded.
 */
export async function reserveAnalysisCredit(params: {
  sessionId: string;
  firebaseUid: string;
  tier: string;
  requestId: string;
  analysisType: "quick" | "forensic";
  documentName?: string;
}): Promise<ReservationResult> {
  const { sessionId, tier, requestId, analysisType } = params;
  const allowance = getPackageAllowance(tier);

  if (analysisType === "forensic" && !allowance.allowsForensic) {
    throw new LifecycleError(
      403,
      "FORENSIC_UPGRADE_REQUIRED",
      "Forensic In-Depth Dual-Pass scanning requires Document Analyzer Premium ($49.99) or CYFSA Case Access ($149/mo). Your current plan includes Quick Document Review."
    );
  }

  const balance = await getCreditBalance(sessionId, tier);
  if (balance.isSuspended) {
    throw new LifecycleError(
      403,
      "ACCOUNT_SUSPENDED",
      balance.suspendedReason ||
        "Your account access has been temporarily suspended pending payment verification. Please contact support at chris@cyfsanavigator.com."
    );
  }

  const key = markerKey(sessionId, requestId);

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const marker = await readUsageRow(key);

    if (marker?.email === MARKER_CONSUMED) {
      const current = await getCreditBalance(sessionId, tier);
      return reservationFor(sessionId, requestId, tier, marker.analyses_used, current.creditsRemaining, true);
    }

    if (marker?.email === MARKER_RESERVED) {
      if (!isStale(marker)) {
        // A retry of a live request. Its credit is already claimed, so it is not charged again.
        // A marker with no slot is still being claimed by another attempt; the caller should retry shortly.
        if (marker.analyses_used <= 0) {
          throw new LifecycleError(409, "ANALYSIS_IN_PROGRESS", "This analysis is already being prepared. Please wait a moment and try again.");
        }
        const current = await getCreditBalance(sessionId, tier);
        return reservationFor(sessionId, requestId, tier, marker.analyses_used, current.creditsRemaining, false);
      }
      await releaseMarker(sessionId, key);
      continue;
    }

    if (marker?.email === MARKER_RELEASED) {
      // A previous attempt failed and released its credit. Re-reserve it for this retry.
      if (!(await transitionMarker(key, MARKER_RELEASED, MARKER_RESERVED))) continue;
    } else if (!(await claimUsageRow({
      uid: key,
      email: MARKER_RESERVED,
      analyses_used: 0,
      first_analysis_at: new Date().toISOString(),
      last_analysis_at: new Date().toISOString(),
    }))) {
      // Another attempt with the same request id inserted the marker first. Read it again.
      continue;
    }

    const claimed = await claimCounterUnit(sessionId, allowance.totalLimit, key);
    if (claimed === "limit") {
      // Nothing was taken. Free the marker so it does not look like a live reservation.
      await transitionMarker(key, MARKER_RESERVED, MARKER_RELEASED);
      throw limitReached();
    }

    if (!(await setMarkerSlot(key, MARKER_RESERVED, claimed.slot))) {
      // The marker was released while we were claiming. Give the unit back so the counter stays exact.
      await decrementCounter(usageCounterKey(sessionId));
      throw usageUnavailable("credit reservation slot", new Error("marker changed during claim"));
    }

    return reservationFor(sessionId, requestId, tier, claimed.slot, Math.max(0, allowance.totalLimit - claimed.slot), false);
  }

  throw usageUnavailable("credit reservation", new Error(`contention on ${key}`));
}

/**
 * Takes one unit from the session counter with a compare-and-set. Reclaims stale reservations first when
 * the counter is full.
 */
async function claimCounterUnit(
  sessionId: string,
  granted: number,
  ownKey: string
): Promise<{ slot: number } | "limit"> {
  const counterKey = usageCounterKey(sessionId);
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const usage = await readUsageRow(counterKey);
    const used = usage?.analyses_used ?? 0;

    if (used >= granted) {
      if ((await releaseStaleReservations(sessionId, ownKey)) > 0) continue;
      return "limit";
    }

    const claimed = usage
      ? await compareAndSetCounter(counterKey, used, used + 1)
      : await claimUsageRow({
          uid: counterKey,
          email: null,
          analyses_used: 1,
          first_analysis_at: new Date().toISOString(),
          last_analysis_at: new Date().toISOString(),
        });
    if (claimed) return { slot: used + 1 };
    await backoff(attempt);
  }
  throw usageUnavailable("credit counter claim", new Error(`contention on ${counterKey}`));
}

/**
 * Marks a reservation consumed after the analysis succeeds. The counter was already taken at reservation,
 * so this only changes the marker. Retries and duplicates are no-ops.
 *
 * Never throws for a database error: the analysis has already been produced. A reservation that cannot be
 * finalized is released by the TTL, which errs on the side of not charging twice.
 */
export async function finalizeAnalysisCredit(params: {
  sessionId: string;
  firebaseUid: string;
  requestId: string;
  reservationId?: string;
  tier: string;
  documentName?: string;
}): Promise<CreditBalance | null> {
  const { sessionId, requestId, tier } = params;
  const key = markerKey(sessionId, requestId);
  try {
    if (!(await transitionMarker(key, MARKER_RESERVED, MARKER_CONSUMED))) {
      const marker = await readUsageRow(key);
      if (marker?.email === MARKER_RELEASED) {
        console.warn("[creditAccounting] Analysis finished after its reservation was released; not charged again.", { requestId });
      }
    }
    return await getCreditBalance(sessionId, tier);
  } catch (err) {
    console.error("[creditAccounting] Non-fatal error finalizing credit reservation:", err);
    return null;
  }
}

/**
 * Safely releases a reservation when processing fails before a billable result is produced.
 * Restores the credit so the user is NOT charged for system errors.
 */
export async function releaseAnalysisReservation(params: {
  sessionId: string;
  requestId: string;
  reservationId?: string;
  reason?: string;
}): Promise<void> {
  const { sessionId, requestId } = params;
  try {
    await releaseMarker(sessionId, markerKey(sessionId, requestId));
  } catch (err) {
    console.error("[creditAccounting] Non-fatal error releasing credit reservation:", err);
  }
}

function safeGetDb(): any {
  try {
    const client = getSupabase();
    if (client && typeof client.from === "function") {
      return client;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Administrative control: suspends a customer's paid session.
 */
export async function suspendSession(params: {
  sessionId: string;
  reason: string;
  adminEmail?: string;
}): Promise<boolean> {
  const { sessionId, reason } = params;
  const db = safeGetDb();
  if (!db || typeof db.from !== "function") return true;
  const now = new Date().toISOString();

  const { error } = await db
    .from("navigator_paid_sessions")
    .update({
      is_suspended: true,
      suspended_at: now,
      suspended_reason: reason,
    })
    .eq("id", sessionId);

  if (error) {
    // If column doesn't exist, store in free_usage flag
    await db.from("free_usage").upsert({
      uid: `suspended_${sessionId}`,
      email: reason,
      analyses_used: 1,
      last_analysis_at: now,
    });
  }

  // Record audit log
  try {
    await db.from("credit_audit_ledger").insert({
      session_id: sessionId,
      firebase_uid: "system",
      event_type: "suspension",
      operator_role: "admin",
      details: { reason },
    });
  } catch {}

  return true;
}

/**
 * Administrative control: restores access after investigation.
 */
export async function restoreSession(sessionId: string): Promise<boolean> {
  const db = safeGetDb();
  if (!db || typeof db.from !== "function") return true;

  const { error } = await db
    .from("navigator_paid_sessions")
    .update({
      is_suspended: false,
      suspended_at: null,
      suspended_reason: null,
    })
    .eq("id", sessionId);

  if (error) {
    await db.from("free_usage").delete().eq("uid", `suspended_${sessionId}`);
  }

  // Record audit log
  try {
    await db.from("credit_audit_ledger").insert({
      session_id: sessionId,
      firebase_uid: "system",
      event_type: "restoration",
      operator_role: "admin",
      details: { restored: true },
    });
  } catch {}

  return true;
}
