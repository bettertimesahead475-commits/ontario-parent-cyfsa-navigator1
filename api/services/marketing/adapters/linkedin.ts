// ---------------------------------------------------------------------------
// LinkedIn adapter — posts to an organization (Company Page) via the UGC Posts
// API. Requires a member/organization access token with w_organization_social
// (and r_organization_social for read), plus the organization URN.
//
// The w_organization_social permission requires LinkedIn's Marketing Developer
// Platform approval, so an unapproved app is reported honestly as
// `waiting_for_platform_approval` when a live call is rejected for permissions.
// ---------------------------------------------------------------------------

import { BaseAdapter, classifyPlatformError, httpJson, platformErrorMessage, readEnv } from "./base.js";
import type { ChannelState, MetricsResult, Platform, PublishInput, PublishResult } from "../types.js";

const API = "https://api.linkedin.com";

export class LinkedInAdapter extends BaseAdapter {
  readonly platform: Platform = "linkedin";
  readonly displayName = "LinkedIn";
  readonly requiredEnv = ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN"];
  readonly maxContentLength = 3000;

  private cfg() {
    return {
      token: readEnv("LINKEDIN_ACCESS_TOKEN")!,
      orgUrn: readEnv("LINKEDIN_ORG_URN")!, // e.g. "urn:li:organization:12345"
    };
  }

  private headers(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    };
  }

  async getStatus(): Promise<ChannelState> {
    const missing = this.missingEnv();
    if (missing.length > 0) return super.getStatus();

    const { token, orgUrn } = this.cfg();
    const orgId = orgUrn.split(":").pop();
    try {
      // A lightweight validation: look up the organization by id.
      const { ok, status, body } = await httpJson(
        `${API}/v2/organizations/${encodeURIComponent(orgId || "")}`,
        { headers: this.headers(token) }
      );
      if (ok && body?.id) {
        return {
          platform: this.platform,
          displayName: this.displayName,
          status: "connected",
          accountName: body.localizedName || orgUrn,
          accountId: String(body.id),
          credentialsPresent: true,
          detail: `Connected to LinkedIn organization "${body.localizedName || orgUrn}".`,
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
            ? "Credentials present, but LinkedIn has not granted organization posting access yet (Marketing Developer Platform approval required)."
            : "Credentials present, but validating the token/organization failed.",
        missingEnv: [],
        lastError: platformErrorMessage(status, body),
      };
    } catch (e: any) {
      return {
        platform: this.platform,
        displayName: this.displayName,
        status: "error",
        credentialsPresent: true,
        detail: "Credentials present, but the connection check could not reach LinkedIn.",
        missingEnv: [],
        lastError: e?.message || String(e),
      };
    }
  }

  protected async doPublish(input: PublishInput): Promise<PublishResult> {
    const { token, orgUrn } = this.cfg();
    const text = this.composeText(input);

    const payload = {
      author: orgUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: input.linkUrl ? "ARTICLE" : "NONE",
          ...(input.linkUrl
            ? { media: [{ status: "READY", originalUrl: input.linkUrl }] }
            : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const { ok, status, body } = await httpJson(`${API}/v2/ugcPosts`, {
      method: "POST",
      headers: this.headers(token),
      body: JSON.stringify(payload),
    });

    // LinkedIn returns the URN in the `x-restli-id` header or body.id.
    const urn = body?.id;
    if (ok && urn) {
      return {
        ok: true,
        externalPostId: urn,
        externalUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}`,
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
    // Organization share statistics are keyed by the share/ugcPost URN.
    const { ok, status, body } = await httpJson(
      `${API}/v2/socialActions/${encodeURIComponent(externalPostId)}`,
      { headers: this.headers(token) }
    );
    if (ok) {
      return {
        ok: true,
        metrics: {
          likes: body?.likesSummary?.totalLikes,
          comments: body?.commentsSummary?.totalComments,
        },
        raw: body,
      };
    }
    return { ok: false, status: classifyPlatformError(status, body), error: platformErrorMessage(status, body) };
  }

  private composeText(input: PublishInput): string {
    const tags = (input.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    return [input.content?.trim(), tags].filter(Boolean).join("\n\n");
  }
}
