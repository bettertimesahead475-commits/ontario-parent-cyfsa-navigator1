// Stage 6 Milestone 2-E — amendment & source-change monitoring foundation.
// Deterministic, provider-independent, no AI, no network, no filesystem, no database access
// anywhere in this file. Answers only "has an authoritative source changed in a way that
// requires inspection?" — never "the law changed," never "this is an amendment/renumbering/
// split/merge/repeal/reenactment" (those are verified-lineage facts a human establishes, never
// inferred here from text similarity or timing). Monitoring is read-only with respect to
// verification: nothing in this file can set VERIFIED, verifiedBy, or verifiedAt, and nothing
// here mutates a prior snapshot or a VERIFIED provision-version.
import { normalizeProvisionText, sha256Hex, validateSourceSnapshotCandidate, type SourceSnapshotCandidate } from "./legalCorpus.js";
import {
  classifySnapshotChange,
  classifyProvisionCandidateChange,
  type SnapshotChangeClassification,
  type ParseResult,
  type ParseStatus,
} from "./legalCorpusIngestion.js";

// ---------------------------------------------------------------------------
// Monitoring input — bounded, provider-independent. No network access is performed here;
// retrieval already happened (successfully or not) before this function is ever called.
// ---------------------------------------------------------------------------

export type RetrievalOutcomeInput =
  | { status: "SUCCESS"; snapshot: SourceSnapshotCandidate }
  | { status: "FAILED"; errorMessage: string; requestedUrl: string; attemptedAt: string };

export interface PriorProvisionRecord {
  citation: string;
  textSha256: string;
  parserVersion: string;
}

export interface MonitoringInput {
  legalSourceId: string;
  expectedSourceUrl: string;
  /** Null on the very first monitoring run for a source — there is nothing to compare against yet. */
  priorSnapshot: { legalSourceId: string; sourceUrl: string; contentSha256: string } | null;
  retrieval: RetrievalOutcomeInput;
  parserVersion: string;
  /** Null on the very first run. Order does not matter — the comparison is by citation key, not position. */
  priorParserVersion: string | null;
  priorProvisions: readonly PriorProvisionRecord[];
  /** Present only when retrieval succeeded; the freshly parsed result of the new snapshot's raw content. */
  newParseResult: ParseResult | null;
  /** Optional: the parse status observed on the previous run, to detect a structural regression (e.g. PARSED -> UNSUPPORTED) independent of any single provision's text. */
  priorParseStatus: ParseStatus | null;
}

// ---------------------------------------------------------------------------
// Outcomes.
// ---------------------------------------------------------------------------

export type SourceMonitoringOutcome =
  | "UNCHANGED"
  | "SOURCE_CHANGED"
  | "PARSER_CHANGED"
  | "STRUCTURE_CHANGED"
  | "PROVISION_CHANGES_DETECTED"
  | "REQUIRES_INSPECTION"
  | "RETRIEVAL_FAILED"
  | "SOURCE_IDENTITY_MISMATCH"
  | "INTEGRITY_FAILURE";

const REQUIRES_INSPECTION_OUTCOMES: SourceMonitoringOutcome[] = [
  "SOURCE_CHANGED",
  "PARSER_CHANGED",
  "STRUCTURE_CHANGED",
  "PROVISION_CHANGES_DETECTED",
  "REQUIRES_INSPECTION",
  "RETRIEVAL_FAILED",
  "SOURCE_IDENTITY_MISMATCH",
  "INTEGRITY_FAILURE",
];

export type ProvisionChangeType = "PROVISION_TEXT_CHANGED" | "PROVISION_ADDED" | "PROVISION_REMOVED" | "PARSER_CHANGED" | "REQUIRES_INSPECTION";

export interface ObservedProvisionChange {
  citation: string;
  changeType: ProvisionChangeType;
  priorTextSha256: string | null;
  newTextSha256: string | null;
}

