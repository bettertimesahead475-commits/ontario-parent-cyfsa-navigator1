import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const component = readFileSync(resolve(process.cwd(), "src/components/CASRightsLimitsTab.tsx"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const sitemap = readFileSync(resolve(process.cwd(), "public/sitemap.xml"), "utf8");
const topicSlugs = [...component.matchAll(/\{slug:"([^"]+)",title:/g)].map((match) => match[1]);
const sourceBlock = component.split("const legalSources:")[1]?.split("const reviewedGrounds:")[0] ?? "";
const defenceBlock = component.split("const defenceAnalysis:")[1]?.split("// Adversarial legal review:")[0] ?? "";
const groundsBlock = component.split("const reviewedGrounds:")[1]?.split("type DefenceAnalysis")[0] ?? "";
const recordKeys = (source: string, kind: "source" | "object") =>
  [...source.matchAll(kind === "source" ? /^\s*"([^"]+)": \[/gm : /^\s*"([^"]+)": \{/gm)].map((match) => match[1]);

describe("CAS Powers & Limits legal hub", () => {
  it("defines 19 unique topics with legal sources, grounds and opposing-case analyses", () => {
    expect(topicSlugs).toHaveLength(19);
    expect(new Set(topicSlugs).size).toBe(19);
    for (const keys of [recordKeys(sourceBlock, "source"), recordKeys(groundsBlock, "object"), recordKeys(defenceBlock, "object")]) {
      expect(keys).toHaveLength(19);
      expect(new Set(keys).size).toBe(19);
      expect([...keys].sort()).toEqual([...topicSlugs].sort());
    }
  });
  it("connects topic-specific analysis and source links to the selected topic", () => {
    expect(component).toContain("defenceAnalysis[topic.slug].opposingCase");
    expect(component).toContain("legalSources[topic.slug]");
    expect(component).toContain("reviewedGrounds[topic.slug]");
  });
  it("searches more than just topic titles", () => {
    expect(component).toContain("reviewedGrounds[t.slug]?.grounds");
    expect(component).toContain("defenceAnalysis[t.slug]?.legalQuestion");
  });
  it("registers a discoverable route and sitemap entry", () => {
    expect(app).toContain('<Route path="/cas-powers-rights"><CASRightsLimitsTab /></Route>');
    expect(sitemap).toContain("https://cyfsanavigator.com/cas-powers-rights");
  });
  it("does not claim a legal result or treat unverified case law as verified", () => {
    expect(component).toContain("not a pleaded defence");
    expect(component).toContain("Source links are research starting points");
    expect(component).toContain("do not rely on unverified judgment summaries");
    expect(component).not.toContain("minicounsel.ca");
  });
});
