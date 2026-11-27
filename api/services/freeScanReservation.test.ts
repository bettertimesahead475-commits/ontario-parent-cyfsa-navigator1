// Unit tests of the free-scan reservation client against an in-memory model of free_reserve_scan,
// free_finalize_scan and free_release_scan (one JavaScript turn per RPC stands in for the per-account lock).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: null as null | ((name: string, args: any) => Promise<{ data: unknown; error: unknown }>) }));
vi.mock("./access.js", () => ({ getSupabase: () => ({ rpc: (name: string, args: any) => db.rpc!(name, args) }) }));

import {
  FREE_SCAN_RESERVATION_TTL,
  finalizeFreeScan,
  releaseFreeScan,
  reserveFreeScan,
  settleFreeScan,
} from "./freeScanReservation";

type Marker = { state: "reserved" | "consumed" | "released"; id: string };

function createModel() {
  const markers = new Map<string, Marker>();
  const calls: { name: string; args: any }[] = [];
  let seq = 0;
  const key = (uid: string, req: string) => `${uid}\u0000${req}`;
  const used = (uid: string) => [...markers.entries()].filter(([k, m]) => k.startsWith(`${uid}\u0000`) && m.state !== "released").length;
  const rpc = async (name: string, args: any) => {
    calls.push({ name, args });
    await Promise.resolve();
    const k = key(args.p_uid, args.p_request);
    const m = markers.get(k);
    if (name === "free_reserve_scan") {
      if (m?.state === "consumed") return { data: { status: "consumed", reservation_id: null, used: used(args.p_uid) }, error: null };
      if (m?.state === "reserved") return { data: { status: "joined", reservation_id: null, used: used(args.p_uid) }, error: null };
      if (used(args.p_uid) >= args.p_limit) return { data: { status: "limit", reservation_id: null, used: used(args.p_uid) }, error: null };
      const id = `res_${++seq}`;
      markers.set(k, { state: "reserved", id });
      return { data: { status: "reserved", reservation_id: id, used: used(args.p_uid) }, error: null };
    }
    if (name === "free_finalize_scan") {
      if (!m) return { data: { status: "missing" }, error: null };
      if (m.state === "released") return { data: { status: "released" }, error: null };
      m.state = "consumed";
      return { data: { status: "consumed" }, error: null };
    }
    if (name === "free_release_scan") {
      if (m?.state === "reserved" && m.id === args.p_reservation_id) m.state = "released";
      return { data: null, error: null };
    }
    return { data: null, error: { code: "42883", message: "function does not exist" } };
  };
  return { markers, calls, rpc, used, key, expire: (uid: string, req: string) => { const x = markers.get(key(uid, req)); if (x) x.state = "released"; } };
}

