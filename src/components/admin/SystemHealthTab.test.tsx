// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import SystemHealthTab from "./SystemHealthTab";

describe("Admin SystemHealthTab UI", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders authentication gate when no admin secret is in sessionStorage", () => {
    render(<SystemHealthTab />);
    expect(screen.getByText(/Admin System Observability/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Admin Secret/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Authenticate/i })).toBeDefined();
  });

  it("renders system observability dashboard when authenticated", async () => {
    sessionStorage.setItem("cyfsa_admin_secret", "valid-admin-secret");

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          latest: {
            status: "healthy",
            timestamp: new Date().toISOString(),
            summary: { total: 9, healthy: 9, degraded: 0, failed: 0 },
            checks: {
              homepage: { name: "homepage", status: "healthy", latencyMs: 120, message: "Homepage loaded successfully" },
              apiHealth: { name: "apiHealth", status: "healthy", latencyMs: 40, message: "/api/health is healthy" },
              pricing: { name: "pricing", status: "healthy", latencyMs: 45, message: "Commercial pricing model verified" },
              usage: { name: "usage", status: "healthy", latencyMs: 50, message: "Usage accounting verified" },
              database: { name: "database", status: "healthy", latencyMs: 60, message: "Database healthy" },
              configIntegrity: { name: "configIntegrity", status: "healthy", latencyMs: 1, message: "Config intact" },
              analyzerAvailability: { name: "analyzerAvailability", status: "healthy", latencyMs: 70, message: "Analyzer pipeline active" },
              authFailClosed: { name: "authFailClosed", status: "healthy", latencyMs: 65, message: "All protected routes fail-closed" },
              paymentObservability: { name: "paymentObservability", status: "healthy", latencyMs: 80, message: "Payment pipeline healthy" },
            },
            incidents: [],
          },
          history: [],
        }),
      };
    }) as any;

    render(<SystemHealthTab />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Production Observability & Monitoring/i })).toBeDefined();
      expect(screen.getByText("Commercial Pricing Integrity")).toBeDefined();
      expect(screen.getByText("Authentication Fail-Closed")).toBeDefined();
    });
  });
});
