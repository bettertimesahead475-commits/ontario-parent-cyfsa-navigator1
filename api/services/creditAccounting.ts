// ---------------------------------------------------------------------------
// Server-Authoritative Credit Accounting
//
// Enforces commercial limits:
// - Document Analyzer Basic ($19.99 CAD): exactly 3 analyses.
// - Document Analyzer Premium ($49.99 CAD): exactly 5 analyses (quick and forensic together).
// - Individual / Family Case Access ($149 CAD/mo) and Community Sponsorships (5/10/25): 5 forensic analyses per
//   monthly billing cycle, renewing on the customer's own renewal date. Quick reviews are not limited.
//
// Every reservation, release and finalization is one atomic PostgreSQL function call (see
// supabase/migrations_pending_approval/paid_credit_reservation_functions.sql). A function runs in one transaction
// under a per-session advisory lock, so a crash, a lost connection or a concurrent request cannot leave a counter
// moved without its marker, or the reverse.
//
// Billing cycle anchor: a paid session's issued_at (set when the access code is redeemed). Each renewal is a new
// session, so the cycle for a monthly plan starts on that date and renews on the same day each month (UTC).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { withTransientRetry } from "./transientRetry.js";
import { readUsageRow, usageUnavailable, type UsageRow } from "./freeUsageStore.js";

export const BASIC_ANALYSES_LIMIT = 3;
export const PREMIUM_ANALYSES_LIMIT = 5;
export const CASE_ACCESS_FORENSIC_LIMIT = 5;

// Longer than the 300 s function limit in vercel.json. A reservation with a recorded unit that has not been touched
// for this long belongs to a request that can no longer be running.
export const RESERVATION_TTL = "15 minutes";
export const RESERVATION_TTL_MS = 15 * 60 * 1000;
// A claim that records no unit within this window is abandoned.
export const CLAIM_WINDOW = "60 seconds";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

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
  /** Billing period (start date, YYYY-MM-DD) the unit was drawn from, for monthly forensic analyses; otherwise null. */
  billingCycle: string | null;
}

// ---- Clock and billing periods ----------------------------------------------------------------------------------

let clock: () => Date = () => new Date();

/** Test hook: pins the clock. Pass null to restore the real clock. */
export function setCreditClockForTesting(now: (() => Date) | null): void {
  clock = now ?? (() => new Date());
}

/**
 * Start of the billing period that contains `now`, for a plan anchored on `issuedAt`. Periods are whole calendar months
 * from the issue date (UTC). A day that a month does not have is the month's last day (31 January renews on 28/29
 * February, then 31 March). Returned as YYYY-MM-DD.
 */
export function billingPeriodStart(issuedAt: Date, now: Date): string {
  const anchor = (k: number): number => {
    const y = issuedAt.getUTCFullYear();
    const m = issuedAt.getUTCMonth() + k;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = Math.min(issuedAt.getUTCDate(), lastDay);
    return Date.UTC(y, m, d, issuedAt.getUTCHours(), issuedAt.getUTCMinutes(), issuedAt.getUTCSeconds(), issuedAt.getUTCMilliseconds());
  };
  const t = now.getTime();
  let k = Math.max(
    0,
    (now.getUTCFullYear() - issuedAt.getUTCFullYear()) * 12 + (now.getUTCMonth() - issuedAt.getUTCMonth())
  );
  while (k > 0 && anchor(k) > t) k--;
  while (anchor(k + 1) <= t) k++;
  return new Date(anchor(k)).toISOString().slice(0, 10);
}

// ---- Counter scopes ----------------------------------------------------------------------------------------------
// 'total'  : Basic and Premium, one total per session (all analysis types together).
// 'period:<YYYY-MM-DD>' : Pro and Community forensic analyses, per billing period.
// 'none'   : Pro and Community quick reviews, which are not limited.

function scopeFor(allowance: PackageAllowance, analysisType: "quick" | "forensic", issuedAt: Date | null): string {
  if (!allowance.isMonthly) return "total";
  if (analysisType !== "forensic") return "none";
  if (!issuedAt) {
    throw usageUnavailable("navigator_paid_sessions issued_at", new Error("monthly plan without an issue date"));
  }
  return `period:${billingPeriodStart(issuedAt, clock())}`;
}

function counterKeyFor(sessionId: string, scope: string): string | null {
  if (scope === "none") return null;
  if (scope === "total") return `paid_session_${sessionId}_total`;
  return `paid_session_${sessionId}_period_${scope.slice("period:".length)}`;
}