let model: ReturnType<typeof createModel>;
beforeEach(() => {
  model = createModel();
  db.rpc = model.rpc;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const unavailable = { statusCode: 503, code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE" };

describe("reserveFreeScan", () => {
  it("sends the account, request, limit, current time and TTL to the database function", async () => {
    const r = await reserveFreeScan({ uid: "u1", requestId: "req_aaaaaaaa", limit: 3 });
    expect(r).toEqual({ status: "reserved", reservationId: "res_1", used: 1 });
    expect(model.calls[0]).toMatchObject({ name: "free_reserve_scan", args: { p_uid: "u1", p_request: "req_aaaaaaaa", p_limit: 3, p_ttl: FREE_SCAN_RESERVATION_TTL } });
    expect(Number.isNaN(Date.parse(model.calls[0].args.p_now))).toBe(false);
  });

  it("a duplicate request for the same id joins the live reservation and takes no second scan", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_dup", limit: 3 });
    const again = await reserveFreeScan({ uid: "u1", requestId: "req_dup", limit: 3 });
    expect(again).toEqual({ status: "joined", reservationId: null, used: 1 });
  });

  it("concurrent requests cannot take more scans than the allowance", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserveFreeScan({ uid: "u1", requestId: `req_${i}`, limit: 3 })));
    expect(results.filter((r) => r.status === "reserved")).toHaveLength(3);
    expect(results.filter((r) => r.status === "limit")).toHaveLength(7);
    expect(model.used("u1")).toBe(3);
  });

  it("concurrent duplicates of one id produce exactly one reservation", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveFreeScan({ uid: "u1", requestId: "req_same", limit: 3 })));
    expect(results.filter((r) => r.status === "reserved")).toHaveLength(1);
    expect(results.filter((r) => r.status === "joined")).toHaveLength(4);
  });

  it("accounts are isolated: one account's use never limits another's", async () => {
    for (let i = 0; i < 3; i++) await reserveFreeScan({ uid: "u1", requestId: `req_${i}`, limit: 3 });
    expect((await reserveFreeScan({ uid: "u1", requestId: "req_x", limit: 3 })).status).toBe("limit");
    expect(await reserveFreeScan({ uid: "u2", requestId: "req_x", limit: 3 })).toMatchObject({ status: "reserved", used: 1 });
  });

  it("a consumed scan is reported as consumed, not reserved again", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_c", limit: 3 });
    await finalizeFreeScan({ uid: "u1", requestId: "req_c" });
    expect((await reserveFreeScan({ uid: "u1", requestId: "req_c", limit: 3 })).status).toBe("consumed");
  });

  it("a missing reservation id and missing used count are normalised", async () => {
    db.rpc = async () => ({ data: { status: "limit" }, error: null });
    expect(await reserveFreeScan({ uid: "u1", requestId: "req_n", limit: 0 })).toEqual({ status: "limit", reservationId: null, used: 0 });
  });

  it("a database error or a transport failure fails closed with 503", async () => {
    db.rpc = async () => ({ data: null, error: { code: "08006", message: "connection failure" } });
    await expect(reserveFreeScan({ uid: "u1", requestId: "req_e", limit: 3 })).rejects.toMatchObject(unavailable);
    db.rpc = async () => { throw new TypeError("fetch failed"); };
    await expect(reserveFreeScan({ uid: "u1", requestId: "req_e", limit: 3 })).rejects.toMatchObject(unavailable);
  });
});

describe("finalizeFreeScan", () => {
  it("records a reserved scan once; repeats stay consumed", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_f", limit: 3 });
    expect(await finalizeFreeScan({ uid: "u1", requestId: "req_f" })).toBe("consumed");
    expect(await finalizeFreeScan({ uid: "u1", requestId: "req_f" })).toBe("consumed");
    expect(model.used("u1")).toBe(1);
  });

  it("reports missing and released reservations so the caller never delivers for free", async () => {
    expect(await finalizeFreeScan({ uid: "u1", requestId: "req_none" })).toBe("missing");
    await reserveFreeScan({ uid: "u1", requestId: "req_r", limit: 3 });
    model.expire("u1", "req_r");
    expect(await finalizeFreeScan({ uid: "u1", requestId: "req_r" })).toBe("released");
  });

  it("another account cannot finalize this account's reservation", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_o", limit: 3 });
    expect(await finalizeFreeScan({ uid: "u2", requestId: "req_o" })).toBe("missing");
    expect(model.markers.get(model.key("u1", "req_o"))?.state).toBe("reserved");
  });

  it("retries a transient failure after 150 ms and succeeds", async () => {
    vi.useFakeTimers();
    await reserveFreeScan({ uid: "u1", requestId: "req_t", limit: 3 });
    let failures = 1;
    const real = model.rpc;
    db.rpc = async (n, a) => (failures-- > 0 ? { data: null, error: { code: "08006", message: "x" } } : real(n, a));
    const done = finalizeFreeScan({ uid: "u1", requestId: "req_t" });
    await vi.advanceTimersByTimeAsync(150);
    expect(await done).toBe("consumed");
  });

  it("throws the last error after three failed attempts and leaves the reservation held", async () => {
    vi.useFakeTimers();
    await reserveFreeScan({ uid: "u1", requestId: "req_t3", limit: 3 });
    const rpc = vi.fn(async () => ({ data: null, error: { code: "08006", message: "x" } }));
    db.rpc = rpc;
    const done = finalizeFreeScan({ uid: "u1", requestId: "req_t3" });
    const assertion = expect(done).rejects.toMatchObject(unavailable);
    await vi.advanceTimersByTimeAsync(700);
    await assertion;
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(model.markers.get(model.key("u1", "req_t3"))?.state).toBe("reserved");
  });
});

