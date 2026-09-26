/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: fragment capture-and-scrub (src/utils/invitationFragment.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'Zq9_' + 'x'.repeat(35) + '-Y1z'; // 43 base64url characters
const OTHER = 'Ab3-' + 'y'.repeat(35) + '_Q7w';

async function freshModule() {
  vi.resetModules();
  return import('./invitationFragment');
}
function go(url: string) { window.history.replaceState(null, '', url); }
function storageDump(): string {
  const all: string[] = [];
  for (const s of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < s.length; i++) { const k = s.key(i)!; all.push(k, String(s.getItem(k))); }
  }
  return all.join('|') + '|' + document.cookie;
}

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.localStorage.clear(); window.sessionStorage.clear();
  setItem = vi.spyOn(Storage.prototype, 'setItem');
});
afterEach(() => { setItem.mockRestore(); go('/'); });

describe('Stage 10 slice 8: invitation fragment capture', () => {
  it('captures a valid #t= token at module load and immediately scrubs it with replaceState (no new history entry)', async () => {
    go('/accept-invitation#t=' + TOKEN);
    const lengthBefore = window.history.length;
    const pushState = vi.spyOn(window.history, 'pushState');
    const m = await freshModule();
    expect(m.invitationCaptureStatus()).toBe('present');
    expect(m.heldInvitationToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/accept-invitation');
    expect(window.location.search).toBe('');
    expect(window.history.length).toBe(lengthBefore);
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it('keeps an existing query string and history state while removing only the fragment', async () => {
    window.history.replaceState({ keep: 1 }, '', '/accept-invitation?from=email#t=' + TOKEN);
    const m = await freshModule();
    expect(m.heldInvitationToken()).toBe(TOKEN);
    expect(window.location.search).toBe('?from=email');
    expect(window.location.hash).toBe('');
    expect(window.history.state).toEqual({ keep: 1 });
  });

  it.each([
    ['empty', '#t='], ['too short', '#t=abc'], ['too long', '#t=' + TOKEN + 'x'], ['bad characters', '#t=' + TOKEN.slice(0, 42) + '%'],
    ['two values', `#t=${TOKEN}&t=${OTHER}`], ['padding', '#t=' + TOKEN.slice(0, 42) + '='],
  ])('a malformed token (%s) is scrubbed and never held', async (_l, hash) => {
    go('/accept-invitation' + hash);
    const m = await freshModule();
    expect(m.invitationCaptureStatus()).toBe('malformed');
    expect(m.heldInvitationToken()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('a missing token is handled safely: nothing held, an unrelated fragment is left alone', async () => {
    go('/accept-invitation');
    let m = await freshModule();
    expect(m.invitationCaptureStatus()).toBe('none');
    go('/rights#section-2');
    m = await freshModule();
    expect(m.invitationCaptureStatus()).toBe('none');
    expect(window.location.hash).toBe('#section-2');
  });

  it('a token-bearing fragment on any other path is scrubbed but never captured', async () => {
    go('/review#t=' + TOKEN);
    const m = await freshModule();
    expect(window.location.hash).toBe('');
    expect(m.invitationCaptureStatus()).toBe('none');
    expect(m.heldInvitationToken()).toBeNull();
  });

  it('never writes the token to localStorage, sessionStorage or cookies', async () => {
    go('/accept-invitation#t=' + TOKEN);
    await freshModule();
    expect(setItem).not.toHaveBeenCalled();
    expect(storageDump()).not.toContain(TOKEN);
    expect(document.cookie).toBe('');
  });

  it('refresh after the scrub cannot recover the token: a fresh page load holds nothing', async () => {
    go('/accept-invitation#t=' + TOKEN);
    let m = await freshModule();
    expect(m.heldInvitationToken()).toBe(TOKEN);
    // A reload re-evaluates the module against the scrubbed URL; nothing persistent carries the token.
    m = await freshModule();
    expect(m.invitationCaptureStatus()).toBe('none');
    expect(m.heldInvitationToken()).toBeNull();
    expect(storageDump()).not.toContain(TOKEN);
  });

  it('discardInvitationToken destroys the in-memory token', async () => {
    go('/accept-invitation#t=' + TOKEN);
    const m = await freshModule();
    expect(m.containsHeldInvitationToken(`x${TOKEN}y`)).toBe(true);
    m.discardInvitationToken();
    expect(m.heldInvitationToken()).toBeNull();
    expect(m.invitationCaptureStatus()).toBe('none');
    expect(m.containsHeldInvitationToken(`x${TOKEN}y`)).toBe(false);
  });

  it('src/main.tsx imports the capture module FIRST, before App and anything that loads telemetry', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../main.tsx'), 'utf8');
    const imports = src.split('\n').filter(l => /^import\b/.test(l));
    expect(imports[0]).toBe("import './utils/invitationFragment';");
  });
});
