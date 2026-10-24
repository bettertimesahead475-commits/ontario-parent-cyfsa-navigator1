// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { apiFetch } from "../utils/api";
import { ParentAttributionSection } from "./ParentAttributionPanel";

vi.mock("../utils/api", () => ({
  apiFetch: vi.fn(),
  safeReadJson: async (response: { json: () => Promise<unknown> }) => response.json(),
}));

const OPTIONS = {
  parties: [
    { partyId: "P-A", partyName: "Parent A", roles: ["RESPONDENT"] },
    { partyId: "P-B", partyName: "Parent B", roles: ["RESPONDENT"] },
  ],
  proceedings: [
    { proceedingId: "PROC-1", fileNumber: "FC-24-0001" },
    { proceedingId: "PROC-2", fileNumber: "FC-25-0042" },
  ],
  pairs: [
    { partyId: "P-A", proceedingId: "PROC-1" },
    { partyId: "P-B", proceedingId: "PROC-1" },
    { partyId: "P-B", proceedingId: "PROC-2" },
  ],
  selectionRequired: true,
};

function viewFor(partyId: string, proceedingId: string, allegations: unknown[]) {
  return {
    jobId: "req_1_abc",
    selection: { proceedingId, partyId },
    view: {
      proceedingId,
      fileNumber: proceedingId === "PROC-1" ? "FC-24-0001" : "FC-25-0042",
      partyId,
      partyName: partyId === "P-A" ? "Parent A" : "Parent B",
      roles: ["RESPONDENT"],
      specificAllegations: allegations,
      sharedAllegations: [],
      unattributedAllegations: [],
      relatedOrders: [],
      issues: [],
      otherProceedingIds: [],
    },
    drafting: { status: "NOT_ACTIVATED", blockedBy: [] },
  };
}

const ALG_A = {
  id: "ALG-1",
  kind: "ALLEGATION",
  text: "Left the child alone overnight.",
  madeBy: "Applicant",
  status: "UNRESOLVED",
  classification: "HEARSAY",
  source: { documentId: "doc-1", page: 1, paragraph: "12", quote: "Parent A left the child alone overnight on two occasions." },
};

const ALG_B = {
  id: "ALG-2",
  kind: "ALLEGATION",
  text: "Missed access visits.",
  madeBy: "Applicant",
  status: "UNRESOLVED",
  classification: "DOCUMENTARY",
  source: { documentId: "doc-2", page: 1, paragraph: "4", quote: "Parent B missed three scheduled access visits without notice." },
};

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const REPORT = { parentViewJobId: "req_1_abc" };
const ALL_CHOICES = json(200, { jobId: "req_1_abc", selection: null, options: OPTIONS });

