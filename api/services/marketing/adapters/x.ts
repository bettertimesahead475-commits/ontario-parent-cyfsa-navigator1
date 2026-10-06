// ---------------------------------------------------------------------------
// X (Twitter) adapter — posts a tweet via the X API v2.
//
// Creating a tweet requires a USER-CONTEXT token (app-only Bearer cannot post).
// This adapter uses an OAuth 2.0 user-context access token supplied as
// X_USER_ACCESS_TOKEN (obtained via the OAuth2 PKCE flow with tweet.write +
// users.read + offline.access). We intentionally do NOT implement OAuth 1.0a
// request signing here — it would mean hand-rolling HMAC-SHA1 signatures with
// no library in the project, which is error-prone; the OAuth2 user token path
// is the supported modern route.
//
// Free-tier X API access is write-limited and some capabilities require a paid
// tier, so a rejection is reported honestly rather than masked.
// ---------------------------------------------------------------------------

import { BaseAdapter, classifyPlatformError, httpJson, platformErrorMessage, readEnv } from "./base.js";
import type { ChannelState, MetricsResult, Platform, PublishInput, PublishResult } from "../types.js";

const API = "https://api.twitter.com/2";

export class XAdapter extends BaseAdapter {
  readonly platform: Platform = "x";
  readonly displayName = "X (Twitter)";
  readonly requiredEnv = ["X_USER_ACCESS_TOKEN"];
  readonly maxContentLength = 280;

  private token() {
    return readEnv("X_USER_ACCESS_TOKEN")!;
  }

  async getStatus(): Promise<ChannelState> {
    const missing = this.missingEnv();
    if (missing.length > 0) return super.getStatus();

    const token = this.token();
    try {
      const { ok, status, body } = await httpJson(`${API}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ok && body?.data?.id) {
        return {
          platform: this.platform,
          displayName: this.displayName,
          status: "connected",
          accountName: body.data.username ? `@${body.data.username}` : body.data.id,
          accountId: body.data.id,
          credentialsPresent: true,
          detail: `Connected to X account ${body.data.username ? "@" + body.data.username : body.data.id}.`,
          missingEnv: [],
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
            ? "Credentials present, but this X token lacks the access level needed to post (check API tier / scopes: tweet.write)."
            : "Credentials present, but validating the user token failed (it may be expired — refresh it).",
        missingEnv: [],
        lastError: platformErrorMessage(status, body),
      };
    } catch (e: any) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: "error",
        credentialsPresent: true,
        detail: "Credentials present, but the connection check could not reach X.",
        missingEnv: [],
        lastError: e?.message || String(e),
      };
    }
  }

  protected async doPublish(input: PublishInput): Promise<PublishResult> {
    const token = this.token();
    const text = this.composeText(input);

    const { ok, status, body } = await httpJson(`${API}/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (ok && body?.data?.id) {
      return {
        ok: true,
        externalPostId: body.data.id,
        externalUrl: `https://x.com/i/web/status/${body.data.id}`,
        raw: body,
      };
    }
    return {
      ok: false,
      status: classifyPlatformError(status, body),
      error: platformErrorMessage(status, body),
      raw: body,
    };
  }

  protected async doFetchMetrics(externalPostId: string): Promise<MetricsResult> {
    const token = this.token();
    // public_metrics needs the tweet to be readable by the token's access level.
    const { ok, status, body } = await httpJson(
      `${API}/tweets/${encodeURIComponent(externalPostId)}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (ok && body?.data?.public_metrics) {
      const m = body.data.public_metrics;
      return {
        ok: true,
        metrics: {
          impressions: m.impression_count,
          likes: m.like_count,
          comments: m.reply_count,
          shares: m.retweet_count,
        },
        raw: body,
      };
    }
    return { ok: false, status: classifyPlatformError(status, body), error: platformErrorMessage(status, body) };
  }

  private composeText(input: PublishInput): string {
    const tags = (input.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    return [input.content?.trim(), tags].filter(Boolean).join(" ").slice(0, this.maxContentLength);
  }
}
