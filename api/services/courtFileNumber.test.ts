import { describe, expect, it } from "vitest";
import { normalizeCourtFileNumber, sameCourtFileNumber } from "../../shared/courtFileNumber";

describe("normalizeCourtFileNumber", () => {
  it("joins a file number split across a line break after a hyphen", () => {
    expect(normalizeCourtFileNumber("File No.: FC-26-\n1234")).toBe("FC-26-1234");
    expect(normalizeCourtFileNumber("FC-26-\r\n  1234")).toBe("FC-26-1234");
  });

  it("accepts spaces in place of hyphens and uppercases the code", () => {
    expect(normalizeCourtFileNumber("fc 26 1234")).toBe("FC-26-1234");
  });

  it("returns null when no court file number is present", () => {
    expect(normalizeCourtFileNumber("Next hearing: September 25, 2025")).toBeNull();
    expect(normalizeCourtFileNumber("")).toBeNull();
    expect(normalizeCourtFileNumber(null)).toBeNull();
  });
});

describe("sameCourtFileNumber", () => {
  it("does not report a discrepancy for the same number split across a line break", () => {
    expect(sameCourtFileNumber("FC-26-\n1234", "FC-26-1234")).toBe(true);
  });

  it("reports a real difference in the sequence number", () => {
    expect(sameCourtFileNumber("FC-26-1234", "FC-26-1243")).toBe(false);
  });

  it("never treats a missing number as matching", () => {
    expect(sameCourtFileNumber(null, null)).toBe(false);
    expect(sameCourtFileNumber("FC-26-1234", "")).toBe(false);
  });
});
