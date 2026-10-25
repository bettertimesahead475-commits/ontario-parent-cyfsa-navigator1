// Regression coverage for the staging suite's fixture client.
//
// The staging run failed because the suite used access.ts getSupabase(), which caches one client per module instance.
// After the invalid-key case, that cached client carried the invalid key into later seeding and cleanup. These tests
// pin both halves of the fix: the fixture client keeps the credentials it was given, and the shared cache really does
// keep the first key. That second fact is why the fixture must not go through getSupabase().

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStagingFixtureClient } from "../testSupport/stagingFixtureClient.js";
import { getSupabase, resetSupabaseClientForTesting } from "./access.js";

const URL_ = "https://nxfhvebzzobegubefcda.supabase.co";

describe("staging fixture client", () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

  beforeEach(() => {
    resetSupabaseClientForTesting();
  });

  afterEach(() => {
    process.env.SUPABASE_URL = saved.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
    resetSupabaseClientForTesting();
  });

  it("keeps the credentials it was given, whatever the environment says later", () => {
    const fixture = createStagingFixtureClient(URL_, "fixture-key") as unknown as { supabaseKey: string; supabaseUrl: string };
    process.env.SUPABASE_URL = "https://other.example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "invalid-key-for-verification";
    expect(fixture.supabaseKey).toBe("fixture-key");
    expect(fixture.supabaseUrl).toBe(URL_);
  });

  it("is not the shared client that access.ts caches", () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-key";
    const shared = getSupabase();
    const fixture = createStagingFixtureClient(URL_, "fixture-key");
    expect(fixture).not.toBe(shared);
  });

  it("documents the hazard: the shared client keeps the first key after the environment changes", () => {
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "good-key";
    const first = getSupabase();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "invalid-key-for-verification";
    expect(getSupabase()).toBe(first);
    expect((getSupabase() as unknown as { supabaseKey: string }).supabaseKey).toBe("good-key");
  });
});
