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

/** A subsection marker "(k)" at the start of a line, or on the section header line. Clauses are indented, so they do not match. */
function hasSubsection(section: string, k: string): boolean {
  const body = sectionBody(section);
  return body !== null && new RegExp(`^(\\*\\*${escapeRe(section)} \\*\\*)?\\(${escapeRe(k)}\\)`, "m").test(body);
}

export interface CyfsaRef {
  section: string;
  subsection: string | null;
  /** Letter or other non-numeric first-level subsection, e.g. "74(h)". Always invalid under the Act's numbering. */
  invalidSubsection: boolean;
}

const ITEM = String.raw`(?:\d{1,3}(?:\.\d+)?(?:\([0-9a-z]+\))*|\(\d+\)(?:\([0-9a-z]+\))*)`;
const SEP = String.raw`\s*(?:,|and|or|&|;|to|-|–)\s*`;
const LIST = new RegExp(String.raw`\b(?:ss?|secs?|sections?|subs?|subsections?)\.?\s*(${ITEM}(?:${SEP}${ITEM})*)`, "gi");

/**
 * Section references in one citation: "s. 81(7)", "ss. 74(2) and 81(7)", "s. 77.1", "s. 94(1) and (5)" (a bare
 * subsection continues the previous section), "s. 1(2), para. 2" (para. is not a section). Quantities such as
 * "150 days" are removed first, so they are not read as sections.
 */
export function cyfsaReferences(citation: string): CyfsaRef[] {
  const cleaned = citation.replace(/\d+\s*(?:days?|months?|years?|hours?|weeks?|%|per cent)\b/gi, "");
  const out: CyfsaRef[] = [];
  for (const m of cleaned.matchAll(LIST)) {
    let base = "";
    for (const item of m[1].matchAll(/(\d{1,3}(?:\.\d+)?)((?:\([0-9a-z]+\))*)|\((\d+)\)((?:\([0-9a-z]+\))*)/g)) {
      if (item[1]) {
        base = item[1];
        const first = /^\(([0-9a-z]+)\)/.exec(item[2]);
        out.push({
          section: base,
          subsection: first && /^\d+$/.test(first[1]) ? first[1] : null,
          invalidSubsection: Boolean(first && !/^\d+$/.test(first[1])),
        });
      } else if (base) {
        out.push({ section: base, subsection: item[3], invalidSubsection: false });
      }
    }
  }
  return out;
}

const OTHER_ACTS = /\b(?:CLRA|Children's Law Reform Act|Evidence Act|Family Law Rules|Mental Health Act|Charter|Criminal Code|Family Law Act)\b/i;

function itemById(id: string): string {
  const item = PRELOADED_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`missing preloaded item ${id}`);
  return item.content;
}

describe("citation parsing", () => {
  it("reads every section in a list, including bare subsection continuations", () => {
    expect(cyfsaReferences("CYFSA ss. 74(2) and 81(7)").map((r) => [r.section, r.subsection])).toEqual([
      ["74", "2"],
      ["81", "7"],
    ]);
    expect(cyfsaReferences("CYFSA ss. 94(1) and (5)").map((r) => [r.section, r.subsection])).toEqual([
      ["94", "1"],
      ["94", "5"],
    ]);
    expect(cyfsaReferences("CYFSA s. 74(2)-(4)").map((r) => [r.section, r.subsection])).toEqual([
      ["74", "2"],
      ["74", "4"],
    ]);
  });

  it("reads 'subs.' and 'subsection' and decimal sections", () => {
    expect(cyfsaReferences("CYFSA subs. 81(7)").map((r) => [r.section, r.subsection])).toEqual([["81", "7"]]);
    expect(cyfsaReferences("CYFSA subsection 94(5)").map((r) => [r.section, r.subsection])).toEqual([["94", "5"]]);
    expect(cyfsaReferences("CYFSA s. 77.1").map((r) => r.section)).toEqual(["77.1"]);
  });

  it("does not read para. numbers, quantities or other Acts' numbers as sections", () => {
    expect(cyfsaReferences("CYFSA s. 1(2), para. 2").map((r) => r.section)).toEqual(["1"]);
    expect(cyfsaReferences("CYFSA s. 81(7) and 150 days").map((r) => r.section)).toEqual(["81"]);
    expect(cyfsaReferences("CYFSA s. 88 and 16 months").map((r) => r.section)).toEqual(["88"]);
    expect(cyfsaReferences("CYFSA, S.O. 2017, c. 14, s. 94(1)").map((r) => r.section)).toEqual(["94"]);
  });

  it("flags letter subsections directly after a section number", () => {
    const [ref] = cyfsaReferences("CYFSA s. 74(h)");
    expect(ref.invalidSubsection).toBe(true);
    expect(hasSubsection("74", "h")).toBe(false);
  });

  it("matches subsections against the bundled text", () => {
    expect(hasSubsection("81", "7")).toBe(true);
    expect(hasSubsection("101", "1")).toBe(true);
    expect(hasSubsection("101", "3")).toBe(true);
    expect(hasSubsection("88", "2")).toBe(false); // s. 88 has no subsections
    expect(hasSubsection("102", "9")).toBe(false);
  });
});

