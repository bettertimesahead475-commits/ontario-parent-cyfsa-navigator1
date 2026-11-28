/**
 * Methods served by native Pages Functions, per route. Pages sends a request whose method has no
 * handler (for example a GET or an OPTIONS preflight to a POST-only endpoint) to the [[path]]
 * catch-all. Without this map the catch-all answered every such request with the misleading
 * "Cloudflare staging API is not yet configured", which hid the real cause (a method mismatch).
 *
 * api/cloudflare-native-api-routes.test.ts keeps this in sync with the exports in functions/api.
 * 'ALL' means the module exports a method-independent onRequest.
 */
import { trimCharacters } from '../../shared/linearText';

export const NATIVE_API_ROUTES: Record<string, readonly string[]> = {
  '/api/access-pricing': ['GET'],
  '/api/activate-code': ['POST'],
  '/api/admin/analyzer-provider-check': ['ALL'],
  '/api/admin/gemini-models': ['GET'],
  '/api/analyze': ['POST'],
  '/api/analyzer-usage': ['GET'],
  '/api/claim-purchase': ['POST'],
  '/api/csp-report': ['POST'],
  '/api/deep-scan': ['POST'],
  '/api/extract-text': ['POST'],
  '/api/final-case-assessment': ['ALL'],
  '/api/health': ['GET'],
  '/api/my-payments': ['GET'],
  '/api/request-access': ['POST'],
  '/api/status': ['GET'],
  '/api/transcribe-audio': ['POST'],
  '/api/transcribe': ['POST'],
};

/** Allowed methods for a native route path (ignoring a trailing slash), or null when not native. */
export function nativeRouteMethods(pathname: string): readonly string[] | null {
  // trimCharacters: linear equivalent of .replace(/\/+$/, ''), which rescanned every run of slashes in the path.
  const normalized = pathname.length > 1 ? trimCharacters(pathname, '/', { end: true }) : pathname;
  if (/^\/api\/analyze\/job\/[^/]+$/.test(normalized)) return ['GET'];
  return NATIVE_API_ROUTES[normalized] ?? null;
}
