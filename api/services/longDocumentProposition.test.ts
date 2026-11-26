// Long-document accuracy: a statement the checker must catch anywhere in a long text, never silently skipped, and never
// reported as VERIFIED when the check was incomplete. Covers DEVIN-scope review of the 4,000-character window change.
import { describe, expect, it } from "vitest";
import {
  evaluatePropositionSupport,
  MAX_PROPOSITION_CHARS,
  MAX_PROPOSITION_WINDOWS,
  resolveLegalAuthority,
} from "../../shared/legalVerificationPipeline";

const FLAG = "The CFSRB may overturn a court order.";
const FILLER = "The worker reviewed the file and noted the dates. ";

/** Filler text of exactly `n` characters, ending in a space so the flag can follow it cleanly. */
function filler(n: number): string {
  return FILLER.repeat(Math.ceil(n / FILLER.length)).slice(0, n);
}

describe("long documents: contradictions at beginning, middle and end", () => {
  it("catches the flag at the start of a long document", () => {
    const text = FLAG + " " + filler(20000);
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });

  it("catches the flag in the middle of a long document", () => {
    const text = filler(10000) + " " + FLAG + " " + filler(10000);
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });

  it("catches the flag at the end of a long document", () => {
    const text = filler(30000) + " " + FLAG;
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });
});

describe("contradictions spanning window boundaries", () => {
  // The window size is MAX_PROPOSITION_CHARS with a 400-character overlap. Sweep the flag's start across the first
  // boundary region so it is cut by a window edge at some offsets and sits wholly inside a window at others.
  it("is found for every start offset around the first window boundary", () => {
    const misses: number[] = [];
    for (let offset = MAX_PROPOSITION_CHARS - 300; offset <= MAX_PROPOSITION_CHARS + 100; offset += 13) {
      const text = filler(offset) + FLAG + filler(500);
      if (evaluatePropositionSupport("CYFSA:119", text).support !== "CONTRADICTED_BY_STATUTE") misses.push(offset);
    }
    expect(misses).toEqual([]);
  });

  it("is found across a later boundary too (second window edge)", () => {
    const edge = MAX_PROPOSITION_CHARS * 2;
    for (const offset of [edge - 200, edge - 50, edge, edge + 50]) {
      const text = filler(offset) + FLAG + filler(300);
      expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
    }
  });
});

describe("statements needing context across windows", () => {
  it("a flag whose trigger and object sit on different sides of a boundary is still matched", () => {
    // The pattern needs "CFSRB" ... "may overturn" ... "court order" within one clause (no period or semicolon).
    const lead = "CFSRB " + "x ".repeat(1);
    for (const pad of [3950, 3990, 4010]) {
      // filler() can end mid-word; a space keeps the \b word boundary before "CFSRB" valid.
      const text = filler(pad) + " " + lead + "may overturn a court order.";
      expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
    }
  });
});

describe("text shapes that defeat sentence punctuation", () => {
  it("a flag in text with no sentence punctuation at all is found", () => {
    const text = "lorem ipsum dolor ".repeat(1500) + "The CFSRB may overturn a court order " + "tail words ".repeat(400);
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });

  it("an extremely long sentence (no break for 12,000 characters) still yields the flag", () => {
    const text = "and then ".repeat(1500) + FLAG;
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });

  it("OCR line breaks inside the flag do not hide it (whitespace is matched)", () => {
    const text = filler(5000) + "The CFSRB may\noverturn a\ncourt order.";
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });

  it("non-breaking spaces and Unicode apostrophes in the flag are handled", () => {
    const text = filler(5000) + "The CFSRB may overturn a court order’s review.";
    expect(evaluatePropositionSupport("CYFSA:119", text).support).toBe("CONTRADICTED_BY_STATUTE");
  });
});

describe("duplicates and multiple findings", () => {
  it("returns one verdict even when the flag occurs many times across overlapping windows", () => {
    const text = (FLAG + " ").repeat(400);
    const result = evaluatePropositionSupport("CYFSA:119", text);
    expect(result.support).toBe("CONTRADICTED_BY_STATUTE");
    expect(Object.keys(result).sort()).toEqual(["reason", "support"]);
  });
});

describe("incomplete verification is never VERIFIED", () => {
  it("a proposition beyond the window cap is NOT_EVALUATED with a reason", () => {
    const huge = "word ".repeat(Math.ceil((MAX_PROPOSITION_CHARS * (MAX_PROPOSITION_WINDOWS + 5)) / 5));
    const result = evaluatePropositionSupport("CYFSA:102(1)", huge);
    expect(result.support).toBe("NOT_EVALUATED");
    expect(result.reason).toMatch(/too long/);
  });

  it("the authority resolver does not return VERIFIED when the proposition was too long to check", () => {
    const huge = "word ".repeat(Math.ceil((MAX_PROPOSITION_CHARS * (MAX_PROPOSITION_WINDOWS + 5)) / 5));
    const res = resolveLegalAuthority("CYFSA s. 74(2)", { proposition: huge });
    expect(res.status).not.toBe("VERIFIED");
    expect(res.status).toBe("UNVERIFIED");
    expect(res.propositionSupport).toBe("NOT_EVALUATED");
  });

  it("the authority resolver still reports VERIFIED for a short, unflagged proposition", () => {
    const res = resolveLegalAuthority("CYFSA s. 74(2)", { proposition: "The child was assessed." });
    expect(res.status).toBe("VERIFIED");
  });

  it("the authority resolver flags a contradiction at the end of a long proposition", () => {
    const text = filler(30000) + " " + FLAG;
    const res = resolveLegalAuthority("CYFSA s. 119", { proposition: text });
    expect(res.status).not.toBe("VERIFIED");
    expect(res.propositionSupport).toBe("CONTRADICTED_BY_STATUTE");
  });
});

describe("processing time", () => {
  it("a 200,000-character document is checked in bounded time", () => {
    const text = filler(200_000);
    const t0 = Date.now();
    evaluatePropositionSupport("CYFSA:102(1)", text);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
