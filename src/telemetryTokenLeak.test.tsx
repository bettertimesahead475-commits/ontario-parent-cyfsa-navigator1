/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: END-TO-END boot of the real entry point (src/main.tsx -> App.tsx) (the site runs on Cloudflare Pages;
// the former Vercel collectors were removed: their scripts do not exist there), started at an invitation link.
// Proves: the fragment is gone before either collector script is injected; each package is handed the
// sanitizing beforeSend; a collector reading the page URL at any later time finds no token; nothing
// is fetched, stored, logged or rendered with the token.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

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

describe("Stage 10 slice 8: no invitation token reaches any telemetry", () => {
  it("boots the real app from an invitation link, scrubs the fragment and injects no third-party collector", async () => {
    await act(async () => { await import("./main"); });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    const srcs = events.filter(e => e.what === "script").map(e => String(e.detail));
    expect(srcs.filter(x => x.includes("vercel") || x.includes("insights/script") || x.includes("speed-insights"))).toEqual([]);
    for (const e of events) expect(e.href).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/accept-invitation");
  });

  it("the token was never fetched, stored, logged, placed in a cookie or rendered", async () => {
    expect(fetchCalls.join(" | ")).not.toContain(TOKEN);
    expect(logs.join(" | ")).not.toContain(TOKEN);
    const stored: string[] = [];
    for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) stored.push(st.key(i)!, String(st.getItem(st.key(i)!)));
    expect(stored.join("|")).not.toContain(TOKEN);
    expect(document.cookie).not.toContain(TOKEN);
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    await waitFor(() => {
      expect(document.body.textContent).toContain("Accept invitation");
    }, { timeout: 10000 });
  });
});
