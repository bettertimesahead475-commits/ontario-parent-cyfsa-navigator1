// ---------------------------------------------------------------------------
// Facebook Page adapter — posts to a Facebook Page via the Graph API.
//
// Credential source, in order:
//   1. The Page connected through the admin OAuth flow (encrypted in
//      marketing_connections). This is the supported path.
//   2. Legacy environment variables FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN,
//      kept so an existing deployment keeps working. Prefer the OAuth path.
//
// Meta permissions required: pages_show_list, pages_manage_posts,
// pages_read_engagement. Granting these to accounts other than app roles
// requires Meta App Review (Advanced Access). Until then the adapter reports
// `waiting_for_platform_approval` when Meta rejects a call for permissions.
// ---------------------------------------------------------------------------

import { BaseAdapter, classifyPlatformError, httpJson, platformErrorMessage, readEnv } from "./base.js";
import type { ChannelState, MetricsResult, Platform, PublishInput, PublishResult, PublishFailureStatus } from "../types.js";
import { loadFacebookCredentials, markFacebookExpired } from "../connections.js";
import { graphBase } from "../facebookOAuth.js";

interface PageCredentials {
  pageId: string;
  token: string;
  source: "connection" | "env";
}

// Flat shape, not a discriminated union: this project compiles without
// strictNullChecks, which does not narrow unions (same convention as types.ts).
interface CredentialResult {
  ok: boolean;
  creds?: PageCredentials;
  status?: PublishFailureStatus;
  error?: string;
}

/** Resolves usable Page credentials. Never throws: a storage problem becomes an honest error state. */
export async function resolveFacebookCredentials(): Promise<CredentialResult> {
  try {
    const conn = await loadFacebookCredentials();
    if (conn.ok) return { ok: true, creds: { pageId: conn.pageId, token: conn.token, source: "connection" } };
    if (conn.reason === "expired") return { ok: false, status: "error", error: `${conn.message} Reconnect the Facebook Page in the Marketing Agent.` };
  } catch (e: any) {
    // Database not configured (503): there is no stored connection yet, so fall
    // through to the env path and report waiting. Any other failure is a real
    // error and must not be presented as "not connected".
    const legacy = legacyEnv();
    if (legacy) return { ok: true, creds: { ...legacy, source: "env" } };
    if (e?.statusCode === 503) {
      return { ok: false, status: "waiting_for_credentials", error: "Facebook Page is not connected. Connect it from the Marketing Agent." };
    }
    return { ok: false, status: "error", error: `Facebook connection could not be read: ${e?.message || "unknown error"}` };
  }
  const legacy = legacyEnv();
  if (legacy) return { ok: true, creds: { ...legacy, source: "env" } };
  return { ok: false, status: "waiting_for_credentials", error: "Facebook Page is not connected. Connect it from the Marketing Agent." };
}

function legacyEnv(): { pageId: string; token: string } | null {
  const pageId = readEnv("FACEBOOK_PAGE_ID");
  const token = readEnv("FACEBOOK_PAGE_ACCESS_TOKEN");
  return pageId && token ? { pageId, token } : null;
}

export class FacebookAdapter extends BaseAdapter {
  readonly platform: Platform = "facebook";
  readonly displayName = "Facebook Page";
  readonly requiredEnv = ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"];
  readonly maxContentLength = 63206;

