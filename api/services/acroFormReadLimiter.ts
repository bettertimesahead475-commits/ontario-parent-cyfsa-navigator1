/**
 * Read limiter for POST /api/acroform/ingest.
 *
 * Two backends. The default, "process", is the in-memory limiter in acroFormRoutes.ts: each serverless instance keeps its
 * own count, so it is a brake, not a quota. The "shared" backend calls the acroform_consume_read function
 * (supabase/migrations_pending_approval/acroform_shared_read_limit.sql), so every instance counts the same reads.
 *
 * "shared" is selected only by ACROFORM_LIMIT_BACKEND="shared". It fails closed: if the function is missing, the call
 * errors, or the answer is not a boolean, consumeSharedRead throws ReadLimiterUnavailable and the route refuses the read.
 * It never falls back to "allow".
 */
import { getSupabase } from "./access.js";

export const ACROFORM_LIMIT_BACKEND_ENV = "ACROFORM_LIMIT_BACKEND";
export const ACROFORM_SHARED_RPC = "acroform_consume_read";

export type ReadLimitBackend = "process" | "shared";

export function readLimitBackend(env: NodeJS.ProcessEnv = process.env): ReadLimitBackend {
  return env[ACROFORM_LIMIT_BACKEND_ENV] === "shared" ? "shared" : "process";
}

export class ReadLimiterUnavailable extends Error {
  constructor() {
    super("The shared read limiter is unavailable.");
    this.name = "ReadLimiterUnavailable";
  }
}

export type RpcCall = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

const defaultRpc: RpcCall = (fn, args) => getSupabase().rpc(fn, args);

/** True when the read is within the limit. Throws ReadLimiterUnavailable on any failure: never allows by default. */
export async function consumeSharedRead(
  uid: string,
  limit: number,
  windowSeconds: number,
  rpc: RpcCall = defaultRpc
): Promise<boolean> {
  let result: { data: unknown; error: unknown };
  try {
    result = await rpc(ACROFORM_SHARED_RPC, { p_uid: uid, p_limit: limit, p_window_seconds: windowSeconds });
  } catch {
    throw new ReadLimiterUnavailable();
  }
  if (result.error || typeof result.data !== "boolean") throw new ReadLimiterUnavailable();
  return result.data;
}
