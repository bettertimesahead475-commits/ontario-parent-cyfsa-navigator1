/**
 * Cloudflare Pages Functions - POST /api/extract-text.
 *
 * Signed-in users only. Extraction is done by ./_document-extraction (page-level provenance, file signature checks,
 * DOCX structure, per-page OCR through ./_gemini). This route never reserves or spends an analysis credit: a failed
 * extraction costs nothing, and the analysis that follows reserves its own credit.
 *
 * Errors are fixed messages per cause. Provider responses, the API key, and document contents are never returned in
 * an error and never logged.
 */

import { verifyFirebaseRequest } from './_auth-check';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject, rateLimitedResponse } from './_rate-limit';
import { ExtractionError, MAX_FILE_BYTES, extractDocument } from './_document-extraction';
import { GEMINI_ERROR_RESPONSE, GeminiError, type GeminiEnv } from './_gemini';
import { readVerifiedPaidSession } from './_supabase-paid-session';
import { createStagingCreditRpc } from './_staging-credit-rpc';
import { extractSessionId } from './analyze';
import { FREE_TRIAL_MAX_BYTES, FREE_TRIAL_MAX_PAGES, PAID_USAGE_REFUSAL, authorizeFreeOcr, ocrRequestIdFor, takePaidUsageUnit, type FreeOcrOutcome, type FreeTrialEnv } from './_free-trial';
import type { CreditRpc } from './_paid-credit-reservation';

export interface ExtractEnv extends GeminiEnv, FreeTrialEnv {
  FIREBASE_PROJECT_ID?: string;
  STAGING_SUPABASE_READ_KEY?: string;
}

const FREE_OCR_REFUSAL: Record<Exclude<FreeOcrOutcome, 'ok'>, [number, string, string]> = {
  email_unverified: [403, 'EMAIL_VERIFICATION_REQUIRED', 'Reading scanned pages needs a verified email address. Verify your email, then try again. Nothing was charged.'],
  no_entitlement: [402, 'FREE_LIMIT_REACHED', 'Your free analyses have been used, so scanned pages can no longer be read. Purchase a plan to continue. Nothing was charged.'],
  ocr_limit: [402, 'FREE_OCR_LIMIT_REACHED', 'The free trial includes a limited number of scanned-document reads, and they have been used. Upload a text-based PDF or Word file, or purchase a plan. Nothing was charged.'],
  paused: [503, 'FREE_TRIAL_PAUSED', 'Scanned-page reading for free trials is paused for today because of high demand. Please try again tomorrow. Nothing was charged.'],
  unavailable: [503, 'RESERVATION_UNAVAILABLE', 'Scanned-page reading is temporarily unavailable. Please try again. Nothing was charged.'],
};

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Base64 is 4/3 the size of the file; allow a little for a data: prefix.
const MAX_BASE64_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3) + 1024;

