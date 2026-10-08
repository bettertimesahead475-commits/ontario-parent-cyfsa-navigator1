// ---------------------------------------------------------------------------
// utm.ts — UTM campaign tagging for links shared in social posts.
//
// When a post links back to CYFSA Navigator, we tag the URL with UTM query
// parameters so the organization can see in its web analytics which platform /
// campaign drove the visit. Rules:
//   - utm_source  = the platform the post goes to (facebook, linkedin, …)
//   - utm_medium  = "social" (overridable)
//   - utm_campaign= a slug of the campaign/theme
//
// IDEMPOTENT: a UTM key that's already present on the URL is never overwritten,
// so tagging the same URL twice (e.g. once at draft generation, again
// defensively at publish time) produces the same result and never duplicates or
// clobbers an admin's hand-set value. A non-absolute / unparseable URL is
// returned untouched rather than mangled.
// ---------------------------------------------------------------------------

export interface UtmParams {
  source: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

/** Tags a URL with utm_* params without overwriting any already present. */
export function buildUtmUrl(rawUrl: string | null | undefined, params: UtmParams): string | null {
  if (!rawUrl) return rawUrl ?? null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Not an absolute URL (no protocol/host) — leave it exactly as given rather
    // than guess. An untagged real link is better than a corrupted one.
    return rawUrl;
  }

  const desired: Record<string, string | undefined> = {
    utm_source: params.source,
    utm_medium: params.medium ?? "social",
    utm_campaign: params.campaign,
    utm_content: params.content,
    utm_term: params.term,
  };

  for (const [key, value] of Object.entries(desired)) {
    if (value && !url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** Turns a campaign name/theme into a safe utm_campaign slug. */
export function slugifyCampaign(name: string | null | undefined): string {
  if (!name) return "awareness";
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "awareness";
}
