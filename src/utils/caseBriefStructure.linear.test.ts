import { describe, expect, it } from "vitest";
import { parseLabelledPipeItem, parseCaseBriefPoint } from "../../shared/caseBriefStructure";

function previousParseLabelledPipeItem(item: string) {
  const text = item.replace(/\*\*/g, "").trim();
  const segments = text.split(/\s+\|\s+/);
  if (segments.length < 2) return null;
  const rows = segments.map((segment) => {
    const m = segment.match(/^([A-Z][A-Za-z ,'/()-]{1,48}):\s*(.*)$/s);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { label: "", value: segment.trim() };
  });
  return rows.some((r) => r.label) ? rows : null;
}

function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("case brief parsing without backtracking regexes", () => {
  it("splits pipe items exactly as the previous regex did", () => {
    const rand = seeded(7);
    const parts = ["Question:", "Source:", " ", "  ", "|", " | ", "\t|\n", "a", "Still unknown: x", "**", "-", "\n"];
    for (let n = 0; n < 5000; n++) {
      let s = "";
      const len = 1 + Math.floor(rand() * 12);
      for (let i = 0; i < len; i++) s += parts[Math.floor(rand() * parts.length)];
      expect(parseLabelledPipeItem(s)).toEqual(previousParseLabelledPipeItem(s));
    }
  });

  it("stays linear on long separator runs", () => {
    const spaces = " ".repeat(50_000);
    const t0 = performance.now();
    parseLabelledPipeItem(`Question: a${spaces}x | Source: b`);
    parseCaseBriefPoint(`ISSUE: a${" -".repeat(25_000)}x EVIDENCE: b`);
    parseCaseBriefPoint(`ISSUE${" ".repeat(50_000)}x`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("keeps the label separators it accepted before", () => {
    expect(parseCaseBriefPoint("ISSUE - a gap. EVIDENCE: b").parts.issue).toBe("a gap.");
    expect(parseCaseBriefPoint("**ISSUE** : a. SIGNIFICANCE — c").parts.significance).toBe("c");
    expect(parseCaseBriefPoint("ISSUE-a").structured).toBe(false);
  });
});
