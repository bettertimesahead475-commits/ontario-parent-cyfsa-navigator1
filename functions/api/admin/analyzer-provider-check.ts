/** Fixed synthetic provider check. No report store, queue, entitlement or credit access. */
import { verifyFirebaseRequest } from '../_auth-check';
import { createCloudflareGenerateFn } from '../_analyzer-model-adapter';
import { runSectionedAnalysis } from '../../../api/services/analyzerSections';
import { DEFAULT_QUICK_MODEL, DEFAULT_FORENSIC_MODEL } from '../../../api/services/analyzerModels';
import { providerDiagnostic } from '../../../shared/providerDiagnostics';
import { AnalyzerError } from '../../../api/services/analyzerErrors';
import { listGeminiModels, resolveGeminiModel, GeminiError } from '../_gemini';

type Env = {
  FIREBASE_PROJECT_ID?: string; STAGING_PROVIDER_CHECKS_ENABLED?: string; ANALYZER_ENABLED?: string;
  STAGING_PROVIDER_CHECK_UIDS?: string; ANTHROPIC_API_KEY?: string; GEMINI_API_KEY?: string;
  GEMINI_OCR_MODEL?: string; GEMINI_AUDIO_MODEL?: string;
  ANTHROPIC_QUICK_MODEL?: string; ANTHROPIC_FORENSIC_MODEL?: string;
};
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fixture = `[Page 1]\nSYNTHETIC SOFTWARE TEST RECORD. All events below are fictional. A test worker recorded a meeting on 2 January 2026. A second note describes the same meeting as taking place on 3 January 2026. The date discrepancy is unresolved.\n\n[Page 2]\nThe test worker wrote: "A neighbour told me there was an argument." The worker did not witness an argument. There is no recording or independent corroboration. An allegation is not a verified fact.\n\n[Page 3]\nA fictional parent requested the underlying notes and an opportunity to respond. A follow-up meeting was proposed. No real child, customer, medical record, court proceeding or legal finding is described. This document is a synthetic fixture for testing evidence classification, chronology and structured report generation.`;

export async function handleProviderCheck(request: Request, env: Env): Promise<Response> {
  const host = new URL(request.url).hostname;
  if (env.STAGING_PROVIDER_CHECKS_ENABLED !== 'true' || env.ANALYZER_ENABLED !== 'false' || env.FIREBASE_PROJECT_ID !== 'cyfsa-navigator-e2e-20261108' || !(host === 'cyfsa-navigator-staging.pages.dev' || host.endsWith('.cyfsa-navigator-staging.pages.dev'))) return Response.json({ code: 'NOT_FOUND' }, { status: 404, headers });
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified') return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401, headers });
  if (!(env.STAGING_PROVIDER_CHECK_UIDS || '').split(',').includes(identity.uid)) return Response.json({ code: 'FORBIDDEN' }, { status: 403, headers });
  const quick = env.ANTHROPIC_QUICK_MODEL || DEFAULT_QUICK_MODEL;
  const deep = env.ANTHROPIC_FORENSIC_MODEL || DEFAULT_FORENSIC_MODEL;
  try {
    if (request.method === 'GET') {
      let gemini: string[] = []; let geminiFailure: unknown; try { gemini = await listGeminiModels(env); } catch (error) { geminiFailure = error instanceof GeminiError ? { code: 'GEMINI_' + error.kind, diagnostic: error.diagnostic } : { code: 'GEMINI_UNAVAILABLE' }; }
      const response = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) return Response.json({ geminiFailure, anthropicFailure: providerDiagnostic(response.status, await response.text()) }, { headers });
      const data = await response.json() as { data?: Array<{ id: string }> };
      const anthropic = (data.data || []).map(x => x.id);
      return Response.json({ ocrModel: resolveGeminiModel(env, 'ocr'), quickModel: quick, deepModel: deep, geminiFailure, availableGeminiModels: gemini, availableAnthropicModels: anthropic }, { headers });
    }
    if (request.method !== 'POST') return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    let body: any;
    try { body = await request.json(); } catch { return Response.json({ code: 'INVALID_REQUEST' }, { status: 400, headers }); }
    if (!body || Object.keys(body).some(k => k !== 'mode') || !['fast','full'].includes(body.mode)) return Response.json({ code: 'FIXED_SYNTHETIC_INPUT_ONLY' }, { status: 400, headers });
    const started = Date.now();
    const model = body.mode === 'full' ? deep : quick;
    const run = await runSectionedAnalysis({ mode: body.mode, documentText: fixture, primaryModel: model, verificationModel: body.mode === 'full' ? deep : undefined, generate: createCloudflareGenerateFn(env), deadlineAt: started + (body.mode === 'full' ? 178000 : 98000), requestId: crypto.randomUUID() });
    if (typeof run.report.fileSummary !== 'string' || run.report.fileSummary.length < 40) throw new AnalyzerError('AI_RESPONSE_INVALID',502,'Structured summary missing');
    return Response.json({ mode: body.mode, modelUsed: model, elapsedMs: Date.now()-started, fixture: 'fixed-synthetic-v1', report: run.report, usageByModel: run.usageByModel, sectionTimingsMs: run.sectionTimingsMs, databaseWrites: false, creditLifecycleTested: false, persistenceTested: false }, { headers });
  } catch (error) {
    return Response.json({ diagnostic: error instanceof AnalyzerError ? error.providerDiagnostic : error instanceof GeminiError ? error.diagnostic : undefined, code: error instanceof AnalyzerError ? error.code : error instanceof GeminiError ? `GEMINI_${error.kind}` : 'PROVIDER_CHECK_FAILED' }, { status: error instanceof AnalyzerError ? error.statusCode : 502, headers });
  }
}
export const onRequest = ({ request, env }: { request: Request; env: Env }) => handleProviderCheck(request, env);
