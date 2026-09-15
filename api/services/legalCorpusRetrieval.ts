// Stage 6 Milestone 2-D — deterministic legal authority retrieval.
// RETRIEVAL, not SELECTION: every input here must already carry a deterministic provision
// identity (a legal source id + a normalized citation) and a case date. This module never
// decides which statute or provision "might apply" to a fact pattern — that remains entirely
// outside this file, gated by the existing Stage 6 mapping/review boundary
// (api/services/legalAuthority.ts). No AI call, no free-text legal reasoning, no persistence
// write of any kind — this module is read-only with respect to legal verification.
import { LifecycleError, requireUuid } from "./lifecycleErrors.js";
import { normalizeSectionLabel } from "./legalCorpusIngestion.js";
import { validateProvisionVersionCandidate, type ProvisionVersionCandidate } from "./legalCorpus.js";
import type { CaseDate, LegalProvision } from "./legalAuthority.js";

const invalid = (message: string) => new LifecycleError(400, "INVALID_LEGAL_RETRIEVAL", message);

// ---------------------------------------------------------------------------
// Citation normalization — same section-level rule as ingestion (74 / s. 74 / section 74 all
// become s.74), extended to preserve an already-well-formed nested suffix untouched. This never
// guesses which nested identity was meant; a malformed suffix is rejected, not repaired.
// ---------------------------------------------------------------------------

const CITATION_HEAD = /^\s*(?:s\.?\s*|section\s+)?(\d+[a-zA-Z]?)\.?\s*/i;
const SUFFIX_GROUP = /^\(([^()\s]+)\)\s*/;

/** Normalizes only the leading section label; every nested (subsection)(paragraph)(clause) group is preserved as its own distinct identity, never collapsed or guessed. */
export function normalizeProvisionCitation(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw invalid("Citation is required.");
  const headMatch = raw.match(CITATION_HEAD);
  if (!headMatch) throw invalid("Malformed citation: no recognizable section number.");
  let citation = normalizeSectionLabel(headMatch[1]);
  let rest = raw.slice(headMatch[0].length);
  while (rest.trim().length > 0) {
    const groupMatch = rest.match(SUFFIX_GROUP);
    if (!groupMatch) throw invalid("Malformed citation: invalid nested identifier.");
    citation += `(${groupMatch[1]})`;
    rest = rest.slice(groupMatch[0].length);
  }
  return citation;
}

// ---------------------------------------------------------------------------
// Retrieval input/output contract.
// ---------------------------------------------------------------------------

export interface ProvisionRetrievalInput {
  legalSourceId: string;
  /** Raw or already-normalized citation — normalized internally before lookup. */
  citation: string;
  caseDate: CaseDate;
  /** Provenance passthrough only — never required for, and never influences, the lookup itself. */
  matterId?: string;
  evidenceItemId?: string;
}

export type RetrievalOutcome =
  | "RESOLVED"
  | "RESOLVED_OPEN_ENDED"
  | "UNKNOWN_DATE"
  | "INVALID_CASE_DATE"
  | "PROVISION_NOT_FOUND"
  | "NO_MATCH"
  | "BEFORE_EARLIEST_VERSION"
  | "AFTER_LAST_CLOSED_VERSION"
  | "GAP_IN_COVERAGE"
  | "MULTIPLE_MATCHES"
  | "UNVERIFIED_ONLY"
  | "OVERLAPPING_VERSIONS"
  | "INTEGRITY_FAILURE";

const RESOLVED_OUTCOMES: RetrievalOutcome[] = ["RESOLVED", "RESOLVED_OPEN_ENDED"];

export interface RetrievalResult {
  outcome: RetrievalOutcome;
  /** True for every outcome except RESOLVED/RESOLVED_OPEN_ENDED — a downstream consumer that only checks this flag can never mistake an ambiguous result for a trusted one. */
  requiresResearch: boolean;
  provisionVersion: ProvisionVersionCandidate | null;
  candidates: ProvisionVersionCandidate[];
  warnings: string[];
  matterId: string | null;
  evidenceItemId: string | null;
}

function result(outcome: RetrievalOutcome, warnings: string[], provisionVersion: ProvisionVersionCandidate | null = null, candidates: ProvisionVersionCandidate[] = []): Omit<RetrievalResult, "matterId" | "evidenceItemId"> {
  return { outcome, requiresResearch: !RESOLVED_OUTCOMES.includes(outcome), provisionVersion, candidates, warnings };
}

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// ---------------------------------------------------------------------------
// Core resolver — pure, synchronous, fully testable in memory. No repository, no network, no
// database. Takes every already-fetched provision-version candidate for ONE provision and
// resolves which VERIFIED one (if any) applies on the given case date.
// ---------------------------------------------------------------------------

/**
 * Resolves the applicable VERIFIED provision-version for a case date, defaulting to
 * VERIFIED-only: UNVERIFIED/COMMITTED_INSPECTION/REJECTED never silently become trusted
 * authority. A corrupted VERIFIED record (stored text/hash inconsistent with the deterministic
 * rules in legalCorpus.ts) fails closed as INTEGRITY_FAILURE rather than being trusted or
 * silently repaired. Deterministic ordering: input order never affects the result — versions
 * are always sorted by (effectiveFrom, id) before any comparison.
 */
