import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  consumeSharedRead,
  readLimitBackend,
  ReadLimiterUnavailable,
  ACROFORM_SHARED_RPC,
  type RpcCall
} from "./acroFormReadLimiter";

const ok = (data: unknown): RpcCall => async () => ({ data, error: null });

describe("readLimitBackend", () => {
  it("defaults to the per-process limiter", () => {
    expect(readLimitBackend({})).toBe("process");
  });

  it("selects the shared limiter only for the exact value 'shared'", () => {
    expect(readLimitBackend({ ACROFORM_LIMIT_BACKEND: "shared" })).toBe("shared");
    for (const v of ["SHARED", "1", "true", " shared", ""]) {
      expect(readLimitBackend({ ACROFORM_LIMIT_BACKEND: v })).toBe("process");
    }
  });
});

describe("consumeSharedRead", () => {
  it("calls the shared function with the user, limit and window", async () => {
    const rpc = vi.fn(ok(true));
    await consumeSharedRead("uid-1", 20, 900, rpc);
    expect(rpc).toHaveBeenCalledWith(ACROFORM_SHARED_RPC, { p_uid: "uid-1", p_limit: 20, p_window_seconds: 900 });
  });

  it("passes through an allowed read and a refused read", async () => {
    await expect(consumeSharedRead("u", 20, 900, ok(true))).resolves.toBe(true);
    await expect(consumeSharedRead("u", 20, 900, ok(false))).resolves.toBe(false);
  });

  it("fails closed when the call throws (for example, the function is missing)", async () => {
    const rpc: RpcCall = async () => {
      throw new Error("function public.acroform_consume_read does not exist");
    };
    await expect(consumeSharedRead("u", 20, 900, rpc)).rejects.toBeInstanceOf(ReadLimiterUnavailable);
  });

  it("fails closed when the database returns an error, even with data present", async () => {
    const rpc: RpcCall = async () => ({ data: true, error: { message: "boom" } });
    await expect(consumeSharedRead("u", 20, 900, rpc)).rejects.toBeInstanceOf(ReadLimiterUnavailable);
  });

  it.each([null, undefined, "true", 1, {}])("fails closed on a non-boolean answer (%j)", async value => {
    await expect(consumeSharedRead("u", 20, 900, ok(value))).rejects.toBeInstanceOf(ReadLimiterUnavailable);
  });
});

describe("pending migration: grants", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../supabase/migrations_pending_approval/acroform_shared_read_limit.sql"),
    "utf8"
  );

  it("is security definer and enables row level security on its table", () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/enable row level security/i);
  });

  it("grants execute only to service_role and never to anon or authenticated", () => {
    const grants = sql.split("\n").filter(l => /^\s*grant\s/i.test(l));
    expect(grants).toEqual([expect.stringMatching(/to service_role;$/)]);
    expect(sql).toMatch(/revoke all on function public\.acroform_consume_read[^;]*from public, anon, authenticated/i);
  });
});
