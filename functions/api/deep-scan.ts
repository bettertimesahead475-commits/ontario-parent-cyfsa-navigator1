/**
 * Cloudflare Pages Functions - Deep Scan Endpoint (/api/deep-scan).
 *
 * Provides backwards-compatible entry point for the "Run Deep Scan" action,
 * delegating directly to the authoritative Cloudflare analyzer pipeline
 * in Forensic In-Depth mode ('full').
 */
import { handleAnalyzeRequest, type AnalyzerEnv, type AnalyzeDependencies } from './analyze';

export async function handleDeepScanRequest(
  request: Request,
  env: AnalyzerEnv,
  deps: AnalyzeDependencies = {},
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {
  let body: any = {};
  try {
    body = await request.clone().json();
  } catch {
    // Let handleAnalyzeRequest report invalid JSON
  }

  // Force forensic in-depth mode
  const forensicBody = {
    ...body,
    mode: 'full',
  };

  const forensicRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(forensicBody),
  });

  return handleAnalyzeRequest(forensicRequest, env, deps, waitUntil);
}

export const onRequestPost = async (context: {
  request: Request;
  env: AnalyzerEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> => {
  return handleDeepScanRequest(context.request, context.env, {}, context.waitUntil);
};
