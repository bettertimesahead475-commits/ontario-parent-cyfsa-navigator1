/**
 * Cloudflare Pages Functions - POST /api/chat
 *
 * Dedicated endpoint for Kace Interactive AI Assistant supporting 4 modes:
 * 1. 'rights': Explain My Rights
 * 2. 'report': Understand My Report (Strict tenant-isolated case file/report Q&A)
 * 3. 'forms': Help With Court Forms (Official Ontario Family Law Rules prescribed forms)
 * 4. 'cas_process': CAS Procedures & Investigation Process (Standards 1–7 & oversight)
 *
 * Server-authoritative model routing: Gemini default, Claude configurable option.
 * Bounded token budget (max 1,500 output tokens), zero client API key exposure.
 */

import { verifyFirebaseRequest } from './_auth-check';
import {
  executeKaceChat,
  type KaceChatMode,
  type KaceChatRequestOptions,
  type ChatServiceEnv,
} from '../../api/services/kaceChatService';

export interface ChatEnv extends ChatServiceEnv {
  FIREBASE_PROJECT_ID?: string;
}

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function handleChatRequest(
  request: Request,
  env: ChatEnv,
  deps: { fetcher?: typeof fetch; skipAuthForTest?: boolean } = {}
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON request body.', code: 'INVALID_REQUEST' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return Response.json(
      { error: 'A question or prompt is required.', code: 'QUERY_REQUIRED' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  // Normalize mode
  let mode: KaceChatMode = 'rights';
  if (body?.mode === 'report' || body?.mode === 'forms' || body?.mode === 'cas_process' || body?.mode === 'rights') {
    mode = body.mode;
  } else if (body?.focus === 'evidentiary-auditor') {
    mode = 'report';
  } else if (body?.focus === 'cas-process') {
    mode = 'cas_process';
  }

  // Privacy boundary: case material must be fetched server-side using a verified
  // owner-scoped report ID. Never trust arbitrary report text supplied by a browser.
  // Until that lookup exists, fail closed rather than sending private case data
  // to a third-party model without ownership verification.
  const hasClientCaseData = body?.reportContext != null ||
    (Array.isArray(body?.files) && body.files.length > 0);
  if (mode === 'report' || hasClientCaseData) {
    return Response.json(
      {
        error: 'Private report conversations are temporarily unavailable while secure case retrieval is being completed.',
        code: 'SECURE_REPORT_RETRIEVAL_REQUIRED',
      },
      { status: 403, headers: DEFAULT_HEADERS }
    );
  }

  // Public educational questions may proceed without a case payload. If an
  // identity is provided, verify it; never reflect unverified identity data.
  let authenticatedUid: string | null = null;
  if (env.FIREBASE_PROJECT_ID && request.headers.has('Authorization')) {
    const authResult = await verifyFirebaseRequest(request, env);
    if (authResult.status !== 'verified') {
      return Response.json(
        { error: 'Invalid or unavailable sign-in session.', code: 'AUTH_VERIFICATION_FAILED' },
        { status: authResult.status === 'unavailable' ? 503 : 401, headers: DEFAULT_HEADERS }
      );
    }
    authenticatedUid = authResult.uid;
  }

  const chatOptions: KaceChatRequestOptions = {
    mode,
    query,
    history: Array.isArray(body?.history) ? body.history : [],
    model: body?.model === 'claude' ? 'claude' : 'gemini',
    formNumber: typeof body?.formNumber === 'string' ? body.formNumber : undefined,
    focus: body?.focus,
  };

  try {
    const result = await executeKaceChat(env, chatOptions, deps);
    return Response.json(
      {
        answer: result.answer,
        mode: result.mode,
        modelUsed: result.modelUsed,
        citations: result.citations,
        disclaimer: result.disclaimer,
        uid: authenticatedUid,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  } catch (err: any) {
    console.error('[Kace Chat] Error handling request:', err);
    return Response.json(
      {
        error: err?.message || 'The AI assistant was unable to answer your query. Please try again.',
        code: 'CHAT_GENERATION_FAILED',
      },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  }
}

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: ChatEnv;
}): Promise<Response> => {
  return handleChatRequest(request, env);
};
