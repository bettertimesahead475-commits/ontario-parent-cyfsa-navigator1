import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Each assertion reproduces a statute misstatement found in a post-launch review of the Forensic Deep Scan and its
// supporting content. The official text is legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("statute misstatements stay corrected", () => {
  it("does not describe s. 81(1) as the warrantless apprehension power (it is the society's court application)", () => {
    expect(read("src/components/LegalTerminologyDrawer.tsx")).not.toContain("Under s. 81(1) of the CYFSA");
  });

  it("does not describe s. 94(2) as a burden-of-proof rule (it is the temporary custody order during an adjournment)", () => {
    const tab = read("src/components/DocumentAnalyzerTab.tsx");
    expect(tab).not.toContain("Section 94(2) Onus");
    expect(tab).toContain("Section 94(2) Temporary Care and Custody");
  });

  it("does not attach a burden-of-proof claim to the s. 94(2) sign-up PDF", () => {
    expect(read("src/components/SignUpTab.tsx")).not.toContain("BURDEN STANDARDS");
  });

  it("does not say representation for a child is 'presumed necessary' (s. 78(4) says deemed desirable)", () => {
    const data = read("src/data.ts");
    expect(data).not.toContain("presumed necessary");
    expect(data).toContain("deemed desirable");
  });

  it("does not label the s. 78(4) grounds as 'harm-based', a term the statute does not use", () => {
    expect(read("src/data.ts")).not.toContain("harm-based grounds");
  });

  it("states the s. 78(5) minor-parent rule as the Children's Lawyer's duty, not a parent's entitlement", () => {
    const data = read("src/data.ts");
    expect(data).not.toContain("you are entitled to representation by the Office of the Children's Lawyer");
    expect(data).toContain("s. 78(5) says the Office of the Children's Lawyer shall represent you");
  });
});

describe("prompt rules for factual extraction", () => {
  const prompts = read("api/services/analyzerPrompts.ts");

  it("forbids stating that check boxes are unmarked without a visible-mark reading", () => {
    expect(prompts).toMatch(/Check boxes: a box is marked only where the page shows a visible mark/);
  });

  it("separates filename dates from court dates", () => {
    expect(prompts).toMatch(/A date in a filename or scan label is a filename date, not a court date/);
  });

  it("normalizes file numbers split across line breaks before a discrepancy is flagged", () => {
    expect(prompts).toMatch(/join a file number split by a line break or a hyphen/);
  });

  it("treats absent documentation as class B, never as proof of breach", () => {
    expect(prompts).toMatch(/Absent documentation is class B\. It is never proof that a procedural obligation was breached\./);
  });
});
