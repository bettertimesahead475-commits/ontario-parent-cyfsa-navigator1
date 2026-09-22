// Stage 9D-4B-1 — SSRF-safe official-form retrieval / integrity subsystem.
//
// SCOPE: this file builds ONLY retrieval + validation + hashing + provenance-preparation for
// official Ontario court-form artifacts (PDF/DOCX). It does NOT implement field-map extraction,
// form filling, assisted completion, AI drafting, or populated derivatives (9D-4B-2 / 9D-4C —
// both explicitly out of scope here), and it does NOT write to the database or execute any
// migration. It hands back a RetrievalResult that a future stage feeds into the 9D-4A registry
// (navigator_official_form_templates etc., see officialFormRegistry.ts) — that registration
// step itself is also out of scope here.
//
// KNOWN ENVIRONMENT LIMITATION: this Claude sandbox's outbound network is proxy-blocked from
// reaching Ontario government hosts. That is a development-environment constraint, not a
// security requirement, so it must never leak into the design as a shortcut. The transport and
// DNS resolver are injectable interfaces; production code path (createTrustedHttpsTransport /
// createDnsResolver) is real, standards-following code that has never been exercised against a
// live Ontario host in this sandbox. Tests exercise the SAME validation/hashing logic through a
// deterministic MockTransport/MockDnsResolver — there is no parallel test-only security
// implementation to drift from the real one.
//
// NO REAL ONTARIO ARTIFACT BYTES, HASHES, OR CURRENTNESS CLAIMS ARE FABRICATED ANYWHERE IN THIS
// FILE OR ITS TESTS. Every fixture used in tests is clearly labeled SYNTHETIC_TEST_OFFICIAL_FORM.

import crypto from "node:crypto";
import * as dns from "node:dns";
import { LifecycleError } from "./lifecycleErrors.js";

const invalid = (code: string, message: string) => new LifecycleError(400, code, message);

// ---------------------------------------------------------------------------
// APPROVED SOURCE POLICY — explicit allowlist only, no generic fetcher, no wildcard.
//
// Only one canonical host is approved for now: ontariocourtforms.on.ca. We treat the bare
// registrable host and its "www." variant as the SAME approved host (normalize by stripping a
// leading "www." before allowlist comparison) rather than requiring an exact string match,
// because Ontario's own canonical index page is published at "www.ontariocourtforms.on.ca" and
// operators legitimately alternate the www-prefix on government sites without it representing a
// different trust boundary. We do NOT extend this to a suffix/wildcard match (e.g. "any host
// ending in ontariocourtforms.on.ca") — only exactly {ontariocourtforms.on.ca,
// www.ontariocourtforms.on.ca} pass. Adding any other host (including other *.on.ca or
// *.ontario.ca hosts) requires an explicit future code change and review, never a wildcard.
// ---------------------------------------------------------------------------
const APPROVED_HOSTS = new Set(["ontariocourtforms.on.ca", "www.ontariocourtforms.on.ca"]);

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase();
}

export function isApprovedHost(hostname: string): boolean {
  return APPROVED_HOSTS.has(normalizeHost(hostname));
}

// ---------------------------------------------------------------------------
// SSRF DEFENSE — URL-shape checks (scheme, credentials, hostname) independent of DNS.
// ---------------------------------------------------------------------------

export function assertUrlShapeIsSafe(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalid("MALFORMED_URL", "The URL could not be parsed.");
  }
  if (url.protocol !== "https:") {
    throw invalid("NON_HTTPS_URL", "Only https:// URLs are permitted.");
  }
  if (url.username || url.password) {
    throw invalid("EMBEDDED_CREDENTIALS", "URLs with embedded credentials are rejected.");
  }
  if (!url.hostname || !/^[a-z0-9.-]+$/i.test(url.hostname)) {
    throw invalid("MALFORMED_HOSTNAME", "The URL hostname is malformed.");
  }
  if (!isApprovedHost(url.hostname)) {
    throw invalid("HOST_NOT_APPROVED", `Host "${url.hostname}" is not on the approved official-source allowlist.`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// SSRF DEFENSE — resolved-IP checks. DNS resolution is injected (DnsResolver) so tests can
// exercise the exact same range-checking logic deterministically without real DNS.
// ---------------------------------------------------------------------------

export interface DnsResolver {
  /** Resolve a hostname to zero or more IPv4/IPv6 literal addresses. */
  resolve(hostname: string): Promise<string[]>;
}

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseIpv4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some(p => p > 255)) return null;
  return parts;
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipParts = parseIpv4(ip);
  const baseParts = parseIpv4(base);
  if (!ipParts || !baseParts) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ipParts) & mask) === (ipv4ToInt(baseParts) & mask);
}

