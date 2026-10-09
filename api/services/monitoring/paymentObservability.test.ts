/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from "vitest";
import { checkPaymentObservability } from "./paymentObservability.js";
import * as access from "../access.js";

describe("Monitoring Payment Observability", () => {
  it("reports healthy with Interac active, payments table reachable, and Stripe not integrated disclosed", async () => {
    const mockSelect = vi.fn().mockResolvedValue({ error: null });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    vi.spyOn(access, "getSupabase").mockReturnValue({ from: mockFrom } as any);

    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/admin/check-payments")) return { status: 401 };
      if (url.includes("/api/activate-code")) return { status: 401 };
      return { status: 404 };
    });

    const metric = await checkPaymentObservability("https://example.com", fetchFn as any);
    expect(metric.status).toBe("healthy");
    expect(metric.name).toBe("paymentObservability");
    expect(metric.message).toContain("Interac e-Transfer active");
    expect((metric.details as any)?.stripeIntegration?.status).toBe("NOT_INTEGRATED");
    expect((metric.details as any)?.idempotencySafeguards?.status).toBe("ACTIVE");
  });

  it("reports failed when payments table is unreachable", async () => {
    const mockSelect = vi.fn().mockResolvedValue({ error: { message: "connection refused" } });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    vi.spyOn(access, "getSupabase").mockReturnValue({ from: mockFrom } as any);

    const fetchFn = vi.fn().mockResolvedValue({ status: 401 });
    const metric = await checkPaymentObservability("https://example.com", fetchFn as any);
    expect(metric.status).toBe("failed");
    expect(metric.message).toContain("Payment infrastructure check failed");
  });
});
