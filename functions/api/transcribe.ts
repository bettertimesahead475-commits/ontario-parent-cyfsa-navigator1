/**
 * Cloudflare Pages Functions - Audio Transcription API.
 *
 * POST /api/transcribe
 * Transcribes parent audio recording/memo using Gemini API REST with pure web standards.
 */
import { verifyFirebaseRequest } from './_auth-check';

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const MAX_TRANSCRIBE_AUDIO_CHARS = 10 * 1024 * 1024; // ~7.5MB audio base64
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/flac',
]);

interface Env {
  FIREBASE_PROJECT_ID?: string;
  GEMINI_API_KEY?: string;
}

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  // Sign-in first, and always: without a configured Firebase project the route refuses (fail closed), so the
  // provider key can never be spent by an anonymous caller.
  if (!env.FIREBASE_PROJECT_ID) {
    return Response.json(
      { error: 'Audio transcription is not configured on this server.', code: 'AUTH_NOT_CONFIGURED' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }
  const authResult = await verifyFirebaseRequest(request, env);
  if (authResult.status !== 'verified') {
    return Response.json(
      { error: 'Sign in to transcribe audio recordings.', code: 'SIGN_IN_REQUIRED' },
      { status: authResult.status === 'unavailable' ? 503 : 401, headers: DEFAULT_HEADERS }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { audioData, mimeType, fileName } = body || {};

  if (!audioData || typeof audioData !== 'string') {
    return Response.json(
      { error: 'No audio data was provided for transcription.', code: 'INVALID_AUDIO' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  if (audioData.length > MAX_TRANSCRIBE_AUDIO_CHARS) {
    return Response.json(
      { error: 'Audio recording is too large to transcribe.', code: 'PAYLOAD_TOO_LARGE' },
      { status: 413, headers: DEFAULT_HEADERS }
    );
  }

  const requestedMime = typeof mimeType === 'string' && mimeType ? mimeType.split(';')[0].trim().toLowerCase() : 'audio/webm';
  if (!ALLOWED_AUDIO_TYPES.has(requestedMime)) {
    return Response.json(
      { error: 'Unsupported audio format. Use MP3, WAV, M4A, OGG, FLAC, AAC or WebM.', code: 'UNSUPPORTED_AUDIO_TYPE' },
      { status: 415, headers: DEFAULT_HEADERS }
    );
  }

  if (!env.GEMINI_API_KEY) {
    return Response.json(
      { error: 'Audio transcription service is not configured on staging.', code: 'TRANSCRIPTION_SERVICE_UNAVAILABLE' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }

  let cleanedBase64 = audioData.trim();
  if (cleanedBase64.includes(',')) {
    cleanedBase64 = cleanedBase64.split(',')[1];
  }

  const targetMime = requestedMime;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe this audio recording exactly as spoken. Attribute lines to speakers only where you can genuinely tell voices apart (e.g. "Speaker 1:", "Speaker 2:") - do not guess names or roles unless someone states their own name or role aloud. Mark unclear or inaudible sections as [inaudible]. Do not add commentary, legal formatting, headers, certifications, or analysis - output the transcription text only, nothing else.',
              },
              {
                inlineData: {
                  mimeType: targetMime,
                  data: cleanedBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!geminiRes.ok) {
      // The provider's error body is not returned: it can carry request and account detail.
      return Response.json(
        { error: 'Audio transcription service returned an error. Please try again.', code: 'AI_PROVIDER_ERROR' },
        { status: 502, headers: DEFAULT_HEADERS }
      );
    }

    const result = (await geminiRes.json()) as any;
    const transcribedText = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!transcribedText) {
      return Response.json(
        { error: 'The transcription came back empty - the recording may be silent, too short, or in an unsupported format.', code: 'EMPTY_TRANSCRIPT' },
        { status: 400, headers: DEFAULT_HEADERS }
      );
    }

    const outFileName = fileName
      ? `Transcript - ${String(fileName).replace(/\.[^/.]+$/, '')}.pdf`
      : `Transcript_Audio_${Date.now()}.pdf`;

    return Response.json(
      {
        success: true,
        fileName: outFileName,
        mimeType: 'application/pdf',
        transcribedText: `AI-GENERATED TRANSCRIPTION AID - review carefully against the original recording before relying on this for anything official; it is not a certified court transcript.\n\n${transcribedText}`,
        text: transcribedText,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  } catch (err: any) {
    return Response.json(
      { error: 'Audio transcription failed. Please check the audio file and try again.', code: 'TRANSCRIPTION_FAILED' },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  }
};
