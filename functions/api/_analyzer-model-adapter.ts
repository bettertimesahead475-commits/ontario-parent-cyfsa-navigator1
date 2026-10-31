/**
 * Cloudflare Worker / Pages Functions Anthropic AI Model Execution Adapter.
 *
 * Calls Claude Messages API using web standard fetch, supporting approved model routing,
 * timeout controls via AbortSignal, transient error retries, and token usage accounting.
 */

import { AnalyzerError, logAnalyzerDiagnostic } from '../../api/services/analyzerErrors';
import { requireApprovedModel, resolveAnthropicWireModel } from '../../api/services/analyzerModels';
import type { GenerateFn, GenerateResult } from '../../api/services/analyzerSections';

export interface ModelAdapterEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_API_URL?: string;
}

export function createCloudflareGenerateFn(
  env: ModelAdapterEnv,
  fetcher: typeof fetch = fetch
): GenerateFn {
  return async (options, model): Promise<GenerateResult> => {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new AnalyzerError(
        'AI_PROVIDER_CONFIGURATION_ERROR',
        500,
        'ANTHROPIC_API_KEY is not configured on Cloudflare runtime.',
        false
      );
    }

    const approvedModel = requireApprovedModel(model);
    const wireModel = resolveAnthropicWireModel(approvedModel);
    const baseUrl = env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';

    const maxRetries = options.retries ?? 1;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : 60_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        // The deadline covers the whole call: headers, body and JSON parse. It also does not depend on fetch honouring
        // the abort signal. Before this, the timer was cleared once headers arrived, so a body that never finished left the
        // analysis waiting forever, with the browser stuck at its last progress value and no error ever sent.
        const deadline = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error(`provider deadline of ${timeoutMs} ms exceeded`)),
            { once: true }
          );
        });
        deadline.catch(() => undefined); // the rejection is consumed by bounded() below, never left unhandled
        const bounded = <T>(p: Promise<T>): Promise<T> => Promise.race([p, deadline]);

        const requestBody = {
          model: wireModel,
          max_tokens: options.max_tokens || 4000,
          system: options.system,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content.map((c) => (typeof c === 'string' ? c : c.text)).join('\n'),
          })),
        };

        const startTime = Date.now();
        let response: Response;
        let rawBody: string;
        try {
          response = await bounded(fetcher(baseUrl, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          }));
          // An error body is only used for server-side logging, so an unreadable one must not change the status mapping.
          rawBody = await bounded(response.text()).catch((e: unknown) => {
            if (response.ok) throw e;
            return 'Could not read error body';
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const status = response.status;
          const errorText = rawBody;

          // The provider's body goes to the server log only (redacted). Customers get fixed messages, because
          // AnalyzerError.userMessage is what the browser receives.
          logAnalyzerDiagnostic(`provider HTTP ${status}`, new Error(errorText));
          if (status === 429) {
            throw new AnalyzerError('AI_RATE_LIMITED', 429, 'The AI service is busy right now. Please wait a moment and try again. Nothing was charged.', true);
          }
          if (status >= 500 && status < 600) {
            throw new AnalyzerError('AI_PROVIDER_TEMPORARILY_UNAVAILABLE', 503, 'The AI analysis engine is temporarily unavailable. Please try again shortly. Nothing was charged.', true);
          }
          if (status === 400) {
            throw new AnalyzerError('AI_REQUEST_REJECTED', 400, 'The AI service could not process this request. Nothing was charged. Please try again or contact support.', false);
          }
          throw new AnalyzerError('AI_PROVIDER_CONFIGURATION_ERROR', 503, 'The analysis service is not available right now because of a configuration problem on our side. Nothing was charged.', false);
        }

        const data = JSON.parse(rawBody) as {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
          stop_reason?: string | null;
        };

        const text = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') || '';
        const usage = {
          input_tokens: data.usage?.input_tokens ?? 0,
          output_tokens: data.usage?.output_tokens ?? 0,
        };

        return {
          text,
          usage,
          model: wireModel,
          durationMs: Date.now() - startTime,
          stopReason: data.stop_reason ?? undefined,
        };
      } catch (err: any) {
        lastError = err;
        if (err instanceof AnalyzerError && !err.retryable) {
          throw err;
        }
        if (attempt <= maxRetries) {
          // Brief exponential backoff before retry
          await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 3000)));
          continue;
        }
      }
    }

    if (lastError instanceof AnalyzerError) {
      throw lastError;
    }
    // Transport failures (timeouts, dropped connections) carry no customer-safe detail, so the message is fixed and the
    // cause goes to the server log only.
    logAnalyzerDiagnostic(`provider transport after ${attempt} attempt(s)`, lastError ?? new Error('unknown'));
    throw new AnalyzerError(
      'AI_PROVIDER_TEMPORARILY_UNAVAILABLE',
      503,
      'The AI analysis engine did not respond in time. Please try again shortly. Nothing was charged.',
      true
    );
  };
}
