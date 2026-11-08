import { providerDiagnostic, type ProviderDiagnostic } from '../../shared/providerDiagnostics';
/**
 * Gemini REST access for Cloudflare Pages Functions: one place for model routing, the request, and error
 * classification, so a model change is one environment variable, not edits to several hard-coded URLs.
 *
 * - Models: GEMINI_OCR_MODEL (documents and images) and GEMINI_AUDIO_MODEL (transcription). There is no automatic
 *   fallback to other models: a model the account cannot use fails with MODEL_UNAVAILABLE, which names the setting to
 *   change. GET /api/admin/gemini-models lists what the configured key can actually use.
 * - OCR defaults to the broadly available PDF-capable Gemini 2.5 Flash. Availability for the deployed key must still be
 *   verified with the admin route and a PDF request; a public model listing alone is not a live extraction test.
 * - The key is sent in the x-goog-api-key header, never in the URL, so it cannot end up in URL logs.
 * - Provider error bodies are never returned to callers; only a classified kind.
 */

export interface GeminiEnv {
  GEMINI_API_KEY?: string;
  GEMINI_OCR_MODEL?: string;
  GEMINI_AUDIO_MODEL?: string;
}

export const DEFAULT_GEMINI_OCR_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_AUDIO_MODEL = 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{1,80}$/;

export type GeminiErrorKind =
  | 'NOT_CONFIGURED'
  | 'MODEL_UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'BLOCKED'
  | 'BAD_REQUEST'
  | 'PDF_REJECTED';

export class GeminiError extends Error {
  constructor(readonly kind: GeminiErrorKind, readonly retryAfterSeconds: number | null = null, readonly diagnostic?: ProviderDiagnostic) {
    super(`Gemini request failed: ${kind}`);
  }
}

/** What the customer sees for each kind, and the HTTP status the API answers with. No provider text. */
export const GEMINI_ERROR_RESPONSE: Record<GeminiErrorKind, { status: number; code: string; error: string; retryable: boolean }> = {
  NOT_CONFIGURED: { status: 503, code: 'OCR_SERVICE_UNCONFIGURED', error: 'Document text recognition is not configured on this server.', retryable: false },
  MODEL_UNAVAILABLE: { status: 503, code: 'OCR_MODEL_UNAVAILABLE', error: 'Document text recognition is temporarily unavailable. Nothing was charged.', retryable: false },
  AUTH_FAILED: { status: 503, code: 'OCR_SERVICE_UNAVAILABLE', error: 'Document text recognition is temporarily unavailable. Nothing was charged.', retryable: false },
  QUOTA_EXHAUSTED: { status: 503, code: 'OCR_QUOTA_EXHAUSTED', error: 'Document text recognition has reached its usage limit. Please try again later. Nothing was charged.', retryable: true },
  RATE_LIMITED: { status: 429, code: 'OCR_RATE_LIMITED', error: 'Too many documents are being read right now. Please try again in a minute. Nothing was charged.', retryable: true },
  PROVIDER_UNAVAILABLE: { status: 502, code: 'OCR_PROVIDER_UNAVAILABLE', error: 'Document text recognition is temporarily unavailable. Please try again. Nothing was charged.', retryable: true },
  TIMEOUT: { status: 504, code: 'OCR_TIMEOUT', error: 'Reading this document took too long. Try a smaller file or fewer pages. Nothing was charged.', retryable: true },
  INVALID_RESPONSE: { status: 502, code: 'OCR_INVALID_RESPONSE', error: 'Document text recognition returned an unusable result. Please try again. Nothing was charged.', retryable: true },
  BLOCKED: { status: 422, code: 'OCR_BLOCKED', error: 'This document could not be read by the text recognition service.', retryable: false },
  BAD_REQUEST: { status: 502, code: 'OCR_REJECTED', error: 'The text recognition provider rejected the extraction request. This does not establish that your file is damaged. Nothing was charged.', retryable: false },
  PDF_REJECTED: { status: 422, code: 'OCR_PDF_REJECTED', error: 'The text recognition provider could not decode the PDF pages. Try exporting a new PDF copy with printing enabled. Nothing was charged.', retryable: false },
};

export function resolveGeminiModel(env: GeminiEnv, use: 'ocr' | 'audio'): string {
  const configured = (use === 'ocr' ? env.GEMINI_OCR_MODEL : env.GEMINI_AUDIO_MODEL)?.trim();
  const model = configured || (use === 'ocr' ? DEFAULT_GEMINI_OCR_MODEL : DEFAULT_GEMINI_AUDIO_MODEL);
  // A malformed setting is a configuration error, not something to send to the provider.
  if (!MODEL_ID.test(model)) throw new GeminiError('NOT_CONFIGURED');
  return model;
}

