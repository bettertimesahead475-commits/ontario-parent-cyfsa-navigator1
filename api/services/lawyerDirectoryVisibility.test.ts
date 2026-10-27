// While the public directory is paused, no listing reaches a visitor and no database query runs for one.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetSupabase } = vi.hoisted(() => ({ mockGetSupabase: vi.fn() }));
vi.mock("./access.js", () => ({ getSupabase: mockGetSupabase }));

const { searchDirectory, getPublicProfile } = await import("./lawyerDirectory.js");
const { PUBLIC_DIRECTORY_VISIBLE } = await import("../../shared/lawyerDirectoryPolicy.js");

describe("public lawyer directory visibility", () => {
  beforeEach(() => {
    mockGetSupabase.mockClear();
  });

  it("the directory is paused: the policy switch is off", () => {
    expect(PUBLIC_DIRECTORY_VISIBLE).toBe(false);
  });

  it("search returns no listings and reads nothing from the database", async () => {
    await expect(searchDirectory({ locality: "London" })).resolves.toEqual([]);
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });

  it("a profile lookup returns nothing and reads nothing from the database", async () => {
    await expect(getPublicProfile("00000000-0000-4000-8000-000000000001")).resolves.toBeNull();
    expect(mockGetSupabase).not.toHaveBeenCalled();
  });
});
