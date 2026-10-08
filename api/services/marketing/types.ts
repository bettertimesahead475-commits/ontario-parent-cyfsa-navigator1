// ---------------------------------------------------------------------------
// Shared types for the Marketing Agent's social-platform adapter layer.
//
// The guiding rule for everything here: NEVER fabricate a connection, a
// publication, or a metric. Every adapter method returns a discriminated union
// that can honestly report `waiting_for_credentials` /
// `waiting_for_platform_approval` / `error` instead of a fake success. A post
// is only ever marked "published" when a real platform API returned a real
// post id.
// ---------------------------------------------------------------------------

export type Platform = "facebook" | "instagram" | "linkedin" | "x" | "tiktok";

export const PLATFORMS: Platform[] = ["facebook", "instagram", "linkedin", "x", "tiktok"];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

// Mirrors the CHECK constraint on marketing_channels.status.
export type ChannelStatus =
  | "connected"
  | "waiting_for_credentials"
  | "waiting_for_platform_approval"
  | "error"
  | "disconnected";

export interface ChannelState {
  platform: Platform;
  displayName: string;
  status: ChannelStatus;
  accountName?: string | null;
  accountId?: string | null;
  scopes?: string[];
  credentialsPresent: boolean;
  /** Human-readable, honest explanation of the current status. */
  detail: string;
  /** Required env vars that are currently missing (drives the setup UI). */
  missingEnv: string[];
  lastError?: string | null;
}

export interface PublishInput {
  content: string;
  mediaUrl?: string | null;
  linkUrl?: string | null;
  hashtags?: string[] | null;
}

// NOTE: these results are flat interfaces (a single shape with optional fields),
// NOT discriminated unions. This project's tsconfig has `strict` off, so
// `strictNullChecks` is off, and TypeScript only narrows discriminated unions
// under strictNullChecks — a `{ok:true}|{ok:false}` union would leave every
// access un-narrowed and fail to compile here. `ok` is still the field callers
// branch on at runtime; the non-success fields are simply optional.
export type PublishFailureStatus = "waiting_for_credentials" | "waiting_for_platform_approval" | "error";

export interface PublishResult {
  ok: boolean;
  externalPostId?: string;
  externalUrl?: string | null;
  /** Set when ok === false: how to classify the failure. */
  status?: PublishFailureStatus;
  /** Set when ok === false: a human-readable reason. */
  error?: string;
  missingEnv?: string[];
  raw?: unknown;
}

export interface PostMetrics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
}

// Flat interface for the same reason as PublishResult (see note above).
export interface MetricsResult {
  ok: boolean;
  metrics?: PostMetrics;
  status?: PublishFailureStatus;
  error?: string;
  missingEnv?: string[];
  raw?: unknown;
}

export interface SocialAdapter {
  readonly platform: Platform;
  readonly displayName: string;
  /** Env var names this adapter needs before it can do anything real. */
  readonly requiredEnv: string[];
  /** Char limit for a single post's text body (0 = effectively unlimited). */
  readonly maxContentLength: number;
  /** Whether a post on this platform requires media (e.g. Instagram, TikTok). */
  readonly requiresMedia: boolean;

  /** Current connection state — presence of env, plus a live check when configured. */
  getStatus(): Promise<ChannelState>;
  /** Publish a post. Returns a real external id on success, or an honest non-success. */
  publish(input: PublishInput): Promise<PublishResult>;
  /** Fetch engagement metrics for a previously published post. */
  fetchMetrics(externalPostId: string): Promise<MetricsResult>;
}
