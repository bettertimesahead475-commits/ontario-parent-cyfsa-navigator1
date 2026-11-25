import { describe, expect, it, vi } from 'vitest';
import { onRequestPost, summarizeCspReport } from '../functions/api/csp-report';

describe('CSP report-only endpoint', () => {
  it('logs only directive, blocked origin and page path for both report formats', () => {
    const legacy = { 'csp-report': { 'document-uri': 'https://cyfsanavigator.com/document-analyzer?case=SECRET', 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=abc' } };
    const modern = [{ type: 'csp-violation', body: { documentURL: 'https://cyfsanavigator.com/pricing', effectiveDirective: 'connect-src', blockedURL: 'https://api.example.com/v1/data?q=1' } }];
    expect(summarizeCspReport(legacy)).toEqual([{ directive: 'script-src-elem', blocked: 'https://evil.example', page: '/document-analyzer' }]);
    expect(summarizeCspReport(modern)).toEqual([{ directive: 'connect-src', blocked: 'https://api.example.com', page: '/pricing' }]);
    expect(summarizeCspReport({ 'csp-report': { 'blocked-uri': 'inline', 'violated-directive': 'style-src' } })[0].blocked).toBe('inline');
  });

  it('always answers 204 and never logs query strings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = JSON.stringify({ 'csp-report': { 'document-uri': 'https://cyfsanavigator.com/a?secret=1', 'violated-directive': 'img-src', 'blocked-uri': 'https://x.example/p?secret=2' } });
    const res = await onRequestPost({ request: new Request('https://x/api/csp-report', { method: 'POST', body, headers: { 'content-length': String(body.length) } }) });
    expect(res.status).toBe(204);
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('secret');
    expect((await onRequestPost({ request: new Request('https://x/api/csp-report', { method: 'POST', body: 'not json' }) })).status).toBe(204);
    warn.mockRestore();
  });
});
