import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/transcribe';
import * as authCheck from '../functions/api/_auth-check';

describe('Cloudflare Native Transcribe API (/api/transcribe & /api/transcribe-audio)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const validEnv = {
    FIREBASE_PROJECT_ID: 'test-firebase-proj',
    GEMINI_API_KEY: 'test-gemini-key',
  };

  it('rejects missing audio data', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'u1', email: null, emailVerified: false });
    const req = new Request('http://localhost/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('INVALID_AUDIO');
  });

  it('rejects oversized audio payloads', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'u1', email: null, emailVerified: false });
    const hugeAudio = 'A'.repeat(11 * 1024 * 1024);
    const req = new Request('http://localhost/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioData: hugeAudio }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('requires sign-in before reading the audio, and never calls Gemini for an anonymous caller', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'denied' });
    const req = new Request('http://localhost/api/transcribe', { method: 'POST', body: JSON.stringify({ audioData: 'UklGRg==', mimeType: 'audio/wav' }) });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed when Firebase is not configured, instead of skipping sign-in', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const req = new Request('http://localhost/api/transcribe', { method: 'POST', body: JSON.stringify({ audioData: 'UklGRg==', mimeType: 'audio/wav' }) });
    const res = await onRequestPost({ request: req, env: { GEMINI_API_KEY: 'k' } });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('AUTH_NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses non-audio types and hides provider error bodies', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'u1', email: null, emailVerified: false });
    const bad = new Request('http://localhost/api/transcribe', { method: 'POST', body: JSON.stringify({ audioData: 'JVBERi0=', mimeType: 'application/pdf' }) });
    expect((await onRequestPost({ request: bad, env: validEnv })).status).toBe(415);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"API key not valid. project 123456"}}', { status: 400 })));
    const req = new Request('http://localhost/api/transcribe', { method: 'POST', body: JSON.stringify({ audioData: 'UklGRg==', mimeType: 'audio/wav' }) });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/API key|123456/);
  });

  it('fails closed when Gemini API key is missing', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_123',
      email: 'user@example.com',
      emailVerified: true,
    });

    const req = new Request('http://localhost/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioData: 'SGVsbG8gd29ybGQ=' }),
    });
    const res = await onRequestPost({ request: req, env: { FIREBASE_PROJECT_ID: 'test-proj' } });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('TRANSCRIPTION_SERVICE_UNAVAILABLE');
  });

  it('transcribes valid audio using Gemini REST endpoint', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({
      status: 'verified',
      uid: 'user_123',
      email: 'user@example.com',
      emailVerified: true,
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Worker: I am visiting the home today. Parent: Yes, welcome.' },
                ],
              },
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    }));

    const req = new Request('http://localhost/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAA',
        mimeType: 'audio/webm',
        fileName: 'case-meeting.webm',
      }),
    });
    const res = await onRequestPost({ request: req, env: validEnv });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.fileName).toBe('Transcript - case-meeting.pdf');
    expect(json.text).toContain('Worker: I am visiting the home today');
    expect(json.transcribedText).toContain('AI-GENERATED TRANSCRIPTION AID');
  });
});
