// ---------------------------------------------------------------------------
// Facebook Page adapter — posts to a Facebook Page via the Graph API.
//
// Requires a Page ID and a long-lived Page access token with pages_manage_posts
// + pages_read_engagement. Those permissions require Facebook App Review, so
// until the app is approved this adapter will honestly report
// `waiting_for_platform_approval` when a live call is rejected for permissions.
// ---------------------------------------------------------------------------

import { BaseAdapter, classifyPlatformError, httpJson, platformErrorMessage, readEnv } from "./base.js";
import type { ChannelState, MetricsResult, Platform, PublishInput, PublishResult } from "../types.js";

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class FacebookAdapter extends BaseAdapter {
  readonly platform: Platform = "facebook";
  readonly displayName = "Facebook Page";
  readonly requiredEnv = ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"];
  readonly maxContentLength = 63206;

  private cfg() {
    return {
      pageId: readEnv("FACEBOOK_PAGE_ID")!,
      token: readEnv("FACEBOOK_PAGE_ACCESS_TOKEN")!,
    };
  }

  async getStatus(): Promise<ChannelState> {
    const missing = this.missingEnv();
    if (missing.length > 0) return super.getStatus();

    const { pageId, token } = this.cfg();
    try {
      const { ok, status, body } = await httpJson(
        `${GRAPH}/${encodeURIComponent(pageId)}?fields=name,id&access_token=${encodeURIComponent(token)}`
      );
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

  protected async doPublish(input: PublishInput): Promise<PublishResult> {
    const { pageId, token } = this.cfg();
    const message = this.composeMessage(input);

    // A post with a photo uses the /photos edge; a text/link post uses /feed.
    const isPhoto = Boolean(input.mediaUrl);
    const endpoint = isPhoto ? `${GRAPH}/${pageId}/photos` : `${GRAPH}/${pageId}/feed`;
    const params = new URLSearchParams({ access_token: token });
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
    return {
      ok: false,
      status: classifyPlatformError(status, body),
      error: platformErrorMessage(status, body),
      raw: body,
    };
  }

  protected async doFetchMetrics(externalPostId: string): Promise<MetricsResult> {
    const { token } = this.cfg();
    const fields = "likes.summary(true),comments.summary(true),shares";
    const { ok, status, body } = await httpJson(
      `${GRAPH}/${encodeURIComponent(externalPostId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`
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
