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

/**
 * Removes the verifying model's identifier from a report. The verdicts, notes, and status are kept
 * because the parent UI shows them; the provider model ID is operating data and is not.
 */
export function stripVerifierIdentity(report: Record<string, any>): Record<string, any> {
  if (report.forensicVerification && typeof report.forensicVerification === "object") {
    delete report.forensicVerification.model;
  }
  const findings = [...(Array.isArray(report.redFlags) ? report.redFlags : []), ...(Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : [])];
  for (const finding of findings) {
    if (finding?.forensicVerification && typeof finding.forensicVerification === "object") {
      delete finding.forensicVerification.verifiedBy;
    }
  }
  return report;
}
