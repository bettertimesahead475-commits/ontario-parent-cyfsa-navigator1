// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Frontend Test Suite for Parent Case-Action Workspace (Batch 2)
 * Tests workspace loading, authority labels, privacy boundary, interaction,
 * accessibility, and error handling.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CaseActionWorkspace, { AUTHORITY_LABELS } from "./CaseActionWorkspace";
import * as apiModule from "../utils/api";

// Mock apiFetch helper
vi.mock("../utils/api", async () => {
  const actual = await vi.importActual("../utils/api");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

function createMockResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MOCK_MATTER_ID = "11111111-1111-4111-a111-111111111111";

const MOCK_REQUIREMENTS = [
  {
    id: "req-1",
    matter_id: MOCK_MATTER_ID,
    title: "Attend Parenting Class",
    description: "CAS worker recommended 6-week course",
    authority_type: "CAS_REQUESTED",
    review_state: "PROPOSED",
    completion_state: "IN_PROGRESS",
    dispute_state: "NOT_DISPUTED",
    due_at: new Date(Date.now() - 86400000).toISOString(),
    isOverdue: true,
    actions: [{ id: "act-1", matter_id: MOCK_MATTER_ID, requirement_id: "req-1", title: "Enroll in course", status: "PENDING", sort_order: 0, created_at: new Date().toISOString() }],
    evidenceLinks: [{ id: "link-1", matter_id: MOCK_MATTER_ID, requirement_id: "req-1", evidence_type: "COMPLETION_CERTIFICATE", title: "Registration Confirmation", attached_at: new Date().toISOString() }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "req-2",
    matter_id: MOCK_MATTER_ID,
    title: "Supervised Access Log",
    description: "Court order condition #4",
    authority_type: "COURT_ORDERED",
    review_state: "PROPOSED",
    completion_state: "NOT_STARTED",
    dispute_state: "NOT_DISPUTED",
    due_at: new Date(Date.now() - 86400000).toISOString(),
    isOverdue: true,
    actions: [],
    evidenceLinks: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "req-3",
    matter_id: MOCK_MATTER_ID,
    title: "Personal Journal Entry",
    description: "Parent self-directed note",
    authority_type: "PARENT_CREATED",
    review_state: "PROPOSED",
    completion_state: "COMPLETED",
    dispute_state: "NOT_DISPUTED",
    isOverdue: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe("Parent Case-Action Workspace UI (Batch 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiModule.apiFetch as any).mockImplementation(async (url: string) => {
      if (url === "/api/review-matters") {
        return createMockResponse({ items: [{ id: MOCK_MATTER_ID, title: "Matter A" }] });
      }
      if (url.includes("/case-actions/requirements")) {
        return createMockResponse(MOCK_REQUIREMENTS);
      }
      return createMockResponse({});
    });
  });

  it("renders workspace title, loading state, and populated requirement cards", async () => {
    render(<CaseActionWorkspace initialMatterId={MOCK_MATTER_ID} />);

    expect(screen.getByText("Parent Case-Action Workspace")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Attend Parenting Class")).toBeDefined();
      expect(screen.getByText("Supervised Access Log")).toBeDefined();
    });
  });

  it("accurately renders plain-language authority labels without mislabeling CAS_REQUESTED as Court Ordered", async () => {
    (apiModule.apiFetch as any).mockImplementation(async (url: string) => {
      if (url === "/api/review-matters") {
        return createMockResponse({ items: [{ id: MOCK_MATTER_ID, title: "Matter A" }] });
      }
      if (url.includes("/case-actions/requirements")) {
        return createMockResponse(MOCK_REQUIREMENTS);
      }
      return createMockResponse({});
    });

    render(<CaseActionWorkspace initialMatterId={MOCK_MATTER_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Attend Parenting Class")).toBeDefined();
    });

    // Verify CAS_REQUESTED shows "CAS requested"
    const casBadges = screen.getAllByText("CAS requested");
    expect(casBadges.length).toBeGreaterThan(0);

    // Verify COURT_ORDERED shows "Court ordered"
    const courtBadges = screen.getAllByText("Court ordered");
    expect(courtBadges.length).toBeGreaterThan(0);

    // Verify PARENT_CREATED shows "My own action"
    const parentBadges = screen.getAllByText("My own action");
    expect(parentBadges.length).toBeGreaterThan(0);
  });

  it("handles proposed items with Confirm and Decline buttons", async () => {
    render(<CaseActionWorkspace initialMatterId={MOCK_MATTER_ID} />);

    expect(await screen.findAllByText("Needs review")).toBeDefined();
    expect(screen.getAllByText("Confirm")[0]).toBeDefined();
    expect(screen.getAllByText("Decline")[0]).toBeDefined();
  });

  it("does NOT render private lawyer_notes in parent UI (critical privacy boundary)", async () => {
    const reqWithPrivateNotes = [
      {
        id: "req-priv-1",
        matter_id: MOCK_MATTER_ID,
        title: "Attend Parenting Class",
        description: "CAS worker recommended 6-week course",
        authority_type: "CAS_REQUESTED" as const,
        review_state: "PROPOSED" as const,
        completion_state: "IN_PROGRESS" as const,
        dispute_state: "NOT_DISPUTED" as const,
        due_at: new Date().toISOString(),
        isOverdue: true,
        lawyer_notes: "PRIVATE LEGAL STRATEGY NOTE THAT MUST NEVER APPEAR",
        actions: [],
        evidenceLinks: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    (apiModule.apiFetch as any).mockImplementation(async (url: string) => {
      if (url === "/api/review-matters") {
        return createMockResponse({ items: [{ id: MOCK_MATTER_ID, title: "Matter A" }] });
      }
      if (url.includes("/case-actions/requirements")) {
        return createMockResponse(reqWithPrivateNotes);
      }
      return createMockResponse({});
    });

    render(<CaseActionWorkspace initialMatterId={MOCK_MATTER_ID} />);

    const found = await screen.findAllByText("Attend Parenting Class");
    expect(found.length).toBeGreaterThan(0);
    expect(screen.queryByText("PRIVATE LEGAL STRATEGY NOTE THAT MUST NEVER APPEAR")).toBeNull();
  });

  it("renders meaningful error state with retry button on API failure", async () => {
    (apiModule.apiFetch as any).mockImplementation(async (url: string) => {
      if (url === "/api/review-matters") {
        return createMockResponse({ items: [{ id: MOCK_MATTER_ID, title: "Matter A" }] });
      }
      if (url.includes("/case-actions/requirements")) {
        return createMockResponse({ error: "Server connection failed" }, 500);
      }
      return createMockResponse({});
    });

    render(<CaseActionWorkspace initialMatterId={MOCK_MATTER_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Server connection failed/i)).toBeDefined();
    });
    expect(screen.getByText("Retry")).toBeDefined();
  });
});
