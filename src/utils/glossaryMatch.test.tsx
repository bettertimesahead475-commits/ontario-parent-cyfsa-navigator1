import { describe, expect, it } from "vitest";
import { containsTrigger } from "../../shared/glossaryMatch";

describe("glossary trigger matching", () => {
  it("matches a trigger that stands as its own term, in any case", () => {
    expect(containsTrigger("The onus is on the society.", "onus")).toBe(true);
    expect(containsTrigger("Burden of proof: ONUS applies", "onus")).toBe(true);
  });

  it("does not match a trigger inside a longer word", () => {
    expect(containsTrigger("This is a bonus payment.", "onus")).toBe(false);
    expect(containsTrigger("The disorderly hallway.", "order")).toBe(false);
  });

  it("does not match a section number that is only the start of a longer one", () => {
    expect(containsTrigger("See s.740 of the file.", "s.74")).toBe(false);
    expect(containsTrigger("See s.74(2) of the Act.", "s.74")).toBe(true);
  });

  it("treats the dot and the hyphen in a trigger literally", () => {
    expect(containsTrigger("An s.74 finding", "s.74")).toBe(true);
    expect(containsTrigger("An sX74 finding", "s.74")).toBe(false);
    expect(containsTrigger("A 300-day rule applies", "300-day")).toBe(true);
  });

  it("matches a multi-word trigger across the words", () => {
    expect(containsTrigger("the child welfare file", "child welfare")).toBe(true);
    expect(containsTrigger("the child welfares file", "child welfare")).toBe(false);
  });

  it("still matches when the term is followed by punctuation or an apostrophe", () => {
    expect(containsTrigger("CYFSA's section 81.", "cyfsa")).toBe(true);
    expect(containsTrigger("(s.74)", "s.74")).toBe(true);
  });
});
