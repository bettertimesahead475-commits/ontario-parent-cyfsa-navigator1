/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: telemetry backstop (beforeSend for Vercel Web Analytics and Speed Insights).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'Zq9_' + 'x'.repeat(35) + '-Y1z';
let s: typeof import('./telemetrySanitizer');
let f: typeof import('./invitationFragment');

beforeEach(async () => {
  vi.resetModules();
  window.history.replaceState(null, '', '/accept-invitation#t=' + TOKEN);
  f = await import('./invitationFragment'); // holds TOKEN, URL scrubbed
  s = await import('./telemetrySanitizer');
});

const ORIGIN = window.location.origin;
const noToken = (x: unknown) => expect(JSON.stringify(x)).not.toContain(TOKEN);

describe('Stage 10 slice 8: sanitizeTelemetryEvent', () => {
  it.each([
    [`${ORIGIN}/accept-invitation#t=${TOKEN}`, `${ORIGIN}/accept-invitation`],
    [`${ORIGIN}/accept-invitation?x=1#t=${TOKEN}`, `${ORIGIN}/accept-invitation`],
    [`${ORIGIN}/review#t=${TOKEN}`, `${ORIGIN}/review`],
    [`${ORIGIN}/review?t=abc&tab=2`, `${ORIGIN}/review?tab=2`],
    [`${ORIGIN}/review?token=abc`, `${ORIGIN}/review`],
    [`${ORIGIN}/rights#anchor`, `${ORIGIN}/rights`],
    [`${ORIGIN}/`, `${ORIGIN}/`],
  ])('%s -> %s', (url, expected) => {
    for (const type of ['pageview', 'event', 'vital'] as const) {
      const out = s.sanitizeTelemetryEvent({ type, url });
      expect(out).toEqual({ type, url: expected });
      noToken(out);
      expect(out!.url).not.toContain('#');
      expect(out!.url).not.toMatch(/[?&]t=/);
    }
  });

  it('drops (null) any event whose URL still carries the held token anywhere, encoded or not', () => {
    for (const url of [
      `${ORIGIN}/review?next=${TOKEN}`, `${ORIGIN}/review?next=${encodeURIComponent('/accept-invitation#t=' + TOKEN)}`,
      `${ORIGIN}/${TOKEN}`, `${ORIGIN}/lawyers/${TOKEN}`,
    ]) expect(s.sanitizeTelemetryEvent({ type: 'pageview', url })).toBeNull();
  });

  it('drops an event with a token-shaped value even after the held token was discarded', () => {
    f.discardInvitationToken();
    const other = 'Pp1_' + 'z'.repeat(35) + '-Kk9';
    expect(s.sanitizeTelemetryEvent({ type: 'pageview', url: `${ORIGIN}/somewhere?x=${other}` })).toBeNull();
    expect(s.sanitizeTelemetryEvent({ type: 'pageview', url: `${ORIGIN}/p/${other}` })).toBeNull();
  });

  it('drops an event whose other fields carry the token (e.g. custom event data)', () => {
    expect(s.sanitizeTelemetryEvent({ type: 'event', url: `${ORIGIN}/review`, data: { note: TOKEN } } as any)).toBeNull();
  });

  it('drops unparsable or malformed events instead of passing them through', () => {
    expect(s.sanitizeTelemetryEvent({ type: 'pageview', url: 'http://[::1' })).toBeNull();
    expect(s.sanitizeTelemetryEvent({ type: 'pageview' } as any)).toBeNull();
    expect(s.sanitizeTelemetryEvent(null as any)).toBeNull();
  });

  it('keeps ordinary telemetry intact (telemetry is not disabled app-wide)', () => {
    expect(s.sanitizeTelemetryEvent({ type: 'pageview', url: `${ORIGIN}/lawyers/abc123?page=2` }))
      .toEqual({ type: 'pageview', url: `${ORIGIN}/lawyers/abc123?page=2` });
  });
});
