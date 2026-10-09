/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from "vitest";
import { checkAnalyzerAvailability } from "./analyzerChecks.js";

function mockFetch(responses: Record<string, number>): any {
  return vi.fn().mockImplementation(async (url: string) => {
    let status = 404;
    for (const [key, code] of Object.entries(responses)) {
      if (url.includes(key)) {
        status = code;
        break;
      }
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => ({}),
      text: async () => "",
    };
  });
}

describe("Monitoring Analyzer Checks", () => {
  it("reports healthy when quick validation returns 400, forensic returns 403, deep scan returns 402, and usage returns 200", async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/analyzer-usage")) return { status: 200, ok: true };
      if (url.includes("/api/deep-scan")) return { status: 402, ok: false };
      if (url.includes("/api/analyze")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.mode === "full") return { status: 403, ok: false };
        return { status: 400, ok: false };
      }
      return { status: 404, ok: false };
    });

    const metric = await checkAnalyzerAvailability("https://example.com", fetchFn as any);
    expect(metric.status).toBe("healthy");
    expect(metric.name).toBe("analyzerAvailability");
    expect(metric.message).toContain("0 AI tokens consumed");
  });

  it("reports failed when quick validation route is unreachable or returns 500", async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/analyze")) return { status: 500, ok: false };
      return { status: 200, ok: true };
    });

    const metric = await checkAnalyzerAvailability("https://example.com", fetchFn as any);
    expect(metric.status).toBe("failed");
    expect(metric.message).toContain("failed route validation");
  });
});