const BLOCKED_IPV4_CIDRS = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // RFC1918
  "172.16.0.0/12", // RFC1918
  "192.168.0.0/16", // RFC1918
  "169.254.0.0/16", // link-local, includes 169.254.169.254 cloud metadata
  "0.0.0.0/8"
];

/** True if `ip` (IPv4 or IPv6 literal) must never be connected to. */
export function isBlockedIpLiteral(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();
  if (parseIpv4(trimmed)) {
    if (trimmed === "169.254.169.254") return true;
    return BLOCKED_IPV4_CIDRS.some(cidr => isIpv4InCidr(trimmed, cidr));
  }
  // IPv6
  if (trimmed === "::1") return true; // loopback
  if (trimmed === "::" ) return true; // unspecified
  if (trimmed.startsWith("fe80:") || trimmed.startsWith("fe80::")) return true; // link-local fe80::/10
  // fc00::/7 unique local addresses (private IPv6)
  if (/^f[cd][0-9a-f]{2}:/.test(trimmed)) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(trimmed);
  if (mapped) return isBlockedIpLiteral(mapped[1]);
  return false;
}

export function isLocalhostHostname(hostname: string): boolean {
  const h = normalizeHost(hostname);
  return h === "localhost" || h.endsWith(".localhost");
}

export async function assertResolvedHostIsSafe(hostname: string, resolver: DnsResolver): Promise<void> {
  if (isLocalhostHostname(hostname)) {
    throw invalid("LOCALHOST_REJECTED", "Localhost is never a valid retrieval target.");
  }
  const addresses = await resolver.resolve(hostname);
  if (addresses.length === 0) {
    throw invalid("DNS_RESOLUTION_FAILED", "The hostname did not resolve to any address.");
  }
  for (const addr of addresses) {
    if (isBlockedIpLiteral(addr)) {
      throw invalid("PRIVATE_OR_BLOCKED_ADDRESS", `Resolved address "${addr}" is in a blocked/private range.`);
    }
  }
}

/** Full per-hop validation: URL shape + allowlist + DNS-resolved-IP safety. Used for the
 * original URL AND independently for every redirect hop — never skipped for a hop. */
export async function validateUrlHopOrThrow(rawUrl: string, resolver: DnsResolver): Promise<URL> {
  const url = assertUrlShapeIsSafe(rawUrl);
  await assertResolvedHostIsSafe(url.hostname, resolver);
  return url;
}

// ---------------------------------------------------------------------------
// TRANSPORT — injectable interface. Trust/security logic (this whole file) sits ABOVE the
// transport, so production and tests share identical validation/hashing logic; only the
// low-level "make one HTTP request, don't auto-follow redirects" mechanics differ.
// ---------------------------------------------------------------------------

export interface TransportResponse {
  status: number;
  headers: Record<string, string>; // lower-cased header names
  /** Async iterable of Buffer chunks. Consumers must stop reading once the byte bound is hit. */
  body: AsyncIterable<Buffer>;
}

export interface Transport {
  /** Perform exactly one HTTP request. MUST NOT auto-follow redirects — the caller (this
   * module) validates and follows each hop itself so every hop gets full SSRF validation. */
  request(url: string): Promise<TransportResponse>;
}

/** Production transport: Node's built-in fetch, redirect following disabled. Never exercised
 * against a live Ontario host in this sandbox (outbound egress to those hosts is proxy-blocked
 * here) — this is real code, not a stub, but its live behavior against ontariocourtforms.on.ca
 * is unverified in this environment. */
