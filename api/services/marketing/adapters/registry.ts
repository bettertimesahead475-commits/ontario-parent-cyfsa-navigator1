// ---------------------------------------------------------------------------
// Adapter registry — the single place that maps a Platform to its adapter.
// Everything else (publisher, scheduler, routes) resolves adapters through
// here, so adding a new platform is one import + one map entry.
// ---------------------------------------------------------------------------

import type { Platform, SocialAdapter } from "../types.js";
import { PLATFORMS } from "../types.js";
import { FacebookAdapter } from "./facebook.js";
import { InstagramAdapter } from "./instagram.js";
import { LinkedInAdapter } from "./linkedin.js";
import { XAdapter } from "./x.js";
import { TikTokAdapter } from "./tiktok.js";

const adapters: Record<Platform, SocialAdapter> = {
  facebook: new FacebookAdapter(),
  instagram: new InstagramAdapter(),
  linkedin: new LinkedInAdapter(),
  x: new XAdapter(),
  tiktok: new TikTokAdapter(),
};

export function getAdapter(platform: Platform): SocialAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No adapter registered for platform "${platform}".`);
  return adapter;
}

export function getAllAdapters(): SocialAdapter[] {
  return PLATFORMS.map((p) => adapters[p]);
}
