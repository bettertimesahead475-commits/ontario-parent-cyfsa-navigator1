// Authenticated source-page map.
//
// Page numbers must come from the server's own document extraction, never from text the client sends. The server
// extracts the uploaded bytes, signs the resulting page list, and returns it. The analysis accepts a page map only if
// the signature verifies, the requesting user matches, and it has not expired. Anything else (typed or pasted text,
// edited markers, a map issued to someone else, an expired map) is unpaginated: page citations against it are
// unverifiable, never verified.
//
// The key is derived from SESSION_SECRET with a purpose label, so no new environment variable is needed. If that
// secret is missing, nothing is signed and analyses run unpaginated (fail closed).

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SOURCE_MAP_VERSION = 1;
export const SOURCE_MAP_TTL_MS = 2 * 60 * 60 * 1000;
/** Upper bound on a signed map accepted from a request. A 20-page document is far below this. */
export const MAX_SIGNED_MAP_CHARS = 4 * 1024 * 1024;
const MAX_PAGES = 20;
const CONTENT_HASH = /^[0-9a-f]{64}$/;

export interface AuthoritativePage {
  pageNumber: number;
  text: string;
}

export interface SignedSourcePageMap {
  payload: string;
  signature: string;
}

interface MapPayload {
  v: number;
  uid: string;
  contentHash: string;
  issuedAt: number;
  expiresAt: number;
  pages: AuthoritativePage[];
}

/** Flat result (not a union) so callers can read reason without narrowing. */
export interface SourceMapVerification {
  ok: boolean;
  pages: AuthoritativePage[];
  contentHash: string | null;
  reason: string | null;
}

function rejected(reason: string): SourceMapVerification {
  return { ok: false, pages: [], contentHash: null, reason };
}

function signingKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("cyfsa:source-page-map:v1").digest();
}

function sign(payloadB64: string, key: Buffer): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

function validPages(pages: unknown): pages is AuthoritativePage[] {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > MAX_PAGES) return false;
  return pages.every(
    (p, index) =>
      p !== null &&
      typeof p === "object" &&
      (p as AuthoritativePage).pageNumber === index + 1 &&
      typeof (p as AuthoritativePage).text === "string"
  );
}

/**
 * Signs the page list of a server extraction for one user and one document. Returns null when signing is not
 * possible (no secret, or invalid pages), so the caller falls back to unpaginated analysis.
 */
export function signSourcePageMap(input: {
  uid: string;
  contentHash: string;
  pages: AuthoritativePage[];
  now?: number;
}): SignedSourcePageMap | null {
  const key = signingKey();
  if (!key || !input.uid || !CONTENT_HASH.test(input.contentHash) || !validPages(input.pages)) return null;
  const issuedAt = input.now ?? Date.now();
  const payload: MapPayload = {
    v: SOURCE_MAP_VERSION,
    uid: input.uid,
    contentHash: input.contentHash,
    issuedAt,
    expiresAt: issuedAt + SOURCE_MAP_TTL_MS,
    pages: input.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { payload: payloadB64, signature: sign(payloadB64, key) };
}

/**
 * Verifies a map presented with an analysis request. Every failure returns a reason, and the caller then treats the
 * analysis as unpaginated. A failure never produces a page as verified.
 */
export function verifySourcePageMap(
  candidate: unknown,
  expected: { uid: string | null | undefined; now?: number }
): SourceMapVerification {
  if (!candidate || typeof candidate !== "object") return rejected("absent");
  const { payload, signature } = candidate as Partial<SignedSourcePageMap>;
  if (typeof payload !== "string" || typeof signature !== "string") return rejected("malformed");
  if (payload.length + signature.length > MAX_SIGNED_MAP_CHARS) return rejected("too-large");

  const key = signingKey();
  if (!key) return rejected("signing-unavailable");
  const expectedSignature = Buffer.from(sign(payload, key));
  const actualSignature = Buffer.from(signature);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return rejected("bad-signature");
  }

  let parsed: MapPayload;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MapPayload;
  } catch {
    return rejected("malformed");
  }
  if (parsed.v !== SOURCE_MAP_VERSION) return rejected("version");
  if (!expected.uid || parsed.uid !== expected.uid) return rejected("wrong-user");
  if (!CONTENT_HASH.test(String(parsed.contentHash))) return rejected("malformed");
  if (!validPages(parsed.pages)) return rejected("page-order");
  if ((expected.now ?? Date.now()) > parsed.expiresAt) return rejected("expired");
  return { ok: true, pages: parsed.pages, contentHash: parsed.contentHash, reason: null };
}

/** Page texts keyed by page number. Only an accepted, signed map may be turned into this. */
export function pageMapFrom(pages: AuthoritativePage[]): Map<number, string> {
  return new Map(pages.map((p) => [p.pageNumber, p.text]));
}

/** The analysis source text for an accepted map, in the same "[Page N]" shape the extractor produces. */
export function sourceTextFrom(pages: AuthoritativePage[]): string {
  return pages.map((p) => `[Page ${p.pageNumber}]\n${p.text}`).join("\n\n");
}

/** Stable digest of a page list, for logs and audit records. Contains no text. */
export function pageListDigest(pages: AuthoritativePage[]): string {
  return createHash("sha256").update(JSON.stringify(pages.map((p) => p.text))).digest("hex").slice(0, 16);
}
