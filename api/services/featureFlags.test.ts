import { describe, it, expect } from "vitest";
import { acroFormFieldIngestionEnabled, ACROFORM_FIELD_INGESTION_FLAG } from "./featureFlags";

describe("ACROFORM_FIELD_INGESTION flag", () => {
  it("is off when the variable is absent, in every environment", () => {
    expect(acroFormFieldIngestionEnabled({})).toBe(false);
    expect(acroFormFieldIngestionEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    expect(acroFormFieldIngestionEnabled({ NODE_ENV: "test" })).toBe(false);
  });

  it("is on only when the variable is exactly 'true'", () => {
    expect(acroFormFieldIngestionEnabled({ [ACROFORM_FIELD_INGESTION_FLAG]: "true" })).toBe(true);
    for (const v of ["1", "TRUE", "yes", "on", " true", ""]) {
      expect(acroFormFieldIngestionEnabled({ [ACROFORM_FIELD_INGESTION_FLAG]: v }), v).toBe(false);
    }
  });
});
