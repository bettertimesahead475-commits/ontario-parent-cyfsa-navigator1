import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the real recordPaidUse against the production-like free_usage table. A delivered analysis must be counted
// once per analysis key, even when the same key is seen again on a retry or by another server instance.
const dbHolder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./access.js", () => ({ getSupabase: () => dbHolder.db }));

import { createProductionLikeDb } from "../testSupport/productionLikeCreditDb.js";
import { getPaidUsageKey, recordPaidUse, resetUsageCachesForTesting } from "./usage.js";

const SESSION = "session-count-1";
const quickKey = () => getPaidUsageKey(SESSION, "Pro", "quick", "2026-10");
const counter = () => dbHolder.db._freeUsage.get(quickKey())?.analyses_used ?? 0;

describe("recordPaidUse counts each delivered analysis once", () => {
  beforeEach(() => {
    dbHolder.db = createProductionLikeDb();
    resetUsageCachesForTesting();
  });

  it("counts a repeated analysis key once within one process", async () => {
    await recordPaidUse(SESSION, "Pro", "p@example.com", "quick", "req_1760000000001_aaaa1111", "2026-10");
    await recordPaidUse(SESSION, "Pro", "p@example.com", "quick", "req_1760000000001_aaaa1111", "2026-10");
    expect(counter()).toBe(1);
  });

  it("counts a repeated analysis key once even when another instance has no in-memory record", async () => {
    await recordPaidUse(SESSION, "Pro", "p@example.com", "quick", "req_1760000000002_bbbb2222", "2026-10");
    resetUsageCachesForTesting(); // a second instance: the durable marker is the only record
    await recordPaidUse(SESSION, "Pro", "p@example.com", "quick", "req_1760000000002_bbbb2222", "2026-10");
    expect(counter()).toBe(1);
  });

  it("counts distinct analyses separately", async () => {
    await recordPaidUse(SESSION, "Pro", "p@example.com", "quick", "req_1760000000003_cccc3333", "2026-10");
    await recordPaidUse(SESSION, "Pro", "p@example.com", "quick", "req_1760000000004_dddd4444", "2026-10");
    expect(counter()).toBe(2);
  });
});
