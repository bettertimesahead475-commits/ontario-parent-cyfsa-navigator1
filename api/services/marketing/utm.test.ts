// Tests UTM tagging: correct params, idempotency (never clobber an existing
// value — so tagging at both draft time and publish time is safe), query-string
// preservation, and honest no-op on unparseable/relative URLs.
import { describe, expect, it } from "vitest";
import { buildUtmUrl, slugifyCampaign } from "./utm.js";

describe("buildUtmUrl", () => {
  it("adds source, default medium=social, and campaign", () => {
    const out = buildUtmUrl("https://cyfsanavigator.com/guide", { source: "facebook", campaign: "fall-awareness" })!;
    const u = new URL(out);
    expect(u.searchParams.get("utm_source")).toBe("facebook");
    expect(u.searchParams.get("utm_medium")).toBe("social");
    expect(u.searchParams.get("utm_campaign")).toBe("fall-awareness");
  });

  it("lets medium be overridden", () => {
    const out = buildUtmUrl("https://x.com/a", { source: "x", medium: "paid-social" })!;
    expect(new URL(out).searchParams.get("utm_medium")).toBe("paid-social");
  });

  it("is idempotent — never overwrites an existing utm value (safe to tag twice)", () => {
    const once = buildUtmUrl("https://cyfsanavigator.com/guide", { source: "linkedin", campaign: "spring" })!;
    const twice = buildUtmUrl(once, { source: "facebook", campaign: "different" })!;
    const u = new URL(twice);
    // The first tagging wins on every key; the second pass changes nothing.
    expect(u.searchParams.get("utm_source")).toBe("linkedin");
    expect(u.searchParams.get("utm_campaign")).toBe("spring");
    expect(once).toBe(twice);
  });

  it("preserves pre-existing non-utm query params", () => {
    const out = buildUtmUrl("https://cyfsanavigator.com/g?ref=news", { source: "facebook" })!;
    const u = new URL(out);
    expect(u.searchParams.get("ref")).toBe("news");
    expect(u.searchParams.get("utm_source")).toBe("facebook");
  });

  it("returns null/empty input unchanged (no crash)", () => {
    expect(buildUtmUrl(null, { source: "x" })).toBeNull();
    expect(buildUtmUrl(undefined, { source: "x" })).toBeNull();
    expect(buildUtmUrl("", { source: "x" })).toBe("");
  });

  it("leaves an unparseable/relative URL untouched rather than mangling it", () => {
    expect(buildUtmUrl("/relative/path", { source: "x" })).toBe("/relative/path");
    expect(buildUtmUrl("not a url", { source: "x" })).toBe("not a url");
  });

  it("omits params with no value (no empty utm_content)", () => {
    const out = buildUtmUrl("https://cyfsanavigator.com", { source: "tiktok" })!;
    expect(new URL(out).searchParams.has("utm_content")).toBe(false);
    expect(new URL(out).searchParams.has("utm_campaign")).toBe(false);
  });
});

describe("slugifyCampaign", () => {
  it("slugifies a human name", () => {
    expect(slugifyCampaign("Fall 2026 Awareness!")).toBe("fall-2026-awareness");
  });
  it("defaults to 'awareness' for empty/nullish", () => {
    expect(slugifyCampaign(null)).toBe("awareness");
    expect(slugifyCampaign("")).toBe("awareness");
    expect(slugifyCampaign("   ")).toBe("awareness");
  });
  it("caps length", () => {
    expect(slugifyCampaign("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});
