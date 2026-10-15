// ---------------------------------------------------------------------------
// facebookOAuth.ts — Meta's supported OAuth authorization-code flow for Pages.
//
//   1. Admin asks for a connect URL (signed state). Browser is sent to Meta.
//   2. Meta redirects to /api/admin/marketing/facebook/callback with ?code&state.
//   3. Server exchanges code -> short-lived user token -> long-lived user token.
//   4. Server lists Pages the user manages (/me/accounts) with Page tokens.
//   5. Pages are stored encrypted; the owner selects one (see routes.ts).
//
// Scopes requested: pages_show_list, pages_manage_posts, pages_read_engagement.
// Meta requires App Review (Advanced Access) before accounts other than app
// admins, developers and testers can grant them. In Development mode only those
// app roles can complete the flow.
// ---------------------------------------------------------------------------

import { httpJson } from "./adapters/base.js";
import type { ManagedPage } from "./connections.js";

export const FACEBOOK_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"] as const;

// Graph API version. Override with META_GRAPH_VERSION. The default must be
// checked against Meta's current versioning before production release.
export function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION?.trim() || "v21.0";
  return `https://graph.facebook.com/${version}`;
}

export const CALLBACK_PATH = "/api/admin/marketing/facebook/callback";

export function publicAppUrl(): string {
  return (process.env.APP_PUBLIC_URL?.trim() || "https://cyfsanavigator.com").replace(/\/+$/, "");
}

export function redirectUri(): string {
  return `${publicAppUrl()}${CALLBACK_PATH}`;
}

function metaConfig(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw Object.assign(
      new Error("META_APP_ID and META_APP_SECRET are not configured. Create the Meta app and add them in Vercel (server-only)."),
      { statusCode: 503 }
    );
  }
  return { appId, appSecret };
}

export function buildAuthorizationUrl(state: string): string {
  const { appId } = metaConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    state,
    response_type: "code",
    scope: FACEBOOK_SCOPES.join(","),
  });
  return `https://www.facebook.com/${graphVersionSegment()}/dialog/oauth?${params.toString()}`;
}

function graphVersionSegment(): string {
  return graphBase().replace("https://graph.facebook.com/", "");
}

export class MetaApiError extends Error {
  constructor(message: string, readonly code: number | null, readonly statusCode: number) {
    super(message);
  }
}

/** Meta error code 190 = invalid, expired, or revoked access token. */
export function isTokenExpiredError(err: unknown): boolean {
  return err instanceof MetaApiError && err.code === 190;
}

function toMetaError(body: any, status: number, fallback: string): MetaApiError {
  const code = typeof body?.error?.code === "number" ? body.error.code : null;
  const message = body?.error?.message ? String(body.error.message) : fallback;
  return new MetaApiError(`${message} (HTTP ${status}${code ? `, code ${code}` : ""})`, code, status);
}

export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const { appId, appSecret } = metaConfig();
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri(), code });
  const { ok, status, body } = await httpJson(`${graphBase()}/oauth/access_token?${params.toString()}`);
  if (!ok || !body?.access_token) throw toMetaError(body, status, "Facebook did not issue a user token.");
  return body.access_token as string;
}

export async function exchangeForLongLivedUserToken(shortToken: string): Promise<string> {
  const { appId, appSecret } = metaConfig();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const { ok, status, body } = await httpJson(`${graphBase()}/oauth/access_token?${params.toString()}`);
  if (!ok || !body?.access_token) throw toMetaError(body, status, "Facebook did not issue a long-lived token.");
  return body.access_token as string;
}

/** Lists Pages the user manages. Follows pagination, capped to protect the request budget. */
export async function listManagedPages(userToken: string): Promise<ManagedPage[]> {
  const pages: ManagedPage[] = [];
  let url: string | null = `${graphBase()}/me/accounts?fields=id,name,access_token,tasks&limit=100&access_token=${encodeURIComponent(userToken)}`;
  for (let i = 0; url && i < 5; i++) {
    const { ok, status, body } = await httpJson(url);
    if (!ok) throw toMetaError(body, status, "Could not list Facebook Pages.");
    for (const p of body?.data ?? []) {
      // Only Pages where the user can create content can be used for posting.
      if (p?.id && p?.name && p?.access_token && Array.isArray(p.tasks) && p.tasks.includes("CREATE_CONTENT")) {
        pages.push({ id: String(p.id), name: String(p.name), accessToken: String(p.access_token) });
      }
    }
    url = body?.paging?.next ?? null;
  }
  return pages;
}

/** Checks a stored Page token against Meta. Returns the Page name, or throws MetaApiError. */
export async function verifyPageToken(pageId: string, pageToken: string): Promise<{ id: string; name: string }> {
  const params = new URLSearchParams({ fields: "id,name", access_token: pageToken });
  const { ok, status, body } = await httpJson(`${graphBase()}/${encodeURIComponent(pageId)}?${params.toString()}`);
  if (!ok || !body?.id) throw toMetaError(body, status, "Could not verify the Facebook Page.");
  return { id: String(body.id), name: String(body.name ?? "") };
}
