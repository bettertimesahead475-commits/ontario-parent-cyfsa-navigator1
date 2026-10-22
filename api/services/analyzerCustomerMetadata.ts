/**
 * Customer-facing analysis metadata.
 *
 * Token counts, provider model identifiers, and estimated API cost are operating data for the
 * business. They are written to the server log ([ANALYZER_RUN]) for internal cost review and are
 * never included in the analysis response a parent receives, in its on-screen view, or in any
 * downloadable PDF. Add a field here only when the parent-facing UI needs it.
 */
export interface CustomerModelMetadata {
  engineName: string;
  mode: "fast" | "full";
  modeName: string;
  durationMs: number;
}

export function toCustomerModelMetadata(input: CustomerModelMetadata): CustomerModelMetadata {
  return {
    engineName: input.engineName,
    mode: input.mode,
    modeName: input.modeName,
    durationMs: input.durationMs,
  };
}

// Reports saved before the allowlist above still hold provider IDs, token counts and cost.
// Anything that returns a stored report must pass it through here as well.
export function redactCustomerReport<T extends Record<string, any>>(report: T): T {
  if (!report || typeof report !== "object") return report;
  const out: Record<string, any> = { ...report };
  if (out.modelMetadata && typeof out.modelMetadata === "object") {
    const m = out.modelMetadata;
    out.modelMetadata = toCustomerModelMetadata({
      engineName: m.engineName,
      mode: m.mode,
      modeName: m.modeName,
      durationMs: m.durationMs,
    });
  }
  if (out.forensicVerification && typeof out.forensicVerification === "object") {
    const { model: _model, ...rest } = out.forensicVerification;
    out.forensicVerification = rest;
  }
  for (const key of ["redFlags", "thresholdAnalysis", "chronology", "contradictions", "gaps"]) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((item: any) => {
      if (!item || typeof item !== "object" || !("verifiedBy" in item)) return item;
      const verifiedBy = item.verifiedBy ? "Independent second review" : item.verifiedBy;
      return { ...item, verifiedBy };
    });
  }
  return out as T;
}
