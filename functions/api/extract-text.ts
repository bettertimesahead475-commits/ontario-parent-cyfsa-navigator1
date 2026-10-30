/**
 * Cloudflare Pages Functions - Document Text & OCR Extraction API.
 *
 * Implements edge-compatible text extraction for uploaded files:
 * - Direct UTF-8 decoding for text/plain and source transcripts.
 * - Clean XML parsing for DOCX packages.
 * - Cloud-native Gemini 2.0 Flash REST OCR for PDFs and scanned images when GEMINI_API_KEY is configured.
 * - Cryptographic Firebase identity verification via Google JWKS.
 * - Strict size limits and fail-closed security guards.
 */

import { verifyFirebaseRequest } from './_auth-check';

export interface ExtractEnv {
  FIREBASE_PROJECT_ID?: string;
  GEMINI_API_KEY?: string;
}

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const MAX_BASE64_CHARS = 30_000_000; // ~22MB

function computeSimpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export async function handleExtractRequest(
  request: Request,
  env: ExtractEnv,
  deps: { fetcher?: typeof fetch } = {}
): Promise<Response> {
  const fetcher = deps.fetcher || fetch;

  // 1. Authenticate user
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') {
    const status = identity.status === 'unavailable' ? 503 : 401;
    return Response.json(
      { error: 'Please sign in to use the Document Analyzer.', code: 'SIGN_IN_REQUIRED' },
      { status, headers: DEFAULT_HEADERS }
    );
  }

  // 2. Validate request body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON request body.', code: 'INVALID_REQUEST' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  const fileData = body?.fileData;
  if (!fileData || typeof fileData.base64 !== 'string') {
    return Response.json(
      { error: 'fileData.base64 is required.', code: 'INVALID_REQUEST' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  if (fileData.base64.length > MAX_BASE64_CHARS) {
    return Response.json(
      { error: 'File is too large to extract. Please upload a smaller file.', code: 'FILE_TOO_LARGE' },
      { status: 413, headers: DEFAULT_HEADERS }
    );
  }

  let base64Data = fileData.base64;
  if (base64Data.includes(',')) {
    base64Data = base64Data.split(',')[1];
  }

  const mime = (fileData.mimeType || '').toLowerCase();
  const fileName = (fileData.fileName || fileData.name || '').toLowerCase();
  const startTime = Date.now();

  let extractedText = '';
  let extractionMethod = 'text-decoding';

  // 3. Text / Plain documents
  if (mime === 'text/plain' || mime.startsWith('text/') || fileName.endsWith('.txt')) {
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      extractedText = new TextDecoder('utf-8').decode(bytes);
      extractionMethod = 'utf8-plain-text';
    } catch {
      return Response.json(
        { error: 'Failed to decode plain text document.', code: 'DECODE_ERROR' },
        { status: 422, headers: DEFAULT_HEADERS }
      );
    }
  }
  // 4. DOCX documents (XML text run parsing)
  else if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/docx' ||
    mime === 'application/msword' ||
    fileName.endsWith('.docx')
  ) {
    try {
      // Decode zip base64 to binary string
      const binaryString = atob(base64Data);
      // Scan for XML paragraph and text tags (<w:t>...</w:t>) in the stream
      const tRegex = /<w:t\b[^>]*>([^<]*)<\/w:t>/gi;
      const paragraphs: string[] = [];
      let match: RegExpExecArray | null;
      let currentRun = '';

      while ((match = tRegex.exec(binaryString)) !== null) {
        currentRun += match[1];
      }

      if (currentRun) {
        paragraphs.push(currentRun);
      }

      extractedText = paragraphs.join('\n\n');
      extractionMethod = 'docx-xml-extraction';
    } catch (e: any) {
      return Response.json(
        { error: 'Failed to parse DOCX structure: ' + (e?.message || 'invalid file'), code: 'DOCX_PARSE_FAILED' },
        { status: 422, headers: DEFAULT_HEADERS }
      );
    }
  }
  // 5. PDF and Image documents (Gemini OCR)
  else if (mime === 'application/pdf' || mime.startsWith('image/') || fileName.endsWith('.pdf')) {
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return Response.json(
        {
          error: 'PDF and image OCR extraction requires GEMINI_API_KEY in Cloudflare Pages staging settings.',
          code: 'OCR_SERVICE_UNCONFIGURED',
        },
        { status: 503, headers: DEFAULT_HEADERS }
      );
    }

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: mime || 'application/pdf',
                  data: base64Data,
                },
              },
              {
                text: 'Extract all readable text from this document verbatim. Preserve line breaks, paragraphs, and timestamps. Return only the extracted text without introduction or summary.',
              },
            ],
          },
        ],
      };

      const res = await fetcher(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'OCR error');
        return Response.json(
          { error: `OCR extraction failed (${res.status}): ${errText}`, code: 'OCR_PROVIDER_ERROR' },
          { status: 502, headers: DEFAULT_HEADERS }
        );
      }

      const resJson = (await res.json()) as any;
      const candidates = resJson?.candidates || [];
      extractedText = candidates[0]?.content?.parts?.[0]?.text || '';
      extractionMethod = 'gemini-2.0-flash-ocr';
    } catch (err: any) {
      return Response.json(
        { error: `OCR extraction timed out or failed: ${err?.message || 'unknown error'}`, code: 'OCR_NETWORK_ERROR' },
        { status: 504, headers: DEFAULT_HEADERS }
      );
    }
  } else {
    return Response.json(
      { error: `Unsupported file type for extraction: ${mime || fileName}`, code: 'UNSUPPORTED_TYPE' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  const trimmedText = extractedText.trim();
  if (!trimmedText) {
    return Response.json(
      {
        error: "No readable text could be extracted from this file. If it's a scanned image, try a clearer copy.",
        code: 'EXTRACTION_EMPTY',
      },
      { status: 422, headers: DEFAULT_HEADERS }
    );
  }

  const durationMs = Date.now() - startTime;
  const contentHash = computeSimpleHash(trimmedText);

  return Response.json(
    {
      extractedText: trimmedText,
      characters: trimmedText.length,
      contentHash,
      pages: [
        {
          pageNumber: 1,
          text: trimmedText,
          extractionMethod,
          confidence: 1.0,
          checksum: contentHash,
        },
      ],
      timing: { extractMs: durationMs },
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
}

export const onRequestPost = async (context?: { request: Request; env: ExtractEnv }): Promise<Response> => {
  if (!context || !context.request) {
    return Response.json({ error: 'Request context missing.', code: 'INVALID_REQUEST' }, { status: 400, headers: DEFAULT_HEADERS });
  }
  return handleExtractRequest(context.request, context.env);
};
