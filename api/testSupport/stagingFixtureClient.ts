// A Supabase client for the staging integration suite's own seeding, reads and cleanup.
//
// Do not use access.ts getSupabase() for fixtures. It caches one client for the whole module instance, built from
// the environment at first use. The suite deliberately loads a module with an invalid key to test fail-closed
// behaviour; a fixture that reused that cached client would fail to seed and would fail to clean up.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createStagingFixtureClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}