describe("settleFreeScan", () => {
  it("delivers a report whose scan is reserved, recording it", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_s", limit: 3 });
    expect(await settleFreeScan({ uid: "u1", requestId: "req_s", limit: 3 })).toBe("delivered");
    expect(model.markers.get(model.key("u1", "req_s"))?.state).toBe("consumed");
  });

  it("an expired reservation is reserved again and recorded when the allowance allows", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_s2", limit: 3 });
    model.expire("u1", "req_s2");
    expect(await settleFreeScan({ uid: "u1", requestId: "req_s2", limit: 3 })).toBe("delivered");
    expect(model.used("u1")).toBe(1);
  });

  it("an expired reservation is not delivered once the allowance is used up", async () => {
    await reserveFreeScan({ uid: "u1", requestId: "req_late", limit: 1 });
    model.expire("u1", "req_late");
    await reserveFreeScan({ uid: "u1", requestId: "req_other", limit: 1 });
    expect(await settleFreeScan({ uid: "u1", requestId: "req_late", limit: 1 })).toBe("limit");
  });

  it("returns in_progress when another live reservation holds the id, and delivered when it was consumed meanwhile", async () => {
    db.rpc = async (name) => name === "free_finalize_scan" ? { data: { status: "missing" }, error: null } : { data: { status: "joined", reservation_id: null, used: 1 }, error: null };
    expect(await settleFreeScan({ uid: "u1", requestId: "req_j", limit: 3 })).toBe("in_progress");
    db.rpc = async (name) => name === "free_finalize_scan" ? { data: { status: "released" }, error: null } : { data: { status: "consumed", reservation_id: null, used: 1 }, error: null };
    expect(await settleFreeScan({ uid: "u1", requestId: "req_j", limit: 3 })).toBe("delivered");
  });

  it("an unknown outcome throws so nothing is delivered", async () => {
    db.rpc = async () => { throw new Error("socket hang up"); };
    vi.useFakeTimers();
    const done = settleFreeScan({ uid: "u1", requestId: "req_u", limit: 3 });
    const assertion = expect(done).rejects.toMatchObject(unavailable);
    await vi.advanceTimersByTimeAsync(700);
    await assertion;
  });
});

describe("releaseFreeScan (refund of an unfinished scan)", () => {
  it("returns the scan to the allowance", async () => {
    const r = await reserveFreeScan({ uid: "u1", requestId: "req_rel", limit: 1 });
    await releaseFreeScan({ uid: "u1", requestId: "req_rel", reservationId: r.reservationId! });
    expect(model.used("u1")).toBe(0);
    expect((await reserveFreeScan({ uid: "u1", requestId: "req_next", limit: 1 })).status).toBe("reserved");
  });

  it("a recorded scan is never refunded", async () => {
    const r = await reserveFreeScan({ uid: "u1", requestId: "req_done", limit: 3 });
    await finalizeFreeScan({ uid: "u1", requestId: "req_done" });
    await releaseFreeScan({ uid: "u1", requestId: "req_done", reservationId: r.reservationId! });
    expect(model.markers.get(model.key("u1", "req_done"))?.state).toBe("consumed");
  });

  it("an unauthorized caller (wrong account or wrong reservation id) changes nothing", async () => {
    const r = await reserveFreeScan({ uid: "u1", requestId: "req_own", limit: 3 });
    await releaseFreeScan({ uid: "u2", requestId: "req_own", reservationId: r.reservationId! });
    await releaseFreeScan({ uid: "u1", requestId: "req_own", reservationId: "res_forged" });
    expect(model.markers.get(model.key("u1", "req_own"))?.state).toBe("reserved");
    expect(model.calls.filter((c) => c.name === "free_release_scan").map((c) => c.args.p_uid)).toEqual(["u2", "u1"]);
  });

  it("a failed release transaction is reported as 503, not silently ignored", async () => {
    db.rpc = async () => ({ data: null, error: { code: "40001", message: "serialization failure" } });
    await expect(releaseFreeScan({ uid: "u1", requestId: "req_x", reservationId: "res_1" })).rejects.toMatchObject(unavailable);
  });
});
