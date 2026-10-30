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
import { ExtractionError, MAX_FILE_BYTES, extractDocument } from './_document-extraction';
import { GEMINI_ERROR_RESPONSE, GeminiError, type GeminiEnv } from './_gemini';

export interface ExtractEnv extends GeminiEnv {
  FIREBASE_PROJECT_ID?: string;
}

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Base64 is 4/3 the size of the file; allow a little for a data: prefix.
const MAX_BASE64_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3) + 1024;

export async function handleExtractRequest(
  request: Request,
  env: ExtractEnv,
  deps: { fetcher?: typeof fetch } = {}
): Promise<Response> {
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') {
    const status = identity.status === 'unavailable' ? 503 : 401;
    return Response.json({ error: 'Please sign in to use the Document Analyzer.', code: 'SIGN_IN_REQUIRED' }, { status, headers: DEFAULT_HEADERS });
  }

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

  const started = Date.now();
  try {
    const result = await extractDocument(
      { base64: fileData.base64, mimeType: fileData.mimeType, fileName: fileData.fileName || fileData.name },
      env,
      deps
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
      return Response.json({ error: err.publicMessage, code: err.code }, { status: err.status, headers: DEFAULT_HEADERS });
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
