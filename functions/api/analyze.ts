/**
 * Cloudflare Pages Functions - Production-Ready Document Analyzer API.
 *
 * Implements the Direct-First Core Analyzer with:
 * - Single-pass structured Quick Review analysis (overview, redFlags, chronology, guidance).
 * - Controlled fallback to established sectioned analysis for oversized documents (>75k chars) or failures.
 * - Forensic In-Depth mode with Claude Opus verification.
 * - Pure Web Crypto token verification via Google JWKS.
 * - Strict database-backed entitlement & credit lifecycle (reserve -> analyze -> finalize/release).
 * - Real-time Server-Sent Events (SSE) streaming and REST JSON responses.
 * - Calibrated fail-closed guards for unconfigured or disabled staging environments.
 */

import { verifyFirebaseRequest } from './_auth-check';
import { readVerifiedPaidSession } from './_supabase-paid-session';
import { reserveVerifiedPaidCredit, type CreditRpc } from './_paid-credit-reservation';
import { finalizePaidReservation, releasePaidReservation } from './_paid-credit-lifecycle';
import { reserveFreeScan } from './_free-credit-reservation';
import { finalizeFreeScan, releaseFreeScan } from './_free-credit-lifecycle';
import { saveCompletedJob, saveJobState } from './_analysis-jobs';
import { createStagingCreditRpc } from './_staging-credit-rpc';
import { createCloudflareGenerateFn } from './_analyzer-model-adapter';
import { DEFAULT_QUICK_MODEL, DEFAULT_FORENSIC_MODEL } from '../../api/services/analyzerModels';
import { runDirectAnalysis, isEligibleForDirectAnalysis, DIRECT_ANALYSIS_MAX_CHARS } from '../../api/services/directAnalyzer';
import {
  runSectionedAnalysis,
  sectionTitle,
  applyReportGuards,
  type SectionKey,
  type SectionRunResult,
  type GenerateFn,
} from '../../api/services/analyzerSections';
import { AnalyzerError, logAnalyzerDiagnostic } from '../../api/services/analyzerErrors';

export interface AnalyzerEnv {
  ANALYZER_ENABLED?: string; // 'true' enables execution; otherwise fails closed with 503
  FIREBASE_PROJECT_ID?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_READ_KEY?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_API_URL?: string;
  ANTHROPIC_QUICK_MODEL?: string;
  ANTHROPIC_FORENSIC_MODEL?: string;
  QUICK_ANALYSIS_BUDGET_MS?: string;
  FORENSIC_ANALYSIS_BUDGET_MS?: string;
  DIRECT_ANALYZER_DISABLED?: string;
}

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export interface AnalyzeDependencies {
  rpc?: CreditRpc;
  generate?: GenerateFn;
  fetcher?: typeof fetch;
}

/** A budget from configuration, bounded so a typo cannot disable the limit or remove it entirely. */
function clampBudget(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 10_000 && n <= 300_000 ? n : fallback;
}

