/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDatabaseHealth, checkConfigurationIntegrity } from "./databaseChecks.js";
import * as access from "../access.js";
import * as diagnostics from "../supabaseDiagnostics.js";

describe("Monitoring Database & Config Checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkDatabaseHealth", () => {
    it("reports healthy when all required tables return head count successfully", async () => {
      const mockSelect = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
      vi.spyOn(access, "getSupabase").mockReturnValue({ from: mockFrom } as any);

      const metric = await checkDatabaseHealth();
      expect(metric.status).toBe("healthy");
      expect(metric.name).toBe("database");
      expect(metric.message).toContain("healthy");
      expect(mockFrom).toHaveBeenCalledWith("access_codes");
      expect(mockFrom).toHaveBeenCalledWith("navigator_paid_sessions");
      expect(mockFrom).toHaveBeenCalledWith("free_usage");
    });

    it("reports failed when one required table is unreachable", async () => {
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "navigator_paid_sessions") {
          return { select: vi.fn().mockResolvedValue({ error: { message: "relation does not exist" } }) };
        }
        return { select: vi.fn().mockResolvedValue({ error: null }) };
      });
      vi.spyOn(access, "getSupabase").mockReturnValue({ from: mockFrom } as any);

      const metric = await checkDatabaseHealth();
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("One or more required Supabase tables are unreachable");
      expect((metric.details as any)?.tables?.navigator_paid_sessions?.reachable).toBe(false);
    });

    it("reports failed when Supabase client throws connection error", async () => {
      vi.spyOn(access, "getSupabase").mockImplementation(() => {
        throw new Error("Failed to connect to Supabase host");
      });

      const metric = await checkDatabaseHealth();
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("Database connection failed");
    });
  });

  describe("checkConfigurationIntegrity", () => {
    it("reports healthy when host and key format are resolved", () => {
      vi.spyOn(diagnostics, "configuredSupabaseHost").mockReturnValue("qboidsfpjuxeqtfotryj.supabase.co");
      vi.spyOn(diagnostics, "describeConfiguredKey").mockReturnValue({
        source: "SUPABASE_SERVICE_ROLE_KEY",
        format: "sb_secret",
        jwtRole: null,
        jwtRef: null,
      });

      const metric = checkConfigurationIntegrity();
      expect(metric.status).toBe("healthy");
      expect(metric.message).toContain("intact");
      expect((metric.details as any)?.projectRef).toBe("qboidsfpjuxeqtfotryj");
    });

    it("reports failed when host or key is missing", () => {
      vi.spyOn(diagnostics, "configuredSupabaseHost").mockReturnValue(null);
      vi.spyOn(diagnostics, "describeConfiguredKey").mockReturnValue({
        source: null,
        format: "other",
        jwtRole: null,
        jwtRef: null,
      });

      const metric = checkConfigurationIntegrity();
      expect(metric.status).toBe("failed");
      expect(metric.message).toContain("Critical configuration missing");
    });
  });
});
