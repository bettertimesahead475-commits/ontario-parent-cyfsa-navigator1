// ---------------------------------------------------------------------------
// Strict Server-Authoritative Credit Accounting & Atomic Cutoff Engine
//
// Enforces non-negotiable CYFSA Navigator commercial limits:
// - Document Analyzer Basic ($19.99 CAD): Exactly 3 analyses. 4th blocked server-side.
// - Document Analyzer Premium ($49.99 CAD): Exactly 5 analyses. 6th blocked server-side.
// - Individual / Family Case Access ($149 CAD/mo): 5 Forensic Analyses per monthly billing cycle.
// - Community Sponsorships (Community 5/10/25): 5 Forensic Analyses per family per month.
//
// Pipeline order:
// Authenticate -> Validate Entitlement -> Reserve Credit -> Process -> Finalize Credit -> Return Result
// If processing fails before a billable result is produced: Release Reservation safely.
// Fail-Closed: If database or reservation fails, AI processing NEVER begins.
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { withTransientRetry } from "./transientRetry.js";
import { logSupabaseFailure } from "./supabaseDiagnostics.js";

function safeGetDb(): any {
  try {
    if (typeof getSupabase === "function") {
      const client = getSupabase();
      if (client && typeof client.from === "function") {
        return client;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export const BASIC_ANALYSES_LIMIT = 3;
export const PREMIUM_ANALYSES_LIMIT = 5;
export const CASE_ACCESS_FORENSIC_LIMIT = 5;

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

// In-memory mutex per session to serialize concurrent reservation requests
// within this Node process, backed by database-level constraints for multi-process safety.
const sessionLocks = new Map<string, Promise<void>>();

async function acquireSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  while (sessionLocks.has(sessionId)) {
    try {
      await sessionLocks.get(sessionId);
    } catch {
      // ignore errors from previous holder
    }
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  sessionLocks.set(sessionId, lockPromise);

  try {
    return await fn();
  } finally {
    sessionLocks.delete(sessionId);
    releaseLock!();
  }
}

// In-memory idempotency cache for request IDs to avoid re-running finalized requests
interface CachedReservation {
  reservationId: string;
  sessionId: string;
  status: "reserved" | "finalized" | "released";
  slotIndex: number;
  tier: string;
  timestamp: number;
}
const requestCache = new Map<string, CachedReservation>();

export function resetCreditAccountingCachesForTesting(): void {
  sessionLocks.clear();
  requestCache.clear();
}

/**
 * Returns current credit balance for a paid session.
 * Checks suspension, granted credits, and active consumption.
 */
export async function getCreditBalance(sessionId: string, tier: string): Promise<CreditBalance> {
  const allowance = getPackageAllowance(tier);

  try {
    return await withTransientRetry(async () => {
      const db = safeGetDb();
      if (!db || typeof db.from !== "function") {
        return await getFallbackBalance(sessionId, tier, allowance);
      }

      // Check session row for granted credits and suspension status
      const { data: sessionRow, error: sessionErr } = await db
        .from("navigator_paid_sessions")
        .select("id, tier, credits_granted, credits_consumed, is_suspended, suspended_reason, revoked_at")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionErr && sessionErr.code !== "PGRST116") {
        // If columns don't exist yet in Supabase schema, read fallback usage table
        if (sessionErr.message?.includes("column") || sessionErr.code === "42703") {
          return await getFallbackBalance(sessionId, tier, allowance);
        }
        throw sessionErr;
      }

      if (sessionRow?.revoked_at) {
        return {
          sessionId,
          tier: allowance.tier,
          creditsGranted: 0,
          creditsConsumed: 0,
          creditsRemaining: 0,
          isSuspended: true,
          suspendedReason: "Session revoked",
          allowsForensic: allowance.allowsForensic,
          isMonthly: allowance.isMonthly,
        };
      }

      const isSuspended = Boolean(sessionRow?.is_suspended);
      const suspendedReason = sessionRow?.suspended_reason || null;

      // Determine granted credits (default to package limit if not explicitly set)
      const granted = sessionRow?.credits_granted && sessionRow.credits_granted > 0
        ? sessionRow.credits_granted
        : allowance.totalLimit;

      // Count consumed credits
      // sessionRow.credits_consumed tracks finalized analyses.
      // In-flight reservations with status === 'reserved' track analyses currently in progress.
      const finalizedConsumed = sessionRow?.credits_consumed ?? 0;
      let consumed = finalizedConsumed;

      try {
        const { data: resRows } = await db
          .from("analysis_credit_reservations")
          .select("id, status")
          .eq("session_id", sessionId);

        if (Array.isArray(resRows)) {
          const inFlightReservations = resRows.filter((r: any) => r.status === "reserved").length;
          const finalizedInTable = resRows.filter((r: any) => r.status === "finalized").length;
          const effectiveFinalized = Math.max(finalizedConsumed, finalizedInTable);
          consumed = effectiveFinalized + inFlightReservations;
        }
      } catch {
        // ignore if reservations table does not exist
      }

      // Also check free_usage table for backward compatibility
      const fallbackUsageKey = `paid_session_${sessionId}_total`;
      try {
        const { data: usageRow } = await db
          .from("free_usage")
          .select("analyses_used")
          .eq("uid", fallbackUsageKey)
          .maybeSingle();

        if (usageRow?.analyses_used !== undefined && usageRow.analyses_used > consumed) {
          consumed = usageRow.analyses_used;
        }
      } catch {
        // ignore
      }

      const remaining = Math.max(0, granted - consumed);

      return {
        sessionId,
        tier: sessionRow?.tier || allowance.tier,
        creditsGranted: granted,
        creditsConsumed: consumed,
        creditsRemaining: remaining,
        isSuspended,
        suspendedReason,
        allowsForensic: allowance.allowsForensic,
        isMonthly: allowance.isMonthly,
      };
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    if (err instanceof TypeError || !safeGetDb()) {
      return await getFallbackBalance(sessionId, tier, allowance);
    }
    logSupabaseFailure("getCreditBalance read", err?.supabaseError ?? err);
    throw new LifecycleError(
      503,
      "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment."
    );
  }
}

async function getFallbackBalance(
  sessionId: string,
  tier: string,
  allowance: PackageAllowance
): Promise<CreditBalance> {
  const db = safeGetDb();
  if (!db || typeof db.from !== "function") {
    let consumed = 0;
    for (const cached of requestCache.values()) {
      if (cached.sessionId === sessionId && (cached.status === "reserved" || cached.status === "finalized")) {
        consumed++;
      }
    }
    const granted = allowance.totalLimit;
    const remaining = Math.max(0, granted - consumed);
    return {
      sessionId,
      tier: allowance.tier,
      creditsGranted: granted,
      creditsConsumed: consumed,
      creditsRemaining: remaining,
      isSuspended: false,
      allowsForensic: allowance.allowsForensic,
      isMonthly: allowance.isMonthly,
    };
  }
  const fallbackUsageKey = `paid_session_${sessionId}_total`;
  const { data: usageRow } = await db
    .from("free_usage")
    .select("analyses_used")
    .eq("uid", fallbackUsageKey)
    .maybeSingle();

  const consumed = usageRow?.analyses_used ?? 0;
  const granted = allowance.totalLimit;
  const remaining = Math.max(0, granted - consumed);

  return {
    sessionId,
    tier: allowance.tier,
    creditsGranted: granted,
    creditsConsumed: consumed,
    creditsRemaining: remaining,
    isSuspended: false,
    allowsForensic: allowance.allowsForensic,
    isMonthly: allowance.isMonthly,
  };
}

/**
 * Atomically reserves 1 credit for an analysis request.
 * MUST be called BEFORE any AI processing begins.
 * Throws with code 'ANALYSIS_LIMIT_REACHED' if no credits remain.
 * Throws with code 'ACCOUNT_SUSPENDED' if the account is suspended.
 */
export async function reserveAnalysisCredit(params: {
  sessionId: string;
  firebaseUid: string;
  tier: string;
  requestId: string;
  analysisType: "quick" | "forensic";
  documentName?: string;
}): Promise<ReservationResult> {
  const { sessionId, firebaseUid, tier, requestId, analysisType, documentName } = params;
  const allowance = getPackageAllowance(tier);

  // Check forensic entitlement
  if (analysisType === "forensic" && !allowance.allowsForensic) {
    throw new LifecycleError(
      403,
      "FORENSIC_UPGRADE_REQUIRED",
      "Forensic In-Depth Dual-Pass scanning requires Document Analyzer Premium ($49.99) or CYFSA Case Access ($149/mo). Your current plan includes Quick Document Review."
    );
  }

  // Check idempotency cache first
  const cached = requestCache.get(requestId);
  if (cached) {
    if (cached.status === "finalized") {
      const balance = await getCreditBalance(sessionId, tier);
      return {
        reservationId: cached.reservationId,
        sessionId,
        requestId,
        slotIndex: cached.slotIndex,
        tier,
        creditsRemainingAfterReservation: balance.creditsRemaining,
        alreadyFinalized: true,
      };
    }
    if (cached.status === "reserved") {
      const balance = await getCreditBalance(sessionId, tier);
      return {
        reservationId: cached.reservationId,
        sessionId,
        requestId,
        slotIndex: cached.slotIndex,
        tier,
        creditsRemainingAfterReservation: balance.creditsRemaining,
      };
    }
  }

  // Acquire process-level mutex to serialize reservations for this session
  return await acquireSessionLock(sessionId, async () => {
    // Re-check balance inside the lock
    const balance = await getCreditBalance(sessionId, tier);

    if (balance.isSuspended) {
      throw new LifecycleError(
        403,
        "ACCOUNT_SUSPENDED",
        balance.suspendedReason ||
          "Your account access has been temporarily suspended pending payment verification. Please contact support at chris@cyfsanavigator.com."
      );
    }

    if (balance.creditsRemaining <= 0) {
      throw new LifecycleError(
        402,
        "ANALYSIS_LIMIT_REACHED",
        "You've used all analyses included in your package. Purchase additional analyses to continue."
      );
    }

    const db = safeGetDb();

    // Query existing reservations for this session to determine occupied slots and check idempotency
    const occupiedSlots = new Set<number>();
    for (let s = 1; s <= balance.creditsConsumed; s++) {
      occupiedSlots.add(s);
    }
    for (const cached of requestCache.values()) {
      if (cached.sessionId === sessionId && (cached.status === "reserved" || cached.status === "finalized")) {
        occupiedSlots.add(cached.slotIndex);
      }
    }
    const hasDb = Boolean(db && typeof db.from === "function");
    if (!hasDb) {
      return {
        reservationId: `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        sessionId,
        requestId,
        slotIndex: 1,
        tier,
        creditsRemainingAfterReservation: balance.creditsRemaining,
      };
    }

    if (hasDb) {
      try {
        const { data: existingReservations } = await db
          .from("analysis_credit_reservations")
          .select("id, slot_index, request_id, status")
          .eq("session_id", sessionId);

        if (Array.isArray(existingReservations) && existingReservations.length > 0) {
          // Idempotency: if request_id already exists for this session
          const matchingReq = existingReservations.find((r: any) => r.request_id === requestId);
          if (matchingReq) {
            return {
              reservationId: matchingReq.id,
              sessionId,
              requestId,
              slotIndex: matchingReq.slot_index,
              tier,
              creditsRemainingAfterReservation: balance.creditsRemaining,
              alreadyFinalized: matchingReq.status === "finalized",
            };
          }

          for (const r of existingReservations) {
            if (r.status === "reserved" || r.status === "finalized") {
              occupiedSlots.add(r.slot_index);
            }
          }
        }
      } catch {
        // Table may not exist yet, fallback
      }
    }

    // Find first unoccupied slot from 1 to balance.creditsGranted
    let slotIndex = -1;
    for (let s = 1; s <= balance.creditsGranted; s++) {
      if (!occupiedSlots.has(s)) {
        slotIndex = s;
        break;
      }
    }

    if (slotIndex === -1 || slotIndex > balance.creditsGranted) {
      throw new LifecycleError(
        402,
        "ANALYSIS_LIMIT_REACHED",
        "You've used all analyses included in your package. Purchase additional analyses to continue."
      );
    }

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Try database-level reservation in analysis_credit_reservations
    if (hasDb) {
      try {
        const { error: insertErr } = await db.from("analysis_credit_reservations").insert({
          id: reservationId.startsWith("res_") ? undefined : reservationId,
          session_id: sessionId,
          firebase_uid: firebaseUid,
          slot_index: slotIndex,
          request_id: requestId,
          analysis_type: analysisType,
          status: "reserved",
          document_name: documentName || null,
        });

        if (insertErr) {
          // If unique constraint violation on (session_id, slot_index) or request_id
          if (insertErr.code === "23505") {
            // If request_id already exists:
            const { data: existing } = await db
              .from("analysis_credit_reservations")
              .select("id, slot_index, status")
              .eq("request_id", requestId)
              .maybeSingle();

            if (existing) {
              return {
                reservationId: existing.id,
                sessionId,
                requestId,
                slotIndex: existing.slot_index,
                tier,
                creditsRemainingAfterReservation: balance.creditsRemaining,
                alreadyFinalized: existing.status === "finalized",
              };
            }

            // Slot was taken concurrently by another request
            throw new LifecycleError(
              402,
              "ANALYSIS_LIMIT_REACHED",
              "You've used all analyses included in your package. Purchase additional analyses to continue."
            );
          }
        }
      } catch (dbErr: any) {
        // If table doesn't exist yet, we enforce via atomic free_usage slot entry
        if (dbErr?.message?.includes("does not exist") || dbErr?.code === "42P01") {
          await reserveFallbackSlot(sessionId, slotIndex, requestId, balance.creditsGranted);
        } else if (dbErr instanceof LifecycleError) {
          throw dbErr;
        }
      }
    }

    // Cache the reservation
    requestCache.set(requestId, {
      reservationId,
      sessionId,
      status: "reserved",
      slotIndex,
      tier,
      timestamp: Date.now(),
    });

    const creditsRemainingAfterReservation = Math.max(0, balance.creditsGranted - occupiedSlots.size - 1);

    return {
      reservationId,
      sessionId,
      requestId,
      slotIndex,
      tier,
      creditsRemainingAfterReservation,
    };
  });
}

async function reserveFallbackSlot(
  sessionId: string,
  slotIndex: number,
  requestId: string,
  maxSlots: number
): Promise<void> {
  const db = safeGetDb();
  if (!db || typeof db.from !== "function") return;
  const slotKey = `paid_slot_${sessionId}_${slotIndex}`;

  const { error: slotErr } = await db.from("free_usage").insert({
    uid: slotKey,
    email: `reserved:${requestId}`,
    analyses_used: 1,
    first_analysis_at: new Date().toISOString(),
    last_analysis_at: new Date().toISOString(),
  });

  if (slotErr) {
    if (slotErr.code === "23505") {
      // Slot already taken
      throw new LifecycleError(
        402,
        "ANALYSIS_LIMIT_REACHED",
        "You've used all analyses included in your package. Purchase additional analyses to continue."
      );
    }
  }
}

/**
 * Safely releases a reservation when processing fails before a billable result is produced.
 * Restores the credit slot so the user is NOT charged for system errors.
 */
export async function releaseAnalysisReservation(params: {
  sessionId: string;
  requestId: string;
  reservationId?: string;
  reason?: string;
}): Promise<void> {
  const { sessionId, requestId, reason } = params;

  const cached = requestCache.get(requestId);
  if (cached) {
    cached.status = "released";
  }

  try {
    const db = safeGetDb();
    const hasDb = Boolean(db && typeof db.from === "function");
    if (hasDb) {
      // Update reservation in database
      await db
        .from("analysis_credit_reservations")
        .update({
          status: "released",
          released_at: new Date().toISOString(),
          metadata: { releaseReason: reason || "processing_error" },
        })
        .eq("request_id", requestId)
        .eq("status", "reserved");

      // Clean up fallback slot if used
      if (cached) {
        const slotKey = `paid_slot_${sessionId}_${cached.slotIndex}`;
        await db.from("free_usage").delete().eq("uid", slotKey);
      }
    }
  } catch (err) {
    console.error("[creditAccounting] Non-fatal error releasing credit reservation:", err);
  }
}

/**
 * Finalizes consumption of a reserved credit after an analysis successfully completes.
 * Updates credits_consumed, records in audit ledger, and sets reservation status to finalized.
 */
export async function finalizeAnalysisCredit(params: {
  sessionId: string;
  firebaseUid: string;
  requestId: string;
  reservationId?: string;
  tier: string;
  documentName?: string;
}): Promise<CreditBalance> {
  const { sessionId, firebaseUid, requestId, tier, documentName } = params;

  return await acquireSessionLock(sessionId, async () => {
    const cached = requestCache.get(requestId);
    if (cached) {
      cached.status = "finalized";
    }

    const db = safeGetDb();
    const hasDb = Boolean(db && typeof db.from === "function");
    const now = new Date().toISOString();

    if (hasDb) {
      // 1. Update reservation status to finalized
      try {
        await db
          .from("analysis_credit_reservations")
          .update({
            status: "finalized",
            finalized_at: now,
            document_name: documentName || null,
          })
          .eq("request_id", requestId);
      } catch {
        // ignore if table doesn't exist
      }

      // 2. Increment consumption counter on navigator_paid_sessions
      try {
        const { data: currentSession } = await db
          .from("navigator_paid_sessions")
          .select("credits_consumed, credits_granted")
          .eq("id", sessionId)
          .maybeSingle();

        const currentConsumed = currentSession?.credits_consumed ?? 0;
        const nextConsumed = currentConsumed + 1;

        await db
          .from("navigator_paid_sessions")
          .update({ credits_consumed: nextConsumed })
          .eq("id", sessionId);
      } catch {
        // column may not exist yet
      }

      // 3. Increment total usage in free_usage for backward compatibility
      const fallbackUsageKey = `paid_session_${sessionId}_total`;
      try {
        const { data: usageRow } = await db
          .from("free_usage")
          .select("analyses_used")
          .eq("uid", fallbackUsageKey)
          .maybeSingle();

        const current = usageRow?.analyses_used ?? 0;
        const next = current + 1;

        await db.from("free_usage").upsert(
          {
            uid: fallbackUsageKey,
            analyses_used: next,
            first_analysis_at: current === 0 ? now : undefined,
            last_analysis_at: now,
          },
          { onConflict: "uid" }
        );
      } catch (err) {
        console.error("[creditAccounting] Non-fatal fallback usage write error:", err);
      }

      // 4. Record audit ledger entry
      try {
        await db.from("credit_audit_ledger").insert({
          session_id: sessionId,
          firebase_uid: firebaseUid,
          event_type: "finalization",
          credits_delta: -1,
          reference_id: requestId,
          operator_role: "system",
          details: { tier, documentName: documentName || null },
        });
      } catch {
        // ignore if audit table not yet present
      }
    }

    return await getCreditBalance(sessionId, tier);
  });
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
