// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { InteractiveFindingsTabs } from "./InteractiveFindingsTabs";
import { buildFindingsExportHtml, buildLawyerQuestionListHtml } from "../../utils/findingsExport";
import { resolveInteractiveFindings, mergeInteractiveFindings, deriveLegacyFindings, parseLegacyQuestion } from "../../../shared/legalFindings";

afterEach(cleanup);

const ev = (quote: string, verified: boolean) => ({ quote, locationInDocument: "p.2 para 3", sourceDocument: "Affidavit.pdf", quoteCheck: verified ? "EXACT" : "ABSENT", quoteVerified: verified } as const);
const auth = (over: any = {}) => ({ key: "charter-s8", kind: "CHARTER", citation: "Charter, s. 8", title: "Search and seizure", status: "CANDIDATE", urlStatus: "UNCHECKED", url: "https://laws-lois.justice.gc.ca/eng/const/page-12.html", ...over });
const base = (id: string, over: any = {}) => ({ id, title: `Title ${id}`, plainLanguage: `Plain ${id}`, whyItMatters: `Matters ${id}`, evidence: [ev("entered without a warrant", true), ev("invented words", false)], contraryEvidence: `Contrary ${id}`, missingInformation: [`Info ${id}`], verificationSteps: [`Step ${id}`], questionsForCounsel: [], authorities: [auth()], relatedIds: [], ...over });

const structured = {
  schemaVersion: 1,
  charter: [{ ...base("ch-1"), section: "8", assessment: "POTENTIAL_CONCERN", stateAction: "Worker entry", affectedRight: "Privacy", legalTest: "Reasonable expectation of privacy", missingLegalElements: ["Whether consent was given"], remediesForCounsel: "Exclusion?" }],
  verification: [{ ...base("vc-1"), claim: "A warrant existed", sourceDocument: "Affidavit.pdf", supportingPassage: ev("a warrant was shown", true), method: "Compared against the affidavit", result: "INCONCLUSIVE", resultNote: "Changed from VERIFIED", missingEvidence: "The warrant", nextAction: "Ask for it" }],
  missing: [{ ...base("ms-1"), item: "Copy of the warrant", dependsOn: "Question 1", absenceStatus: "NOT_IN_UPLOADED_MATERIALS", absenceBasis: "Not in the upload.", nextSteps: ["Request disclosure"] }],
  lawyerQuestions: [{ ...base("q-1"), question: "Was the entry lawful?", whatLawyerAssesses: "Consent and authority", documentsToBring: ["The affidavit"], linkedType: "charter", linkedFindingId: "ch-1" }],
  sectionStatus: { charter: { state: "GENERATED" }, verification: { state: "GENERATED" }, missing: { state: "GENERATED" }, lawyerQuestions: { state: "GENERATED" } },
  authoritySummary: { registryVersion: "x", lastRetrievalCheckAt: null, verifiedCount: 0, candidateCount: 1, unverifiedCount: 0, limitation: "No retrieval check has been recorded." },
};
const report = { redFlags: [], interactiveFindings: structured };

