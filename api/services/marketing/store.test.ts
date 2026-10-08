// Tests the post-status lifecycle (canTransition) — the rule set that, together
// with the approval gate in publisher.ts, guarantees nothing is published
// without passing through human approval first. These are pure-function tests:
// no DB, no env needed (getSupabase() is only called lazily, never at import).
import { describe, expect, it } from "vitest";
import { canTransition, type PostStatus } from "./store.js";

describe("canTransition — the content lifecycle", () => {
  it("allows the happy path draft -> pending_approval -> approved -> scheduled -> publishing -> published", () => {
    const path: PostStatus[] = ["draft", "pending_approval", "approved", "scheduled", "publishing", "published"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("never allows jumping straight from draft to published (must be approved + scheduled/published through the flow)", () => {
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("draft", "scheduled")).toBe(false);
    expect(canTransition("draft", "publishing")).toBe(false);
    expect(canTransition("pending_approval", "published")).toBe(false);
    expect(canTransition("pending_approval", "scheduled")).toBe(false);
  });

  it("treats published and canceled as terminal", () => {
    const anything: PostStatus[] = ["draft", "approved", "scheduled", "failed"];
    for (const to of anything) {
      expect(canTransition("published", to)).toBe(false);
      expect(canTransition("canceled", to)).toBe(false);
    }
  });

  it("lets a failed publish be retried (failed -> scheduled/approved) but not silently published", () => {
    expect(canTransition("failed", "scheduled")).toBe(true);
    expect(canTransition("failed", "approved")).toBe(true);
    expect(canTransition("failed", "published")).toBe(false);
  });

  it("supports rejection and cancellation from review states", () => {
    expect(canTransition("pending_approval", "rejected")).toBe(true);
    expect(canTransition("rejected", "draft")).toBe(true);
    expect(canTransition("draft", "canceled")).toBe(true);
    expect(canTransition("approved", "canceled")).toBe(true);
  });

  it("is reflexive (a no-op transition is allowed)", () => {
    expect(canTransition("draft", "draft")).toBe(true);
  });
});
