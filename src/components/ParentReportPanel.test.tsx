// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { ParentReportPanel, ParentReportSection } from "./ParentReportPanel";

const REPORT = {
  documentType: "Court Affidavit",
  fileSummary: "The affidavit describes the visit on March 2.",
  whatIsMissing: ["The attached exhibit was not in the upload."],
  whatToVerify: ["Compare the visit date with the society notes."],
  whatToAskALawyer: ["Does the visit date match the notes?"],
  gaps: ["The first pass did not check the five-day deadline."],
  missingEvidence: ["The hearing notice."],
  retorts: [{ claim: "The parent missed the visit.", objection: "No record shows a missed visit.", action: "Ask counsel for the visit log." }],
  redFlags: [
    {
      id: "rf1",
      category: "Hearsay Reliance",
      severity: "Worth Raising With Counsel",
      evidenceClassification: "HEARSAY",
      phraseDetected: "The worker was told by a neighbour that the parent was drinking.",
      explanation: "The statement relies on a second-hand account.",
      verifyRequirement: "Obtain the neighbour's statement.",
      legalReference: "CYFSA s. 74",
      citationStatus: "UNVERIFIED",
      parentActionStep: "Ask who saw the drinking.",
    },
  ],
};

describe("ParentReportPanel", () => {
  afterEach(cleanup);

  it("shows the seven parent summary sections in order", () => {
    render(<ParentReportPanel report={REPORT} />);
    const headings = Array.from(document.querySelectorAll("section h3"))
      .map((h) => h.textContent ?? "")
      .filter((t) => /^\d\. /.test(t));
    expect(headings).toHaveLength(7);
    expect(headings[0]).toMatch(/^1\. /);
    expect(headings[6]).toMatch(/^7\. /);
  });

  it("states the evidence label and the unverified citation on a finding, without the raw enum", () => {
    render(<ParentReportPanel report={REPORT} />);
    const summary = screen.getByText("Hearsay Reliance");
    expect(summary.closest("details")?.textContent).toMatch(/Second-hand \(hearsay\)/);
    expect(summary.closest("details")?.textContent).not.toMatch(/HEARSAY/);
    expect(summary.closest("details")?.textContent).toMatch(/[Uu]nverified/);
  });

  it("shows the Deep Scan gaps, evidence to gather, and retorts", () => {
    const { container } = render(<ParentReportPanel report={REPORT} />);
    expect(container.textContent).toMatch(/five-day deadline/);
    expect(container.textContent).toMatch(/The hearing notice/);
    expect(container.textContent).toMatch(/parent missed the visit/);
  });

  it("says there is no finding when the analyzer raised none", () => {
    render(<ParentReportPanel report={{ ...REPORT, redFlags: [] }} />);
    expect(screen.getByText(/raised no points/)).toBeTruthy();
  });

  it("does not present the title as proof of legal effect", () => {
    const { container } = render(<ParentReportPanel report={{ ...REPORT, documentType: "Final Court Order" }} />);
    expect(container.textContent).not.toMatch(/has legal effect/);
    expect(container.textContent).toMatch(/title alone does not show/);
  });
});

describe("ParentReportSection gate", () => {
  afterEach(cleanup);

  it("renders nothing when the parent report flag is off", () => {
    const { container } = render(<ParentReportSection report={REPORT} enabled={false} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText(/seven|Summary/i)).toBeNull();
  });

  it("renders the panel when the flag is on", () => {
    render(<ParentReportSection report={REPORT} enabled={true} />);
    expect(screen.getByText(/1\. What is this document\?/)).toBeTruthy();
  });
});
