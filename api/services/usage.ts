// ---------------------------------------------------------------------------
// Enforces the free-tier limit on the Document Analyzer. Before this file,
// "1 free analysis" was documentation only — /api/analyze never checked a
// uid, a tier, or a count, so it ran unlimited times for anyone regardless
// of payment. This is the actual enforcement, backed by a new Supabase
// table (free_usage) keyed on the parent's Firebase uid.
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";

export const FREE_ANALYSES_LIMIT = 1;

export async function getFreeUsage(uid: string): Promise<number> {
  const db = getSupabase();
  const { data, error } = await db.from("free_usage").select("analyses_used").eq("uid", uid).maybeSingle();
  if (error) throw Object.assign(new Error(`Failed to read usage: ${error.message}`), { statusCode: 500 });
  return data?.analyses_used ?? 0;
}

/**
 * Call ONLY after an analysis actually succeeds — a failed attempt (bad AI
 * call, malformed upload, etc.) should never cost a parent their one free
 * try. Upserts the row and increments the count.
 */
export async function recordFreeUse(uid: string, email: string | null): Promise<void> {
  const db = getSupabase();
  const current = await getFreeUsage(uid);
  const now = new Date().toISOString();
  const { error } = await db.from("free_usage").upsert(
    {
      uid,
      email,
      analyses_used: current + 1,
      first_analysis_at: current === 0 ? now : undefined,
      last_analysis_at: now,
    },
    { onConflict: "uid" }
  );
  if (error) throw Object.assign(new Error(`Failed to record usage: ${error.message}`), { statusCode: 500 });
}