/** Marker row key for one request. Must match paid_marker_uid() in the SQL migration. */
export function markerKey(sessionId: string, requestId: string): string {
  const digest = createHash("sha256").update(requestId).digest("hex").slice(0, 32);
  return `paid_res_${sessionId}_${digest}`;
}

// ---- Database access ---------------------------------------------------------------------------------------------

/** Single attempt. Writes are not retried: an ambiguous outcome fails closed, and the function is idempotent by request. */
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

/** Reads the session row. Any failure other than "no such row" fails closed. */
async function readSession(sessionId: string): Promise<{ revoked: boolean; issuedAt: Date | null }> {
  try {
    return await withTransientRetry(async () => {
      const { data, error } = await getSupabase()
        .from("navigator_paid_sessions")
        .select("id, tier, revoked_at, issued_at")
        .eq("id", sessionId)
        .retry(false)
        .maybeSingle();
      if (error) {
        throw Object.assign(new Error(`navigator_paid_sessions read failed: ${error.message}`), { supabaseError: error, statusCode: 503 });
      }
      return {
        revoked: Boolean(data?.revoked_at),
        issuedAt: data?.issued_at ? new Date(data.issued_at) : null,
      };
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    throw usageUnavailable("navigator_paid_sessions read", err?.supabaseError ?? err);
  }
}

function limitReached(): LifecycleError {
  return new LifecycleError(
    402,
    "ANALYSIS_LIMIT_REACHED",
    "You've used all analyses included in your package. Purchase additional analyses to continue."
  );
}

function suspendedBy(reason: string): LifecycleError {
  return new LifecycleError(
    403,
    "ACCOUNT_SUSPENDED",
    reason || "Your account access has been temporarily suspended pending payment verification. Please contact support at chris@cyfsanavigator.com."
  );
}

/**
 * Current balance for a paid session. For monthly plans this is the current billing period's forensic count.
 */
export async function getCreditBalance(sessionId: string, tier: string): Promise<CreditBalance> {
  const allowance = getPackageAllowance(tier);
  const base = { sessionId, tier: allowance.tier, allowsForensic: allowance.allowsForensic, isMonthly: allowance.isMonthly };

  const session = await readSession(sessionId);
  if (session.revoked) {
    return { ...base, creditsGranted: 0, creditsConsumed: 0, creditsRemaining: 0, isSuspended: true, suspendedReason: "Session revoked" };
  }
  const suspension = await readUsageRow(`suspended_${sessionId}`);
  if (suspension) {
    return { ...base, creditsGranted: 0, creditsConsumed: 0, creditsRemaining: 0, isSuspended: true, suspendedReason: suspension.email || "Account suspended" };
  }

  const scope = scopeFor(allowance, "forensic", session.issuedAt);
  const counter = counterKeyFor(sessionId, scope);
  const usage = counter ? await readUsageRow(counter) : null;
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

// ---- Reservation lifecycle ---------------------------------------------------------------------------------------

interface ReserveRpcResult {
  status: "reserved" | "joined" | "consumed" | "in_progress" | "limit";
  reservation_id: string | null;
  slot?: number;
  counter_used?: number | null;
}

/**
 * Atomically reserves one unit for an analysis request. MUST be called BEFORE any AI processing begins.
 * Throws 402 ANALYSIS_LIMIT_REACHED when the allowance is used up, 403 ACCOUNT_SUSPENDED, 409 ANALYSIS_IN_PROGRESS when
 * the same request is still being claimed, and 503 USAGE_SERVICE_TEMPORARILY_UNAVAILABLE when the reservation cannot be
 * recorded.
 *
 * `reservationId` is non-empty only for the attempt that owns the reservation. A retry that joins a live or finished
 * reservation gets an empty id: it cannot release the owner's unit, and the route does not run the model for it.
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
  if (!SAFE_ID.test(sessionId)) {
    throw new LifecycleError(400, "INVALID_SESSION", "This paid session is not valid. Please sign in again.");
  }

  const session = await readSession(sessionId);
  if (session.revoked) throw suspendedBy("Session revoked");
  const suspension = await readUsageRow(`suspended_${sessionId}`);
  if (suspension) throw suspendedBy(suspension.email || "");

  const now = clock();
  const scope = scopeFor(allowance, analysisType, session.issuedAt);
  const period = scope.startsWith("period:") ? scope.slice("period:".length) : null;
  const granted = allowance.totalLimit;

  const result = await rpc<ReserveRpcResult>("paid_reserve_credit", {
    p_session: sessionId,
    p_request: requestId,
    p_scope: scope,
    p_granted: granted,
    p_now: now.toISOString(),
    p_ttl: RESERVATION_TTL,
    p_claim_window: CLAIM_WINDOW,
  });

  switch (result.status) {
    case "limit":
      throw limitReached();
    case "in_progress":
      throw new LifecycleError(409, "ANALYSIS_IN_PROGRESS", "This analysis is already being prepared. Please wait a moment and try again.");
    case "reserved": {
      const remaining =
        scope === "none"
          ? (await getCreditBalance(sessionId, tier)).creditsRemaining
          : Math.max(0, granted - (result.slot ?? 0));
      return {
        reservationId: result.reservation_id ?? "",
        sessionId,
        requestId,
        slotIndex: result.slot ?? 0,
        tier,
        creditsRemainingAfterReservation: remaining,
        alreadyFinalized: false,
        billingCycle: period,
      };
    }
    case "consumed":
    case "joined": {
      const current = await getCreditBalance(sessionId, tier);
      return {
        reservationId: "",
        sessionId,
        requestId,
        slotIndex: result.slot ?? 0,
        tier,
        creditsRemainingAfterReservation: current.creditsRemaining,
        alreadyFinalized: result.status === "consumed",
        billingCycle: period,
      };
    }
    default:
      throw usageUnavailable("credit reservation", new Error(`unexpected status ${(result as any).status}`));
  }
}

/**
 * Marks a reservation consumed after the analysis is delivered. A duplicate finalize is a no-op. Throws when the charge
 * cannot be recorded or the reservation was already released: the caller then withholds the result, so nothing is
 * delivered for free. Releasing it in that case returns the unit, because nothing was delivered.
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
  const result = await rpc<{ status: "consumed" | "released" | "missing" }>("paid_finalize_credit", {
    p_session: sessionId,
    p_request: requestId,
    p_now: clock().toISOString(),
  });
  if (result.status === "missing") {
    throw new LifecycleError(409, "RESERVATION_MISSING", "This analysis has no credit reservation. Please start a new analysis.");
  }
  if (result.status === "released") {
    throw new LifecycleError(409, "RESERVATION_RELEASED", "This analysis's reservation expired before it could be recorded. Please start a new analysis.");
  }
  try {
    return await getCreditBalance(sessionId, tier);
  } catch {
    // The charge is recorded; a failed balance read for the response does not undo it.
    return null;
  }
}

/**
 * A database outage on a credit call. Every failed RPC is reported this way, so it is distinct from a business outcome
 * (missing or released reservation), which is final. Only an outage is transient: it may be retried, and if it persists
 * the caller holds the validated report instead of discarding it.
 */
export function isBillingOutage(err: unknown): boolean {
  return err instanceof LifecycleError && err.code === "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE";
}

/**
 * Finalizes a reservation, retrying transient write failures. Safe to repeat: paid_finalize_credit maps a consumed
 * marker to consumed, so a retry after an uncertain first attempt cannot charge twice. Business outcomes (missing,
 * released) are final and are never retried.
 */
export async function finalizeAnalysisCreditWithRetry(
  params: Parameters<typeof finalizeAnalysisCredit>[0],
  options: { attempts?: number; delayMs?: number; finalize?: typeof finalizeAnalysisCredit } = {}
): Promise<CreditBalance | null> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 300;
  const finalize = options.finalize ?? finalizeAnalysisCredit;
  for (let attempt = 1; ; attempt++) {
    try {
      return await finalize(params);
    } catch (err) {
      const finalOutcome = err instanceof LifecycleError && !isBillingOutage(err);
      if (finalOutcome || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

/**
 * Releases a reservation when processing fails before a billable result is produced, returning the unit.
 * Only the attempt that owns the reservation may release it: a missing or different reservation id does nothing.
 * A consumed (finalized) reservation is never released: paid_release_marker only acts on reserved markers.
 */
export async function releaseAnalysisReservation(params: {
  sessionId: string;
  requestId: string;
  reservationId?: string;
  reason?: string;
}): Promise<void> {
  const { sessionId, requestId, reservationId } = params;
  if (!reservationId) return;
  try {
    await rpc("paid_release_credit", {
      p_session: sessionId,
      p_request: requestId,
      p_reservation_id: reservationId,
      p_now: clock().toISOString(),
    });
  } catch (err) {
    console.error("[creditAccounting] Non-fatal error releasing credit reservation:", err);
  }
}

export function resetCreditAccountingCachesForTesting(): void {
  // Nothing is cached in memory: every decision reads the shared database.
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
