import { redactDiagnostic } from "./analyzerErrors.js";

/**
 * The message a customer may see for a thrown error. Client errors (4xx) are fixed text written
 * by this server, so their message is shown. Anything else, including database and provider
 * errors, is replaced with the fallback so raw text never reaches the browser.
 */
export function publicErrorMessage(err: unknown, fallback: string): string {
  const e = err as { statusCode?: unknown; message?: unknown } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : 500;
  const message = typeof e?.message === "string" ? e.message : "";
  return status >= 400 && status < 500 && message ? message : fallback;
}

/** Server-side log line for an error. Detail is redacted and never sent to the customer. */
export function logServerError(label: string, err: unknown): void {
  const e = err as { message?: unknown; detail?: unknown; supabaseError?: { message?: unknown } } | null;
  const parts = [e?.message, e?.detail, e?.supabaseError?.message].filter((p) => typeof p === "string" && p);
  console.error(`[${label}] ${redactDiagnostic(parts.join(" | ") || String(err), 400)}`);
}