export interface MonitoringObservation {
  outcome: SourceMonitoringOutcome;
  /** True for every outcome except UNCHANGED — a caller that only checks this flag can never mistake an ambiguous or failed observation for "nothing to look at." */
  requiresInspection: boolean;
  legalSourceId: string;
  sourceUrl: string;
  retrievalAttemptedAt: string | null;
  priorSnapshotSha256: string | null;
  newSnapshotSha256: string | null;
  snapshotChange: SnapshotChangeClassification | null;
  parserVersion: string;
  priorParserVersion: string | null;
  parserChanged: boolean;
  parseStatus: ParseStatus | null;
  /** Sorted by citation — deterministic regardless of parser/input ordering. */
  provisionChanges: ObservedProvisionChange[];
  warnings: string[];
  retrievalError: string | null;
}

function observation(partial: Omit<MonitoringObservation, "requiresInspection">): MonitoringObservation {
  return { ...partial, requiresInspection: REQUIRES_INSPECTION_OUTCOMES.includes(partial.outcome) };
}

// ---------------------------------------------------------------------------
// Core resolver — pure, synchronous. Same inputs always produce the same output: no
// Date.now(), no randomness, no I/O anywhere in this function.
// ---------------------------------------------------------------------------

export function observeSourceChange(input: MonitoringInput): MonitoringObservation {
  const base = { legalSourceId: input.legalSourceId, sourceUrl: input.expectedSourceUrl, parserVersion: input.parserVersion, priorParserVersion: input.priorParserVersion };

  if (input.retrieval.status === "FAILED") {
    // A failed retrieval is never interpreted as "the source/provision was removed" or "the law
    // was repealed" — it is exactly what it is: retrieval did not succeed this time. The prior
    // authoritative corpus is conceptually untouched; this function does not (and could not,
    // being pure) overwrite anything.
    return observation({
      ...base,
      outcome: "RETRIEVAL_FAILED",
      retrievalAttemptedAt: input.retrieval.attemptedAt,
      priorSnapshotSha256: input.priorSnapshot?.contentSha256 ?? null,
      newSnapshotSha256: null,
      snapshotChange: null,
      parserChanged: false,
      parseStatus: null,
      provisionChanges: [],
      warnings: [`Retrieval failed for ${input.retrieval.requestedUrl}: ${input.retrieval.errorMessage}`],
      retrievalError: input.retrieval.errorMessage,
    });
  }

  const snapshot = input.retrieval.snapshot;

  // No cross-source comparison: a snapshot claiming a different legalSourceId or sourceUrl than
  // what this monitoring run was configured to check is rejected outright, never compared.
  if (snapshot.legalSourceId !== input.legalSourceId || snapshot.sourceUrl !== input.expectedSourceUrl) {
    return observation({
      ...base,
      outcome: "SOURCE_IDENTITY_MISMATCH",
      retrievalAttemptedAt: null,
      priorSnapshotSha256: input.priorSnapshot?.contentSha256 ?? null,
      newSnapshotSha256: null,
      snapshotChange: null,
      parserChanged: false,
      parseStatus: null,
      provisionChanges: [],
      warnings: [`Snapshot identity (${snapshot.legalSourceId}, ${snapshot.sourceUrl}) does not match the expected (${input.legalSourceId}, ${input.expectedSourceUrl}).`],
      retrievalError: null,
    });
  }

  try {
    validateSourceSnapshotCandidate(snapshot);
  } catch {
    return observation({
      ...base,
      outcome: "INTEGRITY_FAILURE",
      retrievalAttemptedAt: null,
      priorSnapshotSha256: input.priorSnapshot?.contentSha256 ?? null,
      newSnapshotSha256: null,
      snapshotChange: null,
      parserChanged: false,
      parseStatus: null,
      provisionChanges: [],
      warnings: ["The newly retrieved snapshot fails deterministic checksum validation and cannot be trusted."],
      retrievalError: null,
    });
  }

  const snapshotChange = classifySnapshotChange(input.priorSnapshot, snapshot);
  const parserChanged = input.priorParserVersion !== null && input.priorParserVersion !== input.parserVersion;
  const parseStatus = input.newParseResult?.status ?? null;
  const structureChanged = input.priorParseStatus !== null && parseStatus !== null && input.priorParseStatus !== parseStatus;

  // Provision-level diff by citation key — never by position, so parser/repository ordering
  // never affects the result.
  const priorByCitation = new Map(input.priorProvisions.map((p) => [p.citation, p]));
  const newByCitation = new Map(
    (input.newParseResult?.provisions ?? []).map((p) => {
      const normalized = normalizeProvisionText(p.exactText);
      return [p.citation, { citation: p.citation, textSha256: sha256Hex(normalized) }] as const;
    }),
  );

  const allCitations = [...new Set([...priorByCitation.keys(), ...newByCitation.keys()])].sort();
  const provisionChanges: ObservedProvisionChange[] = [];
  for (const citation of allCitations) {
    const prior = priorByCitation.get(citation) ?? null;
    const current = newByCitation.get(citation) ?? null;
    if (prior && !current) {
      provisionChanges.push({ citation, changeType: "PROVISION_REMOVED", priorTextSha256: prior.textSha256, newTextSha256: null });
    } else if (!prior && current) {
      provisionChanges.push({ citation, changeType: "PROVISION_ADDED", priorTextSha256: null, newTextSha256: current.textSha256 });
    } else if (prior && current) {
      const classification = classifyProvisionCandidateChange(prior, current, input.parserVersion);
      if (classification === "SOURCE_CHANGED") provisionChanges.push({ citation, changeType: "PROVISION_TEXT_CHANGED", priorTextSha256: prior.textSha256, newTextSha256: current.textSha256 });
      else if (classification === "PARSER_CHANGED") provisionChanges.push({ citation, changeType: "PARSER_CHANGED", priorTextSha256: prior.textSha256, newTextSha256: current.textSha256 });
      else if (classification === "REQUIRES_INSPECTION") provisionChanges.push({ citation, changeType: "REQUIRES_INSPECTION", priorTextSha256: prior.textSha256, newTextSha256: current.textSha256 });
      // UNCHANGED/NEW are not recorded as changes — NEW cannot occur here since both prior and current are non-null.
    }
  }

  const warnings: string[] = [];
  let outcome: SourceMonitoringOutcome;
  if (structureChanged) {
    warnings.push(`Parse status changed from ${input.priorParseStatus} to ${parseStatus} — a structural regression, independent of any single provision's text.`);
    outcome = "STRUCTURE_CHANGED";
  } else if (provisionChanges.length > 0) {
    warnings.push(`${provisionChanges.length} provision-level change(s) detected; each requires independent human inspection before any corpus update.`);
    outcome = "PROVISION_CHANGES_DETECTED";
  } else if (snapshotChange === "SOURCE_CHANGED" && parserChanged) {
    warnings.push("Both the raw source bytes and the parser version changed simultaneously; the cause cannot be attributed to just one factor.");
    outcome = "REQUIRES_INSPECTION";
  } else if (snapshotChange === "SOURCE_CHANGED") {
    // Explicitly the core safety rule: a byte-level source change is reported as exactly that —
    // never escalated to a claim that the underlying law changed.
    warnings.push("Source page content changed. This does not by itself mean the law changed — it may be a formatting, template, or unrelated correction. Human inspection required.");
    outcome = "SOURCE_CHANGED";
  } else if (parserChanged) {
    warnings.push("Only the parser version changed; raw source bytes are unchanged. A parser deployment must never be treated as a legal amendment.");
    outcome = "PARSER_CHANGED";
  } else {
    outcome = "UNCHANGED";
  }

  return observation({
    ...base,
    outcome,
    retrievalAttemptedAt: null,
    priorSnapshotSha256: input.priorSnapshot?.contentSha256 ?? null,
    newSnapshotSha256: snapshot.contentSha256,
    snapshotChange,
    parserChanged,
    parseStatus,
    provisionChanges,
    warnings,
    retrievalError: null,
  });
}