export function classifyGeminiStatus(status: number, bodyText: string): GeminiErrorKind {
  if (status === 404) return 'MODEL_UNAVAILABLE';
  // Gemini reports a bad key as 400 INVALID_ARGUMENT with API_KEY_INVALID, not 401.
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(bodyText))) return 'AUTH_FAILED';
  if (status === 429) return /quota|RESOURCE_EXHAUSTED.*(per day|daily|billing)|exceeded your current quota/i.test(bodyText) ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  // A 400 that names the model ("not found", "not supported") is a model problem, not the user's file.
  if (status === 400 && /model.*(not found|not supported|is not available)|not supported for generateContent/i.test(bodyText)) return 'MODEL_UNAVAILABLE';
  if (status === 400 && /document.*(no pages|zero pages)|pdf.*(encrypted|password|unsupported|invalid)|unable to process.*(pdf|document)/i.test(bodyText)) return 'PDF_REJECTED';
  return 'BAD_REQUEST';
}

export interface GeminiCallResult {
  text: string;
  model: string;
  usage: { promptTokens: number | null; outputTokens: number | null };
  finishReason: string | null;
}

/** Bounded generateContent retries. The deadline includes headers, body parsing and backoff. */
export async function generateGemini(
  env: GeminiEnv,
  model: string,
  body: Record<string, unknown>,
  opts: { timeoutMs: number; fetcher?: typeof fetch; maxAttempts?: number }
): Promise<GeminiCallResult> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) throw new GeminiError('TIMEOUT');
  const controller = new AbortController();
  const end = Date.now() + opts.timeoutMs;
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new GeminiError('TIMEOUT')); }, opts.timeoutMs);
  });
  const attempts = Math.min(3, Math.max(1, Math.floor(opts.maxAttempts ?? 2)));
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await Promise.race([generateGeminiAttempt(env, model, body, { ...opts, signal: controller.signal }), expired]);
      } catch (error) {
        if (!(error instanceof GeminiError) || !['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(error.kind) || attempt === attempts || controller.signal.aborted) throw error;
        const delay = Math.max(250 * 2 ** (attempt - 1), (error.retryAfterSeconds ?? 0) * 1000);
        if (delay >= end - Date.now()) throw error;
        await Promise.race([new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(backoff); reject(new GeminiError('TIMEOUT')); };
          const backoff = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, delay);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }), expired]);
      }
    }
    throw new GeminiError('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}

/** A single attempt. Throws only sanitized provider errors. */
async function generateGeminiAttempt(
  env: GeminiEnv,
  model: string,
  body: Record<string, unknown>,
  opts: { timeoutMs: number; fetcher?: typeof fetch; signal: AbortSignal }
): Promise<GeminiCallResult> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiError('NOT_CONFIGURED');
  const fetcher = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await fetcher(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err: any) {
    throw new GeminiError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const retry = Number(res.headers.get('retry-after'));
    let providerStatus: string | null = null;
    try { const parsed = JSON.parse(text); if (/^[A-Z_]+$/.test(parsed?.error?.status)) providerStatus = parsed.error.status; } catch {}
    const kind = res.status === 400 && !text.trim() && key.length < 24 ? 'NOT_CONFIGURED' : classifyGeminiStatus(res.status, text);
    // Never log the provider message: it may echo document contents or credentials.
    console.error(JSON.stringify({ tag: '[GEMINI_REJECTED]', model, httpStatus: res.status, providerStatus, kind,
      reason: /no pages|zero pages/i.test(text) ? 'PDF_NO_PAGES' : /encrypted|password/i.test(text) ? 'PDF_ENCRYPTED' : /mime|inline.data|inlineData/i.test(text) ? 'INPUT_FORMAT' : kind }));
    throw new GeminiError(kind, Number.isFinite(retry) && retry > 0 ? retry : null, providerDiagnostic(res.status, text));
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new GeminiError('INVALID_RESPONSE');
  }
  if (json?.promptFeedback?.blockReason) throw new GeminiError('BLOCKED');
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) {
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') throw new GeminiError('BLOCKED');
    throw new GeminiError('INVALID_RESPONSE');
  }
  const text = parts.map((p: any) => (typeof p?.text === 'string' && p.thought !== true ? p.text : '')).join('');
  if (!text.trim()) throw new GeminiError('INVALID_RESPONSE');
  return {
    text,
    model,
    usage: {
      promptTokens: typeof json?.usageMetadata?.promptTokenCount === 'number' ? json.usageMetadata.promptTokenCount : null,
      outputTokens: typeof json?.usageMetadata?.candidatesTokenCount === 'number' ? json.usageMetadata.candidatesTokenCount : null,
    },
    finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
  };
}

/** The models the configured key can call with generateContent (for the admin check). */
export async function listGeminiModels(env: GeminiEnv, fetcher: typeof fetch = fetch): Promise<string[]> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiError('NOT_CONFIGURED');
  const out: string[] = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const url = `${API_BASE}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    let res: Response;
    try {
      res = await fetcher(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new GeminiError('PROVIDER_UNAVAILABLE');
    }
    if (!res.ok) { const text = await res.text().catch(() => ''); throw new GeminiError(res.status === 400 && !text.trim() && key.length < 24 ? 'NOT_CONFIGURED' : classifyGeminiStatus(res.status, text), null, providerDiagnostic(res.status, text)); }
    const json = (await res.json().catch(() => null)) as any;
    for (const m of json?.models ?? []) {
      if (Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent') && typeof m.name === 'string') {
        out.push(m.name.replace(/^models\//, ''));
      }
    }
    pageToken = json?.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}
