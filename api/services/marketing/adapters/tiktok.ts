// ---------------------------------------------------------------------------
// TikTok adapter — publishes a video via the Content Posting API using the
// PULL_FROM_URL source (TikTok fetches the video from a public URL we provide).
//
// Requires a user access token with video.publish. TikTok's Content Posting API
// requires app audit/approval before it will accept real posts, and unaudited
// apps are limited to private/self-only posts — so until the app is approved,
// a rejection is reported honestly as `waiting_for_platform_approval`. TikTok
// is video-only, so requiresMedia = true.
// ---------------------------------------------------------------------------

import { BaseAdapter, classifyPlatformError, httpJson, platformErrorMessage, readEnv } from "./base.js";
import type { ChannelState, MetricsResult, Platform, PublishInput, PublishResult } from "../types.js";

const API = "https://open.tiktokapis.com/v2";

export class TikTokAdapter extends BaseAdapter {
  readonly platform: Platform = "tiktok";
  readonly displayName = "TikTok";
  readonly requiredEnv = ["TIKTOK_ACCESS_TOKEN"];
  readonly maxContentLength = 2200;
  readonly requiresMedia = true;

  private token() {
    return readEnv("TIKTOK_ACCESS_TOKEN")!;
  }

  async getStatus(): Promise<ChannelState> {
    const missing = this.missingEnv();
    if (missing.length > 0) return super.getStatus();

    const token = this.token();
    try {
      const { ok, status, body } = await httpJson(
        `${API}/user/info/?fields=open_id,display_name`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const user = body?.data?.user;
      if (ok && user?.open_id) {
        return {
          platform: this.platform,
          displayName: this.displayName,
          status: "connected",
          accountName: user.display_name || user.open_id,
          accountId: user.open_id,
          credentialsPresent: true,
          detail: `Connected to TikTok account ${user.display_name || user.open_id}.`,
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
            ? "Credentials present, but TikTok has not approved content posting for this app yet (app audit required; unaudited apps can only post privately)."
            : "Credentials present, but validating the TikTok token failed.",
        missingEnv: [],
        lastError: platformErrorMessage(status, body),
      };
    } catch (e: any) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: "error",
        credentialsPresent: true,
        detail: "Credentials present, but the connection check could not reach TikTok.",
        missingEnv: [],
        lastError: e?.message || String(e),
      };
    }
  }

  protected async doPublish(input: PublishInput): Promise<PublishResult> {
    const token = this.token();
    const title = this.composeTitle(input);

    const payload = {
      post_info: {
        title,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: input.mediaUrl,
      },
    };

    const { ok, status, body } = await httpJson(`${API}/post/publish/video/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const publishId = body?.data?.publish_id;
    // TikTok init returns a publish_id; the video then processes asynchronously.
    // We record the publish_id as the external id — metrics/status can be polled
    // against it. A non-zero error code in the body means the request failed.
    const errorCode = body?.error?.code;
    if (ok && publishId && (!errorCode || errorCode === "ok")) {
      return { ok: true, externalPostId: publishId, raw: body };
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
    // Poll the publish status; full engagement metrics require the Research /
    // Display API and additional scopes, so we honestly return what status we can.
    const { ok, status, body } = await httpJson(`${API}/post/publish/status/fetch/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publish_id: externalPostId }),
    });
    if (ok && body?.data) {
      // No engagement counts are available from this endpoint; return an empty
      // (but honest) metrics object rather than inventing numbers.
      return { ok: true, metrics: {}, raw: body };
    }
    return { ok: false, status: classifyPlatformError(status, body), error: platformErrorMessage(status, body) };
  }

  private composeTitle(input: PublishInput): string {
    const tags = (input.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    return [input.content?.trim(), tags].filter(Boolean).join(" ").slice(0, this.maxContentLength);
  }
}
