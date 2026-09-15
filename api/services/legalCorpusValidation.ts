// Stage 6 Milestone 2-C — controlled legal corpus validation.
// Validates the M2-A/M2-B architecture against a small, real, authoritative Ontario legal
// sample. This module adds no new capability — it is a thin, deterministic orchestration over
// M2-B's existing functions, plus the exact configuration for the one real source this
// milestone validates against (CYFSA, s.74). No AI call, no new persistence, no new schema.
import {
  approvedRetrievalHostnames,
  retrieveApprovedSource,
  buildSnapshotCandidate,
  classifySnapshotChange,
  parseStatuteExcerpt,
  resolveIngestionEffectiveDate,
  buildProvisionVersionIngestionCandidate,
  classifyProvisionCandidateChange,
  buildVerificationQueueEntry,
  PARSER_VERSION,
  type Jurisdiction,
  type RetrievalFetcher,
  type ParseResult,
  type SnapshotChangeClassification,
  type ProvisionChangeClassification,
  type VerificationQueueEntry,
} from "./legalCorpusIngestion.js";
import { isPrivateOrLoopbackIPv4, isPrivateOrLoopbackIPv6 } from "./legalCorpusIngestion.js";
import type { SourceSnapshotCandidate } from "./legalCorpus.js";
import { isIP } from "node:net";

/**
 * The one real source this milestone validates against. This is configuration, not a claim
 * that the corpus has been ingested — no row exists in any database as a result of this file.
 */
export const CYFSA_VALIDATION_TARGET = {
  jurisdiction: "ON" as Jurisdiction,
  sourceUrl: "https://www.ontario.ca/laws/statute/17c14",
  citation: "S.O. 2017, c. 14, Sched. 1",
  officialPublisher: "e-Laws (Government of Ontario)",
};

export interface LiveRetrievalAttempt {
  performed: boolean;
  succeeded: boolean;
  requestedUrl: string;
  finalUrl: string | null;
  errorMessage: string | null;
}

/**
 * Attempts one real retrieval through M2-B's own retrieval boundary — never a separate,
 * unrelated HTTP client. This is best-effort and environment-dependent (many sandboxed
 * environments block outbound network entirely); it must never be relied on by deterministic
 * tests. Callers decide what "performed" means for their environment; this function only
 * reports what actually happened, honestly, including a denial or network error.
 */