const mockFetch = vi.fn();
const fetcher = mockFetch as unknown as typeof apiFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ParentAttributionSection gating", () => {
  it("renders nothing while the client flag is OFF", () => {
    const { container } = render(<ParentAttributionSection report={REPORT} enabled={false} fetcher={fetcher} />);
    expect(container.innerHTML).toBe("");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("renders nothing when the report has no parent view job", () => {
    const { container } = render(<ParentAttributionSection report={{}} enabled fetcher={fetcher} />);
    expect(container.innerHTML).toBe("");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("renders nothing when the server reports no parent analysis", async () => {
    mockFetch.mockResolvedValueOnce(json(404, { code: "NO_PARENT_ANALYSIS" }));
    const { container } = render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});

describe("parent and proceeding selection", () => {
  it("lists the choices and shows no view until the user chooses one", async () => {
    mockFetch.mockResolvedValueOnce(ALL_CHOICES);
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    expect(await screen.findByRole("group", { name: "Which parent and case?" })).toBeTruthy();
    expect((screen.getByLabelText("Parent A, case FC-24-0001") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Show this parent's view" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/analyze/job/req_1_abc/parent-view");
  });

  it("loads only the chosen parent and case and shows that parent's allegation with its citation", async () => {
    mockFetch.mockResolvedValueOnce(ALL_CHOICES).mockResolvedValueOnce(json(200, viewFor("P-A", "PROC-1", [ALG_A])));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    fireEvent.click(await screen.findByLabelText("Parent A, case FC-24-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    expect(await screen.findByText("Left the child alone overnight.")).toBeTruthy();
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/analyze/job/req_1_abc/parent-view?proceedingId=PROC-1&partyId=P-A",
    );
    expect(screen.getByText("Citation: paragraph 12, page 1")).toBeTruthy();
    expect(screen.getByText(/Parent A left the child alone overnight on two occasions\./)).toBeTruthy();
  });

  it("shows an allegation as an allegation (not a court finding) when the record is an ALLEGATION", async () => {
    mockFetch.mockResolvedValueOnce(ALL_CHOICES).mockResolvedValueOnce(json(200, viewFor("P-A", "PROC-1", [ALG_A])));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    fireEvent.click(await screen.findByLabelText("Parent A, case FC-24-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    await screen.findByText("Left the child alone overnight.");
    expect(screen.queryByText(/Court finding/)).toBeNull();
    expect(screen.getByText(/Allegation · Not yet decided · Second-hand account/)).toBeTruthy();
  });

  it("labels a record as a court finding only when the record itself is a FINDING", async () => {
    const FINDING = { ...ALG_A, id: "ALG-F", kind: "FINDING", text: "The court found the child was left alone." };
    mockFetch.mockResolvedValueOnce(ALL_CHOICES).mockResolvedValueOnce(json(200, viewFor("P-A", "PROC-1", [FINDING])));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    fireEvent.click(await screen.findByLabelText("Parent A, case FC-24-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    await screen.findByText("The court found the child was left alone.");
    expect(screen.getByText(/Court finding, as stated in the document/)).toBeTruthy();
  });

  it("switching to another parent replaces the view and never keeps the earlier parent's allegations", async () => {
    mockFetch
      .mockResolvedValueOnce(ALL_CHOICES)
      .mockResolvedValueOnce(json(200, viewFor("P-A", "PROC-1", [ALG_A])))
      .mockResolvedValueOnce(json(200, viewFor("P-B", "PROC-2", [ALG_B])));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    fireEvent.click(await screen.findByLabelText("Parent A, case FC-24-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    await screen.findByText("Left the child alone overnight.");

    fireEvent.click(screen.getByLabelText("Parent B, case FC-25-0042"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    expect(await screen.findByText("Missed access visits.")).toBeTruthy();
    expect(screen.queryByText("Left the child alone overnight.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Parent B, case FC-25-0042" })).toBeTruthy();
  });

  it("shows a single parent's view without asking for a choice when only one pair exists", async () => {
    mockFetch
      .mockResolvedValueOnce(json(200, { jobId: "req_1_abc", selection: null, options: { ...OPTIONS, pairs: [OPTIONS.pairs[0]], selectionRequired: false } }))
      .mockResolvedValueOnce(json(200, viewFor("P-A", "PROC-1", [ALG_A])));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    expect(await screen.findByText("Left the child alone overnight.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Which parent and case?" })).toBeNull();
  });

  it("shows a clear error and no view when the chosen view cannot be loaded", async () => {
    mockFetch
      .mockResolvedValueOnce(ALL_CHOICES)
      .mockResolvedValueOnce(json(400, { code: "NOT_A_VALID_CHOICE" }));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    fireEvent.click(await screen.findByLabelText("Parent A, case FC-24-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This view could not be loaded.");
    expect(screen.queryByText(/Allegations about this parent/)).toBeNull();
  });

  it("states that drafting is not available and offers no drafting action", async () => {
    mockFetch.mockResolvedValueOnce(ALL_CHOICES).mockResolvedValueOnce(json(200, viewFor("P-A", "PROC-1", [ALG_A])));
    render(<ParentAttributionSection report={REPORT} enabled fetcher={fetcher} />);
    fireEvent.click(await screen.findByLabelText("Parent A, case FC-24-0001"));
    fireEvent.click(screen.getByRole("button", { name: "Show this parent's view" }));
    await screen.findByText("Left the child alone overnight.");
    expect(screen.getByText("Drafting a Form 33B or a Plan of Care is not available yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /draft/i })).toBeNull();
  });
});
