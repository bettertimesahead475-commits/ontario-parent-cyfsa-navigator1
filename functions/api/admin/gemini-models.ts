/**
 * GET /api/admin/gemini-models (admin secret only).
 *
 * Asks Google which models the configured GEMINI_API_KEY can call with generateContent, and whether the configured
 * OCR and audio models are among them. This is how a model change is verified for this key, rather than assumed from
 * documentation. Returns model names only: never the key or any provider error text.
 */
import { GeminiError, listGeminiModels, resolveGeminiModel, type GeminiEnv } from '../_gemini';

interface Env extends GeminiEnv {
  ADMIN_SECRET?: string;
}

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const secret = env.ADMIN_SECRET?.trim();
  const presented = request.headers.get('x-admin-secret') ?? '';
  if (!secret || !constantTimeEqual(presented, secret)) {
    return Response.json({ error: 'Unauthorized.', code: 'UNAUTHORIZED' }, { status: 401, headers: HEADERS });
  }
  try {
    const available = await listGeminiModels(env);
    const ocrModel = resolveGeminiModel(env, 'ocr');
    const audioModel = resolveGeminiModel(env, 'audio');
    return Response.json(
      {
        ocrModel,
        ocrModelAvailable: available.includes(ocrModel),
        ocrModelSource: env.GEMINI_OCR_MODEL?.trim() ? 'GEMINI_OCR_MODEL' : 'default',
        audioModel,
        audioModelAvailable: available.includes(audioModel),
        audioModelSource: env.GEMINI_AUDIO_MODEL?.trim() ? 'GEMINI_AUDIO_MODEL' : 'default',
        availableModels: available.filter((m) => /^gemini-/.test(m)).sort(),
      },
      { status: 200, headers: HEADERS }
    );
  } catch (err) {
    const kind = err instanceof GeminiError ? err.kind : 'PROVIDER_UNAVAILABLE';
    return Response.json({ error: 'Could not list Gemini models.', code: `GEMINI_${kind}` }, { status: 502, headers: HEADERS });
  }
};
