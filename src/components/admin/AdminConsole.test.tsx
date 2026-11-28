// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
vi.mock("../../utils/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AdminConsole from "./AdminConsole";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("AdminConsole", () => {
  beforeEach(() => { apiFetch.mockReset(); sessionStorage.clear(); localStorage.clear(); });

  it("shows a sign-in message for a signed-out visitor and asks for no secret", async () => {
    apiFetch.mockResolvedValue(json(401, { code: "AUTH_REQUIRED" }));
    render(<AdminConsole />);
    expect(await screen.findByText(/Sign in with your administrator Google account/)).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/api/admin/session");
  });

  it("refuses a signed-in customer who is not an administrator", async () => {
    apiFetch.mockResolvedValue(json(403, { code: "ADMIN_REQUIRED" }));
    render(<AdminConsole />);
    expect(await screen.findByText("This account is not an administrator.")).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("loads the overview for an administrator and never stores anything in browser storage", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/session")) return json(200, { admin: true, email: "owner@example.com" });
      if (url.endsWith("/monitoring/status")) return json(200, { healthy: true, checkedAt: "2026-11-25T00:00:00Z", status: { liveAnalysisReady: true, forensicQueueReady: true }, database: { reachable: true, latencyMs: 40 }, stuckJobs: [], recentFailures: [] });
      if (url.endsWith("/usage")) return json(200, { jobsLast24h: 2, byMode: {}, failuresByCode: {} });
      if (url.endsWith("/revenue")) return json(200, { totals: { approvedAmount: 0, refundedAmount: 0, netAmount: 0, bankConfirmedAmount: 0, disputedAmount: 0, pendingAmount: 0 }, byMonth: [], byPlan: [] });
      return json(404, {});
    });
    render(<AdminConsole />);
    await waitFor(() => expect(screen.getByText("Healthy")).toBeTruthy());
    expect(screen.getByText(/Signed in as owner@example.com/)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    for (const [, init] of apiFetch.mock.calls) expect(JSON.stringify(init ?? {})).not.toMatch(/admin-secret/i);
  });

  it("submits the displayed credits used with a manual credit restore", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/session")) return json(200, { admin: true, email: "owner@example.com" });
      if (url.endsWith("/payments/overview")) return json(200, { payments: [{
        referenceNumber: "PS-RESTORE", sessionId: "session-1", creditsGranted: 5, creditsConsumed: 3, accessStatus: "active",
      }] });
      if (url.endsWith("/credits/restore")) return json(409, { error: "Credits used have changed." });
      return json(404, {});
    });
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("1").mockReturnValueOnce("Failed analysis");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(<AdminConsole />);
      fireEvent.click(await screen.findByRole("button", { name: "Payments" }));
      fireEvent.click(await screen.findByRole("button", { name: "Restore credit" }));
      expect(await screen.findByText("Credits used have changed.")).toBeTruthy();
      const request = apiFetch.mock.calls.find(([url]) => url === "/api/admin/credits/restore");
      expect(JSON.parse(request?.[1].body)).toEqual({
        sessionId: "session-1", credits: 1, expectedUsed: 3, reason: "Failed analysis",
      });
    } finally {
      prompt.mockRestore();
      confirm.mockRestore();
    }
  });
});

