/**
 * Receives Content-Security-Policy-Report-Only violation reports (legacy report-uri format and the Reporting
 * API array format). Logs only the violated directive, the blocked ORIGIN and the page path: never full URLs,
 * query strings, script samples or document content. Always answers 204 so reporting cannot affect users.
 */
const MAX_BODY_BYTES = 16 * 1024;

function originOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'none';
  if (/^(inline|eval|wasm-eval|data|blob|self)$/i.test(value)) return value.toLowerCase();
  try { return new URL(value).origin; } catch { return value.split(':')[0].slice(0, 20); }
}

function pathOf(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  try { return new URL(value).pathname.slice(0, 80); } catch { return 'unknown'; }
}

export function summarizeCspReport(payload: unknown): Array<{ directive: string; blocked: string; page: string }> {
  const items = Array.isArray(payload) ? payload.map((r) => (r && typeof r === 'object' ? (r as any).body : null)) : [(payload as any)?.['csp-report']];
  return items.filter(Boolean).slice(0, 10).map((r: any) => ({
    directive: String(r.effectiveDirective ?? r['effective-directive'] ?? r['violated-directive'] ?? 'unknown').split(' ')[0].slice(0, 40),
    blocked: originOf(r.blockedURL ?? r['blocked-uri']),
    page: pathOf(r.documentURL ?? r['document-uri']),
  }));
}

export const onRequestPost = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    const length = Number(request.headers.get('content-length') || 0);
    if (length <= MAX_BODY_BYTES) {
      const text = (await request.text()).slice(0, MAX_BODY_BYTES);
      for (const v of summarizeCspReport(JSON.parse(text))) console.warn('[CSP_REPORT_ONLY_VIOLATION]', JSON.stringify(v));
    }
  } catch { /* Malformed reports are ignored. */ }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
