/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from "vitest";
import {
  checkHomepage,
  checkApiHealth,
  checkCommercialPricing,
  checkAnalyzerUsage,
  checkAuthFailClosed,
} from "./syntheticChecks.js";

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; text?: string; json?: any; ok?: boolean }): any {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const res = handler(url, init);
    const status = res.status;
    const ok = res.ok !== undefined ? res.ok : status >= 200 && status < 300;
    return {
      status,
      ok,
      headers: new Headers(),
      text: async () => res.text || "",
      json: async () => res.json || {},
    };
  });
}

describe("Monitoring Synthetic Checks", () => {
  describe("checkHomepage", () => {
    it("reports healthy when homepage loads with valid title and root", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        text: '<!DOCTYPE html><html><head><title>CYFSA Navigator</title></head><body><div id="root"></div></body></html>',
      }));

      const metric = await checkHomepage("https://example.com", fetchFn);
      expect(metric.status).toBe("healthy");
      expect(metric.name).toBe("homepage");
      expect(metric.message).toContain("successfully");
    });

    it("reports failed when homepage returns 500 error", async () => {
      const fetchFn = mockFetch(() => ({ status: 500 }));
      const metric = await checkHomepage("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("500");
    });

    it("reports failed when HTML is missing CYFSA Navigator title", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        text: '<!DOCTYPE html><html><head><title>Wrong Title</title></head><body><div id="root"></div></body></html>',
      }));
      const metric = await checkHomepage("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("missing critical markers");
    });

    it("reports failed when fetch throws network error", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Network connection refused"));
      const metric = await checkHomepage("https://example.com", fetchFn as any);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("unreachable");
    });
  });

  describe("checkApiHealth", () => {
    it("reports healthy when /api/health returns healthy status", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: { status: "healthy", timestamp: new Date().toISOString() },
      }));
      const metric = await checkApiHealth("https://example.com", fetchFn);
      expect(metric.status).toBe("healthy");
    });

    it("reports failed when /api/health reports unhealthy", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: { status: "degraded", error: "service failure" },
      }));
      const metric = await checkApiHealth("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("unhealthy status");
    });

    it("reports failed when /api/health returns non-200", async () => {
      const fetchFn = mockFetch(() => ({ status: 503 }));
      const metric = await checkApiHealth("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("503");
    });
  });

  describe("checkCommercialPricing", () => {
    it("reports healthy when commercial model matches authoritative baseline", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: {
          prices: {
            Basic: 19.99,
            AnalyzerBasic: 19.99,
            Premium: 49.99,
            AnalyzerPremium: 49.99,
            Pro: 149,
            Community5: 2000,
            Community10: 3500,
            Community25: 7500,
          },
          legacy_prices: {},
        },
      }));
      const metric = await checkCommercialPricing("https://example.com", fetchFn);
      expect(metric.status).toBe("healthy");
      expect(metric.message).toContain("Commercial pricing model verified");
    });

    it("detects pricing regression when Basic price differs", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: {
          prices: {
            Basic: 19.00, // Regression!
            AnalyzerBasic: 19.99,
            Premium: 49.99,
            AnalyzerPremium: 49.99,
            Pro: 149,
            Community5: 2000,
            Community10: 3500,
            Community25: 7500,
          },
          legacy_prices: {},
        },
      }));
      const metric = await checkCommercialPricing("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("Commercial pricing regression detected");
      expect((metric.details as any)?.mismatches?.Basic).toBeDefined();
    });

    it("detects regression when legacy_prices is unexpectedly present", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: {
          prices: {
            Basic: 19.99,
            AnalyzerBasic: 19.99,
            Premium: 49.99,
            AnalyzerPremium: 49.99,
            Pro: 149,
            Community5: 2000,
            Community10: 3500,
            Community25: 7500,
          },
          legacy_prices: { Pro: 19, Premium: 49 },
        },
      }));
      const metric = await checkCommercialPricing("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("Commercial pricing regression detected");
    });
  });

  describe("checkAnalyzerUsage", () => {
    it("reports healthy for anonymous baseline usage without consuming credit", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: {
          type: "free",
          tier: "Anonymous",
          limit: 1,
          remaining: 1,
          quickReviewsUsed: 0,
          quickReviewsLimit: 1,
          quickReviewsRemaining: 1,
          forensicAnalysesUsed: 0,
          forensicAnalysesLimit: 0,
          forensicAnalysesRemaining: 0,
        },
      }));
      const metric = await checkAnalyzerUsage("https://example.com", fetchFn);
      expect(metric.status).toBe("healthy");
      expect(metric.message).toContain("without credit consumption");
    });

    it("reports failed when usage endpoint returns malformed payload", async () => {
      const fetchFn = mockFetch(() => ({
        status: 200,
        json: { unexpected: true },
      }));
      const metric = await checkAnalyzerUsage("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("unexpected schema");
    });
  });

  describe("checkAuthFailClosed", () => {
    it("reports healthy when all protected routes return 401/402/403", async () => {
      const fetchFn = mockFetch((url) => {
        if (url.includes("/api/activate-code")) return { status: 401 };
        if (url.includes("/api/cases")) return { status: 401 };
        if (url.includes("/api/analyze")) return { status: 403 };
        if (url.includes("/api/deep-scan")) return { status: 402 };
        return { status: 404 };
      });

      const metric = await checkAuthFailClosed("https://example.com", fetchFn);
      expect(metric.status).toBe("healthy");
      expect(metric.message).toContain("All protected routes verified fail-closed");
    });

    it("flags CRITICAL SECURITY FAILURE if a protected route returns 200", async () => {
      const fetchFn = mockFetch((url) => {
        if (url.includes("/api/activate-code")) return { status: 200 }; // Critical auth fail-open!
        if (url.includes("/api/cases")) return { status: 401 };
        if (url.includes("/api/analyze")) return { status: 403 };
        if (url.includes("/api/deep-scan")) return { status: 402 };
        return { status: 404 };
      });

      const metric = await checkAuthFailClosed("https://example.com", fetchFn);
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("CRITICAL SECURITY FAILURE");
    });
  });
});