/** Time allowed past the latency budget before the pipeline is stopped regardless of what it is waiting on. */
const HARD_DEADLINE_GRACE_MS = 5_000;
/** How often the stream confirms the worker is alive. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Rejects with makeError() if work does not settle within ms. The work is abandoned, not cancelled, so its late result is ignored. */
export function withHardDeadline<T>(work: Promise<T>, ms: number, makeError: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

export async function handleAnalyzeRequest(
  request: Request,
  env: AnalyzerEnv,
  deps: AnalyzeDependencies = {},
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {
  // Fail-closed guard: Staging analyzer disabled unless explicitly authorized
  if (env.ANALYZER_ENABLED !== 'true') {
    return Response.json(
      { code: 'STAGING_ANALYZER_NOT_READY', analyzerReady: false },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }

  // Verify core platform configuration
  if (!env.FIREBASE_PROJECT_ID || !env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'Analyzer service configuration is incomplete.', code: 'CONFIGURATION_ERROR', analyzerReady: false },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON request body.', code: 'INVALID_REQUEST' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  let rawText = body?.documentText ?? body?.textContent ?? body?.text ?? '';
  if (!rawText && body?.fileData?.base64 && (body?.fileData?.mimeType === 'text/plain' || !body?.fileData?.mimeType)) {
    try {
      let b64 = String(body.fileData.base64);
      if (b64.includes(',')) b64 = b64.split(',')[1];
      rawText = atob(b64);
    } catch {}
  }
  const documentText = typeof rawText === 'string' ? rawText.trim() : '';
  if (!documentText) {
    return Response.json(
      { error: 'Missing or empty documentText.', code: 'INVALID_REQUEST' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  const mode: 'fast' | 'full' = body?.mode === 'full' ? 'full' : 'fast';
  const isForensic = mode === 'full';
  const sessionId = typeof body?.sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(body.sessionId) ? body.sessionId : null;
  const rawRequestId = request.headers.get('X-Analysis-Id') || body?.analysisId || '';
  const requestId = /^[A-Za-z0-9_-]{8,128}$/.test(rawRequestId)
    ? rawRequestId
    : `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  const acceptHeader = request.headers.get('accept') || '';
  const wantsStream = body?.stream !== false && acceptHeader.includes('text/event-stream');

  // Authenticate user via Firebase JWT
  const authFetcher = deps.fetcher || fetch;
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') {
    const status = identity.status === 'unavailable' ? 503 : 401;
    return Response.json(
      { error: 'Authentication required to run document analysis.', code: 'SIGN_IN_REQUIRED' },
      { status, headers: DEFAULT_HEADERS }
    );
  }
  const uid = identity.uid;
  // Only a cryptographically verified Firebase ID token with a verified owner email qualifies.
  // No client-supplied role, email or session can grant this entitlement.
  const isOwner = identity.emailVerified && identity.email?.toLowerCase() === 'mr.pelkie@gmail.com';

  // Set up RPC transport
  const rpc = deps.rpc || createStagingCreditRpc(env, authFetcher);

  // Reserve credits according to user tier
  let reservationId: string | null = null;
  if (isOwner) {
    // Owner requests have no paid/free credit reservation; normal authentication and AI limits still apply.
  } else if (sessionId) {
    const sessionRead = await readVerifiedPaidSession(env, uid, sessionId, authFetcher);
    if (sessionRead.status !== 'verified') {
      return Response.json(
        { error: 'Paid session is invalid, expired, or revoked.', code: 'SESSION_INVALID' },
        { status: sessionRead.status === 'unavailable' ? 503 : 403, headers: DEFAULT_HEADERS }
      );
    }

    const reservation = await reserveVerifiedPaidCredit(sessionRead.session, isForensic ? 'forensic' : 'quick', requestId, rpc);
    if (reservation.status === 'limit') {
      return Response.json(
        { error: 'Plan credit limit reached for this billing period.', code: 'CREDIT_LIMIT_REACHED' },
        { status: 402, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status === 'in_progress' || reservation.status === 'joined' || reservation.status === 'consumed') {
      return Response.json(
        { error: 'This analysis is already running. Results will display shortly.', code: 'ANALYSIS_IN_PROGRESS', jobId: requestId },
        { status: 409, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status !== 'reserved' || !reservation.reservation_id) {
      return Response.json(
        { error: 'Credit reservation service is temporarily unavailable.', code: 'RESERVATION_UNAVAILABLE' },
        { status: reservation.status === 'denied' ? 403 : 503, headers: DEFAULT_HEADERS }
      );
    }
    reservationId = reservation.reservation_id;
  } else {
    // Free user scan
    if (isForensic) {
      return Response.json(
        { error: 'Forensic In-Depth analysis requires a paid plan.', code: 'UPGRADE_REQUIRED' },
        { status: 403, headers: DEFAULT_HEADERS }
      );
    }
    const reservation = await reserveFreeScan(uid, requestId, rpc);
    if (reservation.status === 'limit') {
      return Response.json(
        { error: "You've used your free analysis. Upgrade to continue.", code: 'FREE_LIMIT_REACHED' },
        { status: 402, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status === 'joined' || reservation.status === 'consumed') {
      return Response.json(
        { error: 'This analysis is already running or completed.', code: 'ANALYSIS_IN_PROGRESS', jobId: requestId },
        { status: 409, headers: DEFAULT_HEADERS }
      );
    }
    if (reservation.status !== 'reserved' || !reservation.reservation_id) {
      const sanitizedError: Record<string, any> = {
        error: 'Free scan reservation unavailable.',
        code: 'RESERVATION_UNAVAILABLE',
        status: reservation.status,
      };
      if (reservation.httpStatus) sanitizedError.httpStatus = reservation.httpStatus;
      if (reservation.pgCode) sanitizedError.pgCode = reservation.pgCode;
      if (reservation.pgMessage) sanitizedError.pgMessage = reservation.pgMessage;
      if (reservation.pgDetails) sanitizedError.pgDetails = reservation.pgDetails;
      if (reservation.pgHint) sanitizedError.pgHint = reservation.pgHint;

      console.error('[FREE_SCAN_RESERVATION_UNAVAILABLE]', JSON.stringify(sanitizedError));

      return Response.json(sanitizedError, {
        status: reservation.status === 'denied' ? 403 : 503,
        headers: DEFAULT_HEADERS,
      });
    }
    reservationId = reservation.reservation_id;
  }

  // Model selection
  const primaryModel = isForensic
    ? (env.ANTHROPIC_FORENSIC_MODEL || DEFAULT_FORENSIC_MODEL)
    : (env.ANTHROPIC_QUICK_MODEL || DEFAULT_QUICK_MODEL);
  const verificationModel = env.ANTHROPIC_FORENSIC_MODEL || DEFAULT_FORENSIC_MODEL;
  const generate = deps.generate || createCloudflareGenerateFn(env, authFetcher);

  // Product latency budgets. Leave a small margin for report guards,
  // credit finalization and persistence; a deadline is not a completion guarantee.
  // The budgets are configurable because the right value is a measurement, not a guess: a 15-second window left the
  // direct call about 8 seconds, which a multi-thousand-token report cannot finish, so every real Quick Review aborted
  // and released its credit. The defaults below are the smallest values where a complete call can finish; the product
  // targets (15 s Quick, 60 s Forensic) are reported as not met until staging measurements say otherwise.
  const analysisBudgetMs = isForensic
    ? clampBudget(env.FORENSIC_ANALYSIS_BUDGET_MS, 120_000)
    : clampBudget(env.QUICK_ANALYSIS_BUDGET_MS, 60_000);
  const aiDeadlineAt = Date.now() + analysisBudgetMs - 2_000;

  // The job exists from this point on, so a refreshed or reconnected browser sees it as running (not missing).
  await saveJobState(env, { jobId: requestId, uid, status: 'running', percent: 35, message: 'Analysis started.' }, deps.fetcher || fetch);

  // Execute Analysis Pipeline
  const executeAnalysis = async (
    onProgress?: (stage: string, percent: number, message: string) => Promise<void> | void,
    onSection?: (key: SectionKey, value: Record<string, any>) => Promise<void> | void
  ): Promise<Record<string, any>> => {
    let run: SectionRunResult | null = null;

    if (!isForensic) {
      // Quick Review: Strictly bounded single-pass operation.
      // Falls back NEVER to sectioned analysis: multi-call sectioned pipelines exceed worker budgets
      // and stall customers. Truncated output, malformed JSON, and validation failures report explicit errors.
      if (documentText.length > DIRECT_ANALYSIS_MAX_CHARS) {
        throw new AnalyzerError(
          'AI_REQUEST_REJECTED',
          400,
          `This document exceeds the 75,000 character limit for Quick Review. Please select Forensic In-Depth mode for comprehensive analysis of larger records. Nothing was charged.`,
          false
        );
      }

      if (env.DIRECT_ANALYZER_DISABLED === 'true') {
        throw new AnalyzerError(
          'AI_PROVIDER_CONFIGURATION_ERROR',
          500,
          'Quick Review direct analyzer is temporarily disabled by configuration. Nothing was charged.',
          false
        );
      }

      if (!isEligibleForDirectAnalysis(documentText, aiDeadlineAt)) {
        throw new AnalyzerError(
          'ANALYSIS_TIMED_OUT',
          408,
          'Analysis could not be started within the available time budget. Nothing was charged.',
          true
        );
      }

      let directFailureReason: "oversized" | "timeout" | "max_tokens" | "malformed_json" | "validation_failed" | undefined;
      let directFailureDetails: string | undefined;
      const directStartedAt = Date.now();

      try {
        await onProgress?.('reviewing_evidence', 40, 'Conducting direct evidence audit and analysis...');
        run = await runDirectAnalysis({
          mode: 'fast',
          documentText,
          primaryModel,
          generate,
          deadlineAt: aiDeadlineAt,
          requestId,
          onSectionComplete: async (key, value, completed, total) => {
            const percent = 35 + Math.round((completed / total) * 60);
            const message = `Completed ${completed} of ${total} report sections: ${sectionTitle(key)}.`;
            await onSection?.(key, value);
            await onProgress?.(completed === total ? 'preparing_report' : 'reviewing_evidence', percent, message);
          },
          onFailureReason: (reason, details) => {
            directFailureReason = reason;
            directFailureDetails = details;
          },
        });
        if (run) {
          console.info('[analyzer_latency]', JSON.stringify({ path: 'direct', elapsedMs: Date.now() - directStartedAt, outcome: 'success' }));
        }
      } catch (err: any) {
        console.warn('[analyzer_latency]', JSON.stringify({ path: 'direct', elapsedMs: Date.now() - directStartedAt, outcome: 'failed' }));
        logAnalyzerDiagnostic('direct-first analysis failed', err);
        throw err;
      }

      if (!run) {
        console.warn('[analyzer_latency]', JSON.stringify({ path: 'direct', elapsedMs: Date.now() - directStartedAt, outcome: 'rejected', reason: directFailureReason }));
        if (directFailureReason === 'max_tokens') {
          throw new AnalyzerError(
            'AI_RESPONSE_INVALID',
            422,
            'The AI analysis model output was truncated before completion. Nothing was charged. Please try again.',
            true
          );
        }
        if (directFailureReason === 'malformed_json') {
          throw new AnalyzerError(
            'AI_RESPONSE_INVALID',
            422,
            'The AI analysis model generated an invalid response structure. Nothing was charged. Please try again.',
            true
          );
        }
        if (directFailureReason === 'validation_failed') {
          throw new AnalyzerError(
            'AI_RESPONSE_INVALID',
            422,
            `The AI analysis model output did not satisfy legal schema requirements (${directFailureDetails || 'schema error'}). Nothing was charged. Please try again.`,
            true
          );
        }
        if (directFailureReason === 'timeout') {
          throw new AnalyzerError(
            'ANALYSIS_TIMED_OUT',
            408,
            'Analysis could not be completed within the available time budget. Nothing was charged.',
            true
          );
        }
        throw new AnalyzerError(
          'AI_RESPONSE_INVALID',
          422,
          'Quick Review could not be completed in a single pass. Nothing was charged. Please try again or select Forensic In-Depth mode.',
          true
        );
      }
    } else {
      // Forensic In-Depth mode: multi-pass sectioned pipeline with Opus verification
      const sectionedStartedAt = Date.now();
      await onProgress?.('reviewing_evidence', 35, 'Analyzing document across evidence sections...');
      run = await runSectionedAnalysis({
        mode,
        documentText,
        primaryModel,
        verificationModel,
        generate,
        deadlineAt: aiDeadlineAt,
        requestId,
        onSectionComplete: async (key, value, completed, total) => {
          const span = 50;
          const percent = 35 + Math.round((completed / total) * span);
          const message = `Completed ${completed} of ${total} report sections: ${sectionTitle(key)}.`;
          await onSection?.(key, value);
          await onProgress?.(completed === total ? 'preparing_report' : 'reviewing_evidence', percent, message);
        },
        onVerificationStart: () => {
          void onProgress?.('verifying_findings', 88, 'Independent Claude Opus verification of high-impact findings...');
        },
      });
      console.info('[analyzer_latency]', JSON.stringify({ path: 'sectioned', elapsedMs: Date.now() - sectionedStartedAt, outcome: 'success' }));
    }

    await onProgress?.('preparing_report', 96, 'Validating quotations and assembling the report...');

    const report: Record<string, any> = {
      ...run.report,
      _metadata: {
        requestId,
        analysisMode: mode,
        modelUsed: primaryModel,
        verificationModelUsed: isForensic ? verificationModel : undefined,
        analyzedAt: new Date().toISOString(),
      },
    };

    applyReportGuards(report, documentText);
    return report;
  };

  // Helper to finalize credits
  const finalize = async (): Promise<boolean> => {
    if (isOwner) return true;
    if (sessionId) {
      const res = await finalizePaidReservation(sessionId, requestId, rpc);
      return res.status === 'consumed';
    } else {
      const res = await finalizeFreeScan(uid, requestId, rpc);
      return res.status === 'consumed';
    }
  };

  // Helper to release credits on error
  const release = async (): Promise<void> => {
    if (isOwner || !reservationId) return;
    try {
      if (sessionId) {
        await releasePaidReservation(sessionId, requestId, reservationId, rpc);
      } else {
        await releaseFreeScan(uid, requestId, reservationId, rpc);
      }
    } catch (e) {
      console.error('[ANALYZER_RELEASE_FAILED]', e);
    }
  };

  // Streaming SSE response
  if (wantsStream) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendEvent = async (event: string, data: any) => {
      try {
        await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        // Client disconnected
      }
    };

    const streamStartedAt = Date.now();
    const stageLog = (stage: string, extra: Record<string, unknown> = {}) => {
      console.info('[analyzer_stage]', JSON.stringify({ requestId, mode, path: isForensic ? 'forensic' : 'quick', stage, elapsedMs: Date.now() - streamStartedAt, ...extra }));
    };

    // Liveness signal. A browser that stops receiving these knows the worker is gone, not just slow. Heartbeats carry
    // no progress value, so the displayed percentage still moves only on real stage events.
    const heartbeat = setInterval(() => {
      void sendEvent('heartbeat', { requestId, elapsedMs: Date.now() - streamStartedAt });
    }, HEARTBEAT_INTERVAL_MS);

    // Run execution in background stream writer
    const analysisTask = (async () => {
      stageLog('started');
      try {
        await sendEvent('stage', { requestId, stage: 'verifying_access', percent: 30, message: 'Verifying account authorization & entitlements...' });

        // Hard ceiling over the whole pipeline. The provider call has its own timeout, but the pipeline must end even if a
        // step ignores its timeout. Without this ceiling the browser stays at its last percentage with no error and no result.
        const report = await withHardDeadline(
          executeAnalysis(
            async (stage, percent, message) => {
              stageLog('progress', { progressStage: stage, percent });
              await sendEvent('stage', { requestId, stage, percent, message });
            },
            async (key, value) => {
              await sendEvent('section', { requestId, section: key, ...value });
            }
          ),
          analysisBudgetMs + HARD_DEADLINE_GRACE_MS,
          () => new AnalyzerError('ANALYSIS_TIMED_OUT', 504, 'The analysis did not finish in time. Nothing was charged. Please try again.', true)
        );
        stageLog('analysis_done');

        // Atomic finalization before delivering complete report
        const finalized = await finalize();
        if (!finalized) {
          throw new AnalyzerError('ANALYSIS_PERSISTENCE_FAILED', 503, 'Credit finalization failed. Result cannot be delivered.', false);
        }
        stageLog('finalized');

        // Persist the completed job so a refresh can recover it (see ./_analysis-jobs.ts).
        await saveCompletedJob(env, { jobId: requestId, uid, report }, deps.fetcher || fetch);
        stageLog('persisted');

        // The report itself is sent unchanged, so the saved and streamed shapes stay identical.
        await sendEvent('complete', report);
        stageLog('complete');
      } catch (err: any) {
        const code = err instanceof AnalyzerError ? err.code : 'ANALYSIS_FAILED';
        const message = err instanceof AnalyzerError ? err.userMessage : 'The analysis could not be completed. Nothing was charged. Please try again.';
        const retryable = err instanceof AnalyzerError ? err.retryable : true;
        stageLog('failed', { code, retryable, errorName: err?.name ?? 'unknown' });
        // Each step is guarded so the error event is always sent, even if releasing the credit or saving the job fails.
        try { await release(); } catch (e) { console.error('[ANALYZER_RELEASE_FAILED]', e); }
        try {
          // The failure reason is saved, so a refreshed page shows it instead of a missing or stuck job.
          await saveJobState(env, { jobId: requestId, uid, status: 'failed', error: { code, message, retryable } }, deps.fetcher || fetch);
        } catch (e) { console.error('[ANALYSIS_JOB_SAVE_FAILED]', e instanceof Error ? e.name : 'error'); }
        await sendEvent('error', { requestId, error: message, code, retryable });
      } finally {
        clearInterval(heartbeat);
        try {
          await writer.close();
        } catch {}
      }
    })();
    // Keep the long-running AI operation alive after the Pages handler returns.
    // Otherwise the runtime may terminate the detached async task mid-analysis.
    waitUntil?.(analysisTask);

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // Synchronous JSON response
  try {
    const report = await executeAnalysis();
    const finalized = await finalize();
    if (!finalized) {
      await release();
      return Response.json(
        { error: 'Credit finalization failed.', code: 'CREDIT_FINALIZATION_FAILED' },
        { status: 503, headers: DEFAULT_HEADERS }
      );
    }
    // Persist the completed job so a refresh can recover it (see ./_analysis-jobs.ts).
    await saveCompletedJob(env, { jobId: requestId, uid, report }, deps.fetcher || fetch);
    return Response.json(report, { status: 200, headers: DEFAULT_HEADERS });
  } catch (err: any) {
    await release();
    const status = err instanceof AnalyzerError ? err.statusCode : 500;
    const code = err instanceof AnalyzerError ? err.code : 'ANALYSIS_FAILED';
    const message = err instanceof AnalyzerError ? err.userMessage : 'The analysis could not be completed. Nothing was charged. Please try again.';
    const retryable = err instanceof AnalyzerError ? err.retryable : true;
    await saveJobState(env, { jobId: requestId, uid, status: 'failed', error: { code, message, retryable } }, deps.fetcher || fetch);
    return Response.json(
      { error: message, code, retryable },
      { status, headers: DEFAULT_HEADERS }
    );
  }
}

export const onRequestPost = async (context?: { request: Request; env: AnalyzerEnv; waitUntil?: (promise: Promise<unknown>) => void }): Promise<Response> => {
  if (!context || !context.env || context.env.ANALYZER_ENABLED !== 'true') {
    return Response.json(
      { code: 'STAGING_ANALYZER_NOT_READY', analyzerReady: false },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
  return handleAnalyzeRequest(context.request, context.env, {}, context.waitUntil?.bind(context));
};
