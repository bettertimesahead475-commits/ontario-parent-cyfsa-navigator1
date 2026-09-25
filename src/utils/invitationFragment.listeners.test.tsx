/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: the module is evaluated exactly ONCE in this file, as in a real page, so its
// popstate/hashchange listeners are the only ones present.
import { describe, expect, it } from 'vitest';

const TOKEN = 'Zq9_' + 'x'.repeat(35) + '-Y1z';
const OTHER = 'Ab3-' + 'y'.repeat(35) + '_Q7w';
window.history.replaceState(null, '', '/accept-invitation');
const m = await import('./invitationFragment');

describe('Stage 10 slice 8: invitation fragment listeners', () => {
  it('a link pasted into an already-open app (hashchange/popstate, no reload) is captured and scrubbed', async () => {
    expect(m.invitationCaptureStatus()).toBe('none');
    window.history.replaceState(null, '', '/accept-invitation#t=' + TOKEN);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(window.location.hash).toBe('');
    expect(m.heldInvitationToken()).toBe(TOKEN);
    window.history.replaceState(null, '', '/accept-invitation#t=' + OTHER);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('');
    expect(m.heldInvitationToken()).toBe(OTHER);
  });

});
