import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRELOADED_ITEMS } from "../components/StatutoryBookmarkSidebar";

const BUNDLED = readFileSync(
  new URL("../../legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt", import.meta.url),
  "utf8"
);
const DATA_SOURCE = readFileSync(new URL("../data.ts", import.meta.url), "utf8");

/** Section headings from the bundled table of contents, e.g. "| 74. | Interpretation |". */
const TOC = new Map<number, string>();
for (const m of BUNDLED.matchAll(/^\| (\d+)\. \| (.+?) \|$/gm)) {
  if (!TOC.has(Number(m[1]))) TOC.set(Number(m[1]), m[2].trim());
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of a section such as "81", "77.1": from its "**N **" header to the next section header. */
function sectionBody(section: string): string | null {
  const lines = BUNDLED.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\*\\*${escapeRe(section)} \\*\\*`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\*\*\d+(\.\d+)? \*\*/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** Text of one numbered subsection "(k)": from its marker to the next numbered subsection. */
function subsectionText(section: string, k: string): string | null {
  const body = sectionBody(section);
  if (body === null) return null;
  const start = body.search(new RegExp(`^(\\*\\*${escapeRe(section)} \\*\\*)?\\(${escapeRe(k)}\\)`, "m"));
  if (start < 0) return null;
  const next = body.slice(start + 1).search(/^\(\d+\)/m);
  return next < 0 ? body.slice(start) : body.slice(start, start + 1 + next);
}

/** A clause "(x)" directly inside the subsection: clauses are tab-indented, so they match "\t(x)\t" at line start. */
function hasClause(section: string, k: string, letter: string): boolean {
  const text = subsectionText(section, k);
  return text !== null && new RegExp(`^\\t\\(${escapeRe(letter)}\\)\\t`, "m").test(text);
}

/** A paragraph "N." directly inside the subsection (or, with no subsection, anywhere in the section). */
function hasParagraph(section: string, k: string | undefined, n: string): boolean {
  const text = k === undefined ? sectionBody(section) : subsectionText(section, k);
  return text !== null && new RegExp(`^\\t${escapeRe(n)}\\.\\t`, "m").test(text);
}

/** A numbered subsection exists in the bundled section. */
function hasSubsection(section: string, k: string): boolean {
  return subsectionText(section, k) !== null;
}

/** One provision a preloaded CYFSA item relies on. Each is checked against the bundled text. */
interface Ref {
  section: string;
  subsection?: string;
  clause?: string;
  para?: string;
}

/**
 * Every CYFSA item in the statutory sidebar, with the provisions it relies on. This table is maintained by
 * hand on purpose: a free-text parser of citation strings misread several forms, so each reference is listed here
 * and checked against the bundled text. A completeness test fails when a CYFSA item has no entry.
 */
const EXPECTED: Record<string, Ref[]> = {
  "cyfsa-81": [{ section: "81", subsection: "7" }],
  "cyfsa-88": [{ section: "88" }],
  "cyfsa-74": [{ section: "74", subsection: "2" }, { section: "74", subsection: "2", clause: "k" }, { section: "74", subsection: "2", clause: "n" }],
  "cyfsa-3": [{ section: "3" }, { section: "78" }, { section: "78", subsection: "4" }],
  "cyfsa-72": [{ section: "72" }],
  "def-least-intrusive": [{ section: "1", subsection: "2", para: "2" }, { section: "101", subsection: "3" }],
  "def-best-interests": [{ section: "74", subsection: "3" }],
  "def-supervision-order": [{ section: "101", subsection: "1", para: "1" }],
};

const cyfsaItems = PRELOADED_ITEMS.filter((i) => /\bCYFSA\b/.test(i.citation));

function itemById(id: string): string {
  const item = PRELOADED_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`missing preloaded item ${id}`);
  return item.content;
}

describe("the reference table covers the sidebar", () => {
  it("has an entry for every CYFSA item, and no entry for an item that is gone", () => {
    expect(cyfsaItems.map((i) => i.id).filter((id) => !(id in EXPECTED))).toEqual([]);
    const ids = new Set(PRELOADED_ITEMS.map((i) => i.id));
    expect(Object.keys(EXPECTED).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("names an Act for every item that cites a section", () => {
    const unnamed = PRELOADED_ITEMS.filter(
      (i) =>
        /\bss?\.\s*\d/i.test(i.citation) &&
        !/\b(?:CYFSA|CLRA|Evidence Act|Family Law Rules|Mental Health Act|Charter)\b/i.test(i.citation)
    ).map((i) => i.id);
    expect(unnamed).toEqual([]);
  });

  it("keeps CYFSA items free of other Acts", () => {
    const mixed = cyfsaItems.filter((i) => /\b(?:CLRA|Evidence Act|Family Law Rules|Mental Health Act|Charter)\b/i.test(i.citation));
    expect(mixed.map((i) => i.id)).toEqual([]);
  });
});

describe("each referenced provision exists in the bundled text", () => {
  for (const item of cyfsaItems) {
    it.each(EXPECTED[item.id] ? EXPECTED[item.id].map((r) => [JSON.stringify(r), r] as const) : [])(
      `${item.id}: %s`,
      (_label, ref) => {
        expect(TOC.has(Number(ref.section)), `s. ${ref.section} is in the CYFSA table of contents`).toBe(true);
        expect(sectionBody(ref.section), `s. ${ref.section} has bundled text`).not.toBeNull();
        expect(new RegExp(`\\b${escapeRe(ref.section)}\\b`).test(item.citation), "item citation names the section").toBe(true);
        if (ref.subsection !== undefined) {
          expect(hasSubsection(ref.section, ref.subsection), `s. ${ref.section}(${ref.subsection}) exists`).toBe(true);
        }
        if (ref.clause !== undefined) {
          expect(
            hasClause(ref.section, ref.subsection ?? "", ref.clause),
            `s. ${ref.section}(${ref.subsection})(${ref.clause}) exists`
          ).toBe(true);
        }
        if (ref.para !== undefined) {
          expect(
            hasParagraph(ref.section, ref.subsection, ref.para),
            `para. ${ref.para} of s. ${ref.section}(${ref.subsection}) exists`
          ).toBe(true);
        }
      }
    );
  }
});

describe("the checks themselves fail on wrong references", () => {
  it("rejects a clause that is not in the subsection", () => {
    expect(hasClause("74", "2", "z")).toBe(false);
    expect(hasClause("74", "2", "k")).toBe(true);
  });

  it("checks paragraphs inside the subsection they belong to", () => {
    expect(hasParagraph("101", "1", "1")).toBe(true);
    expect(hasParagraph("101", "2", "1")).toBe(false);
  });

  it("rejects a subsection that does not exist", () => {
    expect(hasSubsection("88", "2")).toBe(false);
    expect(hasSubsection("102", "9")).toBe(false);
  });
});

describe("corrected statements", () => {
  it("cites the supervision order to s. 101(1), para. 1, not s. 102 (custody order)", () => {
    const item = PRELOADED_ITEMS.find((i) => i.id === "def-supervision-order");
    expect(item?.citation).toBe("CYFSA s. 101(1), para. 1");
    expect(TOC.get(102)).toBe("Custody order");
    expect(item?.content).toContain("at least three months and not more than 12 months");
  });

  it("states s. 3 rights and s. 78 representation, with the full s. 78(4) presumption and qualifier", () => {
    const item = PRELOADED_ITEMS.find((i) => i.id === "cyfsa-3");
    expect(item?.citation).toBe("CYFSA s. 3; s. 78");
    expect(item?.content).not.toMatch(/Children[’']s Lawyer|\bOCL\b|12 and older|12 or older|aged 12|age 12/i);
    expect(item?.content).toMatch(/legal representation/);
    expect(item?.content).toMatch(/deemed desirable/);
    expect(item?.content).toMatch(/no parent appears/);
    expect(item?.content).toMatch(
      /unless the court is satisfied, taking into account the child's views and wishes, given due weight in accordance with the child's age and maturity, that the child's interests are otherwise adequately protected\./
    );
  });

  it("uses the statutory child protection worker term for s. 81(7)", () => {
    const content = itemById("cyfsa-81");
    expect(content).toContain("child protection worker");
    expect(content).toContain("s. 81(12)");
    expect(content).not.toMatch(/children[’']s aid worker/i);
  });

  it("limits the poverty and housing statement, names family-circumstance clauses and uses the statutory wording for emotional harm", () => {
    const content = itemById("cyfsa-74");
    expect(content).toMatch(/Poverty and housing on their own are not listed grounds/);
    expect(content).toMatch(/clause \(k\)/);
    expect(content).toMatch(/serious emotional harm/);
    expect(content).not.toMatch(/do not meet|home clutter|General family circumstances|severe emotional|medical neglect/i);
  });

  it("states the s. 101(3) test and the s. 1(2) para. 2 'should be considered' wording", () => {
    const content = itemById("def-least-intrusive");
    expect(content).toContain("would be inadequate");
    expect(content).toContain("should be considered");
    expect(content).not.toMatch(/thoroughly|tried and failed|should be used/i);
  });

  it("keeps the s. 81(13) neglect-or-default clause and drops the unsupported court-process claim", () => {
    expect(DATA_SOURCE).toContain("alleged neglect or default in the execution in good faith of that duty");
    expect(DATA_SOURCE).not.toMatch(/challenges go through the court process below/);
  });
});
