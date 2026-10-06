// ---------------------------------------------------------------------------
// Instagram adapter — publishes to an Instagram Business/Creator account via
// the Instagram Graph API. Publishing is a two-step flow: create a media
// container (with a publicly reachable image/video URL), then publish it.
//
// Instagram ALWAYS requires media — there is no text-only post — so this
// adapter sets requiresMedia = true and will refuse a post with no media_url
// before ever calling the API. Posting permissions require App Review, so an
// unapproved app is reported honestly as `waiting_for_platform_approval`.
// ---------------------------------------------------------------------------

import { BaseAdapter, classifyPlatformError, httpJson, platformErrorMessage, readEnv } from "./base.js";
import type { ChannelState, MetricsResult, Platform, PublishInput, PublishResult } from "../types.js";

const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class InstagramAdapter extends BaseAdapter {
  readonly platform: Platform = "instagram";
  readonly displayName = "Instagram";
  readonly requiredEnv = ["INSTAGRAM_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN"];
  readonly maxContentLength = 2200;
  readonly requiresMedia = true;

  private cfg() {
    return {
      accountId: readEnv("INSTAGRAM_ACCOUNT_ID")!,
      token: readEnv("INSTAGRAM_ACCESS_TOKEN")!,
    };
  }

  async getStatus(): Promise<ChannelState> {
    const missing = this.missingEnv();
    if (missing.length > 0) return super.getStatus();

    const { accountId, token } = this.cfg();
    try {
      const { ok, status, body } = await httpJson(
        `${GRAPH}/${encodeURIComponent(accountId)}?fields=username,id&access_token=${encodeURIComponent(token)}`
      );
      if (ok && body?.id) {
        return {
          platform: this.platform,
          displayName: this.displayName,
          status: "connected",
          accountName: body.username ? `@${body.username}` : body.id,
          accountId: body.id,
          credentialsPresent: true,
          detail: `Connected to Instagram account ${body.username ? "@" + body.username : body.id}.`,
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
            ? "Credentials present, but Instagram content-publishing permission has not been granted yet (App Review required)."
            : "Credentials present, but validating the account token failed.",
        missingEnv: [],
        lastError: platformErrorMessage(status, body),
      };
    } catch (e: any) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: "error",
        credentialsPresent: true,
        detail: "Credentials present, but the connection check could not reach Instagram.",
        missingEnv: [],
        lastError: e?.message || String(e),
      };
    }
  }

  protected async doPublish(input: PublishInput): Promise<PublishResult> {
    const { accountId, token } = this.cfg();
    const caption = this.composeCaption(input);

    // Step 1: create the media container.
    const createParams = new URLSearchParams({
      image_url: input.mediaUrl!,
      caption,
      access_token: token,
    });
    const create = await httpJson(`${GRAPH}/${accountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createParams.toString(),
    });
    if (!create.ok || !create.body?.id) {
      return {
        ok: false,
        status: classifyPlatformError(create.status, create.body),
        error: `Container creation failed: ${platformErrorMessage(create.status, create.body)}`,
        raw: create.body,
      };
    }

    // Step 2: publish the container.
    const publishParams = new URLSearchParams({ creation_id: create.body.id, access_token: token });
    const publish = await httpJson(`${GRAPH}/${accountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
    });
    if (publish.ok && publish.body?.id) {
      return { ok: true, externalPostId: publish.body.id, raw: publish.body };
    }
    return {
      ok: false,
      status: classifyPlatformError(publish.status, publish.body),
      error: `Publish failed: ${platformErrorMessage(publish.status, publish.body)}`,
      raw: publish.body,
    };
  }

  protected async doFetchMetrics(externalPostId: string): Promise<MetricsResult> {
    const { token } = this.cfg();
    const metricNames = "impressions,reach,likes,comments,shares";
    const { ok, status, body } = await httpJson(
      `${GRAPH}/${encodeURIComponent(externalPostId)}/insights?metric=${metricNames}&access_token=${encodeURIComponent(token)}`
    );
    if (ok && Array.isArray(body?.data)) {
      const byName: Record<string, number> = {};
      for (const item of body.data) {
        const value = item?.values?.[0]?.value;
        if (typeof value === "number") byName[item.name] = value;
      }
      return {
        ok: true,
        metrics: {
          impressions: byName.impressions,
          reach: byName.reach,
          likes: byName.likes,
          comments: byName.comments,
          shares: byName.shares,
        },
        raw: body,
      };
    }
    return { ok: false, status: classifyPlatformError(status, body), error: platformErrorMessage(status, body) };
  }

  private composeCaption(input: PublishInput): string {
    const tags = (input.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    return [input.content?.trim(), tags].filter(Boolean).join("\n\n");
  }
}
