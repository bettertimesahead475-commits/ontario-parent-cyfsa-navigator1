// ---------------------------------------------------------------------------
// BaseAdapter — shared plumbing for every social adapter.
//
// It centralizes the ONE decision that keeps the whole system honest: given the
// required env vars, is this platform actually usable right now? If any required
// var is missing, the adapter is in `waiting_for_credentials` and every method
// short-circuits to an honest non-success rather than pretending. Concrete
// adapters only implement the real API calls for the path where credentials
// genuinely exist.
// ---------------------------------------------------------------------------

import type {
  ChannelState,
  MetricsResult,
  Platform,
  PublishInput,
  PublishResult,
  SocialAdapter,
} from "../types.js";

export function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function missingEnvVars(required: string[]): string[] {
  return required.filter((name) => !readEnv(name));
}

/**
 * Maps a failed platform HTTP response onto one of our honest non-success
 * statuses. A permissions/scope/app-review signal becomes
 * `waiting_for_platform_approval` (the credentials exist, the platform just
 * hasn't granted the capability yet); everything else is a plain `error`.
 */
export function classifyPlatformError(
  status: number,
  body: any
): "waiting_for_platform_approval" | "error" {
  const text = (typeof body === "string" ? body : JSON.stringify(body || "")).toLowerCase();
  const looksLikeApproval =
    status === 403 ||
    text.includes("permission") ||
    text.includes("scope") ||
    text.includes("not been approved") ||
    text.includes("not authorized") ||
    text.includes("app review") ||
    text.includes("unaudited") ||
    text.includes("insufficient") ||
    text.includes("feature is not available");
  return looksLikeApproval ? "waiting_for_platform_approval" : "error";
}

/** Extracts a readable message from a platform's JSON error body, best-effort. */
export function platformErrorMessage(status: number, body: any): string {
  if (body && typeof body === "object") {
    const msg =
      body.error?.message ||
      body.error_description ||
      body.message ||
      body.error?.error_user_msg ||
      (typeof body.error === "string" ? body.error : null) ||
      body.detail ||
      body.title;
    if (msg) return `${msg} (HTTP ${status})`;
  }
  if (typeof body === "string" && body.trim()) return `${body.slice(0, 200)} (HTTP ${status})`;
  return `Platform returned HTTP ${status}.`;
}

/** A small helper around fetch with a timeout, used by concrete adapters. */
export async function httpJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; body: any }> {
  const { timeoutMs = 15000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...rest, signal: controller.signal });
    const text = await resp.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body (e.g. an HTML error page) — leave as text */
    }
    return { ok: resp.ok, status: resp.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export abstract class BaseAdapter implements SocialAdapter {
  abstract readonly platform: Platform;
  abstract readonly displayName: string;
  abstract readonly requiredEnv: string[];
  readonly maxContentLength: number = 0;
  readonly requiresMedia: boolean = false;

  protected missingEnv(): string[] {
    return missingEnvVars(this.requiredEnv);
  }

  protected isConfigured(): boolean {
    return this.missingEnv().length === 0;
  }

  /**
   * Default status: honest env presence check. When no credentials are set, the
   * channel is `waiting_for_credentials`. When they are set, the base class
   * reports `connected` optimistically — concrete adapters that can cheaply
   * validate a token (e.g. a `/me` call) SHOULD override getStatus() to upgrade
   * this to a verified `connected`, or to `waiting_for_platform_approval` /
   * `error` based on what the live check actually returns.
   */
  async getStatus(): Promise<ChannelState> {
    const missing = this.missingEnv();
    if (missing.length > 0) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: "waiting_for_credentials",
        credentialsPresent: false,
        detail: `Not connected yet. Set ${missing.join(", ")} to connect ${this.displayName}.`,
        missingEnv: missing,
      };
    }
    return {
      platform: this.platform,
      displayName: this.displayName,
      status: "connected",
      credentialsPresent: true,
      detail: `${this.displayName} credentials are present.`,
      missingEnv: [],
    };
  }

  /** Honest non-success when unconfigured; concrete classes implement the real call. */
  async publish(input: PublishInput): Promise<PublishResult> {
    const missing = this.missingEnv();
    if (missing.length > 0) {
      return {
        ok: false,
        status: "waiting_for_credentials",
        error: `${this.displayName} is not connected. Missing: ${missing.join(", ")}.`,
        missingEnv: missing,
      };
    }
    const validationError = this.validateInput(input);
    if (validationError) {
      return { ok: false, status: "error", error: validationError };
    }
    return this.doPublish(input);
  }

  async fetchMetrics(externalPostId: string): Promise<MetricsResult> {
    const missing = this.missingEnv();
    if (missing.length > 0) {
      return {
        ok: false,
        status: "waiting_for_credentials",
        error: `${this.displayName} is not connected. Missing: ${missing.join(", ")}.`,
        missingEnv: missing,
      };
    }
    return this.doFetchMetrics(externalPostId);
  }

  /** Shared content validation (length + media requirement). */
  protected validateInput(input: PublishInput): string | null {
    const content = (input.content || "").trim();
    if (!content && !input.mediaUrl) {
      return "Post has no content.";
    }
    if (this.maxContentLength > 0 && content.length > this.maxContentLength) {
      return `Content is ${content.length} characters; ${this.displayName} allows at most ${this.maxContentLength}.`;
    }
    if (this.requiresMedia && !input.mediaUrl) {
      return `${this.displayName} requires an image or video (media_url).`;
    }
    return null;
  }

  /** Implemented by concrete adapters — only reached when credentials exist. */
  protected abstract doPublish(input: PublishInput): Promise<PublishResult>;
  protected abstract doFetchMetrics(externalPostId: string): Promise<MetricsResult>;
}