  async getStatus(): Promise<ChannelState> {
    const resolved = await resolveFacebookCredentials();
    if (!resolved.ok) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: resolved.status,
        credentialsPresent: false,
        detail: resolved.error,
        missingEnv: resolved.status === "waiting_for_credentials" ? this.requiredEnv : [],
        lastError: resolved.status === "waiting_for_credentials" ? null : resolved.error,
      };
    }

    const { pageId, token } = resolved.creds;
    try {
      const { ok, status, body } = await httpJson(`${graphBase()}/${encodeURIComponent(pageId)}?fields=name,id&access_token=${encodeURIComponent(token)}`);
      if (ok && body?.id) {
        return {
          platform: this.platform,
          displayName: this.displayName,
          status: "connected",
          accountName: body.name,
          accountId: body.id,
          credentialsPresent: true,
          detail: `Connected to Facebook Page "${body.name}".`,
          missingEnv: [],
        };
      }
      if (body?.error?.code === 190) {
        await markFacebookExpired(`${platformErrorMessage(status, body)}. Reconnect the Facebook Page.`).catch(() => undefined);
        return {
          platform: this.platform,
          displayName: this.displayName,
          status: "error",
          credentialsPresent: true,
          detail: "Facebook connection expired. Reconnect the Facebook Page.",
          missingEnv: [],
          lastError: platformErrorMessage(status, body),
        };
      }
      const mapped = classifyPlatformError(status, body);
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: mapped,
        credentialsPresent: true,
        detail:
          mapped === "waiting_for_platform_approval"
            ? "Credentials present, but Facebook has not granted posting permissions yet (App Review / pages_manage_posts required)."
            : "Credentials present, but validating the Page token failed.",
        missingEnv: [],
        lastError: platformErrorMessage(status, body),
      };
    } catch (e: any) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: "error",
        credentialsPresent: true,
        detail: "Credentials present, but the connection check could not reach Facebook.",
        missingEnv: [],
        lastError: e?.message || String(e),
      };
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const resolved = await resolveFacebookCredentials();
    if (!resolved.ok) {
      return {
        ok: false,
        status: resolved.status,
        error: resolved.error,
        missingEnv: resolved.status === "waiting_for_credentials" ? this.requiredEnv : undefined,
      };
    }
    const validationError = this.validateInput(input);
    if (validationError) return { ok: false, status: "error", error: validationError };
    return this.postToGraph(input, resolved.creds);
  }

  async fetchMetrics(externalPostId: string): Promise<MetricsResult> {
    const resolved = await resolveFacebookCredentials();
    if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
    return this.fetchFromGraph(externalPostId, resolved.creds);
  }

  // Base-class hooks. publish()/fetchMetrics() above resolve credentials first, so
  // these are only reached if a caller bypasses them; they fail closed.
  protected async doPublish(input: PublishInput): Promise<PublishResult> {
    const resolved = await resolveFacebookCredentials();
    if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
    return this.postToGraph(input, resolved.creds);
  }

  protected async doFetchMetrics(externalPostId: string): Promise<MetricsResult> {
    const resolved = await resolveFacebookCredentials();
    if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };
    return this.fetchFromGraph(externalPostId, resolved.creds);
  }

  private async postToGraph(input: PublishInput, creds: PageCredentials): Promise<PublishResult> {
    const message = this.composeMessage(input);

    // A post with a photo uses the /photos edge; a text/link post uses /feed.
    const isPhoto = Boolean(input.mediaUrl);
    const endpoint = isPhoto ? `${graphBase()}/${creds.pageId}/photos` : `${graphBase()}/${creds.pageId}/feed`;
    const params = new URLSearchParams({ access_token: creds.token });
    if (isPhoto) {
      params.set("url", input.mediaUrl!);
      params.set("caption", message);
    } else {
      params.set("message", message);
      if (input.linkUrl) params.set("link", input.linkUrl);
    }

    const { ok, status, body } = await httpJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (ok && (body?.id || body?.post_id)) {
      const externalPostId = body.post_id || body.id;
      return {
        ok: true,
        externalPostId,
        externalUrl: `https://www.facebook.com/${externalPostId}`,
        raw: body,
      };
    }
    if (body?.error?.code === 190) {
      await markFacebookExpired(platformErrorMessage(status, body)).catch(() => undefined);
      return { ok: false, status: "error", error: "Facebook connection expired. Reconnect the Facebook Page, then retry this post." };
    }
    return {
      ok: false,
      status: classifyPlatformError(status, body),
      error: platformErrorMessage(status, body),
      raw: body,
    };
  }

  private async fetchFromGraph(externalPostId: string, creds: PageCredentials): Promise<MetricsResult> {
    const fields = "likes.summary(true),comments.summary(true),shares";
    const { ok, status, body } = await httpJson(
      `${graphBase()}/${encodeURIComponent(externalPostId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(creds.token)}`
    );
    if (ok) {
      return {
        ok: true,
        metrics: {
          likes: body?.likes?.summary?.total_count,
          comments: body?.comments?.summary?.total_count,
          shares: body?.shares?.count,
        },
        raw: body,
      };
    }
    return { ok: false, status: classifyPlatformError(status, body), error: platformErrorMessage(status, body) };
  }

  private composeMessage(input: PublishInput): string {
    const tags = (input.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    return [input.content?.trim(), tags].filter(Boolean).join("\n\n");
  }
}
