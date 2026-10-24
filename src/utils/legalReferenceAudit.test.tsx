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
const normalizeQuotes = (s: string) => s.replace(/[’‘]/g, "'");

/** The body of a section such as "81", "77.1": from its "**N **" header to the next section header. */
function sectionBody(section: string): string | null {
  const lines = BUNDLED.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\*\\*${escapeRe(section)} \\*\\*`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\*\*\d+(\.\d+)? \*\*/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** Text of one numbered subsection "(k)", from its marker to the next numbered subsection. */
function subsectionText(section: string, k: string): string | null {
  const body = sectionBody(section);
  if (body === null) return null;
  const start = body.search(new RegExp(`^(\\*\\*${escapeRe(section)} \\*\\*)?\\(${escapeRe(k)}\\)`, "m"));
  if (start < 0) return null;
  const rest = body.slice(start + 1);
  const next = rest.search(/^\(\d+\)/m);
  return next < 0 ? body.slice(start) : body.slice(start, start + 1 + next);
}

/** A numbered subsection "(k)" exists in the bundled section. */
function hasSubsection(section: string, k: string): boolean {
  return subsectionText(section, k) !== null;
}

/** A clause letter "(x)" that sits inside subsection (k). Clauses are tab-indented, so they match "\t(x)\t". */
function hasClause(section: string, k: string, letter: string): boolean {
  const text = subsectionText(section, k);
  return text !== null && new RegExp(`^\\t\\(${escapeRe(letter)}\\)\\t`, "m").test(text);
}

/** A paragraph "N." numbered at the start of a tabbed line inside the section. */
function hasParagraph(section: string, n: string): boolean {
  const body = sectionBody(section);
  return body !== null && new RegExp(`^\\t${escapeRe(n)}\\.\\t`, "m").test(body);
}

export interface CyfsaRef {
  section: string;
  subsection: string | null;
  /** Clause letters after the subsection, e.g. ["k"] for 74(2)(k). Only single letters are clauses. */
  clauses: string[];
  /** True when a parenthesised part is neither a numeric subsection "(n)" nor a clause letter "(a)", or a clause letter comes before any subsection. */
  invalidToken: boolean;
}

// Section number: 1 to 3 digits not followed by another digit, optional decimal part (77.1).
const NUM = String.raw`\d{1,3}(?!\d)(?:\.\d+)?`;
// One parenthesised part, valid or not, so the parser can flag invalid ones such as "(zz)" or "(7.5)".
const PART = String.raw`\([^()\s]*\)`;
// A space is allowed between a number and its parenthesis: "s. 74 (2)".
const ITEM = String.raw`(?:${NUM}(?:\s?${PART})*|${PART}(?:${PART})*)`;
const SEP = String.raw`\s*(?:,|and|or|&|;|to|-|–)\s*`;
const LIST = new RegExp(String.raw`\b(?:ss?|secs?|sections?|subs?|subsections?)\.?\s*(${ITEM}(?:${SEP}${ITEM})*)`, "gi");
const TOKEN = new RegExp(String.raw`(${ITEM})|(${SEP})`, "g");

function refFrom(section: string, parts: string[]): CyfsaRef {
  const isNum = (p: string) => /^\(\d+\)$/.test(p);
  const isLetter = (p: string) => /^\([a-z]\)$/.test(p);
  const first = parts[0] ?? null;
  const subsection = first !== null && isNum(first) ? first.slice(1, -1) : null;
  const clauses = subsection !== null ? parts.slice(1).filter(isLetter).map((p) => p.slice(1, -1)) : [];
  const invalidToken =
    parts.some((p) => !isNum(p) && !isLetter(p)) ||
    (first !== null && !isNum(first)) ||
    (subsection !== null && parts.slice(1).some((p) => isNum(p)));
  return { section, subsection, clauses, invalidToken };
}

/**
 * Section references in one citation. Handles lists ("ss. 74(2) and 81(7)"), bare subsection continuations
 * ("s. 94(1) and (5)" gives 94(5)), ranges ("s. 74(2)-(4)" gives 74(2), 74(3), 74(4)), decimals ("s. 77.1"),
 * and a space before a parenthesis ("s. 74 (2)"). A quantity such as "150 days" is removed first.
 * "para." numbers are not sections; cyfsaParagraphs reads them.
 */
export function cyfsaReferences(citation: string): CyfsaRef[] {
  const cleaned = normalizeQuotes(citation).replace(/\d+\s*(?:days?|months?|years?|hours?|weeks?|%|per cent)\b/gi, "");
  const out: CyfsaRef[] = [];
  for (const m of cleaned.matchAll(LIST)) {
    let base = "";
    let lastRef: CyfsaRef | null = null;
    let pendingRange = false;
    for (const t of m[1].matchAll(TOKEN)) {
      if (t[2] !== undefined) {
        pendingRange = /^(?:-|–|to)$/.test(t[2].trim());
        continue;
      }
      const raw = t[1];
      const numeric = /^\d/.test(raw);
      const section = numeric ? raw.match(/^\d{1,3}(?:\.\d+)?/)![0] : base;
      const parts = (numeric ? raw.slice(section.length) : raw).match(/\([^()\s]*\)/g) ?? [];
      if (numeric) base = section;
      // A bare clause letter after a subsection belongs to that subsection: "74(2)(a), (b)".
      if (!numeric && lastRef !== null && lastRef.subsection !== null && /^\([a-z]\)$/.test(parts[0] ?? "")) {
        lastRef.clauses.push(parts[0].slice(1, -1));
        pendingRange = false;
        continue;
      }
      const ref = refFrom(section, parts);
      if (
        pendingRange &&
        lastRef !== null &&
        lastRef.section === section &&
        lastRef.subsection !== null &&
        ref.subsection !== null &&
        Number(ref.subsection) > Number(lastRef.subsection) + 1
      ) {
        for (let k = Number(lastRef.subsection) + 1; k < Number(ref.subsection); k++) {
          out.push(refFrom(section, [`(${k})`]));
        }
      }
      out.push(ref);
      lastRef = ref;
      pendingRange = false;
    }
  }
  return out;
}

/** Paragraph numbers, each with the section it belongs to: "s. 1(2), para. 2; s. 101(3)" gives para 2 of s. 1. */
export function cyfsaParagraphs(citation: string): { para: string; section: string | null }[] {
  const cleaned = normalizeQuotes(citation);
  return [...cleaned.matchAll(/\bparas?\.?\s*(\d{1,2})\b/gi)].map((m) => {
    const refs = cyfsaReferences(cleaned.slice(0, m.index));
    return { para: m[1], section: refs.length ? refs[refs.length - 1].section : null };
  });
}

const OTHER_ACTS = /\b(?:CLRA|Children's Law Reform Act|Evidence Act|Family Law Rules|Mental Health Act|Charter|Criminal Code|Family Law Act|Youth Criminal Justice Act)\b/i;
const ACT_NAME = /\b(?:CYFSA|Child, Youth and Family Services Act|CLRA|Children's Law Reform Act|Evidence Act|Family Law Rules|Mental Health Act|Charter|Criminal Code|Family Law Act|Youth Criminal Justice Act)\b/i;

/** A citation mixes Acts if another Act is named, or a ';' separated part is not a CYFSA reference. */
export function mixesActs(citation: string): boolean {
  const c = normalizeQuotes(citation);
  if (OTHER_ACTS.test(c) && /\bCYFSA\b/.test(c)) return true;
  const parts = c.split(";");
  return parts.slice(1).some((p) => !/^\s*(?:CYFSA\b|ss?\.|subs?\.|subsections?\b|sections?\b|\d)/i.test(p));
}

function itemById(id: string): string {
  const item = PRELOADED_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`missing preloaded item ${id}`);
  return item.content;
}

const pairs = (refs: CyfsaRef[]) => refs.map((r) => [r.section, r.subsection]);

describe("citation parsing", () => {
  it("reads every section in a list, including bare subsection continuations", () => {
    expect(pairs(cyfsaReferences("CYFSA ss. 74(2) and 81(7)"))).toEqual([
      ["74", "2"],
      ["81", "7"],
    ]);
    expect(pairs(cyfsaReferences("CYFSA ss. 94(1) and (5)"))).toEqual([
      ["94", "1"],
      ["94", "5"],
    ]);
  });

  it("expands subsection ranges", () => {
    expect(pairs(cyfsaReferences("CYFSA s. 74(2)-(4)"))).toEqual([
      ["74", "2"],
      ["74", "3"],
      ["74", "4"],
    ]);
    expect(pairs(cyfsaReferences("CYFSA s. 74(2) and (4)"))).toEqual([
      ["74", "2"],
      ["74", "4"],
    ]);
  });

  it("reads clause letters after a subsection", () => {
    expect(cyfsaReferences("CYFSA s. 74(2)(k)")[0].clauses).toEqual(["k"]);
    expect(cyfsaReferences("CYFSA s. 74(2)(a), (b)").map((r) => r.clauses)).toEqual([["a", "b"]]);
  });

  it("reads 'subs.', 'subsection' and decimal sections", () => {
    expect(pairs(cyfsaReferences("CYFSA subs. 81(7)"))).toEqual([["81", "7"]]);
    expect(pairs(cyfsaReferences("CYFSA subsection 94(5)"))).toEqual([["94", "5"]]);
    expect(cyfsaReferences("CYFSA s. 77.1").map((r) => r.section)).toEqual(["77.1"]);
  });

  it("reads a space before a parenthesis", () => {
    expect(pairs(cyfsaReferences("CYFSA s. 74 (2)"))).toEqual([["74", "2"]]);
    expect(cyfsaReferences("CYFSA s. 74 (h)")[0].invalidToken).toBe(true);
  });

  it("does not read years, quantities or para. numbers as sections", () => {
    expect(cyfsaReferences("CYFSA s. 1(2), para. 2").map((r) => r.section)).toEqual(["1"]);
    expect(cyfsaReferences("CYFSA s. 81(7) and 150 days").map((r) => r.section)).toEqual(["81"]);
    expect(cyfsaReferences("CYFSA s. 88 and 16 months").map((r) => r.section)).toEqual(["88"]);
    expect(cyfsaReferences("CYFSA s. 74(2) and 2017 amendments").map((r) => r.section)).toEqual(["74"]);
    expect(cyfsaReferences("CYFSA, S.O. 2017, c. 14, s. 94(1)").map((r) => r.section)).toEqual(["94"]);
  });

  it("flags invalid parenthesised parts", () => {
    expect(cyfsaReferences("CYFSA s. 74(h)")[0].invalidToken).toBe(true);
    expect(cyfsaReferences("CYFSA s. 74(2)(zz)")[0].invalidToken).toBe(true);
    expect(cyfsaReferences("CYFSA s. 81(7.5)")[0].invalidToken).toBe(true);
    expect(cyfsaReferences("CYFSA s. 74(2)(a)")[0].invalidToken).toBe(false);
  });

  it("reads paragraph numbers with the section they belong to", () => {
    expect(cyfsaParagraphs("CYFSA s. 101(1), para. 9")).toEqual([{ para: "9", section: "101" }]);
    expect(cyfsaParagraphs("CYFSA s. 1(2), para. 7; s. 101(3)")).toEqual([{ para: "7", section: "1" }]);
  });

  it("detects a citation that mixes Acts, with curly or straight apostrophes", () => {
    expect(mixesActs("CYFSA s. 74(2); Youth Criminal Justice Act, s. 3")).toBe(true);
    expect(mixesActs("CYFSA s. 74(2); Children’s Law Reform Act, s. 10")).toBe(true);
    expect(mixesActs("CYFSA s. 74(2), CLRA s. 8")).toBe(true);
    expect(mixesActs("CYFSA s. 1(2), para. 2; s. 101(3)")).toBe(false);
    expect(mixesActs("CYFSA ss. 74(2) and 81(7)")).toBe(false);
  });

  it("matches subsections, clauses and paragraphs against the bundled text", () => {
    expect(hasSubsection("81", "7")).toBe(true);
    expect(hasSubsection("101", "1")).toBe(true);
    expect(hasSubsection("88", "2")).toBe(false); // s. 88 has no subsections
    expect(hasSubsection("102", "9")).toBe(false);
    expect(hasClause("74", "2", "k")).toBe(true);
    expect(hasClause("74", "2", "z")).toBe(false);
    expect(hasParagraph("101", "9")).toBe(false);
  });
});

describe("preloaded citations resolve to the bundled text", () => {
  const sectionItems = PRELOADED_ITEMS.filter((i) => /\bss?\.\s*\d/i.test(i.citation));

  it("names an Act for every item that cites a section, and cites at least one", () => {
    expect(sectionItems.length).toBeGreaterThanOrEqual(10);
    const unnamed = sectionItems.filter((i) => !ACT_NAME.test(i.citation)).map((i) => i.id);
    expect(unnamed).toEqual([]);
  });

  it("has CYFSA items to check, and none mixes CYFSA with another Act", () => {
    const cyfsaItems = PRELOADED_ITEMS.filter((i) => /\bCYFSA\b/.test(i.citation));
    expect(cyfsaItems.length).toBeGreaterThanOrEqual(7);
    expect(cyfsaItems.filter((i) => mixesActs(i.citation)).map((i) => i.id)).toEqual([]);
  });

  const cyfsaCitations = PRELOADED_ITEMS.filter((i) => /\bCYFSA\b/.test(i.citation)).map((i) => [i.id, i.citation] as const);
  it.each(cyfsaCitations)("%s (%s)", (_id, citation) => {
    const refs = cyfsaReferences(citation);
    expect(refs.length, "citation names at least one CYFSA section").toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.invalidToken, `no invalid part in "${citation}"`).toBe(false);
      const integer = Number(ref.section.split(".")[0]);
      expect(TOC.has(integer), `s. ${ref.section} is in the CYFSA table of contents`).toBe(true);
      expect(sectionBody(ref.section), `s. ${ref.section} has bundled text`).not.toBeNull();
      if (ref.subsection) {
        expect(hasSubsection(ref.section, ref.subsection), `s. ${ref.section}(${ref.subsection}) exists`).toBe(true);
      }
      for (const clause of ref.clauses) {
        expect(hasClause(ref.section, ref.subsection ?? "", clause), `s. ${ref.section}(${ref.subsection})(${clause}) exists`).toBe(true);
      }
    }
    for (const { para, section } of cyfsaParagraphs(citation)) {
      expect(section, `para. ${para} has a section in "${citation}"`).not.toBeNull();
      expect(hasParagraph(section ?? "", para), `para. ${para} of s. ${section} exists`).toBe(true);
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

  it("states s. 3 rights and s. 78 representation, including the s. 78(4) presumption and its full qualifier", () => {
    const item = PRELOADED_ITEMS.find((i) => i.id === "cyfsa-3");
    expect(item?.citation).toBe("CYFSA s. 3; s. 78");
    expect(item?.content).not.toMatch(/Children[’']s Lawyer|\bOCL\b|12 and older|12 or older|aged 12|age 12/i);
    expect(item?.content).toMatch(/legal representation/);
    expect(item?.content).toMatch(/deemed desirable/);
    expect(item?.content).toMatch(/no parent appears/);
    expect(item?.content).toMatch(
      /unless the court is satisfied, taking into account the child's views and wishes, that the child's interests are otherwise adequately protected\./
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