export async function handleExtractRequest(
  request: Request,
  env: ExtractEnv,
  deps: { fetcher?: typeof fetch; rpc?: CreditRpc } = {}
): Promise<Response> {
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') {
    const status = identity.status === 'unavailable' ? 503 : 401;
    return Response.json({ error: 'Please sign in to use the Document Analyzer.', code: 'SIGN_IN_REQUIRED' }, { status, headers: DEFAULT_HEADERS });
  }
  {
    const retryAfter = rateLimitRetryAfter('extractText', rateLimitSubject(request, identity.uid), RATE_LIMITS.extractText);
    if (retryAfter) return rateLimitedResponse(retryAfter);
  }

  // Accounts without a paid session get the free-scan limits, and OCR (a provider cost) only while a free analysis
  // remains (./_free-trial.ts). Paid sessions and the owner keep the full limits.
  const fetcher = deps.fetcher ?? fetch;
  const isOwner = identity.emailVerified && identity.email?.trim().toLowerCase() === 'mr.pelkie@gmail.com';
  let paid = isOwner;
  // Idempotency key of this document for a free account's OCR budget; set once the body is read, before extraction.
  let freeOcrRequestId: string | null = null;
  const sessionId = extractSessionId(request.headers.get('x-ps-session'));
  if (!paid && sessionId) {
    const read = await readVerifiedPaidSession(env, identity.uid, sessionId, fetcher);
    if (read.status === 'unavailable') {
      return Response.json({ error: 'Paid session could not be checked. Please try again. Nothing was charged.', code: 'RESERVATION_UNAVAILABLE' }, { status: 503, headers: DEFAULT_HEADERS });
    }
    paid = read.status === 'verified';
  }
  const extractionDeps = isOwner ? {} : paid ? {
    // Paid OCR has no credit of its own: a per-account and platform daily cap bounds it before the provider call.
    authorizeOcr: async () => {
      if (!env.GEMINI_API_KEY) return;
      const usage = await takePaidUsageUnit(env, 'pocr', identity.uid, deps.rpc ?? createStagingCreditRpc(env, fetcher));
      if (usage !== 'ok') {
        const [code, message] = PAID_USAGE_REFUSAL[usage];
        throw new ExtractionError(503, code, message, false);
      }
    },
  } : {
    limits: { maxBytes: FREE_TRIAL_MAX_BYTES, maxPages: FREE_TRIAL_MAX_PAGES, maxOcrPages: FREE_TRIAL_MAX_PAGES, label: 'A free scan' },
    authorizeOcr: async () => {
      if (!env.GEMINI_API_KEY) return; // OCR then fails as unconfigured, without spending a free OCR unit
      const rpc = deps.rpc ?? createStagingCreditRpc(env, fetcher);
      if (!freeOcrRequestId) throw new ExtractionError(400, 'INVALID_REQUEST', 'fileData.base64 is required.', false);
      const outcome = await authorizeFreeOcr(env, identity.uid, identity.email ?? null, identity.emailVerified, rpc, freeOcrRequestId, fetcher);
      if (outcome !== 'ok') {
        const [status, code, message] = FREE_OCR_REFUSAL[outcome];
        throw new ExtractionError(status, code, message, outcome === 'unavailable' ? undefined : false);
      }
    },
  };

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BASE64_CHARS + 4096) {
    return Response.json({ error: 'File is too large. The limit is 20 MB.', code: 'FILE_TOO_LARGE' }, { status: 413, headers: DEFAULT_HEADERS });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON request body.', code: 'INVALID_REQUEST' }, { status: 400, headers: DEFAULT_HEADERS });
  }
  const fileData = body?.fileData;
  if (!fileData || typeof fileData.base64 !== 'string' || !fileData.base64) {
    return Response.json({ error: 'fileData.base64 is required.', code: 'INVALID_REQUEST' }, { status: 400, headers: DEFAULT_HEADERS });
  }
  if (fileData.base64.length > MAX_BASE64_CHARS) {
    return Response.json({ error: 'File is too large. The limit is 20 MB.', code: 'FILE_TOO_LARGE' }, { status: 413, headers: DEFAULT_HEADERS });
  }
  if (!isOwner && !paid) freeOcrRequestId = await ocrRequestIdFor(identity.uid, fileData.base64);

  const started = Date.now();
  try {
    const result = await extractDocument(
      { base64: fileData.base64, mimeType: fileData.mimeType, fileName: fileData.fileName || fileData.name },
      env,
      { fetcher: deps.fetcher, ...extractionDeps }
    );
    const text = result.extractedText.trim();
    if (!text) {
      return Response.json(
        {
          error: "No readable text could be extracted from this file. If it's a scanned image, try a clearer copy. Nothing was charged.",
          code: 'EXTRACTION_EMPTY',
          incomplete: result.incomplete,
        },
        { status: 422, headers: DEFAULT_HEADERS }
      );
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const contentHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return Response.json(
      {
        extractedText: text,
        characters: text.length,
        contentHash,
        document: {
          documentId: result.documentId,
          fileName: result.fileName,
          mimeType: result.mimeType,
          detectedType: result.detectedType,
          pageCount: result.pageCount,
          pageAttribution: result.pageAttribution,
          extractionMethods: [...new Set(result.pages.map((p) => p.extractionMethod))],
          complete: result.pages.every(p => p.status !== 'partial' && p.status !== 'not_processed'),
          incomplete: result.incomplete,
          ocrModel: result.ocr?.model ?? null,
        },
        pages: result.pages,
        timing: { extractMs: Date.now() - started },
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  } catch (err) {
    if (err instanceof ExtractionError) {
      return Response.json({ error: err.publicMessage, code: err.code, retryable: err.retryable }, { status: err.status, headers: DEFAULT_HEADERS });
    }
    if (err instanceof GeminiError) {
      const r = GEMINI_ERROR_RESPONSE[err.kind];
      // Operator-facing signal with no document content, no key, no provider text.
      console.error(JSON.stringify({ tag: '[EXTRACT_OCR_FAILED]', kind: err.kind }));
      const headers: Record<string, string> = { ...DEFAULT_HEADERS };
      if (err.retryAfterSeconds) headers['Retry-After'] = String(err.retryAfterSeconds);
      return Response.json({ error: r.error, code: r.code, retryable: r.retryable }, { status: r.status, headers });
    }
    console.error(JSON.stringify({ tag: '[EXTRACT_FAILED]', name: (err as any)?.name ?? 'Error' }));
    return Response.json(
      { error: 'The document could not be read. Please try again. Nothing was charged.', code: 'EXTRACTION_FAILED' },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  }
}

export const onRequestPost = async (context?: { request: Request; env: ExtractEnv }): Promise<Response> => {
  if (!context || !context.request) {
    return Response.json({ error: 'Request context missing.', code: 'INVALID_REQUEST' }, { status: 400, headers: DEFAULT_HEADERS });
  }
  return handleExtractRequest(context.request, context.env);
};
