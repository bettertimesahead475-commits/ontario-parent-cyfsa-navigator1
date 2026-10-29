import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./TemplatesTab.tsx", import.meta.url)),
  "utf8",
);

describe("respondent answer form identity", () => {
  it("identifies the respondent's educational preparation as Form 33B.1", () => {
    expect(source).toContain("Respondent Answer & Care Plan Preparation (Form 33B.1)");
    expect(source).toContain("EDUCATIONAL PREPARATION");
    expect(source).toContain("Form 33B is exclusively for CAS care plans");
  });

  it("does not tell parents that populated objections are Form 33B replies", () => {
    expect(source).not.toContain("flagged objections into Form 33B reply paragraphs");
    expect(source).toContain("flagged objections into your educational Form 33B.1 respondent answer preparation");
  });
});
