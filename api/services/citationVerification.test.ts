// Regression tests for shared/citationVerification.ts: which Act a citation names, and whether it can be matched to
// CYFSA Navigator's internal reference text. None of these tests consult official legislation. A match is never
// reported as verification against e-Laws.
import { describe, expect, it } from "vitest";
import { BUNDLED_STATUTE_ENTRIES } from "../../src/utils/statuteReference";
import {
  citedSections,
  classifyCitation,
  effectiveCitationStatus,
  identifyInstruments,
  INTERNAL_CYFSA_SECTION_KEYS,
} from "../../shared/citationVerification";

describe("internal reference list", () => {
  it("is exactly the sections in the bundled internal reference text", () => {
    expect([...INTERNAL_CYFSA_SECTION_KEYS].sort()).toEqual(Object.keys(BUNDLED_STATUTE_ENTRIES).sort());
  });
});

describe("identifying the Act", () => {
  it("recognises the CYFSA by its short name, full name, and S.O. citation", () => {
    expect(identifyInstruments("CYFSA, s. 88")).toEqual({ cyfsa: true, others: [] });
    expect(identifyInstruments("Child, Youth and Family Services Act, 2017, s. 88").cyfsa).toBe(true);
    expect(identifyInstruments("S.O. 2017, c. 14, s. 74(2)")).toEqual({ cyfsa: true, others: [] });
  });

  it("does not count the CYFSA's own name as another Act", () => {
    expect(identifyInstruments("Child, Youth and Family Services Act, 2017").others).toEqual([]);
  });

  it("names the other instrument for Family Law Act, Criminal Code, CLRA and regulations", () => {
    expect(identifyInstruments("Family Law Act, s. 88")).toMatchObject({ cyfsa: false });
    expect(identifyInstruments("Family Law Act, s. 88").others).toContain("Act");
    expect(identifyInstruments("Criminal Code, s. 81(7)").others).toContain("Code");
    expect(identifyInstruments("CLRA, s. 8(1)").others).toContain("CLRA");
    expect(identifyInstruments("O. Reg. 1/18, s. 4").others.length).toBeGreaterThan(0);
  });
});

describe("classifyCitation: the citation must identify the correct statute", () => {
  it("CYFSA, s. 88 matches the internal reference text, and is not described as verified", () => {
    const c = classifyCitation("CYFSA, s. 88");
    expect(c.status).toBe("INTERNAL_REFERENCE_MATCH");
    expect(c.identifiedAct).toBe("CYFSA");
    expect(c.sections).toEqual(["88"]);
    expect(c.officialVerification).toBe("BUNDLED_TEXT_CHECKED");
    expect(c.reason).toMatch(/Not checked against live e-Laws/);
    expect(c.reason).toMatch(/not a finding that the section applies/);
  });

  it("Family Law Act, s. 88 is never read as the CYFSA's section 88", () => {
    const c = classifyCitation("Family Law Act, s. 88");
    expect(c.status).toBe("UNVERIFIED");
    expect(c.identifiedAct).toBe("OTHER");
    expect(c.reason).toMatch(/other than the CYFSA/);
  });

  it("Criminal Code, s. 81(7) is never read as the CYFSA's section 81(7)", () => {
    const c = classifyCitation("Criminal Code, s. 81(7)");
    expect(c.status).toBe("UNVERIFIED");
    expect(c.identifiedAct).toBe("OTHER");
  });

  it("CLRA sections are never CYFSA matches, even when the number is on the internal list", () => {
    expect(classifyCitation("CLRA, s. 88").status).toBe("UNVERIFIED");
    expect(classifyCitation("Children's Law Reform Act, s. 74(2)").status).toBe("UNVERIFIED");
  });

  it("regulations are not CYFSA provisions, even when the Act is named", () => {
    expect(classifyCitation("CYFSA s. 94(1) of O. Reg. 1/18").status).toBe("UNVERIFIED");
    expect(classifyCitation("Regulation 1/18, s. 88").status).toBe("UNVERIFIED");
  });
});

