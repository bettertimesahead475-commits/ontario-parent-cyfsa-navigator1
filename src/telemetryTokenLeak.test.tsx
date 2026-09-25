/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: END-TO-END boot of the real entry point (src/main.tsx -> App.tsx) with the REAL
// @vercel/analytics and @vercel/speed-insights packages (not mocked), started at an invitation link.
// Proves: the fragment is gone before either collector script is injected; each package is handed the
// sanitizing beforeSend; a collector reading the page URL at any later time finds no token; nothing
// is fetched, stored, logged or rendered with the token.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

const TOKEN = 'Zq9_' + 'x'.repeat(35) + '-Y1z';

// Only heavy page content is stubbed; the router, RequireAuth wrapper and telemetry are real code
// paths except RequireAuth, which is replaced by a signed-in pass-through.
vi.mock('./components/ParentJourney', () => ({ __esModule: true, default: () => null }));
vi.mock('./components/RequireAuth', () => ({ __esModule: true, default: ({ children }: any) => children }));

const events: { what: string; href: string; detail?: string }[] = [];
const fetchCalls: string[] = [];
const logs: string[] = [];
const realAppend = document.head.appendChild.bind(document.head);
vi.spyOn(document.head, 'appendChild').mockImplementation((node: any) => {
  if (node?.tagName === 'SCRIPT') events.push({ what: 'script', href: window.location.href, detail: node.src });
  return realAppend(node);
});
vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
  fetchCalls.push(`${String(input)} ${init?.body ?? ''} ${window.location.href}`);
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}));
for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
}

window.history.replaceState(null, '', '/accept-invitation#t=' + TOKEN);
document.body.innerHTML = '<div id="root"></div>';

afterAll(() => vi.restoreAllMocks());

describe('Stage 10 slice 8: no invitation token reaches Analytics or Speed Insights', () => {
  it('boots the real app from an invitation link with the fragment scrubbed before any collector exists', async () => {
    await act(async () => { await import('./main'); });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const scripts = events.filter(e => e.what === 'script');
    // Both collectors really injected (test mode loads their debug builds from va.vercel-scripts.com).
    const srcs = scripts.map(e => String(e.detail));
    expect(srcs.some(x => /\/v1\/script(\.debug)?\.js$|\/_vercel\/insights\/script\.js$/.test(x))).toBe(true);
    expect(srcs.some(x => /speed-insights\/script(\.debug)?\.js$/.test(x))).toBe(true);
    for (const e of scripts) expect(e.href).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/accept-invitation');
  });

  it('both real packages were handed the sanitizing beforeSend', async () => {
    const { sanitizeTelemetryEvent } = await import('./utils/telemetrySanitizer');
    const va = ((window as any).vaq ?? []) as unknown[][];
    const si = ((window as any).siq ?? []) as unknown[][];
    expect(va.some(c => c[0] === 'beforeSend' && c[1] === sanitizeTelemetryEvent)).toBe(true);
    expect(si.some(c => c[0] === 'beforeSend' && c[1] === sanitizeTelemetryEvent)).toBe(true);
  });

  it('a collector that builds its event from the live URL -- or from the original link -- sends no token', async () => {
    const va = ((window as any).vaq ?? []) as unknown[][];
    const si = ((window as any).siq ?? []) as unknown[][];
    const beforeSends = [...va, ...si].filter(c => c[0] === 'beforeSend').map(c => c[1] as (e: any) => any);
    for (const bs of beforeSends) {
      const live = bs({ type: 'pageview', url: window.location.href });
      expect(JSON.stringify(live)).not.toContain(TOKEN);
      expect(live.url).toBe(`${window.location.origin}/accept-invitation`);
      // Even if a collector had captured the original link before the scrub, it is dropped/cleaned.
      const early = bs({ type: 'pageview', url: `${window.location.origin}/accept-invitation#t=${TOKEN}` });
      expect(JSON.stringify(early ?? null)).not.toContain(TOKEN);
      const vital = bs({ type: 'vital', url: `${window.location.origin}/accept-invitation?t=${TOKEN}` });
      expect(JSON.stringify(vital ?? null)).not.toContain(TOKEN);
    }
  });

  it('the token was never fetched, stored, logged, placed in a cookie or rendered', async () => {
    expect(fetchCalls.join('\n')).not.toContain(TOKEN);
    expect(logs.join('\n')).not.toContain(TOKEN);
    const stored: string[] = [];
    for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) stored.push(st.key(i)!, String(st.getItem(st.key(i)!)));
    expect(stored.join('|')).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    // The acceptance page did render (the capture is in memory, not lost).
    expect(document.body.textContent).toContain('Accept invitation');
  });
});