describe("AdminConsole financial reporting (DEVIN-FIN-01)", () => {
  beforeEach(() => { apiFetch.mockReset(); });
  it("shows a warning and 'unavailable' (never $0.00) when refunds cannot be established", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/session")) return json(200, { admin: true, email: "owner@example.com" });
      if (url.endsWith("/monitoring/status")) return json(200, { healthy: true, checkedAt: "2026-11-25T00:00:00Z", status: {}, database: { reachable: true, latencyMs: 1 }, stuckJobs: [], recentFailures: [] });
      if (url.endsWith("/usage")) return json(200, { jobsLast24h: 0, byMode: {}, failuresByCode: {} });
      if (url.endsWith("/revenue")) return json(200, {
        reporting: { complete: false, warnings: ["Refund and bank-settlement records could not be read."] },
        totals: { approvedAmount: 49, refundedAmount: null, netAmount: null, bankConfirmedAmount: null, disputedAmount: null, pendingAmount: 0 },
        byMonth: [{ month: "2026-11", approved: 1, approvedAmount: 49, refundedAmount: null }], byPlan: [],
      });
      return json(404, {});
    });
    const { container, findAllByText } = render(<AdminConsole />);
    expect((await findAllByText("Figures incomplete.")).length).toBeGreaterThan(0);
    const text = container.textContent || "";
    expect(text).toMatch(/records could not be read/);
    expect(text).toContain("Refunded: unavailable");
    expect(text).toContain("Net: unavailable");
    expect(text).not.toMatch(/Refunded: \$0\.00|Net: \$0\.00|Bank confirmed: \$0\.00/);
    expect(text).toContain("Approved: $49.00"); // authoritative payment total still shown
  });

  it("flags the Packages totals as incomplete and never renders a missing figure as $0.00", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/session")) return json(200, { admin: true, email: "owner@example.com" });
      if (url.endsWith("/monitoring/status")) return json(200, { healthy: true, checkedAt: "2026-11-25T00:00:00Z", status: {}, database: { reachable: true, latencyMs: 1 }, stuckJobs: [], recentFailures: [] });
      if (url.endsWith("/usage")) return json(200, { jobsLast24h: 0, byMode: {}, failuresByCode: {} });
      if (url.endsWith("/revenue")) return json(200, {
        reporting: { complete: false, warnings: ["Bank-settlement records could not be read."] },
        totals: { approvedAmount: 49, refundedAmount: 0, netAmount: 49, bankConfirmedAmount: null, disputedAmount: null, pendingAmount: 0 },
        byMonth: [], byPlan: [{ plan: "guide", approved: 1, approvedAmount: null, pending: 0 }],
      });
      return json(404, {});
    });
    const { container } = render(<AdminConsole />);
    // Revenue card and Packages card each carry the warning.
    await waitFor(() => expect(container.textContent).toContain("Packages"));
    await waitFor(() => expect(container.querySelectorAll("strong").length).toBeGreaterThan(0));
    await waitFor(() => expect((container.textContent || "").match(/Figures incomplete\./g)?.length).toBe(2));
    const text = container.textContent || "";
    expect(text).toContain("Bank confirmed: unavailable");
    expect(text).not.toMatch(/Bank confirmed: \$0\.00/);
  });
});

describe("AdminConsole approval message with transactional email", () => {
  beforeEach(() => { apiFetch.mockReset(); vi.restoreAllMocks(); });

  const payment = { referenceNumber: "PS-AAAA1111", customerEmail: "parent@example.test", package: "Basic", amount: 19.99, submittedAt: "2026-11-25T00:00:00Z", status: "pending", bankSettlementStatus: "pending_settlement", accessStatus: "pending" };
  const setup = (approval: Record<string, unknown>) => {
    vi.spyOn(window, "prompt").mockReturnValue("19.99");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/session")) return json(200, { admin: true, email: "owner@example.com" });
      if (url.endsWith("/payments/overview")) return json(200, { payments: [payment], reporting: { warnings: [] } });
      if (url.endsWith("/payments/approve") && init?.method === "POST") return json(200, { success: true, customerEmail: "parent@example.test", accessCode: "ABCD-EFGH-JKMN", expiresAt: "2026-12-09T00:00:00Z", ...approval });
      return json(404, {});
    });
    render(<AdminConsole initialSection="payments" />);
  };

  it("tells the administrator not to send the code again when it was queued for email", async () => {
    setup({ emailsQueued: { confirmation: true, receipt: true, accessCode: true } });
    (await screen.findByRole("button", { name: "Approve" })).click();
    expect(await screen.findByText(/queued for email to the customer: do not send it yourself/)).toBeTruthy();
    expect(screen.queryByText(/Send it now/)).toBeNull();
  });

  it("still asks for manual delivery when the code was not queued", async () => {
    setup({ emailsQueued: { confirmation: false, receipt: false, accessCode: false } });
    (await screen.findByRole("button", { name: "Approve" })).click();
    expect(await screen.findByText(/Send it now: it is shown only once/)).toBeTruthy();
  });
});
