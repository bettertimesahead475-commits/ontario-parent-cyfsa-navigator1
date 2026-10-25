import { describe, expect, it } from "vitest";
import { buildParentReportView } from "./parentReportView";

// A quote from text that was not authenticated against the original file must not be presented as the record.
describe("parent view: quote provenance", () => {
  const flag = (extra: Record<string, unknown>) => ({
    id: "rf1",
    phraseDetected: "the child appeared unwell",
    explanation: "x",
    legalReference: "",
    ...extra,
  });

  it("says a quote from unauthenticated text is not confirmed as record evidence", () => {
    const view = buildParentReportView({
      redFlags: [flag({ quoteVerified: null, quoteVerification: "UNAUTHENTICATED_SOURCE" })],
    });
    const what = view.findings[0].whatHappened;
    expect(what).toContain("not verified against your original file");
    expect(what).not.toContain("The record says");
  });

  it("still presents a verified quote as the record's words", () => {
    const view = buildParentReportView({
      redFlags: [flag({ quoteVerified: true, quoteVerification: "EXACT" })],
    });
    expect(view.findings[0].whatHappened).toContain("The record says");
  });
});
