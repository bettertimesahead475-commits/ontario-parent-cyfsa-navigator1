import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLED_STATUTE_ENTRIES, findBundledStatute, statuteDetailsFor } from "./statuteReference";

const BUNDLED = readFileSync(
  new URL("../../legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt", import.meta.url),
  "utf8"
);

// Collapse whitespace and drop the bold markers of the bundled file, so a quotation can be compared
// with the file's text without caring about tabs or line breaks.
const squash = (value: string) => value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

describe("bundled statute quotations", () => {
  it.each(Object.entries(BUNDLED_STATUTE_ENTRIES))("%s is a verbatim passage of the bundled CYFSA text", (_key, entry) => {
    expect(squash(BUNDLED)).toContain(squash(entry.text));
  });

  it("covers exactly the sections the bundled text supports", () => {
    expect(Object.keys(BUNDLED_STATUTE_ENTRIES).sort()).toEqual(["74(2)", "81(7)", "88", "94(1)", "94(2)"]);
  });
});

describe("matching a citation to a bundled entry", () => {
  it.each([
    ["CYFSA s. 94(1)", "94(1)"],
    ["CYFSA 2017, Section 94(2)", "94(2)"],
    ["CYFSA, S.O. 2017, c. 14, s. 88", "88"],
    ["CYFSA s. 74(2)", "74(2)"],
    ["CYFSA s. 81(7)", "81(7)"],
  ])("maps %s to %s", (citation, key) => {
    expect(findBundledStatute(citation)).toBe(BUNDLED_STATUTE_ENTRIES[key]);
  });

  it.each([
    "94",
    "94(5)",
    "94(4)",
    "CYFSA s. 74(1)",
    "CYFSA s. 74",
    "Section 81",
    "CLRA, s. 8",
    "CYFSA s. 2",
    "Family Law Rules r. 13",
    "CYFSA s. 100",
    "81(7)",
    "CLRA, s. 88",
    "Criminal Code, s. 81(7)",
    "Family Law Rules, s. 94(1)",
  ])("does not invent an entry for %s", (citation) => {
    expect(findBundledStatute(citation)).toBeNull();
  });

  it("does not route a section number that only starts with a known one", () => {
    expect(findBundledStatute("CYFSA s. 880")).toBeNull();
  });
});

describe("the detail shown for a citation", () => {
  it("shows the bundled text and note for a matched citation", () => {
    const details = statuteDetailsFor("CYFSA s. 88");
    expect(details.exactText).toContain("within five days after a child is brought to a place of safety");
    expect(details.explanation).toContain("five-day rule");
  });

  it("shows no text and names no Act for a citation without an entry", () => {
    const details = statuteDetailsFor("CLRA, s. 8");
    expect(details.exactText).toBeNull();
    expect(details.subtitle).toBe("No bundled text");
    expect(details.explanation).not.toMatch(/Child, Youth and Family/i);
    expect(details.explanation).toMatch(/not been checked against the statute/);
  });
});
