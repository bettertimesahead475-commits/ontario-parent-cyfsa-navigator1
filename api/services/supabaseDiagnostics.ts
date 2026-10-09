// ---------------------------------------------------------------------------
// Sanitized, secret-free descriptions of Supabase failures.
//
// getFreeUsage()/getActivePaidSession() used to collapse every failure into one
// generic "temporarily unavailable" response without logging the underlying cause, so a
// production outage looked identical whether the database was down, the network call never
// connected (DNS/TLS), the configured project URL pointed somewhere unexpected, or the API key
// was rejected. These helpers expose only non-secret facts: the configured hostname (a project
// ref, not a credential), the key's format and (for legacy JWT keys) its non-secret `role` and
// `ref` claims, the error message, and the network cause code. Key material is never returned.
// ---------------------------------------------------------------------------

import { resolveSupabaseCredentials } from "./access.js";

export type SupabaseFailureKind =
  | "NOT_CONFIGURED"
  | "NETWORK" // the request never got an HTTP response (DNS, TCP, TLS, reset, timeout)
  | "AUTH" // the gateway rejected the API key
  | "QUERY" // PostgREST answered with an error (missing table/column, RLS, etc.)
  | "UNKNOWN";

export interface SupabaseFailureDescription {
  kind: SupabaseFailureKind;
  host: string | null;
  message: string;
  causeCode: string | null;
  causeMessage: string | null;
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export function configuredSupabaseHost(): string | null {
  try {
    const creds = typeof resolveSupabaseCredentials === "function" ? resolveSupabaseCredentials() : null;
    const url = creds?.url || process.env.SUPABASE_URL || null;
    if (!url) return null;
    return new URL(url.trim()).hostname || null;
  } catch {
    return "(SUPABASE_URL is not a valid URL)";
  }
}

/** Never longer than this - error strings must not become a log/response amplification vector. */
function clip(value: unknown, max = 300): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function findCause(err: any): { code: string | null; message: string | null } {
  // Node's fetch wraps the real socket/DNS error in `cause` (sometimes nested one level deeper).
  let current = err?.cause ?? null;
  for (let depth = 0; current && depth < 3; depth++) {
    if (current.code || current.errno) {
      return { code: clip(current.code ?? current.errno, 60), message: clip(current.message) };
    }
    current = current.cause ?? null;
  }
  // supabase-js (postgrest-js) does not throw on a failed fetch; it returns
  // `{ message: "TypeError: fetch failed", details: "...\n\nCaused by: Error: <msg> (<CODE>)\n<stack>" }`.
  // Only that one "Caused by" line is kept - never the stack.
  if (typeof err?.details === "string") {
    const match = err.details.match(/Caused by: ([^\n]*?)(?: \(([A-Z0-9_]+)\))?\s*(?:\n|$)/);
    if (match) return { code: match[2] ? clip(match[2], 60) : null, message: clip(match[1]) };
  }
  return { code: null, message: clip(err?.cause?.message) };
}

/**
 * Describe a thrown error or a supabase-js `{ error }` value without exposing secrets.
 * supabase-js turns a rejected fetch into `{ message: "TypeError: fetch failed", details: ... }`,
 * so the PostgREST error object itself is also understood.
 */
export function describeSupabaseFailure(err: any): SupabaseFailureDescription {
  const host = configuredSupabaseHost();
  const message = clip(err?.message ?? err) || "Unknown error";
  const { code: causeCode, message: causeMessage } = findCause(err);
  const lower = `${message} ${causeMessage ?? ""}`.toLowerCase();

  let kind: SupabaseFailureKind = "UNKNOWN";
  if (lower.includes("not configured")) kind = "NOT_CONFIGURED";
  else if (
    (causeCode && NETWORK_CODES.has(causeCode)) ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("socket hang up")
  ) kind = "NETWORK";
  else if (lower.includes("invalid api key") || lower.includes("jwt") || err?.status === 401 || err?.code === "PGRST301") kind = "AUTH";
  else if (typeof err?.code === "string" && /^(PGRST|42|22|23)/.test(err.code)) kind = "QUERY";

  return { kind, host, message, causeCode, causeMessage };
}

/** Logs one structured, secret-free line for a failed Supabase operation. */
export function logSupabaseFailure(operation: string, err: any): SupabaseFailureDescription {
  const description = describeSupabaseFailure(err);
  console.error(`[supabase] ${operation} failed`, JSON.stringify(description));
  return description;
}

/** Non-secret facts about the configured service key, for the admin diagnostics route. */
export function describeConfiguredKey(): {
  source: string | null;
  format: "jwt" | "sb_secret" | "sb_publishable" | "other" | null;
  jwtRole: string | null;
  jwtRef: string | null;
} {
  const { key, source } = resolveSupabaseCredentials();
  if (!key) return { source: null, format: null, jwtRole: null, jwtRef: null };
  if (key.startsWith("sb_secret_")) return { source, format: "sb_secret", jwtRole: null, jwtRef: null };
  if (key.startsWith("sb_publishable_")) return { source, format: "sb_publishable", jwtRole: null, jwtRef: null };
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      // Only the public claims segment is decoded; the signature is never read or returned.
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      return {
        source,
        format: "jwt",
        jwtRole: typeof claims.role === "string" ? clip(claims.role, 40) : null,
        jwtRef: typeof claims.ref === "string" ? clip(claims.ref, 40) : null,
      };
    } catch {
      /* fall through */
    }
  }
  return { source, format: "other", jwtRole: null, jwtRef: null };
}
