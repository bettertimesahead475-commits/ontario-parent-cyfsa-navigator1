// In-memory model of the free-scan reservation functions, for route tests only. It mirrors free_reserve_scan,
// free_finalize_scan and free_release_scan in supabase/migrations_pending_approval, and settleFreeScan in
// api/services/freeScanReservation.ts. The PostgreSQL run (free_scan_reservation_functions.test.sql and the
// concurrency run) is the authority on the database semantics; this model lets route tests observe them.
import { vi } from "vitest";

type Marker = "reserved" | "consumed" | "released";

export function createFreeScanEmulator(readStored: (uid: string) => Promise<number>) {
  const markers = new Map<string, Marker>();
  const key = (uid: string, requestId: string) => `${uid}\u0000${requestId}`;
  const heldBy = (uid: string) =>
    [...markers.entries()].filter(([k, m]) => k.startsWith(`${uid}\u0000`) && m !== "released").length;

  const reserveFreeScan = vi.fn(async ({ uid, requestId, limit }: { uid: string; requestId: string; limit: number }) => {
    const marker = markers.get(key(uid, requestId));
    if (marker === "consumed") return { status: "consumed", reservationId: null, used: await countUsed(uid) };
    if (marker === "reserved") return { status: "joined", reservationId: null, used: await countUsed(uid) };
    const used = await countUsed(uid);
    if (used >= limit) return { status: "limit", reservationId: null, used };
    markers.set(key(uid, requestId), "reserved");
    return { status: "reserved", reservationId: `${uid}\u0000${requestId}`, used: used + 1 };
  });

  const finalizeFreeScan = vi.fn(async ({ uid, requestId }: { uid: string; requestId: string }) => {
    const marker = markers.get(key(uid, requestId));
    if (marker === undefined) return "missing";
    if (marker === "released") return "released";
    markers.set(key(uid, requestId), "consumed");
    return "consumed";
  });

  const releaseFreeScan = vi.fn(async ({ uid, requestId, reservationId }: { uid: string; requestId: string; reservationId: string }) => {
    if (reservationId !== `${uid}\u0000${requestId}` || markers.get(key(uid, requestId)) !== "reserved") return;
    markers.set(key(uid, requestId), "released");
  });

  const settleFreeScan = vi.fn(async ({ uid, requestId, limit }: { uid: string; requestId: string; limit: number }) => {
    if ((await finalizeFreeScan({ uid, requestId })) === "consumed") return "delivered";
    const scan = await reserveFreeScan({ uid, requestId, limit });
    if (scan.status === "consumed") return "delivered";
    if (scan.status === "limit") return "limit";
    if (scan.status === "joined") return "in_progress";
    await finalizeFreeScan({ uid, requestId });
    return "delivered";
  });

  async function countUsed(uid: string) {
    return (await readStored(uid)) + heldBy(uid);
  }

  return {
    reserveFreeScan,
    finalizeFreeScan,
    releaseFreeScan,
    settleFreeScan,
    FREE_SCAN_RESERVATION_TTL: "15 minutes",
    /** Forgets every reservation, as a fresh account would have. */
    reset() {
      markers.clear();
    },
    /** Simulates reconciliation of a reservation whose analysis went quiet: the unit is returned. */
    expire(uid: string, requestId: string) {
      if (markers.get(key(uid, requestId)) === "reserved") markers.set(key(uid, requestId), "released");
    },
    /** Units this account has consumed (delivered scans). */
    consumedFor(uid: string) {
      return [...markers.entries()].filter(([k, m]) => k.startsWith(`${uid}\u0000`) && m === "consumed").length;
    },
    /** Units held right now (reserved or consumed). */
    heldFor: heldBy,
  };
}
