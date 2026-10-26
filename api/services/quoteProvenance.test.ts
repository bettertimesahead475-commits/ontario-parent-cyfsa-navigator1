import { describe, expect, it } from "vitest";
import { applyReportGuards, UNAUTHENTICATED_QUOTE_STATUS } from "./analyzerSections.js";

// A quote is documentary evidence only when the server-authenticated page text contains it. Text supplied with the
// request is not, so it can never produce a "verified" result.

const PAGES = new Map<number, string>([
  [1, "The worker said the child appeared unwell at school on Monday."],
  [2, "The affidavit states the visit was unannounced."],
]);

function flag(phrase: string) {
  return { id: "rf1", phraseDetected: phrase, legalReference: "", locationInDocument: "Page 1" };
}

describe("quote provenance", () => {
  it("reports a quote as verified only when the authenticated page text contains it", () => {
    const report: Record<string, any> = { redFlags: [flag("appeared unwell at school")] };
    applyReportGuards(report, PAGES);
    expect(report.sourceProvenance).toBe("authenticated_pages");
    expect(report.redFlags[0].quoteVerified).toBe(true);
    expect(report.redFlags[0].quoteVerification).toBe("EXACT");
  });

  it("reports a quote absent from the authenticated pages as not found", () => {
    const report: Record<string, any> = { redFlags: [flag("the child was locked in a room")] };
    applyReportGuards(report, PAGES);
    expect(report.redFlags[0].quoteVerified).toBe(false);
    expect(report.redFlags[0].quoteVerification).toBe("ABSENT");
  });

  it("never reports a quote as verified when there are no authenticated pages", () => {
    for (const sourcePages of [null, new Map<number, string>()]) {
      const report: Record<string, any> = { redFlags: [flag("appeared unwell at school")] };
      applyReportGuards(report, sourcePages);
      expect(report.sourceProvenance).toBe("pasted_text");
      expect(report.redFlags[0].quoteVerified).toBeNull();
      expect(report.redFlags[0].quoteVerification).toBe(UNAUTHENTICATED_QUOTE_STATUS);
    }
  });

  it("does not let a quote pass that is found only outside the authenticated pages", () => {
    // Client-typed text beside an uploaded file is not in the page map, so it cannot verify a quote.
    const report: Record<string, any> = { redFlags: [flag("this sentence was typed by the client")] };
    applyReportGuards(report, PAGES);
    expect(report.redFlags[0].quoteVerified).toBe(false);
    expect(report.redFlags[0].quoteVerification).toBe("ABSENT");
  });
});

describe("pasted text is labelled as a text match, never as documentary proof", () => {
  it("records a match against the pasted text separately and keeps the documentary check unverified", () => {
    const report: Record<string, any> = { redFlags: [flag("appeared unwell at school")] };
    applyReportGuards(report, null, "The child appeared unwell at school on Monday.");
    expect(report.sourceProvenance).toBe("pasted_text");
    expect(report.redFlags[0].pastedTextMatch).toBe(true);
    expect(report.redFlags[0].quoteVerified).toBeNull();
    expect(report.redFlags[0].quoteVerification).toBe(UNAUTHENTICATED_QUOTE_STATUS);
  });

  it("reports no pasted-text match when the pasted text does not contain the quote", () => {
    const report: Record<string, any> = { redFlags: [flag("the child was locked in a room")] };
    applyReportGuards(report, null, "Something else entirely.");
    expect(report.redFlags[0].pastedTextMatch).toBe(false);
    expect(report.redFlags[0].quoteVerified).toBeNull();
  });

  it("does not compare a quote with pasted text when none was given", () => {
    const report: Record<string, any> = { redFlags: [flag("appeared unwell at school")] };
    applyReportGuards(report, null);
    expect(report.redFlags[0].pastedTextMatch).toBeNull();
  });

  it("a pasted-text match never makes a documentary check pass when authenticated pages exist", () => {
    const report: Record<string, any> = { redFlags: [flag("this sentence was typed by the client")] };
    applyReportGuards(report, PAGES, "this sentence was typed by the client");
    expect(report.sourceProvenance).toBe("authenticated_pages");
    expect(report.redFlags[0].quoteVerified).toBe(false);
    expect(report.redFlags[0].pastedTextMatch).toBeNull();
  });
});
