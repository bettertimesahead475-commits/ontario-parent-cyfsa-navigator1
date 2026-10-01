import type { AnalysisReport } from "../types";

const LIST_FIELDS = [
  "redFlags",
  "thresholdAnalysis",
  "proceduralTimelineViolations",
  "charterAndHumanRightsIssues",
  "whatToVerify",
  "whatToAskALawyer",
  "whatIsMissing",
  "lawyerCaseBrief",
] as const;

/**
 * Makes a report from /api/analyze or /api/deep-scan safe to render.
 *
 * Fast Analysis (the automatic pass after upload) only returns the core schema - title,
 * metadata, summary, Evidence Strength Index and red flags. The results view mapped over
 * thresholdAnalysis / whatToVerify / whatIsMissing / whatToAskALawyer unconditionally, so every
 * successful fast analysis threw during render and the parent never saw the result. Missing list
 * fields become empty lists here; nothing is invented and present values are never changed
 * (other than coercing a non-array to an empty list and a missing severity to an empty string).
 */
export function normalizeAnalysisReport<T extends Partial<AnalysisReport> | null | undefined>(report: T): T {
  if (!report || typeof report !== "object") return report;
  const normalized: any = { ...report };
  for (const field of LIST_FIELDS) {
    if (!Array.isArray(normalized[field])) normalized[field] = [];
  }
  normalized.redFlags = normalized.redFlags
    .filter((flag: unknown) => flag && typeof flag === "object")
    .map((flag: any) => (typeof flag.severity === "string" ? flag : { ...flag, severity: "" }));
  return normalized;
}
