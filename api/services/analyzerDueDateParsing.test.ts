// Regression: parseExplicitDueDate rejected every ISO date because its regex literals were written
// with a doubled backslash (\\d), which matches a literal backslash. Explicit dates must still parse.
import { describe, expect, it } from "vitest";
import { parseExplicitDueDate } from "./analyzerRequirementExtractor";

describe("parseExplicitDueDate", () => {
  it("accepts an ISO calendar date as midnight UTC", () => {
    expect(parseExplicitDueDate("2026-10-15")).toBe("2026-10-15T00:00:00.000Z");
  });
  it("accepts an ISO timestamp with milliseconds", () => {
    expect(parseExplicitDueDate("2026-10-15T17:00:00.250Z")).toBe("2026-10-15T17:00:00.250Z");
  });
  it("rejects impossible calendar dates and vague phrases", () => {
    expect(parseExplicitDueDate("2026-02-30")).toBeNull();
    expect(parseExplicitDueDate("next Tuesday")).toBeNull();
    expect(parseExplicitDueDate("as soon as possible")).toBeNull();
  });
});
