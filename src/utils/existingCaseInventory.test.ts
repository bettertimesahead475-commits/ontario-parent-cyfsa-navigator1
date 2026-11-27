import { describe, it, expect, vi } from "vitest";
vi.mock("./storage", () => ({ getUserKey: (key: string) => key + "_test-user" }));
import { readExistingCaseInventory } from "./existingCaseInventory";
function store(entries: Record<string, string>) {
  return { getItem: (key: string) => entries[key] ?? null } as Pick<Storage, "getItem">;
}
describe("zero-credit case inventory", () => {
  it("finds existing files and cached reports without writes or API calls", () => {
    const inventory = readExistingCaseInventory(store({
      OPA_DOC_ANALYZER_PROGRESS_test-user: JSON.stringify({ organizedFiles: [{ id: "a", name: "Court order.pdf", category: "Court" }, { id: "a", name: "duplicate" }, { id: "b", name: "CAS letter" }] }),
      OPA_QUICK_REVIEW_SNAPSHOTS_test-user: JSON.stringify({ a: { summary: "cached" } }),
      OPA_DEEPSCAN_REPORTS_test-user: JSON.stringify({ b: { findings: [] } }),
    }));
    expect(inventory.documents).toHaveLength(2);
    expect(inventory.quickReviewCount).toBe(1);
    expect(inventory.deepScanCount).toBe(1);
  });
  it("does not import legacy global data into a signed-in user's inventory", () => {
    const inventory = readExistingCaseInventory(store({
      OPA_DOC_ANALYZER_PROGRESS: JSON.stringify({ organizedFiles: [{ id: "secret", name: "other person's file" }] }),
    }));
    expect(inventory.documents).toEqual([]);
    expect(inventory.legacyDataPresent).toBe(true);
  });
  it("handles corrupted saved state without destroying data", () => {
    const inventory = readExistingCaseInventory(store({ OPA_DOC_ANALYZER_PROGRESS_test-user: "{bad" }));
    expect(inventory.documents).toEqual([]);
    expect(inventory.warnings).toHaveLength(1);
  });
});
