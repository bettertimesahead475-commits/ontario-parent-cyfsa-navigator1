import { createClient } from '@supabase/supabase-js';

let supabaseHumanReview: ReturnType<typeof createClient> | null = null;

export function getHumanReviewSupabase() {
  if (supabaseHumanReview) return supabaseHumanReview;
  
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_HUMAN_REVIEW_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_HUMAN_REVIEW_KEY or SUPABASE_URL. Human review DB capability is unconfigured.');
  }

  supabaseHumanReview = createClient(url, key);
  return supabaseHumanReview;
}
