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

const RESERVED_PREFIX = "reservation:reserved";
const MARKER_CONSUMED = "reservation:consumed";
const MARKER_RELEASED = "reservation:released";
// A claim records its unit within milliseconds. Anything still unrecorded after this long was abandoned.
const CLAIM_WINDOW_MS = 60 * 1000;
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

// ---- Counter scope ---------------------------------------------------------------------------------
// Basic and Premium: one total per session (exact package count, quick and forensic together).
// Pro and Community: forensic analyses only, counted per calendar month (UTC). That matches the
// per-cycle key usage.ts uses for forensic analyses. Quick reviews on these plans are unlimited, so they
// do not draw on a counter.

let clock: () => Date = () => new Date();

/** Test hook: pins the billing clock. Pass null to restore the real clock. */
export function setCreditClockForTesting(now: (() => Date) | null): void {
  clock = now ?? (() => new Date());
}

function billingCycle(): string {
  return clock().toISOString().slice(0, 7);
}

type CounterScope = { kind: "total" } | { kind: "cycle"; cycle: string } | { kind: "none" };

function scopeFor(allowance: PackageAllowance, analysisType: "quick" | "forensic"): CounterScope {
  if (!allowance.isMonthly) return { kind: "total" };
  return analysisType === "forensic" ? { kind: "cycle", cycle: billingCycle() } : { kind: "none" };
}

function reservedState(scope: CounterScope): string {
  if (scope.kind === "total") return RESERVED_PREFIX;
  if (scope.kind === "cycle") return `${RESERVED_PREFIX}:cycle:${scope.cycle}`;
  return `${RESERVED_PREFIX}:none`;
}

function isReservedState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.startsWith(RESERVED_PREFIX);
}

function scopeFromState(state: string): CounterScope | null {
  if (state === RESERVED_PREFIX) return { kind: "total" };
  if (state === `${RESERVED_PREFIX}:none`) return { kind: "none" };
  const match = /^reservation:reserved:cycle:(\d{4}-\d{2})$/.exec(state);
  return match ? { kind: "cycle", cycle: match[1] } : null;
}

function counterKeyFor(sessionId: string, scope: CounterScope): string | null {
  if (scope.kind === "none") return null;
  if (scope.kind === "total") return `paid_session_${sessionId}_total`;
  return `paid_session_${sessionId}_cycle_${scope.cycle}`;
}