describe("classifyCitation: section numbers without an identified Act", () => {
  it("a bare section number is unverified, because it could belong to any Act", () => {
    const c = classifyCitation("s. 81(7)");
    expect(c.status).toBe("UNVERIFIED");
    expect(c.identifiedAct).toBe("NONE");
    expect(c.reason).toMatch(/No Act is identified/);
  });

  it("'section 88' with no Act is unverified", () => {
    expect(classifyCitation("section 88").status).toBe("UNVERIFIED");
  });

  it("an 'the Act' reference is ambiguous and therefore unverified", () => {
    expect(classifyCitation("the Act, s. 88").status).toBe("UNVERIFIED");
  });

  it("a Family Law Rules citation is unverified, because the rules are not in the internal reference", () => {
    expect(classifyCitation("Family Law Rules, 14(19)").status).toBe("UNVERIFIED");
  });
});

describe("classifyCitation: multiple statutes in one citation", () => {
  it("CYFSA plus Family Law Act is unverified, and is not confirmed by the CYFSA part alone", () => {
    const c = classifyCitation("CYFSA s. 88 and Family Law Act s. 88");
    expect(c.status).toBe("UNVERIFIED");
    expect(c.identifiedAct).toBe("MULTIPLE");
  });

  it("CYFSA plus Criminal Code is unverified", () => {
    expect(classifyCitation("CYFSA s. 74(2); Criminal Code s. 81(7)").status).toBe("UNVERIFIED");
  });

  it("two CYFSA sections, both on the internal list, still match", () => {
    expect(classifyCitation("CYFSA ss. 74(2) and 94(1)").status).toBe("INTERNAL_REFERENCE_MATCH");
  });
});

describe("classifyCitation: incorrect or unsupported section numbers", () => {
  it("a CYFSA section not on the internal list is unverified, and says why", () => {
    const c = classifyCitation("CYFSA s. 999");
    expect(c.status).toBe("UNVERIFIED");
    expect(c.identifiedAct).toBe("CYFSA");
    expect(c.reason).toMatch(/not in CYFSA Navigator's internal reference text/);
    expect(c.reason).toMatch(/does not show whether the section exists or applies/);
  });

  it("s.94(3) is unverified: it is not on the bundled list", () => {
    expect(classifyCitation("CYFSA s. 94(3)").status).toBe("UNVERIFIED");
  });

  it("s.125(1) is unverified", () => {
    expect(classifyCitation("CYFSA s. 125(1)").status).toBe("UNVERIFIED");
  });

  it("a CYFSA citation naming no section is unverified", () => {
    expect(classifyCitation("CYFSA").status).toBe("UNVERIFIED");
  });

  it("a subsection range that reaches an unlisted subsection is unverified", () => {
    expect(classifyCitation("CYFSA s. 74(2)-(4)").status).toBe("UNVERIFIED");
  });
});

describe("classifyCitation: empty and already-marked citations", () => {
  it("empty text is NONE, not unverified and not matched", () => {
    expect(classifyCitation("").status).toBe("NONE");
    expect(classifyCitation(null).status).toBe("NONE");
  });

  it("text already carrying the unverified warning stays unverified", () => {
    expect(classifyCitation("CYFSA s. 88 ⚠️ Statute citation unverified — confirm exact section with counsel").status).toBe("UNVERIFIED");
  });

  it("citedSections reads subsection lists after a section keyword only", () => {
    expect(citedSections("ss. 94(1) and (2)")).toEqual(["94(1)", "94(2)"]);
    expect(citedSections("S.O. 2017, c. 14")).toEqual([]);
  });
});

describe("effectiveCitationStatus: stored labels cannot make a citation look matched", () => {
  it("a stored match on a Family Law Act citation is displayed as unverified", () => {
    expect(effectiveCitationStatus({ legalReference: "Family Law Act, s. 88", citationStatus: "CONFIRMED_REFERENCE" })).toBe("UNVERIFIED");
  });

  it("a stored match on a CYFSA internal-list citation is displayed as a match", () => {
    expect(effectiveCitationStatus({ legalReference: "CYFSA, s. 88", citationStatus: "INTERNAL_REFERENCE_MATCH" })).toBe("INTERNAL_REFERENCE_MATCH");
    expect(effectiveCitationStatus({ legalReference: "CYFSA s. 74(2)", citationStatus: "CONFIRMED_REFERENCE" })).toBe("INTERNAL_REFERENCE_MATCH");
  });

  it("a citation with no recorded status is unverified, never matched", () => {
    expect(effectiveCitationStatus({ legalReference: "CYFSA s. 74(2)" })).toBe("UNVERIFIED");
  });

  it("no citation text is NONE", () => {
    expect(effectiveCitationStatus({ legalReference: "", citationStatus: "INTERNAL_REFERENCE_MATCH" })).toBe("NONE");
  });
});