describe("InteractiveFindingsTabs", () => {
  it("renders four tabs with the Charter tab selected and only its panel mounted", () => {
    render(<InteractiveFindingsTabs report={report} scope="t" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByText("A warrant existed")).toBeNull(); // lazy: other panels are not mounted
    expect(screen.getByTestId("authority-limitation").textContent).toMatch(/No retrieval check/);
  });

  it("expands and collapses a finding, mounting its body only while open", () => {
    render(<InteractiveFindingsTabs report={report} scope="t" />);
    const btn = screen.getByRole("button", { name: /Charter s\. 8/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Reasonable expectation of privacy")).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Reasonable expectation of privacy")).toBeTruthy();
    expect(screen.getByText("Whether consent was given")).toBeTruthy();
    expect(screen.getByText(/not an established violation/i, { selector: "span" })).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByText("Reasonable expectation of privacy")).toBeNull();
  });

  it("labels quotations as found or not found word-for-word", () => {
    render(<InteractiveFindingsTabs report={report} scope="t" />);
    fireEvent.click(screen.getByRole("button", { name: /Charter s\. 8/ }));
    expect(screen.getAllByText("Quotation found in the document").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not found word-for-word in the document").length).toBeGreaterThan(0);
  });

  it("shows an unchecked link as 'not yet checked', withholds a broken link, and never links free-text references", () => {
    const r = { ...report, interactiveFindings: { ...structured, charter: [{ ...structured.charter[0], authorities: [auth(), auth({ key: "x", citation: "Broken s. 1", urlStatus: "BROKEN" }), { kind: "OTHER", citation: "Re Made Up (2019)", title: "Re Made Up (2019)", status: "UNVERIFIED", urlStatus: "NONE" }] }] } };
    render(<InteractiveFindingsTabs report={r} scope="t" />);
    fireEvent.click(screen.getByRole("button", { name: /Charter s\. 8/ }));
    const cards = screen.getAllByTestId("authority-card");
    expect(within(cards[0]).getByText(/link not yet checked/)).toBeTruthy();
    expect(within(cards[0]).getByText(/Candidate authority/)).toBeTruthy();
    expect(within(cards[1]).queryByRole("link")).toBeNull();
    expect(within(cards[1]).getByText(/withheld/)).toBeTruthy();
    expect(within(cards[2]).queryByRole("link")).toBeNull();
    expect(within(cards[2]).getByText(/Unverified legal reference/)).toBeTruthy();
    expect(within(cards[0]).getByRole("link").getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("switches tabs with the mouse and the keyboard (arrows, Home, End) using a roving tabindex", async () => {
    render(<InteractiveFindingsTabs report={report} scope="t" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("A warrant existed")).toBeTruthy();
    fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "End" });
    expect(screen.getAllByRole("tab")[3].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getAllByRole("tab")[3], { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowLeft" });
    expect(screen.getAllByRole("tab")[3].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getAllByRole("tab")[3], { key: "Home" });
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
  });

  it("verification, missing and question tabs show their required fields", () => {
    render(<InteractiveFindingsTabs report={report} scope="t" initialTab="verification" />);
    fireEvent.click(screen.getByRole("button", { name: /A warrant existed/ }));
    for (const t of ["Compared against the affidavit", "Changed from VERIFIED", "The warrant", "Ask for it", "Supporting passage"]) expect(screen.getAllByText(new RegExp(t)).length).toBeGreaterThan(0);
    cleanup();
    render(<InteractiveFindingsTabs report={report} scope="t" initialTab="missing" />);
    expect(screen.getByText(/not proof that it does not exist/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy of the warrant/ }));
    expect(screen.getByText("Request disclosure")).toBeTruthy();
    expect(screen.getByText("Not in the uploaded materials")).toBeTruthy();
  });

  it("copies a single lawyer question and offers a consolidated print", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onPrint = vi.fn();
    render(<InteractiveFindingsTabs report={report} scope="t" initialTab="lawyerQuestions" onPrintQuestions={onPrint} />);
    fireEvent.click(screen.getByRole("button", { name: /Was the entry lawful/ }));
    expect(screen.getByText(/Linked: Title ch-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy this question" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toMatch(/Was the entry lawful\?/);
    fireEvent.click(screen.getByRole("button", { name: /Print all questions/ }));
    expect(onPrint).toHaveBeenCalled();
  });

  it("shows empty states and an unavailable section reason", () => {
    const r = { interactiveFindings: { ...structured, charter: [], missing: [], sectionStatus: { ...structured.sectionStatus, charter: { state: "GENERATED" }, missing: { state: "UNAVAILABLE", reason: "This part could not be generated (timeout)." } } } };
    render(<InteractiveFindingsTabs report={r} scope="t" />);
    expect(screen.getByTestId("empty-findings").textContent).toMatch(/No Charter issue/);
    fireEvent.click(screen.getAllByRole("tab")[2]);
    // UNAVAILABLE with no legacy text: the reason is shown, not an empty list
    expect(screen.getByText(/could not be generated \(timeout\)/)).toBeTruthy();
  });

  it("renders a legacy saved report from its string arrays with an explicit note", () => {
    const legacy = {
      charterAndHumanRightsIssues: ["Section 8 Charter: a search of the home without a warrant may be a concern."],
      whatToVerify: ["Check the apprehension date"],
      whatIsMissing: ["The signed warrant"],
      whatToAskALawyer: ["Question: Was the entry lawful? | What the uploaded record shows: no warrant | Still unknown: consent | Source: p.3"],
    };
    render(<InteractiveFindingsTabs report={legacy} scope="t" />);
    expect(screen.getByTestId("legacy-note").textContent).toMatch(/Basic list only/);
    expect(screen.getByRole("button", { name: /Charter s\. 8/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("tab")[3]);
    fireEvent.click(screen.getByRole("button", { name: /Was the entry lawful/ }));
    expect(screen.getByText("no warrant")).toBeTruthy();
    expect(screen.getByText("consent")).toBeTruthy();
  });

  it("handles a report with no findings at all", () => {
    render(<InteractiveFindingsTabs report={{}} scope="t" />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByTestId("empty-findings")).toBeTruthy();
  });
});

describe("export is independent of UI state", () => {
  it("contains every finding, citation, explanation and question without any tab being opened", () => {
    const html = buildFindingsExportHtml(report);
    for (const t of ["Charter s. 8", "Reasonable expectation of privacy", "A warrant existed", "Copy of the warrant", "Was the entry lawful?", "Charter, s. 8", "Candidate authority - not yet verified", "No retrieval check has been recorded.", "Plain ch-1", "Matters q-1", "Contrary vc-1", "Consent and authority", "The affidavit", "not an established violation"]) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain("Not found word-for-word in the document");
  });
  it("escapes document-influenced text", () => {
    const evil = { interactiveFindings: { ...structured, missing: [{ ...structured.missing[0], item: "<img src=x onerror=alert(1)>" }] } };
    const html = buildFindingsExportHtml(evil);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
  it("withholds broken links in the export too", () => {
    const r = { interactiveFindings: { ...structured, verification: [], missing: [], lawyerQuestions: [], charter: [{ ...structured.charter[0], authorities: [auth({ urlStatus: "BROKEN" })] }] } };
    expect(buildFindingsExportHtml(r)).not.toContain("laws-lois.justice.gc.ca");
  });
  it("builds a consolidated question list", () => {
    const html = buildLawyerQuestionListHtml(report);
    expect(html).toContain("Was the entry lawful?");
    expect(html).toContain("The affidavit");
    expect(html).toMatch(/not legal advice/);
  });
  it("exports legacy reports from their string arrays", () => {
    const html = buildFindingsExportHtml({ whatToVerify: ["Check the date"], whatIsMissing: ["Signed warrant"] });
    expect(html).toContain("Check the date");
    expect(html).toContain("Signed warrant");
    expect(html).toContain("Basic list only");
  });
});

describe("shared helpers", () => {
  it("parses the legacy question format without inventing fields", () => {
    expect(parseLegacyQuestion("Question: Q? | Still unknown: X")).toEqual({ question: "Q?", stillUnknown: "X" });
    expect(parseLegacyQuestion("Just a plain question")).toEqual({ question: "Just a plain question" });
  });
  it("falls back per section when a section is UNAVAILABLE", () => {
    const r = { whatToVerify: ["Legacy verify"], interactiveFindings: { ...structured, verification: [], sectionStatus: { ...structured.sectionStatus, verification: { state: "UNAVAILABLE", reason: "r" } } } };
    const f = resolveInteractiveFindings(r);
    expect(f.verification[0].legacy).toBe(true);
    expect(f.sectionStatus.verification.state).toBe("LEGACY");
    expect(f.charter[0].id).toBe("ch-1");
  });
  it("merges quick and deep findings, keeping the earlier structured section when the later one failed", () => {
    const deep: any = { ...structured, charter: [], sectionStatus: { ...structured.sectionStatus, charter: { state: "UNAVAILABLE", reason: "x" } } };
    const merged = mergeInteractiveFindings(structured as any, deep)!;
    expect(merged.charter).toHaveLength(1);
    expect(merged.sectionStatus.charter.state).toBe("GENERATED");
    expect(mergeInteractiveFindings(undefined, deep)).toBe(deep);
    expect(mergeInteractiveFindings(structured as any, undefined)).toBe(structured);
  });
  it("derives nothing from an empty report", () => {
    expect(deriveLegacyFindings(null).charter).toEqual([]);
  });
});
