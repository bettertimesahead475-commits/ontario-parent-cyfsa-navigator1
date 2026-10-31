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
  callbacks?: AnalysisStreamCallbacks,
  options?: { inactivityTimeoutMs?: number; maxDurationMs?: number }
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
  // Cloudflare can be silent during long model calls; avoid false 45-second disconnects.
  // The overall cap sits above the server's 300 s function limit.
  const inactivityTimeoutMs = options?.inactivityTimeoutMs ?? 280000;
  const maxDurationMs = options?.maxDurationMs ?? 330000;
  const startOverall = Date.now();

  while (true) {
    if (Date.now() - startOverall > maxDurationMs) {
      throw streamInterrupted();
    }

    let timeoutId: any;
    const timeoutPromise = new Promise<{ done: boolean; value: undefined }>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(streamInterrupted());
      }, inactivityTimeoutMs);
    });

    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await Promise.race([reader.read(), timeoutPromise]);
    } catch (e) {
      if (e instanceof ApiResponseError) throw e;
      throw streamInterrupted(); // network dropped mid-stream
    } finally {
      clearTimeout(timeoutId);
    }

    const { done, value } = readResult;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const lines = rawEvent.split("\n").map(line => line.trimEnd());
      const eventName = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
      const dataText = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (!dataText) continue; // heartbeat or comment
      let payload: any;
      try {
        payload = JSON.parse(dataText);
      } catch {
        console.warn("Ignoring malformed analysis SSE payload.");
        continue;
      }
      // Cloudflare Pages emits named SSE events with raw payloads. Legacy API
      // emits unnamed events with a 'type' discriminator. Support both.
      const type = eventName || payload.type;
      if (type === "stage") {
        callbacks?.onStage?.(payload.stage, payload.percent, payload.message);
      } else if (type === "section") {
        const section = payload.section;
        callbacks?.onSection?.(section, payload.data ?? payload);
      } else if (type === "complete") {
        finalReport = payload.report ?? payload;
        callbacks?.onComplete?.(finalReport, payload.credits);
      } else if (type === "error") {
        callbacks?.onError?.({
          code: payload.code,
          message: payload.error ?? payload.message,
          statusCode: payload.statusCode ?? 500,
          retryable: payload.retryable ?? true,
        });
        throw new ApiResponseError(
          payload.error || payload.message || "Analysis failed.",
          payload.statusCode || 500,
          payload.code || "AI_ERROR",
          payload.retryable ?? true,
          payload.statusCode === 429
        );
      }
    }
  }

  if (!finalReport) {
    throw streamInterrupted();
  }
  return finalReport;
}

/**
 * The live progress connection ended before the result arrived. The analysis may still be running
 * (or finished) on the server, so callers recover it with pollAnalysisJob - they must not start a
 * second analysis, and must not claim nothing was charged, because the server may yet complete it.
 */
export const STREAM_INTERRUPTED = "STREAM_INTERRUPTED";
function streamInterrupted(): ApiResponseError {
  return new ApiResponseError(
    "The live progress connection was interrupted. Checking whether your analysis finished on the server...",
    0,
    STREAM_INTERRUPTED,
    false
  );
}

export interface AnalysisJobSnapshot {
  jobId: string;
  status: "pending" | "analyzing" | "completed" | "failed" | "timed_out";
  currentStage?: string;
  percent?: number;
  message?: string;
  sections?: Record<string, any>;
  sectionsTotal?: number;
  report?: any;
  error?: { code: string; message: string; statusCode: number; retryable: boolean };
}

export type AnalysisJobOutcome =
  | { status: "completed"; report: any }
  | { status: "failed"; error: { code: string; message: string; statusCode: number; retryable: boolean } };

/**
 * Follows a server-side analysis job until it completes or fails, reporting real progress from the
 * persisted job record. Used after a dropped stream and after a page reload; it never starts or
 * pays for a new analysis. Gives up (throwing ApiResponseError) only when the job cannot exist any
 * more: never created, the account is signed out, or it outlived the server's time limit.
 */
export async function pollAnalysisJob(
  jobId: string,
  options: {
    onProgress?: (job: AnalysisJobSnapshot) => void;
    isCancelled?: () => boolean;
    intervalMs?: number;
    maxWaitMs?: number;
    /** Request function; defaults to apiFetch (which attaches the caller's identity headers). */
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  } = {}
): Promise<AnalysisJobOutcome> {
  const fetcher = options.fetcher ?? apiFetch;
  const intervalMs = options.intervalMs ?? 3000;
  const maxWaitMs = options.maxWaitMs ?? 6 * 60 * 1000; // > 300 s function limit + persistence
  const started = Date.now();
  let notFoundCount = 0;
  let networkFailures = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (true) {
    if (options.isCancelled?.()) throw new ApiResponseError("Cancelled.", 0, "CANCELLED", false);
    if (Date.now() - started > maxWaitMs) {
      throw new ApiResponseError(
        "We couldn't confirm whether this analysis finished. Your document is safe. Check your saved reports, or start the analysis again.",
        504,
        "RECOVERY_TIMEOUT",
        true
      );
    }
    let res: Response;
    try {
      res = await fetcher(`/api/analyze/job/${encodeURIComponent(jobId)}`);
      networkFailures = 0;
    } catch {
      if (++networkFailures >= 10) {
        throw new ApiResponseError(
          "We lost the connection while checking your analysis. Your document is safe - please check your connection and reopen this page.",
          0,
          "NETWORK_ERROR",
          true
        );
      }
      await sleep(intervalMs);
      continue;
    }
    if (res.status === 401) {
      throw new ApiResponseError("Please sign in again to see this analysis.", 401, "SIGN_IN_REQUIRED", false);
    }
    if (res.status === 403) {
      throw new ApiResponseError("This analysis belongs to a different account.", 403, "FORBIDDEN", false);
    }
    if (res.status === 404) {
      // The record may not be written yet right after the request starts; then it truly does not exist.
      notFoundCount++;
      // A 404/pending result is normal while Cloudflare has not yet saved
      // the completed job. Never infer failure or start a new analysis here.
      await sleep(intervalMs);
      continue;
    }
    if (!res.ok) {
      await sleep(intervalMs);
      continue;
    }
    const job = (await res.json().catch(() => null)) as AnalysisJobSnapshot | null;
    if (job?.status === "completed" && job.report) return { status: "completed", report: job.report };
    if (job?.status === "failed" || job?.status === "timed_out") {
      // A stopped analysis is reported with its reason, and the caller decides whether to start it again.
      return {
        status: "failed",
        error: job.error || { code: "INTERNAL_ANALYSIS_ERROR", message: "The analysis could not be completed.", statusCode: 500, retryable: true },
      };
    }
    if (job?.status === "pending") {
      notFoundCount++;
      // A 404/pending result is normal while Cloudflare has not yet saved
      // the completed job. Never infer failure or start a new analysis here.
    } else if (job) {
      options.onProgress?.(job);
    }
    await sleep(intervalMs);
  }
}
