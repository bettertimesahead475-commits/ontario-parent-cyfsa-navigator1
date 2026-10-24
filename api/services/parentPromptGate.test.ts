import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSectionPrompt } from "./analyzerSections.js";

describe("parent attribution prompt gate", () => {
  const original = process.env.PARENT_ANALYSIS_ENABLED;
  beforeEach(() => {
    delete process.env.PARENT_ANALYSIS_ENABLED;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PARENT_ANALYSIS_ENABLED;
    else process.env.PARENT_ANALYSIS_ENABLED = original;
  });

  it("leaves every section prompt unchanged when the flag is OFF", () => {
    for (const key of ["overview", "redFlags", "chronology", "guidance"] as const) {
      expect(buildSectionPrompt(key, "fast", "DOC")).not.toContain("parentAttribution");
      expect(buildSectionPrompt(key, "fast", "DOC")).not.toContain("PARENT ATTRIBUTION RULES");
    }
  });

  it("adds the schema and rules to the overview prompt only when the flag is ON", () => {
    process.env.PARENT_ANALYSIS_ENABLED = "true";
    const overview = buildSectionPrompt("overview", "fast", "DOC");
    expect(overview).toContain('"parentAttribution"');
    expect(overview).toContain("PARENT ATTRIBUTION RULES");
    expect(buildSectionPrompt("redFlags", "fast", "DOC")).not.toContain("parentAttribution");
    expect(buildSectionPrompt("guidance", "full", "DOC")).not.toContain("parentAttribution");
  });

  it("treats any value other than exactly 'true' as OFF", () => {
    process.env.PARENT_ANALYSIS_ENABLED = "1";
    expect(buildSectionPrompt("overview", "fast", "DOC")).not.toContain("parentAttribution");
  });
});