export async function attemptLiveCyfsaRetrieval(fetchImpl: RetrievalFetcher): Promise<LiveRetrievalAttempt> {
  const config = {
    maxBytes: 5_000_000,
    minBytes: 50,
    timeoutMs: 15_000,
    allowedHostnames: approvedRetrievalHostnames(CYFSA_VALIDATION_TARGET.jurisdiction),
    allowedContentTypePrefixes: ["text/html", "text/plain", "application/xhtml+xml"],
    maxRedirects: 1,
  };
  try {
    const result = await retrieveApprovedSource(CYFSA_VALIDATION_TARGET.sourceUrl, config, fetchImpl);
    return { performed: true, succeeded: true, requestedUrl: CYFSA_VALIDATION_TARGET.sourceUrl, finalUrl: result.finalUrl, errorMessage: null };
  } catch (e) {
    return {
      performed: true,
      succeeded: false,
      requestedUrl: CYFSA_VALIDATION_TARGET.sourceUrl,
      finalUrl: null,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// DNS / destination-IP observability (informational only — see STAGE_6_M2C doc for the
// documented limitation this does NOT solve: TOCTOU / DNS-rebinding).
// ---------------------------------------------------------------------------

export interface DnsResolver {
  (hostname: string): Promise<string[]>;
}

export interface DestinationIpObservation {
  hostname: string;
  resolvedIps: string[];
  privateOrLoopbackIps: string[];
  safe: boolean;
}

/**
 * Resolves a hostname via an injected resolver and classifies each resolved address as
 * private/loopback or not. This is observability, not enforcement: Node's own `fetch`
 * performs its own independent DNS resolution when the actual request is made, so a hostname
 * resolving safely here provides no guarantee about the IP the real connection will use a
 * moment later (classic TOCTOU / DNS-rebinding exposure). True connection-level IP pinning
 * would require overriding the HTTP transport's own connect step (a Node `Agent`/dispatcher
 * with a custom `lookup`), which is a larger transport redesign intentionally deferred — see
 * STAGE_6_M2C_LEGAL_CORPUS_VALIDATION.md "Unresolved hardening items." This function never
 * weakens `validateRetrievalUrl`'s hostname allowlist; it only adds a second, independent,
 * point-in-time signal on top of it.
 */
export async function observeDestinationIps(hostname: string, resolve: DnsResolver): Promise<DestinationIpObservation> {
  const resolvedIps = await resolve(hostname);
  const privateOrLoopbackIps = resolvedIps.filter((ip) => {
    const kind = isIP(ip);
    if (kind === 4) return isPrivateOrLoopbackIPv4(ip);
    if (kind === 6) return isPrivateOrLoopbackIPv6(ip);
    return true; // not a parseable IP at all — fail closed, treat as unsafe to report
  });
  return { hostname, resolvedIps, privateOrLoopbackIps, safe: resolvedIps.length > 0 && privateOrLoopbackIps.length === 0 };
}

export interface OfflineCorpusValidationResult {
  snapshot: SourceSnapshotCandidate;
  snapshotChange: SnapshotChangeClassification;
  parseResult: ParseResult;
  candidates: Array<
    | { citation: string; status: "CANDIDATE"; verificationStatus: "UNVERIFIED"; textSha256: string; changeClassification: ProvisionChangeClassification }
    | { citation: string; status: "REQUIRES_EFFECTIVE_DATE_INSPECTION"; reason: string }
  >;
  verificationQueue: VerificationQueueEntry[];
}

/**
 * Runs the full offline pipeline (snapshot -> parse -> per-provision candidate ->
 * verification-queue entry) against already-retrieved raw text — real or fixture, this
 * function does not care which. Every candidate it can build is UNVERIFIED; nothing here can
 * produce anything else. Deterministic, no network, safe to run in every ordinary test run.
 */
export function runOfflineCorpusValidation(input: {
  id: string;
  legalSourceId: string;
  legalSourceVersionId: string;
  provisionIdByCitation: (citation: string) => string;
  sourceUrl: string;
  retrievedAt: string;
  rawContent: string;
  previousSnapshot: { contentSha256: string } | null;
  previousCandidatesByCitation: Map<string, { textSha256: string; parserVersion: string }>;
  effectiveFromByCitation: (citation: string) => { from: unknown; to: unknown };
}): OfflineCorpusValidationResult {
  const snapshot = buildSnapshotCandidate({
    id: input.id,
    legalSourceId: input.legalSourceId,
    sourceUrl: input.sourceUrl,
    retrievedAt: input.retrievedAt,
    rawContent: input.rawContent,
  });
  const snapshotChange = classifySnapshotChange(input.previousSnapshot, snapshot);
  const parseResult = parseStatuteExcerpt(input.rawContent);

  const candidates: OfflineCorpusValidationResult["candidates"] = [];
  const verificationQueue: VerificationQueueEntry[] = [];

  for (const provision of parseResult.provisions) {
    const { from, to } = input.effectiveFromByCitation(provision.citation);
    const effectiveDate = resolveIngestionEffectiveDate(from, to);
    const provisionId = input.provisionIdByCitation(provision.citation);
    const built = buildProvisionVersionIngestionCandidate({
      id: input.id,
      provisionId,
      legalSourceId: input.legalSourceId,
      legalSourceVersionId: input.legalSourceVersionId,
      exactText: provision.exactText,
      effectiveDate,
    });

    if (built.status === "REQUIRES_EFFECTIVE_DATE_INSPECTION") {
      candidates.push({ citation: provision.citation, status: "REQUIRES_EFFECTIVE_DATE_INSPECTION", reason: built.reason });
      verificationQueue.push(
        buildVerificationQueueEntry({
          legalSourceId: input.legalSourceId,
          sourceUrl: input.sourceUrl,
          retrievedAt: input.retrievedAt,
          citation: provision.citation,
          exactText: provision.exactText,
          effectiveDate,
          previousTextSha256: input.previousCandidatesByCitation.get(provision.citation)?.textSha256 ?? null,
          parseStatus: parseResult.status,
          changeClassification: "REQUIRES_INSPECTION",
        }),
      );
      continue;
    }

    const previous = input.previousCandidatesByCitation.get(provision.citation) ?? null;
    const changeClassification = classifyProvisionCandidateChange(previous, built.candidate, PARSER_VERSION);
    candidates.push({
      citation: provision.citation,
      status: "CANDIDATE",
      verificationStatus: "UNVERIFIED",
      textSha256: built.candidate.textSha256,
      changeClassification,
    });
    verificationQueue.push(
      buildVerificationQueueEntry({
        legalSourceId: input.legalSourceId,
        sourceUrl: input.sourceUrl,
        retrievedAt: input.retrievedAt,
        citation: provision.citation,
        exactText: provision.exactText,
        effectiveDate,
        previousTextSha256: previous?.textSha256 ?? null,
        parseStatus: parseResult.status,
        changeClassification,
      }),
    );
  }

  return { snapshot, snapshotChange, parseResult, candidates, verificationQueue };
}
