import { describe, expect, it } from "vitest";
import { EXTRACTION_SYSTEM, INVESTIGATION_SYSTEM, REVIEW_SYSTEM, SYNTHESIS_SYSTEM, VISUAL_SYSTEM } from "./prompts";

// The guardrails from eval/forensic/MICHELLE_CLARK_AFFIDAVIT_PROTOCOL.md section 5, which every stage must carry.
describe("stage prompts carry the evidence guardrails", () => {
  it.each([
    ["extraction", EXTRACTION_SYSTEM],
    ["investigation", INVESTIGATION_SYSTEM],
    ["synthesis", SYNTHESIS_SYSTEM],
    ["review", REVIEW_SYSTEM],
    ["visual", VISUAL_SYSTEM],
  ])("%s", (_name, prompt) => {
    expect(prompt).toMatch(/runs from the event the provision names/);
    expect(prompt).toMatch(/adjournment by the court is not on its own a missed limit/);
    expect(prompt).toMatch(/not evidence of backdating or invalidity/);
    expect(prompt).toMatch(/OCR did not capture is not evidence that a signature/);
    expect(prompt).toMatch(/request for clarification, not a\s+finding of misconduct/);
  });

  it("the review distinguishes contradictions from differences in wording and does not suppress supported findings", () => {
    expect(REVIEW_SYSTEM).toMatch(/contradict each other only\s+if both cannot be true/);
    expect(REVIEW_SYSTEM).toMatch(/never because it is adverse to a party/);
    expect(REVIEW_SYSTEM).toMatch(/do not summarise the case/);
  });
});
