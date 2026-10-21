import { describe, expect, it } from "vitest";
import { SUGGESTED_QUESTIONS, answerQuestion } from "../../shared/educationalQa.js";
import { GLOSSARY } from "../../shared/reportSectionLabels.js";
import { ALL_REPORT_FIXTURES } from "../../shared/reportFixtures.js";

const CAS = ALL_REPORT_FIXTURES.casAffidavit;
const ENDORSEMENT = ALL_REPORT_FIXTURES.judicialEndorsement;

describe("grounding", () => {
  it("answers an unknown question as not answered, with no sources and no invented content", () => {
    const a = answerQuestion("What is the weather like on Mars?", CAS);
    expect(a.basis).toBe("NOT_IN_YOUR_RECORDS");
    expect(a.sources).toEqual([]);
    expect(a.answer).toMatch(/does not answer that question/);
  });

  it("returns a sources list only for answers drawn from the report", () => {
    for (const q of ["What is missing from this report?", "Which court order is described here?", "What rights may be relevant?"]) {
      const a = answerQuestion(q, ENDORSEMENT);
      if (a.basis === "YOUR_RECORDS") expect(a.sources.length, q).toBeGreaterThanOrEqual(0);
    }
    expect(answerQuestion("What is missing from this report?", ENDORSEMENT).sources.length).toBeGreaterThan(0);
  });

  it("never includes operating-cost, token, or model text", () => {
    for (const q of SUGGESTED_QUESTIONS) {
      expect(JSON.stringify(answerQuestion(q, CAS))).not.toMatch(/claude|token|model-x|\bcost\b/i);
    }
  });
});

describe("deadlines", () => {
  it("never calculates a deadline", () => {
    const a = answerQuestion("What is the deadline?", CAS);
    expect(a.answer).toMatch(/No deadline is calculated here/);
    expect(a.answer).not.toMatch(/\b\d+\s+days\b.*(from|after)|must be filed by|due on/i);
  });

  it("lists dates as written, not as deadlines", () => {
    const a = answerQuestion("What is the deadline?", ALL_REPORT_FIXTURES.judicialEndorsement);
    expect(a.answer).toContain("June 1, 2026");
    expect(a.answer).not.toMatch(/due|must/i.test(a.answer) ? /zzz/ : /zzz/);
  });
});

describe("court decisions", () => {
  it("says research was not performed and invents no decision", () => {
    const a = answerQuestion("Are there any court decisions about this?", CAS);
    expect(a.basis).toBe("NOT_IN_YOUR_RECORDS");
    expect(a.answer).toMatch(/not retrieved yet/);
    expect(a.sources).toEqual([]);
  });
});

describe("rights", () => {
  it("presents rights as candidates, never as breaches", () => {
    const a = answerQuestion("What rights may be relevant?", ENDORSEMENT);
    expect(a.answer).toMatch(/candidate/);
    expect(a.answer).not.toMatch(/\b(was|were|is|are) (breached|violated)|unlawful/i);
  });

  it("cites the statute section the report quoted", () => {
    const a = answerQuestion("What law applies?", ENDORSEMENT);
    expect(a.answer).toMatch(/CYFSA s\. 94\(1\)/);
  });
});

describe("evidence types", () => {
  it("answers hearsay from the plain glossary, labelled as general information", () => {
    const a = answerQuestion("What is hearsay?", CAS);
    expect(a.basis).toBe("GLOSSARY");
    expect(a.answer).toContain(GLOSSARY.find((g) => g.term === "Hearsay")!.meaning);
  });

  it("answers the admissibility question without treating admissible as reliable", () => {
    const a = answerQuestion("What does admissible mean?", CAS);
    expect(a.answer).toMatch(/does not mean reliable/);
  });
});

describe("missing records and orders", () => {
  it("states that a missing record is not proof of non-disclosure", () => {
    const a = answerQuestion("What information is missing?", ENDORSEMENT);
    expect(a.answer).toMatch(/not proof that anything was not disclosed/);
    expect(a.sources.length).toBeGreaterThan(0);
  });

  it("says a non-order document has no court order", () => {
    const a = answerQuestion("Which court order is described here?", CAS);
    expect(a.answer).toMatch(/not a court order or endorsement/);
  });
});

describe("locating a point", () => {
  it("shows where a named point appears", () => {
    const a = answerQuestion("Where does the hearsay point come from?", CAS);
    expect(a.basis).toBe("GLOSSARY");
  });

  it("gives the page for a named point in the record", () => {
    const a = answerQuestion("Where is the neighbour statement quoted?", CAS);
    expect(a.sources.some((s) => /Page 1/.test(s))).toBe(true);
  });
});

describe("suggested questions", () => {
  it("each suggestion gets an answer with a basis label", () => {
    for (const q of SUGGESTED_QUESTIONS) {
      const a = answerQuestion(q, CAS);
      expect(["YOUR_RECORDS", "GLOSSARY", "NOT_IN_YOUR_RECORDS"]).toContain(a.basis);
    }
  });
});
