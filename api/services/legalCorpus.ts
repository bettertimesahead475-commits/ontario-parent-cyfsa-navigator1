// Stage 6 Milestone 2-A — legal corpus schema hardening & snapshot versioning.
// Deterministic, provider-independent logic only. No live model calls (Claude/Gemini/OpenAI),
// no website fetches, no statute ingestion, no legal selection/RAG. Infrastructure only.
// Retrieved legal source text is UNTRUSTED DATA: nothing here interprets it as instructions,
// nothing here lets it choose its own source identity, and nothing here can promote it to
// VERIFIED — every verifying call requires an explicit human accounts(id) argument.
import { LifecycleError, requireUuid } from "./lifecycleErrors.js";
import { hash } from "./pageSources.js";

const invalid = (message: string) => new LifecycleError(400, "INVALID_LEGAL_CORPUS", message);

export const VERIFICATION_STATES = ["UNVERIFIED", "COMMITTED_INSPECTION", "VERIFIED", "REJECTED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATES)[number];

export const INGESTION_STATUSES = ["RETRIEVED", "PARSED", "VALIDATED", "REJECTED"] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export const LINEAGE_TYPES = ["AMENDMENT", "RENUMBERING", "SPLIT", "MERGE", "REPEAL", "REENACTMENT"] as const;
export type LineageType = (typeof LINEAGE_TYPES)[number];

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

// ---------------------------------------------------------------------------
// Deterministic text normalization and checksum. Conservative by design: only Unicode
// canonical composition and line-ending normalization are applied. Internal whitespace,
// punctuation, and casing are never altered — a statute's spacing/punctuation can be legally
// meaningful, unlike Stage 4's quote-matching whitespace tolerance (a different purpose).
// ---------------------------------------------------------------------------

/**
 * Canonical normalization for stored provision text:
 * 1. Unicode NFC normalization (canonical composition only — no compatibility folding).
 * 2. Line endings CRLF/CR -> LF.
 * 3. Leading/trailing whitespace of the whole text trimmed.
 * Internal whitespace runs, punctuation, and all other characters are preserved exactly.
 */
export function normalizeProvisionText(text: string): string {
  if (typeof text !== "string" || !text.trim()) throw invalid("Provision text is required.");
  return text.normalize("NFC").replace(/\r\n|\r/g, "\n").trim();
}

/** SHA-256 of the exact UTF-8 bytes of the given string, hex-encoded. Reuses Stage 4's checksum function rather than a second hashing convention. */
export const sha256Hex = (text: string): string => hash(text);

// ---------------------------------------------------------------------------
// Provision-version candidate validation.
// ---------------------------------------------------------------------------

export interface ProvisionVersionCandidate {
  id: string;
  provisionId: string;
  legalSourceId: string;
  legalSourceVersionId: string;
  effectiveFrom: string; // ISO date, inclusive
  effectiveTo: string | null; // ISO date, exclusive; null = open-ended
  exactText: string;
  normalizedText: string;
  textSha256: string;
  verificationStatus: VerificationStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * Validates a provision-version candidate deterministically, including recomputing
 * normalization and checksum from exactText and requiring an exact match — a caller cannot
 * submit a normalizedText or textSha256 disconnected from the actual exactText. This is the
 * corpus-poisoning defense for this table: retrieved text can never assert its own checksum.
 */
export function validateProvisionVersionCandidate(value: unknown): ProvisionVersionCandidate {
  const v = value as any;
  if (!v || typeof v !== "object") throw invalid("Provision-version candidate must be an object.");
  requireUuid(v.id, "id");
  requireUuid(v.provisionId, "provisionId");
  requireUuid(v.legalSourceId, "legalSourceId");
  requireUuid(v.legalSourceVersionId, "legalSourceVersionId");
  if (!isIsoDate(v.effectiveFrom)) throw invalid("effectiveFrom must be an ISO date.");
  if (v.effectiveTo !== null && !isIsoDate(v.effectiveTo)) throw invalid("effectiveTo must be an ISO date or null.");
  if (v.effectiveTo !== null && !(v.effectiveTo > v.effectiveFrom)) throw invalid("effectiveTo must be strictly after effectiveFrom.");
  if (typeof v.exactText !== "string" || v.exactText.length < 1 || v.exactText.length > 50000) throw invalid("exactText length out of bounds.");
  const expectedNormalized = normalizeProvisionText(v.exactText);
  if (v.normalizedText !== expectedNormalized) throw invalid("normalizedText does not match the deterministic normalization of exactText.");
  const expectedHash = sha256Hex(expectedNormalized);
  if (!isSha256(v.textSha256) || v.textSha256 !== expectedHash) throw invalid("textSha256 does not match the deterministic checksum of normalizedText.");
  if (!VERIFICATION_STATES.includes(v.verificationStatus)) throw invalid("Unknown verification status.");
  if (v.verificationStatus === "VERIFIED") {
    requireUuid(v.verifiedBy, "verifiedBy");
    if (typeof v.verifiedAt !== "string" || Number.isNaN(Date.parse(v.verifiedAt))) throw invalid("verifiedAt is required when VERIFIED.");
  } else if (v.verifiedBy !== null || v.verifiedAt !== null) {
    throw invalid("verifiedBy/verifiedAt must be null unless verificationStatus is VERIFIED.");
  }
  return v as ProvisionVersionCandidate;
}

/**
 * The only path by which a provision-version may move to VERIFIED, REJECTED, or
 * COMMITTED_INSPECTION. `verifiedBy` must be a real human accounts(id) — there is no AI
 * identity this function will accept, and no caller in this codebase may synthesize one.
 * Once `current` is VERIFIED this always throws: verified content is immutable (also enforced
 * at the database layer by navigator_provision_version_immutable).
 */
export function validateVerificationTransition(
  current: VerificationStatus,
  next: VerificationStatus,
  verifiedBy: string | null,
): void {
  if (!VERIFICATION_STATES.includes(next)) throw invalid("Unknown target verification status.");
  if (current === "VERIFIED") throw invalid("Verified provision-version content is immutable.");
  if (next === "VERIFIED") {
    if (!verifiedBy) throw invalid("Promoting to VERIFIED requires a human verifiedBy account id.");
    requireUuid(verifiedBy, "verifiedBy");
  } else if (verifiedBy != null) {
    throw invalid("verifiedBy must be omitted unless promoting to VERIFIED.");
  }
}

// ---------------------------------------------------------------------------
// Source snapshot candidate validation.
// ---------------------------------------------------------------------------

export interface SourceSnapshotCandidate {
  id: string;
  legalSourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  rawContent: string;
  contentSha256: string;
  ingestionStatus: IngestionStatus;
}

/** Validates a source-snapshot candidate, recomputing and requiring an exact checksum match against the raw payload — the snapshot can never assert its own integrity. */
export function validateSourceSnapshotCandidate(value: unknown): SourceSnapshotCandidate {
  const v = value as any;
  if (!v || typeof v !== "object") throw invalid("Source snapshot candidate must be an object.");
  requireUuid(v.id, "id");
  requireUuid(v.legalSourceId, "legalSourceId");
  if (typeof v.sourceUrl !== "string" || !/^https:\/\//.test(v.sourceUrl)) throw invalid("sourceUrl must be https.");
  if (typeof v.retrievedAt !== "string" || Number.isNaN(Date.parse(v.retrievedAt))) throw invalid("retrievedAt must be a valid timestamp.");
  if (typeof v.rawContent !== "string" || v.rawContent.length < 1 || v.rawContent.length > 5_000_000) throw invalid("rawContent length out of bounds.");
  const expectedHash = sha256Hex(v.rawContent);
  if (!isSha256(v.contentSha256) || v.contentSha256 !== expectedHash) throw invalid("contentSha256 does not match the raw payload checksum.");
  if (!INGESTION_STATUSES.includes(v.ingestionStatus)) throw invalid("Unknown ingestion status.");
  return v as SourceSnapshotCandidate;
}

// ---------------------------------------------------------------------------
// Lineage candidate validation.
// ---------------------------------------------------------------------------

export interface LineageCandidate {
  predecessorVersionId: string;
  successorVersionId: string;
  lineageType: LineageType;
}

export function validateLineageCandidate(value: unknown): LineageCandidate {
  const v = value as any;
  if (!v || typeof v !== "object") throw invalid("Lineage candidate must be an object.");
  requireUuid(v.predecessorVersionId, "predecessorVersionId");
  requireUuid(v.successorVersionId, "successorVersionId");
  if (v.predecessorVersionId === v.successorVersionId) throw invalid("A provision-version cannot link to itself.");
  if (!LINEAGE_TYPES.includes(v.lineageType)) throw invalid("Unknown lineage type.");
  return v as LineageCandidate;
}

/** True when a proposed edge duplicates an existing one (same predecessor/successor/type). Callers own the actual existing-edge lookup; this is the deterministic comparison only. */
export function isDuplicateLineageEdge(existing: LineageCandidate[], candidate: LineageCandidate): boolean {
  return existing.some(
    (e) =>
      e.predecessorVersionId === candidate.predecessorVersionId &&
      e.successorVersionId === candidate.successorVersionId &&
      e.lineageType === candidate.lineageType,
  );
}

// ---------------------------------------------------------------------------
// Source trust classification. Official government publishers only are AUTHORITATIVE;
// everything else (including CanLII) is SECONDARY and may never become the source of record
// for a provision-version while an official publisher is available.
// ---------------------------------------------------------------------------

export type SourceTrust = "AUTHORITATIVE" | "SECONDARY";

const AUTHORITATIVE_PUBLISHERS: Record<"ON" | "CA", RegExp> = {
  ON: /^e-Laws \(Government of Ontario\)$/,
  CA: /^Justice Laws Canada$/,
};

/** Deterministic publisher-string classification. Does not fetch or verify anything — it only decides whether a given (jurisdiction, publisher) pair may ever be treated as the authoritative source of record. */
export function classifySourceTrust(jurisdiction: "ON" | "CA", officialPublisher: string): SourceTrust {
  const pattern = AUTHORITATIVE_PUBLISHERS[jurisdiction];
  return pattern && pattern.test(officialPublisher) ? "AUTHORITATIVE" : "SECONDARY";
}
