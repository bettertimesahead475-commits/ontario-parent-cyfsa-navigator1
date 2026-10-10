import { auth } from "./firebase";
import { getUserKey } from "./storage";

/**
 * Robust API helper that routes relative routes correctly, and attaches
 * identity headers every request needs for the paywall:
 *  - Authorization: Bearer <Firebase ID token>, if a parent is signed in
 *    (this is how the server knows *who* is asking, for the free-tier count)
 *  - X-PS-Session: <paid session token>, if one is stored locally (Pro/Premium
 *    unlock — takes priority over the free-tier check server-side)
 * Both are safe to send on every request; routes that don't care simply
 * ignore them.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  try {
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken();
      headers.set("Authorization", `Bearer ${idToken}`);
    }
  } catch (e) {
    console.warn("Failed to attach Firebase ID token to request:", e);
  }

  try {
    const sessionToken = localStorage.getItem(getUserKey("ps_session_token") || "ps_session_token");
    if (sessionToken) headers.set("X-PS-Session", sessionToken);
  } catch (e) {
    console.warn("Failed to attach session token to request:", e);
  }

  return fetch(input, { ...init, headers });
}

/** Error thrown by safeReadJson for a non-2xx or non-JSON response. */
export class ApiResponseError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly isRateLimit: boolean;
  constructor(message: string, status: number, code: string | null, retryable: boolean, isRateLimit = false) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.isRateLimit = isRateLimit;
  }
}

/**
 * Safely parses the JSON response. A non-2xx response throws an ApiResponseError that keeps the
 * server's status, machine-readable `code` and `retryable` flag, so callers can tell "sign in" /
 * "free limit reached" (never worth retrying) apart from a temporary outage. A non-JSON response
 * (typically a gateway timeout page) is reported as a readable message, never raw HTML.
 */
export async function safeReadJson(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    await response.text().catch(() => "");
    const status = response.status;
    const message =
      status === 504 || status === 502
        ? "The server took too long to respond. Your document is safe - please try again in a moment."
        : status >= 500
          ? `The server is temporarily unavailable (${status}). Your document is safe - please try again in a moment.`
          : `Unexpected server response (${status}).`;
    throw new ApiResponseError(message, status, null, status >= 500 || status === 408);
  }
  const data = await response.json();
  if (!response.ok) {
    const status = response.status;
    const retryable = typeof data?.retryable === "boolean" ? data.retryable : status >= 500 || status === 429 || status === 408;
    throw new ApiResponseError(
      data?.error || `Server error (${status})`,
      status,
      typeof data?.code === "string" ? data.code : null,
      retryable,
      status === 429 || data?.isRateLimit === true
    );
  }
  return data;
}

export interface AnalysisStreamCallbacks {
  onStage?: (stage: string, percent: number, message: string) => void;
  onSection?: (section: string, data: any) => void;
  onComplete?: (report: any, credits?: any) => void;
  onError?: (error: { code: string; message: string; statusCode: number; retryable: boolean }) => void;
}

/**
 * Reads real-time progress events from the Server-Sent Events (SSE) stream returned by /api/analyze.
 * Automatically decodes chunked transfer, dispatches stage callbacks, and resolves with the verified report.
 */
export async function readAnalysisEventStream(
  response: Response,
  callbacks?: AnalysisStreamCallbacks
): Promise<any> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    return safeReadJson(response);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Unable to establish streaming connection.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalReport: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const line = rawEvent.trim();
      if (!line || line.startsWith(":")) continue; // heartbeat
      if (line.startsWith("data: ")) {
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "stage") {
            callbacks?.onStage?.(payload.stage, payload.percent, payload.message);
          } else if (payload.type === "section") {
            callbacks?.onSection?.(payload.section, payload.data);
          } else if (payload.type === "complete") {
            finalReport = payload.report;
            callbacks?.onComplete?.(payload.report, payload.credits);
          } else if (payload.type === "error") {
            callbacks?.onError?.({
              code: payload.code,
              message: payload.error,
              statusCode: payload.statusCode,
              retryable: payload.retryable,
            });
            throw new ApiResponseError(
              payload.error || "Analysis failed.",
              payload.statusCode || 500,
              payload.code || "AI_ERROR",
              payload.retryable ?? true,
              payload.statusCode === 429
            );
          }
        } catch (e) {
          if (e instanceof ApiResponseError) throw e;
          console.warn("Failed to parse SSE line:", line, e);
        }
      }
    }
  }

  if (!finalReport) {
    throw new Error("Analysis stream disconnected before completion. Please retry.");
  }
  return finalReport;
}