describe("preloaded CYFSA citations resolve to the bundled text", () => {
  const cyfsaItems = PRELOADED_ITEMS.filter((i) => /\bCYFSA\b/.test(i.citation));

  it("has CYFSA items to check, and none mixes CYFSA with another Act", () => {
    expect(cyfsaItems.length).toBeGreaterThanOrEqual(7);
    const mixed = PRELOADED_ITEMS.filter((i) => /\bCYFSA\b/.test(i.citation) && OTHER_ACTS.test(i.citation));
    expect(mixed.map((i) => i.id)).toEqual([]);
  });

  it.each(cyfsaItems.map((i) => [i.id, i.citation] as const))("%s (%s)", (_id, citation) => {
    const refs = cyfsaReferences(citation);
    expect(refs.length, "citation names at least one CYFSA section").toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.invalidSubsection, `no letter subsection in "${citation}"`).toBe(false);
      const integer = Number(ref.section.split(".")[0]);
      expect(TOC.has(integer), `s. ${ref.section} is in the CYFSA table of contents`).toBe(true);
      expect(sectionBody(ref.section), `s. ${ref.section} has bundled text`).not.toBeNull();
      if (ref.subsection) {
        expect(hasSubsection(ref.section, ref.subsection), `s. ${ref.section}(${ref.subsection}) exists`).toBe(true);
      }
    }
  });
});

describe("corrected statements", () => {
  it("cites the supervision order to s. 101(1), para. 1, not s. 102 (custody order)", () => {
    const item = PRELOADED_ITEMS.find((i) => i.id === "def-supervision-order");
    expect(item?.citation).toBe("CYFSA s. 101(1), para. 1");
    expect(TOC.get(102)).toBe("Custody order");
    expect(item?.content).toContain("at least three months and not more than 12 months");
  });

  it("states s. 3 rights and s. 78 representation, including the s. 78(4) presumption", () => {
    const item = PRELOADED_ITEMS.find((i) => i.id === "cyfsa-3");
    expect(item?.citation).toBe("CYFSA s. 3; s. 78");
    expect(item?.content).not.toMatch(/Children[’']s Lawyer|\bOCL\b|12 and older|aged 12/i);
    expect(item?.content).toMatch(/legal representation/);
    expect(item?.content).toMatch(/deemed desirable/);
    expect(item?.content).toMatch(/no parent appears/);
  });

  it("uses the statutory child protection worker term for s. 81(7)", () => {
    const content = itemById("cyfsa-81");
    expect(content).toContain("child protection worker");
    expect(content).toContain("s. 81(12)");
    expect(content).not.toMatch(/children[’']s aid worker/i);
  });

  it("states that poverty and housing are not listed grounds, without a broader legal conclusion", () => {
    const content = itemById("cyfsa-74");
    expect(content).toMatch(/not listed as grounds/);
    expect(content).not.toMatch(/do not meet|home clutter/i);
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
