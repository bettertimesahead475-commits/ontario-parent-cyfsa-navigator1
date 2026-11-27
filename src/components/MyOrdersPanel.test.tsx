// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MyOrdersPanel from "./MyOrdersPanel";
import * as api from "../utils/api";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("MyOrdersPanel", () => {
  it("renders nothing and makes no request when signed out", () => {
    const spy = vi.spyOn(api, "apiFetch");
    const { container } = render(<MyOrdersPanel signedIn={false} onActivated={() => {}} />);
    expect(container.innerHTML).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows order states, pending instructions and a renewal reminder", async () => {
    vi.spyOn(api, "apiFetch").mockResolvedValue(ok({
      orders: [
        { referenceNumber: "PS-PEND2345", plan: "Premium", amount: 49.99, state: "awaiting_verification", submittedAt: null, instructions: "Send an Interac e-transfer for $49.99 CAD" },
        { referenceNumber: "PS-USED2345", plan: "Pro", amount: 149, state: "activated", submittedAt: null },
      ],
      entitlements: [{ tier: "Pro", expiresAt: "2026-12-01T00:00:00Z", daysLeft: 3, renewalDue: true }],
    }));
    render(<MyOrdersPanel signedIn onActivated={() => {}} />);
    expect(await screen.findByText("Awaiting payment verification")).toBeTruthy();
    expect(screen.getByText(/\$49\.99 CAD/)).toBeTruthy();
    expect(screen.getByText("Activated")).toBeTruthy();
    expect(screen.getByText(/ends in 3 days/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activate now" })).toBeNull();
  });

  it("activates a verified order and stores the session for this account", async () => {
    const onActivated = vi.fn();
    const spy = vi.spyOn(api, "apiFetch").mockImplementation(async (url: any) => url === "/api/claim-purchase"
      ? ok({ success: true, tier: "Premium", token: "tok", email: "parent@example.com" })
      : ok({ orders: [{ referenceNumber: "PS-READY234", plan: "Premium", amount: 49.99, state: "ready_to_activate", submittedAt: null }], entitlements: [] }));
    render(<MyOrdersPanel signedIn onActivated={onActivated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate now" }));
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith("Premium"));
    const claim = spy.mock.calls.find(([u]) => u === "/api/claim-purchase");
    expect(JSON.parse(String(claim?.[1]?.body))).toEqual({ referenceNumber: "PS-READY234" });
    expect(Object.values({ ...localStorage })).toContain("tok");
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("announces a refused activation", async () => {
    vi.spyOn(api, "apiFetch").mockImplementation(async (url: any) => url === "/api/claim-purchase"
      ? ok({ error: "Your payment has not been verified yet.", code: "PAYMENT_NOT_VERIFIED" }, 409)
      : ok({ orders: [{ referenceNumber: "PS-READY234", plan: "Premium", amount: 49.99, state: "ready_to_activate", submittedAt: null }], entitlements: [] }));
    render(<MyOrdersPanel signedIn onActivated={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not been verified");
  });
});