export function resolveProvisionVersion(versions: ProvisionVersionCandidate[], caseDate: CaseDate): Omit<RetrievalResult, "matterId" | "evidenceItemId"> {
  // Integrity check first, over every version regardless of verification state, before any
  // date logic runs — a corrupted VERIFIED row must halt trust immediately.
  for (const v of versions) {
    try {
      validateProvisionVersionCandidate(v);
    } catch {
      if (v.verificationStatus === "VERIFIED") {
        return result("INTEGRITY_FAILURE", [`Provision-version ${v.id} is marked VERIFIED but fails deterministic text/checksum validation.`]);
      }
    }
  }

  if (versions.length === 0) return result("NO_MATCH", ["No provision-version records exist for this provision."]);

  const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Overlap detection over ALL versions (any verification state) — same half-open-interval,
  // sorted-adjacent-pair algorithm as legalAuthority.ts's resolveApplicableVersion, which is
  // mathematically sufficient (proven there) to catch any overlap in a start-sorted list.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.effectiveTo === null || prev.effectiveTo > sorted[i].effectiveFrom) {
      return result("OVERLAPPING_VERSIONS", [`Provision-versions ${prev.id} and ${sorted[i].id} have overlapping or invalid effective ranges.`]);
    }
  }

  if (caseDate.kind === "UNKNOWN") return result("UNKNOWN_DATE", ["No case date was provided; provision-version cannot be resolved."]);
  if (!isIsoDate(caseDate.date)) return result("INVALID_CASE_DATE", ["The case date is not a valid ISO date."]);

  const verified = sorted.filter((v) => v.verificationStatus === "VERIFIED");
  if (verified.length === 0) {
    return result("UNVERIFIED_ONLY", ["Only non-VERIFIED provision-version records exist; none are eligible for normal retrieval."]);
  }

  const d = caseDate.date;
  const matches = verified.filter((v) => v.effectiveFrom <= d && (v.effectiveTo === null || d < v.effectiveTo));

  if (matches.length > 1) return result("MULTIPLE_MATCHES", ["More than one VERIFIED provision-version matches this date."], null, matches);

  if (matches.length === 0) {
    const earliest = verified[0];
    const latest = verified[verified.length - 1];
    if (d < earliest.effectiveFrom) return result("BEFORE_EARLIEST_VERSION", ["The case date precedes the earliest VERIFIED provision-version."]);
    if (latest.effectiveTo !== null && d >= latest.effectiveTo) return result("AFTER_LAST_CLOSED_VERSION", ["The case date is after the last VERIFIED provision-version's range, and no open-ended version exists."]);
    return result("GAP_IN_COVERAGE", ["The case date falls in a gap between VERIFIED provision-versions."]);
  }

  const match = matches[0];
  return result(match.effectiveTo === null ? "RESOLVED_OPEN_ENDED" : "RESOLVED", [], match, [match]);
}

// ---------------------------------------------------------------------------
// Repository abstraction — narrow, provider-independent. No concrete Supabase implementation
// is included in this milestone; this is the seam a future server-side adapter would implement.
// Every method is read-only. A future adapter must derive the caller's identity server-side
// (verified Firebase UID) exactly like the existing Stage 4/5/6 services do — client-supplied
// identity is never authoritative — but that wiring belongs to the adapter, not this contract.
// ---------------------------------------------------------------------------

export interface LegalCorpusRepository {
  findProvisionByCitation(legalSourceId: string, normalizedCitation: string): Promise<LegalProvision | null>;
  findProvisionVersions(provisionId: string): Promise<ProvisionVersionCandidate[]>;
}

/**
 * Orchestrates citation normalization, provision lookup, and version resolution. This is the
 * only function in this file that touches the repository; `resolveProvisionVersion` above
 * remains independently testable without one.
 */
export async function retrieveLegalAuthority(input: ProvisionRetrievalInput, repository: LegalCorpusRepository): Promise<RetrievalResult> {
  if (!input || typeof input !== "object") throw invalid("Retrieval input is required.");
  const legalSourceId = requireUuid(input.legalSourceId, "legalSourceId");
  const normalizedCitation = normalizeProvisionCitation(input.citation);
  const matterId = input.matterId != null ? requireUuid(input.matterId, "matterId") : null;
  const evidenceItemId = input.evidenceItemId != null ? requireUuid(input.evidenceItemId, "evidenceItemId") : null;

  const provision = await repository.findProvisionByCitation(legalSourceId, normalizedCitation);
  if (!provision) {
    return { outcome: "PROVISION_NOT_FOUND", requiresResearch: true, provisionVersion: null, candidates: [], warnings: [`No provision found for citation "${normalizedCitation}" under this legal source.`], matterId, evidenceItemId };
  }
  const versions = await repository.findProvisionVersions(provision.id);
  const resolved = resolveProvisionVersion(versions, input.caseDate);
  return { ...resolved, matterId, evidenceItemId };
}
