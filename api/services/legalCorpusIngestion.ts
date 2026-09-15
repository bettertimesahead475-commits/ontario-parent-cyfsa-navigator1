// Stage 6 Milestone 2-B — controlled authoritative legal corpus ingestion.
// Deterministic and provider-independent throughout: no AI call classifies source authority,
// parses provision boundaries, or promotes anything to VERIFIED. Retrieved/parsed text is
// UNTRUSTED DATA — nothing here executes it, treats it as instructions, or lets it declare its
// own authority, verification state, or provenance. This module defines the retrieval/parsing
// infrastructure only; no live network call to a real government server happens anywhere in
// this repository as part of this milestone (every test injects a mock fetch implementation).
import { isIP } from "node:net";
import { LifecycleError, requireUuid } from "./lifecycleErrors.js";
import {
  normalizeProvisionText,
  sha256Hex,
  validateProvisionVersionCandidate,
  validateSourceSnapshotCandidate,
  type ProvisionVersionCandidate,
  type SourceSnapshotCandidate,
} from "./legalCorpus.js";

const invalid = (message: string) => new LifecycleError(400, "INVALID_LEGAL_INGESTION", message);

// ---------------------------------------------------------------------------
// A. Source policy — deterministic hostname allowlist. Authority is always derived from the
// actual URL, never from a caller-supplied "this is authoritative" claim.
// ---------------------------------------------------------------------------

export type Jurisdiction = "ON" | "CA";
export type RetrievalAuthority = "AUTHORITATIVE" | "SECONDARY" | "UNKNOWN";

const AUTHORITATIVE_HOSTNAMES: Record<Jurisdiction, readonly string[]> = {
  ON: ["www.ontario.ca", "ontario.ca"],
  CA: ["laws-lois.justice.gc.ca"],
};
const SECONDARY_HOSTNAMES: readonly string[] = ["www.canlii.org", "canlii.org"];

/** Pure hostname classification. Never fetches, never trusts caller-declared labels. */
export function classifyRetrievalHostname(jurisdiction: Jurisdiction, hostname: string): RetrievalAuthority {
  const host = hostname.toLowerCase();
  if (AUTHORITATIVE_HOSTNAMES[jurisdiction].includes(host)) return "AUTHORITATIVE";
  if (SECONDARY_HOSTNAMES.includes(host)) return "SECONDARY";
  return "UNKNOWN";
}

/** The only hostnames retrieval is ever permitted to target for a jurisdiction: authoritative government publishers only. Secondary sources (CanLII, etc.) are never a retrieval target of this pipeline, even though they are a recognized research classification elsewhere in the corpus model. */
export function approvedRetrievalHostnames(jurisdiction: Jurisdiction): readonly string[] {
  return AUTHORITATIVE_HOSTNAMES[jurisdiction];
}

// ---------------------------------------------------------------------------
// B. Retrieval boundary — SSRF-sensitive. Every URL (including redirect targets) is
// independently re-validated against the same deterministic allowlist; nothing about a URL's
// history or a caller's label exempts it from this check.
// ---------------------------------------------------------------------------

function isPrivateOrLoopbackIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true; // fail closed
  const [a, b] = parts;
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isPrivateOrLoopbackIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  );
}

/**
 * Validates a retrieval target deterministically before any network call. Rejects: non-https
 * protocols (including file://), embedded credentials, non-standard ports, localhost, any raw
 * IP literal (private or not — only approved hostnames are ever permitted, which excludes
 * direct-IP access entirely, including cloud metadata endpoints like 169.254.169.254), and any
 * hostname not on the caller-supplied allowlist.
 */
