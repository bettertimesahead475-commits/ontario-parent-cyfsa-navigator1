import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRELOADED_ITEMS } from "../components/StatutoryBookmarkSidebar";

const BUNDLED = readFileSync(
  new URL("../../legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt", import.meta.url),
  "utf8"
);

/** Section headings from the bundled table of contents, e.g. "| 74. | Interpretation |". */
const TOC = new Map<number, string>();
for (const m of BUNDLED.matchAll(/^\| (\d+)\. \| (.+?) \|$/gm)) {
  if (!TOC.has(Number(m[1]))) TOC.set(Number(m[1]), m[2].trim());
}

/** The body of a section: from its "**N **" header to the next section header. */
function sectionBody(n: number): string | null {
  const lines = BUNDLED.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\*\\*${n} \\*\\*`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\*\*\d+(\.\d+)? \*\*/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** True when the bundled section has a subsection marker "(k)" at the start of a line or on its header line. */
function hasSubsection(n: number, k: string): boolean {
  const body = sectionBody(n);
  return body !== null && new RegExp(`^(\\*\\*${n} \\*\\*)?\\(${k}\\)`, "m").test(body);
}

/**
 * Section references in a CYFSA citation string: "s. 81(7)", "ss. 74(2) and 81(7)", "s. 3; s. 78",
 * "s. 1(2), para. 2". Each number after a section keyword counts, including items in a list. "para." is not a section.
 */
export function cyfsaReferences(citation: string): { section: number; subsection: string | null }[] {
  const out: { section: number; subsection: string | null }[] = [];
  const list = /\b(?:ss?\.|sections?)\s*((?:\d{1,3}(?:\([0-9a-z]+\))*(?:\s*(?:,|and|or|&|;|to|-|–)\s*(?!para\b))?)+)/gi;
  for (const m of citation.matchAll(list)) {
    for (const item of m[1].matchAll(/(\d{1,3})((?:\([0-9a-z]+\))*)/g)) {
      const first = /^\((\d+)\)/.exec(item[2]);
      out.push({ section: Number(item[1]), subsection: first ? first[1] : null });
    }
  }
  return out;
}

function itemById(id: string): string {
  const item = PRELOADED_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`missing preloaded item ${id}`);
  return item.content;
}

describe("citation parsing", () => {
  it("reads every section in a list and ignores para. numbers", () => {
    expect(cyfsaReferences("CYFSA ss. 74(2) and 81(7)")).toEqual([
      { section: 74, subsection: "2" },
      { section: 81, subsection: "7" },
    ]);
    expect(cyfsaReferences("CYFSA s. 1(2), para. 2")).toEqual([{ section: 1, subsection: "2" }]);
    expect(cyfsaReferences("CYFSA s. 101(1), para. 1")).toEqual([{ section: 101, subsection: "1" }]);
  });

  it("matches subsections against the bundled text", () => {
    expect(hasSubsection(81, "7")).toBe(true);
    expect(hasSubsection(101, "3")).toBe(true);
    expect(hasSubsection(88, "2")).toBe(false); // s. 88 has no subsections
    expect(hasSubsection(102, "9")).toBe(false);
  });
});

describe("preloaded CYFSA citations resolve to the bundled text", () => {
  const cyfsaItems = PRELOADED_ITEMS.filter((i) => /\bCYFSA\b/.test(i.citation));

  it("has CYFSA items to check", () => {
    expect(cyfsaItems.length).toBeGreaterThanOrEqual(7);
  });

  it.each(cyfsaItems.map((i) => [i.id, i.citation] as const))("%s (%s)", (_id, citation) => {
    for (const ref of cyfsaReferences(citation)) {
      expect(TOC.has(ref.section), `s. ${ref.section} is in the CYFSA table of contents`).toBe(true);
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

  it("does not attribute counsel rights or the age-12 rule to s. 3", () => {
    const item = PRELOADED_ITEMS.find((i) => i.id === "cyfsa-3");
    expect(item?.citation).toContain("s. 78");
    expect(item?.content).not.toMatch(/Children's Lawyer|OCL|12 and older/);
    expect(item?.content).toContain("legal representation");
  });

  it("uses the statutory child protection worker term for s. 81(7)", () => {
    const content = itemById("cyfsa-81");
    expect(content).toContain("child protection worker");
    expect(content).not.toContain("children's aid worker");
  });

  it("does not say poverty or clutter are ruled out by s. 74(2)", () => {
    expect(itemById("cyfsa-74")).not.toMatch(/do not meet/);
  });

  it("states the s. 101(3) test instead of an unsupported 'thoroughly tried' standard", () => {
    const content = itemById("def-least-intrusive");
    expect(content).toContain("would be inadequate");
    expect(content).not.toMatch(/thoroughly|tried and failed/);
  });
});