function isOlderThan(row: UsageRow, ms: number): boolean {
  const touched = Date.parse(row.last_analysis_at ?? row.first_analysis_at ?? "") || 0;
  return clock().getTime() - touched > ms;
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
  return isOlderThan(row, RESERVATION_TTL_MS);
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

  const scope: CounterScope = allowance.isMonthly ? { kind: "cycle", cycle: billingCycle() } : { kind: "total" };
  const usage = await readUsageRow(counterKeyFor(sessionId, scope) as string);
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

function reservationFor(
  sessionId: string,
  requestId: string,
  tier: string,
  slotIndex: number,
  remaining: number,
  alreadyFinalized: boolean,
  owned: boolean
): ReservationResult {
  return {
    // Only the attempt that created or re-took the reservation owns it and may release it.
    reservationId: owned ? markerKey(sessionId, requestId) : "",
    sessionId,
    requestId,
    slotIndex,
    tier,
    creditsRemainingAfterReservation: remaining,
    alreadyFinalized,
  };
}

/**
 * Releases one reservation: marker reserved -> released, then the counter it drew on -1 if it claimed a unit.
 * The marker's own state says which counter that was, so a release after a billing-cycle change still
 * returns the unit to the right counter. Only the caller whose transition succeeds gives a unit back.
 */
async function releaseMarker(sessionId: string, key: string): Promise<boolean> {
  const marker = await readUsageRow(key);
  if (!marker || !isReservedState(marker.email)) return false;
  if (!(await transitionMarker(key, marker.email as string, MARKER_RELEASED))) return false;
  const scope = scopeFromState(marker.email as string);
  const counter = scope ? counterKeyFor(sessionId, scope) : null;
  if (counter && marker.analyses_used > 0) {
    await decrementCounter(counter);
  }
  return true;
}

/** Releases reservations left by requests that never finished. Returns how many were released. */
async function releaseStaleReservations(sessionId: string, exceptKey: string): Promise<number> {
  const stale = (await listMarkers(markerPrefix(sessionId), RESERVED_PREFIX)).filter(
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
 * 'ANALYSIS_IN_PROGRESS' (409) if the same request is still being claimed, and 503
 * 'USAGE_SERVICE_TEMPORARILY_UNAVAILABLE' if the reservation cannot be recorded.
 *
 * `reservationId` is non-empty only for the attempt that owns the reservation. A retry that joins a live
 * reservation gets an empty id, so its failure cannot release the owner's credit.
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
  const scope = scopeFor(allowance, analysisType);
  const state = reservedState(scope);
  const counter = counterKeyFor(sessionId, scope);
  const granted = allowance.totalLimit;

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const marker = await readUsageRow(key);

    if (marker?.email === MARKER_CONSUMED) {
      const current = await getCreditBalance(sessionId, tier);
      return reservationFor(sessionId, requestId, tier, marker.analyses_used, current.creditsRemaining, true, false);
    }

    if (marker && isReservedState(marker.email)) {
      if (marker.analyses_used > 0 && !isStale(marker)) {
        // A retry of a live request. Its unit is already claimed, so it is not charged again, and it does not own the reservation.
        const current = await getCreditBalance(sessionId, tier);
        return reservationFor(sessionId, requestId, tier, marker.analyses_used, current.creditsRemaining, false, false);
      }
      if (marker.analyses_used <= 0 && !isStale(marker) && !isOlderThan(marker, CLAIM_WINDOW_MS)) {
        // Another attempt is still claiming its unit. Ask the caller to retry in a moment.
        throw new LifecycleError(409, "ANALYSIS_IN_PROGRESS", "This analysis is already being prepared. Please wait a moment and try again.");
      }
      // Abandoned: the claim never recorded its unit (no slot), or the reservation has expired. Free it, then claim again.
      await releaseMarker(sessionId, key);
      continue;
    }

    if (marker?.email === MARKER_RELEASED) {
      // A previous attempt failed and released its credit. Re-reserve it for this retry.
      if (!(await transitionMarker(key, MARKER_RELEASED, state))) continue;
    } else if (!(await claimUsageRow({
      uid: key,
      email: state,
      analyses_used: 0,
      first_analysis_at: new Date().toISOString(),
      last_analysis_at: new Date().toISOString(),
    }))) {
      // Another attempt with the same request id inserted the marker first. Read it again.
      continue;
    }

    if (counter === null) {
      // Plan allowance does not count this analysis (Pro/Community quick reviews). Nothing to claim.
      return reservationFor(sessionId, requestId, tier, 0, Math.max(0, granted - (await cycleConsumed(sessionId))), false, true);
    }

    const claimed = await claimCounterUnit(sessionId, counter, granted, key);
    if (claimed === "limit") {
      // Nothing was taken. Free the marker so it does not look like a live reservation.
      await transitionMarker(key, state, MARKER_RELEASED);
      throw limitReached();
    }

    if (!(await setMarkerSlot(key, state, claimed.slot))) {
      // The marker was released while we were claiming. Give the unit back so the counter stays exact.
      await decrementCounter(counter);
      throw usageUnavailable("credit reservation slot", new Error("marker changed during claim"));
    }

    return reservationFor(sessionId, requestId, tier, claimed.slot, Math.max(0, granted - claimed.slot), false, true);
  }

  throw usageUnavailable("credit reservation", new Error(`contention on ${key}`));
}

async function cycleConsumed(sessionId: string): Promise<number> {
  const usage = await readUsageRow(counterKeyFor(sessionId, { kind: "cycle", cycle: billingCycle() }) as string);
  return usage?.analyses_used ?? 0;
}

/**
 * Takes one unit from a counter with a compare-and-set. Reclaims stale reservations first when the counter
 * is full.
 */
async function claimCounterUnit(
  sessionId: string,
  counterKey: string,
  granted: number,
  ownKey: string
): Promise<{ slot: number } | "limit"> {
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
 * Marks a reservation consumed after the analysis succeeds. The unit was already taken at reservation, so
 * this only changes the marker. Retries and duplicates are no-ops, and a finished analysis is never
 * released afterwards.
 *
 * Never throws for a database error: the analysis has already been produced. A reservation that cannot be
 * finalized expires and is released, which errs on the side of not charging twice.
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
    const marker = await readUsageRow(key);
    if (marker && isReservedState(marker.email)) {
      if (!(await transitionMarker(key, marker.email as string, MARKER_CONSUMED))) {
        console.warn("[creditAccounting] Reservation changed while finalizing; not re-charged.", { requestId });
      }
    } else if (marker?.email === MARKER_RELEASED) {
      console.warn("[creditAccounting] Analysis finished after its reservation was released; not charged again.", { requestId });
    }
    return await getCreditBalance(sessionId, tier);
  } catch (err) {
    console.error("[creditAccounting] Non-fatal error finalizing credit reservation:", err);
    return null;
  }
}

/**
 * Releases a reservation when processing fails before a billable result is produced, restoring the credit.
 * Only the attempt that owns the reservation may release it: a missing or different reservation id does nothing.
 */
export async function releaseAnalysisReservation(params: {
  sessionId: string;
  requestId: string;
  reservationId?: string;
  reason?: string;
}): Promise<void> {
  const { sessionId, requestId, reservationId } = params;
  const key = markerKey(sessionId, requestId);
  if (!reservationId || reservationId !== key) return;
  try {
    await releaseMarker(sessionId, key);
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