export function validateRetrievalUrl(rawUrl: string, allowedHostnames: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalid("Malformed retrieval URL.");
  }
  if (url.protocol !== "https:") throw invalid("Only https retrieval is permitted.");
  if (url.username || url.password) throw invalid("Retrieval URL must not embed credentials.");
  if (url.port && url.port !== "443") throw invalid("Non-standard port is not permitted.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw invalid("Localhost is not a permitted retrieval target.");
  const ipKind = isIP(hostname);
  if (ipKind === 4 && isPrivateOrLoopbackIPv4(hostname)) throw invalid("Private or loopback IPv4 target is not permitted.");
  if (ipKind === 6 && isPrivateOrLoopbackIPv6(hostname)) throw invalid("Private or loopback IPv6 target is not permitted.");
  if (ipKind !== 0) throw invalid("Direct IP retrieval targets are not permitted; only approved hostnames may be used.");
  if (!allowedHostnames.map((h) => h.toLowerCase()).includes(hostname)) throw invalid("Hostname is not on the approved retrieval allowlist.");
  return url;
}

export interface RetrievalConfig {
  maxBytes: number;
  minBytes: number;
  timeoutMs: number;
  allowedHostnames: readonly string[];
  allowedContentTypePrefixes: readonly string[];
  maxRedirects: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: Omit<RetrievalConfig, "allowedHostnames"> = {
  maxBytes: 5_000_000,
  minBytes: 50,
  timeoutMs: 15_000,
  allowedContentTypePrefixes: ["text/html", "text/plain", "application/xhtml+xml"],
  maxRedirects: 1,
};

export interface RetrievalResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type RetrievalFetcher = (url: URL, init: { redirect: "manual"; signal: AbortSignal }) => Promise<RetrievalResponse>;

export interface RetrievalResult {
  finalUrl: string;
  contentType: string | null;
  rawContent: string;
}

/**
 * Controlled retrieval: validates the target, calls the injected fetcher with a bounded timeout,
 * manually validates any redirect target against the same allowlist (never auto-follows), and
 * bounds/validates the response before returning raw text. Never parses or interprets content —
 * that is the parser's job (section E), kept deliberately separate from retrieval.
 */
export async function retrieveApprovedSource(rawUrl: string, config: RetrievalConfig, fetchImpl: RetrievalFetcher): Promise<RetrievalResult> {
  let url = validateRetrievalUrl(rawUrl, config.allowedHostnames);
  for (let hop = 0; ; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: RetrievalResponse;
    try {
      response = await fetchImpl(url, { redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      if (hop >= config.maxRedirects) throw invalid("Too many redirects.");
      const location = response.headers.get("location");
      if (!location) throw invalid("Redirect response is missing a Location header.");
      url = validateRetrievalUrl(new URL(location, url).toString(), config.allowedHostnames);
      continue;
    }
    if (response.status !== 200) throw invalid(`Unexpected retrieval status ${response.status}.`);
    const contentType = response.headers.get("content-type");
    if (!contentType || !config.allowedContentTypePrefixes.some((p) => contentType.toLowerCase().startsWith(p))) {
      throw invalid("Unexpected or missing content type.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > config.maxBytes) throw invalid("Retrieved content exceeds the maximum allowed size.");
    if (buffer.byteLength < config.minBytes) throw invalid("Retrieved content is unexpectedly small.");
    let rawContent: string;
    try {
      rawContent = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw invalid("Retrieved content is not valid UTF-8.");
    }
    // eslint-disable-next-line no-control-regex
    if (/[ --]/.test(rawContent)) throw invalid("Retrieved content contains unexpected control characters.");
    return { finalUrl: url.toString(), contentType, rawContent };
  }
}

// ---------------------------------------------------------------------------
// C/D. Snapshot candidate construction and duplicate/change detection.
// ---------------------------------------------------------------------------

export function buildSnapshotCandidate(input: {
  id: string;
  legalSourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  rawContent: string;
}): SourceSnapshotCandidate {
  return validateSourceSnapshotCandidate({
    ...input,
    contentSha256: sha256Hex(input.rawContent),
    ingestionStatus: "RETRIEVED",
  });
}

export type SnapshotChangeClassification = "NEW" | "UNCHANGED" | "SOURCE_CHANGED";

/** A changed checksum means the retrieved content changed — never interpreted as "the law changed." */
export function classifySnapshotChange(previous: { contentSha256: string } | null, candidate: { contentSha256: string }): SnapshotChangeClassification {
  if (!previous) return "NEW";
  return previous.contentSha256 === candidate.contentSha256 ? "UNCHANGED" : "SOURCE_CHANGED";
}

export function isDuplicateSnapshot(
  existing: readonly { legalSourceId: string; sourceUrl: string; contentSha256: string }[],
  candidate: { legalSourceId: string; sourceUrl: string; contentSha256: string },
): boolean {
  return existing.some((e) => e.legalSourceId === candidate.legalSourceId && e.sourceUrl === candidate.sourceUrl && e.contentSha256 === candidate.contentSha256);
}

// ---------------------------------------------------------------------------
// E. Deterministic parser — line-based, no LLM. Recognizes section/subsection/paragraph
// structure; clause-level (roman numeral) nesting is deliberately not yet decomposed into its
// own candidates in this milestone (absorbed into its parent paragraph text, flagged PARTIAL),
// since Ontario statutes do not uniformly nest to that depth and guessing would be unsafe.
// ---------------------------------------------------------------------------

export const PARSER_VERSION = "cyfsa-line-parser-v1";
export type ParseStatus = "PARSED" | "PARTIAL" | "UNSUPPORTED" | "FAILED";

export interface ParsedProvisionCandidate {
  citation: string;
  parentCitation: string | null;
  exactText: string;
}
export interface ParseResult {
  status: ParseStatus;
  provisions: ParsedProvisionCandidate[];
  warnings: string[];
}

const SECTION_HEADER = /^(\d+[a-zA-Z]?)\.\s+(.+)$/;
const SUBSECTION_MARKER = /^\((\d{1,3})\)\s*(.*)$/;
const PARAGRAPH_MARKER = /^\(([a-z])\)\s*(.*)$/;
const CLAUSE_MARKER = /^\(([ivxlcdm]{2,})\)\s*(.*)$/i;

/** Normalizes "s. 74", "section 74", and "74" (in section-header context) to the same canonical `s.74` — but never collapses a subsection/paragraph/clause suffix into its parent's identity. */
export function normalizeSectionLabel(raw: string): string {
  const m = raw.trim().match(/^(?:s\.?\s*|section\s+)?(\d+[a-zA-Z]?)\.?$/i);
  if (!m) throw invalid("Unrecognized section label.");
  return `s.${m[1]}`;
}

export function parseStatuteExcerpt(rawText: string): ParseResult {
  if (typeof rawText !== "string" || !rawText.trim()) return { status: "FAILED", provisions: [], warnings: ["Empty input."] };

  const lines = rawText.split(/\r\n|\r|\n/);
  const provisions = new Map<string, { parentCitation: string | null; parts: string[] }>();
  const warnings: string[] = [];
  let sectionCitation: string | null = null;
  let subsectionCitation: string | null = null;
  let paragraphCitation: string | null = null;
  let sawAnyMarker = false;
  let sawUnsupportedNesting = false;

  const ensure = (citation: string, parentCitation: string | null) => {
    if (!provisions.has(citation)) provisions.set(citation, { parentCitation, parts: [] });
  };
  const append = (citation: string, text: string) => {
    if (text) provisions.get(citation)!.parts.push(text);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(SECTION_HEADER))) {
      sectionCitation = normalizeSectionLabel(m[1]);
      subsectionCitation = null;
      paragraphCitation = null;
      ensure(sectionCitation, null);
      append(sectionCitation, m[2]);
      sawAnyMarker = true;
    } else if (sectionCitation && (m = line.match(SUBSECTION_MARKER))) {
      subsectionCitation = `${sectionCitation}(${m[1]})`;
      paragraphCitation = null;
      ensure(subsectionCitation, sectionCitation);
      append(subsectionCitation, m[2]);
      sawAnyMarker = true;
    } else if ((subsectionCitation ?? sectionCitation) && (m = line.match(PARAGRAPH_MARKER))) {
      const parent = subsectionCitation ?? sectionCitation!;
      paragraphCitation = `${parent}(${m[1]})`;
      ensure(paragraphCitation, parent);
      append(paragraphCitation, m[2]);
      sawAnyMarker = true;
    } else if ((m = line.match(CLAUSE_MARKER))) {
      sawUnsupportedNesting = true;
      const parent = paragraphCitation ?? subsectionCitation ?? sectionCitation;
      if (parent) append(parent, line);
      else warnings.push(`Clause-level marker encountered with no open parent provision: "${line}"`);
    } else {
      const parent = paragraphCitation ?? subsectionCitation ?? sectionCitation;
      if (parent) append(parent, line);
      else warnings.push(`Unclassified text before any recognized section header: "${line}"`);
    }
  }

  if (!sawAnyMarker) return { status: "UNSUPPORTED", provisions: [], warnings: ["No recognizable section/subsection/paragraph structure was found."] };
  if (sawUnsupportedNesting) {
    warnings.push(
      "Clause-level (roman numeral) nesting was encountered and absorbed into its parent paragraph text; this milestone does not create separate clause-level provision candidates.",
    );
  }

  const result: ParsedProvisionCandidate[] = [...provisions.entries()]
    .map(([citation, v]) => ({ citation, parentCitation: v.parentCitation, exactText: v.parts.join(" ").trim() }))
    .filter((p) => p.exactText.length > 0);

  if (result.length === 0) return { status: "FAILED", provisions: [], warnings: [...warnings, "No non-empty provision text was extracted."] };

  return { status: warnings.length > 0 ? "PARTIAL" : "PARSED", provisions: result, warnings };
}

// ---------------------------------------------------------------------------
// Effective-date handling — never invents a date.
// ---------------------------------------------------------------------------

export interface IngestionEffectiveDate {
  status: "KNOWN" | "REQUIRES_INSPECTION";
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Only a recognizable ISO date supplied by the authoritative source's own metadata is used.
 * Retrieval date, upload date, and current date are never substituted — this function has no
 * access to any of those values in the first place, by design, so it cannot fall back to them.
 */
export function resolveIngestionEffectiveDate(metadataEffectiveFrom: unknown, metadataEffectiveTo: unknown): IngestionEffectiveDate {
  if (!isIsoDate(metadataEffectiveFrom)) return { status: "REQUIRES_INSPECTION", effectiveFrom: null, effectiveTo: null };
  if (metadataEffectiveTo == null) return { status: "KNOWN", effectiveFrom: metadataEffectiveFrom, effectiveTo: null };
  if (!isIsoDate(metadataEffectiveTo)) return { status: "REQUIRES_INSPECTION", effectiveFrom: null, effectiveTo: null };
  return { status: "KNOWN", effectiveFrom: metadataEffectiveFrom, effectiveTo: metadataEffectiveTo };
}

// ---------------------------------------------------------------------------
// F. Provision-version candidate construction. There is no parameter through which a caller
// can request anything other than UNVERIFIED — ingestion is structurally unable to verify.
// ---------------------------------------------------------------------------

export interface ProvisionVersionIngestionInput {
  id: string;
  provisionId: string;
  legalSourceId: string;
  legalSourceVersionId: string;
  exactText: string;
  effectiveDate: IngestionEffectiveDate;
}
export type ProvisionVersionIngestionResult =
  | { status: "CANDIDATE"; candidate: ProvisionVersionCandidate }
  | { status: "REQUIRES_EFFECTIVE_DATE_INSPECTION"; reason: string };

export function buildProvisionVersionIngestionCandidate(input: ProvisionVersionIngestionInput): ProvisionVersionIngestionResult {
  if (input.effectiveDate.status !== "KNOWN" || !input.effectiveDate.effectiveFrom) {
    return {
      status: "REQUIRES_EFFECTIVE_DATE_INSPECTION",
      reason: "No deterministically known effective date was available from the source; a date is never invented or substituted from retrieval/upload/current date.",
    };
  }
  requireUuid(input.id, "id");
  requireUuid(input.provisionId, "provisionId");
  requireUuid(input.legalSourceId, "legalSourceId");
  requireUuid(input.legalSourceVersionId, "legalSourceVersionId");
  const normalizedText = normalizeProvisionText(input.exactText);
  const candidate: ProvisionVersionCandidate = {
    id: input.id,
    provisionId: input.provisionId,
    legalSourceId: input.legalSourceId,
    legalSourceVersionId: input.legalSourceVersionId,
    effectiveFrom: input.effectiveDate.effectiveFrom,
    effectiveTo: input.effectiveDate.effectiveTo,
    exactText: input.exactText,
    normalizedText,
    textSha256: sha256Hex(normalizedText),
    verificationStatus: "UNVERIFIED",
    verifiedBy: null,
    verifiedAt: null,
  };
  return { status: "CANDIDATE", candidate: validateProvisionVersionCandidate(candidate) };
}

// ---------------------------------------------------------------------------
// Duplicate/change classification for provision-version candidates across ingestion runs.
// ---------------------------------------------------------------------------

export type ProvisionChangeClassification = "NEW" | "UNCHANGED" | "SOURCE_CHANGED" | "PARSER_CHANGED" | "REQUIRES_INSPECTION";

/**
 * Conservative by design: a text-checksum difference is SOURCE_CHANGED (never "amended"), a
 * parser-version difference alone is PARSER_CHANGED, and both changing together is
 * REQUIRES_INSPECTION because the cause cannot be attributed to just one factor.
 */
export function classifyProvisionCandidateChange(
  previous: { textSha256: string; parserVersion: string } | null,
  candidate: { textSha256: string },
  parserVersion: string,
): ProvisionChangeClassification {
  if (!previous) return "NEW";
  const textChanged = previous.textSha256 !== candidate.textSha256;
  const parserChanged = previous.parserVersion !== parserVersion;
  if (!textChanged && !parserChanged) return "UNCHANGED";
  if (textChanged && !parserChanged) return "SOURCE_CHANGED";
  if (!textChanged && parserChanged) return "PARSER_CHANGED";
  return "REQUIRES_INSPECTION";
}

// ---------------------------------------------------------------------------
// Human verification queue — a deterministic data contract only, no persistence, no UI.
// ---------------------------------------------------------------------------

export interface VerificationQueueEntry {
  legalSourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  citation: string;
  exactText: string;
  normalizedText: string;
  textSha256: string;
  effectiveDate: IngestionEffectiveDate;
  previousTextSha256: string | null;
  parseStatus: ParseStatus;
  changeClassification: ProvisionChangeClassification;
  reasonsForInspection: string[];
}

export function buildVerificationQueueEntry(input: {
  legalSourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  citation: string;
  exactText: string;
  effectiveDate: IngestionEffectiveDate;
  previousTextSha256: string | null;
  parseStatus: ParseStatus;
  changeClassification: ProvisionChangeClassification;
}): VerificationQueueEntry {
  const normalizedText = normalizeProvisionText(input.exactText);
  const textSha256 = sha256Hex(normalizedText);
  const reasons: string[] = [];
  if (input.effectiveDate.status !== "KNOWN") reasons.push("Effective date could not be determined from source metadata.");
  if (input.parseStatus !== "PARSED") reasons.push(`Parser status was ${input.parseStatus}, not PARSED.`);
  if (input.changeClassification !== "NEW" && input.changeClassification !== "UNCHANGED") reasons.push(`Change classification: ${input.changeClassification}.`);
  if (reasons.length === 0) reasons.push("New candidate requires human review before it may be promoted to VERIFIED.");
  return { ...input, normalizedText, textSha256, reasonsForInspection: reasons };
}
