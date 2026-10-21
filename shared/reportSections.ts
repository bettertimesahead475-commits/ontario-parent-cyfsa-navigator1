/**
 * Builds the report the 16-section view shows: the adapted legacy findings, plus Section 5 rights
 * from the verified parental-rights module when the report's own content makes them relevant.
 *
 * A right is never added to every report. Each one needs a trigger term that appears in the report,
 * and that term is shown to the parent so the reason is visible.
 */
import { PARENTAL_RIGHTS, RIGHT_CONDITIONS, type ParentalRightEntry } from "./parentalRights";
import { adaptLegacyReport, type ReportContract, type ReportFinding } from "./reportContract";

/** Terms that make a right relevant. Each term must appear in the report text. */
export const RIGHT_TRIGGERS: Record<string, RegExp[]> = {
  "parent-is-a-party": [/child protection/i, /\bcyfsa\b/i, /children'?s aid/i, /\bsociety\b/i],
  "five-day-hearing": [/place of safety/i, /\bapprehen/i, /taken into care/i],
  "adjournment-limit": [/\badjourn/i, /\bpostpone/i],
  "plan-for-child": [/plan of care/i, /plan for the child/i, /care plan/i, /society'?s plan/i],
  "parent-rights-in-care": [/\bin care\b/i, /society care/i, /\bin the care of\b/i],
  "evidence-admissibility": [/hearsay/i, /second[- ]hand/i, /told me/i, /\baffidavit\b/i],
  "need-for-protection-grounds": [/in need of protection/i, /risk of/i, /physical harm/i, /\bneglect/i],
  "appeal-by-parent": [/\bappeal/i, /\bendorsement\b/i, /\bfinal order\b/i, /\binterim order\b/i],
};

/** Report fields whose text may trigger a right. Operating metadata and verification internals are excluded. */
const CONTENT_FIELDS = [
  "documentType",
  "fileSummary",
  "metadata",
  "documentAuthority",
  "redFlags",
  "chronology",
  "thresholdAnalysis",
  "proceduralTimelineViolations",
  "contradictions",
  "whatIsMissing",
  "whatToVerify",
  "whatToAskALawyer",
  "lawyerCaseBrief",
  "charterAndHumanRightsIssues",
] as const;

/** Text of the report content that triggers are checked against. */
export function reportTextForTriggers(legacy: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => walk(v, depth + 1));
  };
  if (legacy && typeof legacy === "object") {
    const record = legacy as Record<string, unknown>;
    for (const field of CONTENT_FIELDS) walk(record[field], 0);
  }
  return parts.join("\n");
}

/** Returns the matched trigger term for a right, or null when it is not relevant to this report. */
export function matchRight(entry: ParentalRightEntry, text: string): string | null {
  for (const pattern of RIGHT_TRIGGERS[entry.id] ?? []) {
    const hit = text.match(pattern);
    if (hit) return hit[0].toLowerCase();
  }
  return null;
}

/** Adds one Section 5 finding for each relevant right, and leaves every other section unchanged. */
export function withApplicableRights(contract: ReportContract, text: string, documentId = "primary-document"): ReportContract {
  const added: ReportFinding[] = [];
  for (const entry of PARENTAL_RIGHTS) {
    const term = matchRight(entry, text);
    if (!term) continue;
    const cond = RIGHT_CONDITIONS[entry.id];
    added.push({
      id: `R-${entry.id}`,
      sectionId: "S05",
      legacyId: null,
      kind: "ANALYSIS",
      title: `Possibly relevant: ${entry.title}`,
      whatHappened: `Candidate only. This report mentions "${term}". That word does not show the conditions below are met.`,
      whyItMatters: entry.plainEnglish,
      whatLawSays: `${entry.section}: "${entry.quote}"`,
      whatIsUnknown: [
        "Conditions not yet established from the records:",
        ...cond.conditions.map((c) => `- ${c}`),
        "Exceptions or limits to check:",
        ...cond.exceptions.map((c) => `- ${c}`),
      ].join("\n"),
      whatYouCanDo: entry.verifyInDocuments,
      evidenceClassification: null,
      severity: null,
      legalTestResult: "Conditions not established",
      concern: "NOT_INDEPENDENTLY_VERIFIED",
      quote: "NOT_CHECKED",
      sources: [{ documentId, locator: entry.section, quote: "" }],
      authorities: [{ citation: entry.section, status: "VERIFIED_IN_REPOSITORY_REFERENCE" }],
      uncertainty:
        "A keyword match is a research signal only. Checked against the repository copy of the CYFSA consolidation dated 2026-06-24, not the official e-Laws text (not reachable in this session).",
      supportingFindingIds: [],
      contraryFindingIds: [],
      relatedFindingIds: [],
      order: 0,
    });
  }
  if (added.length === 0) return contract;
  const existing = contract.findings.filter((f) => f.sectionId === "S05").length;
  added.forEach((f, i) => {
    f.order = existing + i + 1;
  });
  return {
    ...contract,
    findings: [...contract.findings, ...added],
    sections: contract.sections.map((s) =>
      s.id === "S05"
        ? { ...s, status: "POPULATED", note: "Includes provisions that may be relevant. Each lists the conditions the records have not yet established.", findingIds: [...s.findingIds, ...added.map((f) => f.id)] }
        : s
    ),
  };
}

/** Full pipeline used by the UI: legacy adapter, then Section 5 rights. Does not change the input. */
export function buildSectionedReport(legacy: unknown, documentId = "primary-document"): ReportContract {
  const base = adaptLegacyReport(legacy, { documentId });
  return withApplicableRights(base, reportTextForTriggers(legacy), documentId);
}