export function createTrustedHttpsTransport(): Transport {
  return {
    async request(url: string): Promise<TransportResponse> {
      const res = await fetch(url, { redirect: "manual" });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const bodyStream = res.body;
      async function* toChunks(): AsyncIterable<Buffer> {
        if (!bodyStream) return;
        const reader = (bodyStream as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield Buffer.from(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      return { status: res.status, headers, body: toChunks() };
    }
  };
}

/** Production DNS resolver: real Node dns.promises lookup. Same "real but unverified live in
 * this sandbox" status as createTrustedHttpsTransport above. */
export function createDnsResolver(): DnsResolver {
  return {
    async resolve(hostname: string): Promise<string[]> {
      const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
      return results.map(r => r.address);
    }
  };
}

// ---------------------------------------------------------------------------
// DOWNLOAD BOUNDS.
//
// A court form (PDF or DOCX) is realistically well under a few MB; we allow generous headroom
// (25 MB) for scanned/image-heavy forms without allowing anything resembling a large-file
// SSRF/DoS vector.
// ---------------------------------------------------------------------------
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024; // 25 MB

/** Reads a response body up to `maxBytes`, stopping the moment the bound is exceeded — never
 * buffers past the limit even if the stream is much larger or Content-Length lied. */
export async function readBoundedBody(body: AsyncIterable<Buffer>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw invalid("ARTIFACT_TOO_LARGE", `Artifact exceeds the ${maxBytes}-byte download bound.`);
    }
    chunks.push(chunk);
  }
  const result = Buffer.concat(chunks);
  if (result.length === 0) {
    throw invalid("EMPTY_ARTIFACT", "Artifact response body was empty.");
  }
  return result;
}

function declaredContentLengthTooLarge(headers: Record<string, string>, maxBytes: number): boolean {
  const raw = headers["content-length"];
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > maxBytes;
}

// ---------------------------------------------------------------------------
// CONTENT VALIDATION — magic bytes / structural sanity, never trust filename/Content-Type
// alone.
// ---------------------------------------------------------------------------

export type DetectedFormat = "PDF" | "DOCX";

const PDF_MAGIC = Buffer.from("%PDF-", "utf8");
const ZIP_LOCAL_HEADER_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
// DOCX-specific: a real DOCX zip must contain the OOXML content-types manifest entry name
// somewhere in its local file headers, distinguishing it from an arbitrary non-DOCX ZIP.
const DOCX_CONTENT_TYPES_MARKER = Buffer.from("[Content_Types].xml", "utf8");

function isPdf(bytes: Buffer): boolean {
  return bytes.length >= PDF_MAGIC.length && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= ZIP_LOCAL_HEADER_MAGIC.length && bytes.subarray(0, 4).equals(ZIP_LOCAL_HEADER_MAGIC);
}

function isDocx(bytes: Buffer): boolean {
  if (!isZip(bytes)) return false;
  // Basic structural sanity beyond "is a zip": the OOXML manifest entry name must appear in the
  // byte stream (it is stored, uncompressed as a local file header filename, in every valid
  // DOCX/OOXML package). This rejects an arbitrary non-DOCX ZIP that merely shares the PK magic.
  return bytes.includes(DOCX_CONTENT_TYPES_MARKER);
}

/** Detect and validate PDF/DOCX content by magic bytes (+ basic structural sanity for DOCX).
 * Rejects HTML/error pages and arbitrary ZIPs served with a misleading Content-Type. Does not
 * execute/interpret macros or embedded content — validation only. */
export function detectAndValidateFormat(bytes: Buffer, expectedFormat: DetectedFormat): DetectedFormat {
  if (bytes.length === 0) {
    throw invalid("EMPTY_ARTIFACT", "Artifact bytes were empty.");
  }
  if (expectedFormat === "PDF") {
    if (!isPdf(bytes)) {
      throw invalid("CONTENT_VALIDATION_FAILED", "Content does not have a valid PDF signature (%PDF-).");
    }
    return "PDF";
  }
  if (expectedFormat === "DOCX") {
    if (!isDocx(bytes)) {
      throw invalid("CONTENT_VALIDATION_FAILED", "Content is not a valid DOCX package (ZIP signature/OOXML structure check failed).");
    }
    return "DOCX";
  }
  throw invalid("UNKNOWN_EXPECTED_FORMAT", "Unrecognized expected format.");
}

// ---------------------------------------------------------------------------
// BYTE INTEGRITY — SHA-256 computed from exact accepted bytes. A caller-supplied hash is never
// trusted as proof; the server always recomputes.
// ---------------------------------------------------------------------------
export function sha256OfExactBytes(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// RETRIEVAL RESULT.
// ---------------------------------------------------------------------------

export const ARTIFACT_VERIFICATION_ORIGINS = ["AUTOMATIC_RETRIEVAL", "TRUSTED_DEVELOPMENT_INGESTION"] as const;
export type ArtifactVerificationOrigin = (typeof ARTIFACT_VERIFICATION_ORIGINS)[number];

export interface RetrievalResult {
  requestedUrl: string;
  finalValidatedUrl: string;
  retrievedAt: string; // ISO timestamp
  httpStatus: number;
  reportedContentType: string | null;
  detectedFormat: DetectedFormat;
  byteLength: number;
  sha256Hex: string;
  bytes: Buffer;
  verificationOrigin: ArtifactVerificationOrigin;
  /** True only when real artifact bytes have actually been processed through this pipeline
   * (automatic retrieval OR the trusted ingestion seam). Never true from index metadata alone. */
  artifactBytesVerified: true;
  /** A mocked/synthetic successful retrieval must never establish CURRENT status for a real
   * Ontario form; this field only ever reflects that this run's fixture was marked synthetic,
   * and is never itself sufficient to flip a real form's currentness_status. */
  isSynthetic: boolean;
}

/** Public-facing shape: excludes exact bytes and never carries a private storage location
 * (this subsystem does not assign a storage location — that is the registration step's job —
 * but this function documents/enforces the exclusion contract regardless). */
export type PublicRetrievalResult = Omit<RetrievalResult, "bytes">;

export function toPublicRetrievalResult(result: RetrievalResult): PublicRetrievalResult {
  const { bytes, ...rest } = result;
  return rest;
}

// ---------------------------------------------------------------------------
// REDIRECT DEFENSE + orchestration.
// ---------------------------------------------------------------------------
const MAX_REDIRECTS = 5;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

interface FetchRawResult {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
}

async function fetchWithValidatedRedirects(
  startUrl: string,
  transport: Transport,
  resolver: DnsResolver,
  maxBytes: number
): Promise<FetchRawResult> {
  let currentUrl = startUrl;
  const visited = new Set<string>();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Every hop — including the very first request — is independently validated against the
    // full allowlist + SSRF check. Nothing here relies on the transport auto-following
    // redirects (createTrustedHttpsTransport explicitly disables that).
    const validated = await validateUrlHopOrThrow(currentUrl, resolver);
    const normalized = validated.toString();
    if (visited.has(normalized)) {
      throw invalid("REDIRECT_LOOP", "A redirect loop was detected.");
    }
    visited.add(normalized);

    const response = await transport.request(normalized);

    if (isRedirectStatus(response.status)) {
      if (hop === MAX_REDIRECTS) {
        throw invalid("TOO_MANY_REDIRECTS", `Exceeded the maximum of ${MAX_REDIRECTS} redirects.`);
      }
      const location = response.headers["location"];
      if (!location) {
        throw invalid("MISSING_REDIRECT_LOCATION", "Redirect response had no Location header.");
      }
      // Resolve relative Location headers against the current (already-validated) URL.
      currentUrl = new URL(location, normalized).toString();
      continue;
    }

    if (declaredContentLengthTooLarge(response.headers, maxBytes)) {
      throw invalid("ARTIFACT_TOO_LARGE", `Declared Content-Length exceeds the ${maxBytes}-byte download bound.`);
    }
    const bytes = await readBoundedBody(response.body, maxBytes);
    return { finalUrl: normalized, status: response.status, headers: response.headers, bytes };
  }
  // Unreachable given the loop bound above, but keeps the return type total.
  throw invalid("TOO_MANY_REDIRECTS", `Exceeded the maximum of ${MAX_REDIRECTS} redirects.`);
}

export interface RetrieveOfficialFormArtifactOptions {
  url: string;
  expectedFormat: DetectedFormat;
  transport: Transport;
  resolver: DnsResolver;
  maxBytes?: number;
  now?: () => Date;
  isSynthetic?: boolean;
}

/**
 * The single trusted retrieval entry point used by BOTH automatic retrieval and (via
 * ingestTrustedDevelopmentArtifact below) the internal manual-ingestion seam. This is where
 * URL/SSRF validation, redirect validation, download bounds, content validation and hashing all
 * happen — there is exactly one implementation of this trust boundary in the whole subsystem.
 */
export async function retrieveOfficialFormArtifact(opts: RetrieveOfficialFormArtifactOptions): Promise<RetrievalResult> {
  const maxBytes = opts.maxBytes ?? MAX_ARTIFACT_BYTES;
  const now = opts.now ?? (() => new Date());

  const raw = await fetchWithValidatedRedirects(opts.url, opts.transport, opts.resolver, maxBytes);
  if (raw.status < 200 || raw.status >= 300) {
    throw invalid("NON_SUCCESS_STATUS", `Retrieval failed with HTTP status ${raw.status}.`);
  }

  const detectedFormat = detectAndValidateFormat(raw.bytes, opts.expectedFormat);
  const sha256Hex = sha256OfExactBytes(raw.bytes);

  return {
    requestedUrl: opts.url,
    finalValidatedUrl: raw.finalUrl,
    retrievedAt: now().toISOString(),
    httpStatus: raw.status,
    reportedContentType: raw.headers["content-type"] ?? null,
    detectedFormat,
    byteLength: raw.bytes.length,
    sha256Hex,
    bytes: raw.bytes,
    verificationOrigin: "AUTOMATIC_RETRIEVAL",
    artifactBytesVerified: true,
    isSynthetic: opts.isSynthetic ?? false
  };
}

// ---------------------------------------------------------------------------
// TRUSTED DEVELOPMENT INGESTION SEAM.
//
// Internal/service-role-gated only. This is NOT a public HTTP route: no route in
// officialFormRoutes.ts (or anywhere else in api/) references this function, and it is not
// wired into api/_server.ts. It exists so a trusted maintainer who obtained real bytes OUTSIDE
// this blocked sandbox (and verified them independently) can push those bytes through the exact
// same content-validation + hashing pipeline that automatic retrieval uses, rather than a
// second, divergent code path. It takes bytes directly (no URL fetch, no transport) — an
// ordinary parent/professional/browser caller has no code path that reaches this function at
// all, let alone one that could declare an arbitrary file "official".
// ---------------------------------------------------------------------------
export interface TrustedDevelopmentIngestionInput {
  /** Where the maintainer says these bytes came from, for provenance only — never trusted as
   * proof of anything; recorded as requestedUrl/finalValidatedUrl on the result. */
  sourceUrlForProvenanceOnly: string;
  expectedFormat: DetectedFormat;
  bytes: Buffer;
  now?: () => Date;
  isSynthetic?: boolean;
}

export function ingestTrustedDevelopmentArtifact(input: TrustedDevelopmentIngestionInput): RetrievalResult {
  const now = input.now ?? (() => new Date());
  // Identical content-validation call as automatic retrieval.
  const detectedFormat = detectAndValidateFormat(input.bytes, input.expectedFormat);
  // Identical SHA-256 path as automatic retrieval: recomputed from exact bytes, never accepted
  // from a caller-supplied value (this function's signature has no hash parameter at all).
  const sha256Hex = sha256OfExactBytes(input.bytes);

  return {
    requestedUrl: input.sourceUrlForProvenanceOnly,
    finalValidatedUrl: input.sourceUrlForProvenanceOnly,
    retrievedAt: now().toISOString(),
    httpStatus: 200,
    reportedContentType: null,
    detectedFormat,
    byteLength: input.bytes.length,
    sha256Hex,
    bytes: input.bytes,
    verificationOrigin: "TRUSTED_DEVELOPMENT_INGESTION",
    artifactBytesVerified: true,
    isSynthetic: input.isSynthetic ?? false
  };
}

// ---------------------------------------------------------------------------
// INDEX-VS-BYTE VERIFICATION distinction.
//
// Official-index metadata (title/number/version date/effective date/filenames, as read by a
// human off the canonical index page) is a DIFFERENT, weaker claim than byte-level artifact
// verification. This record type is what a "we know what the index says" entry looks like; it
// deliberately has NO sha256Hex/byteLength/finalArtifactUrl/detectedFormat/verifiedAt fields
// filled in, because this subsystem has not run bytes for it through the pipeline.
// ---------------------------------------------------------------------------
export interface OfficialIndexMetadataRecord {
  formNumber: string;
  officialTitle: string;
  versionDateRaw: string;
  effectiveDateRaw: string;
  pdfFilename: string;
  docxFilename: string;
  officialIndexVerified: true; // this metadata was read off the canonical index page
  artifactBytesVerified: false; // ALWAYS false for an index-only record — never inferred true
  sha256Hex: null;
  byteLengthPdf: null;
  byteLengthDocx: null;
  finalArtifactUrlPdf: null;
  finalArtifactUrlDocx: null;
  detectedFormat: null;
  artifactVerifiedAt: null;
}

export function buildOfficialIndexMetadataRecord(meta: {
  formNumber: string;
  officialTitle: string;
  versionDateRaw: string;
  effectiveDateRaw: string;
  pdfFilename: string;
  docxFilename: string;
}): OfficialIndexMetadataRecord {
  return {
    ...meta,
    officialIndexVerified: true,
    artifactBytesVerified: false,
    sha256Hex: null,
    byteLengthPdf: null,
    byteLengthDocx: null,
    finalArtifactUrlPdf: null,
    finalArtifactUrlDocx: null,
    detectedFormat: null,
    artifactVerifiedAt: null
  };
}
