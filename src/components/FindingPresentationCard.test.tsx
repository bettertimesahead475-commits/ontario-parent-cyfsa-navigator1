// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FindingPresentationCard } from "./FindingPresentationCard";

afterEach(() => {
  cleanup();
});

describe("FindingPresentationCard component", () => {
  const sampleFlag = {
    id: "rf-1",
    severity: "Affects Evidentiary Weight",
    category: "Hearsay",
    evidenceClassification: "HEARSAY",
    phraseDetected: "The worker was informed by an anonymous caller that the child was left unattended.",
    explanation: "This is a secondhand out-of-court statement without firsthand corroboration.",
    verifyRequirement: "Request contemporaneous intake notes.",
    legalReference: "CYFSA s. 74(2)",
    locationInDocument: "Page 3, Paragraph 10",
    quoteLocation: { page: 3, startOffset: 100, endOffset: 185 },
    parentActionStep: "Instruct counsel to object under Family Law Rule 14(18).",
  };

  const defaultProps = {
    flag: sampleFlag,
    idx: 0,
    narrationActive: false,
    factCheckEnabled: false,
    openLegislativeReference: vi.fn(),
    setSearchQuery: vi.fn(),
  };

  it("renders the finding card with quote, locator, and badges", () => {
    render(<FindingPresentationCard {...defaultProps} />);
    expect(screen.getByText(sampleFlag.phraseDetected, { exact: false })).toBeDefined();
    expect(screen.getByText("Affects Evidentiary Weight")).toBeDefined();
    expect(screen.getByText("Hearsay")).toBeDefined();
    expect(screen.getByText(/Page 3, Paragraph 10/i)).toBeDefined();
  });

  it("defaults to Educational Legal Analysis mode", () => {
    render(<FindingPresentationCard {...defaultProps} />);
    expect(screen.getByRole("tab", { name: /Educational Legal Analysis/i })).toBeDefined();
    expect(screen.getByText(/What the Document Evidence Establishes:/i)).toBeDefined();
    expect(screen.getByText(/What Ontario Law Requires:/i)).toBeDefined();
    expect(screen.getByText(/Missing Evidence Required to Conclusively Resolve:/i)).toBeDefined();
  });

  it("switches to Courtroom-Style Legal Presentation mode on tab click", () => {
    render(<FindingPresentationCard {...defaultProps} />);
    const courtroomTab = screen.getByRole("tab", { name: /Courtroom-Style Legal Presentation/i });
    fireEvent.click(courtroomTab);

    expect(screen.getByText(/Formal Ontario Family Court Submissions/i)).toBeDefined();
    expect(screen.getByText(/Courtroom Oral Submission Example:/i)).toBeDefined();
    expect(screen.getAllByText(/Your Honour/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Legal Authority & Jurisprudential Application:/i)).toBeDefined();
  });

  it("expands the 'What Can This Finding Be Used For?' section with Ontario Court Forms connection", () => {
    render(<FindingPresentationCard {...defaultProps} />);
    const expandButton = screen.getByText(/What Can This Finding Be Used For\?/i);
    fireEvent.click(expandButton);

    expect(screen.getByText(/1. Cross-Examination Questions/i)).toBeDefined();
    expect(screen.getByText(/2. Evidentiary Objections on Weight/i)).toBeDefined();
    expect(screen.getByText(/3. Targeted Disclosure Demands/i)).toBeDefined();
    expect(screen.getByText(/Official Ontario Court Forms Education Connection/i)).toBeDefined();
    expect(screen.getAllByText(/Form 14A/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Educational guidance only/i)).toBeDefined();
  });

  it("calls openLegislativeReference when clicking statute reference button", () => {
    render(<FindingPresentationCard {...defaultProps} />);
    const statuteBtn = screen.getByText(/Statute reference: CYFSA s. 74\(2\)/i);
    fireEvent.click(statuteBtn);
    expect(defaultProps.openLegislativeReference).toHaveBeenCalledWith("CYFSA s. 74(2)");
  });

  it("calls setSearchQuery when clicking Locate Phrase button", () => {
    render(<FindingPresentationCard {...defaultProps} />);
    const locateBtn = screen.getByText(/Locate Phrase/i);
    fireEvent.click(locateBtn);
    expect(defaultProps.setSearchQuery).toHaveBeenCalledWith(sampleFlag.phraseDetected);
  });
});
