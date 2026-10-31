/**
 * Cloudflare Worker / Pages Functions Anthropic AI Model Execution Adapter.
 *
 * Calls Claude Messages API using web standard fetch, supporting approved model routing,
 * timeout controls via AbortSignal, transient error retries, and token usage accounting.
 */

import { AnalyzerError, logAnalyzerDiagnostic } from '../../api/services/analyzerErrors';
import { requireApprovedModel, resolveAnthropicWireModel, buildThinkingRequestFields } from '../../api/services/analyzerModels';
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

    const maxRetries = options.retries ?? 0;
    let attempt = 0;
    let lastError: Error | null = null;
    const overallStart = Date.now();
    const overallBudget = options.timeoutMs > 0 ? options.timeoutMs : 60_000;

    while (attempt <= maxRetries) {
      attempt++;
      const timeSpent = Date.now() - overallStart;
      const remainingTime = overallBudget - timeSpent;
      if (attempt > 1 && remainingTime <= 0) {
        break;
      }
      const timeoutMs = Math.max(1000, Math.min(overallBudget, remainingTime));
      const attemptStart = Date.now();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const deadline = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error(`provider deadline of ${timeoutMs} ms exceeded`)),
            { once: true }
          );
        });
        deadline.catch(() => undefined);
        const bounded = <T>(p: Promise<T>): Promise<T> => Promise.race([p, deadline]);

        const thinkingFields = buildThinkingRequestFields(wireModel, Boolean(options.enableThinking), options.thinkingBudget);
        const requestBody: Record<string, unknown> = {
          model: wireModel,
          max_tokens: options.max_tokens || 8192,
          system: options.system,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content.map((c) => (typeof c === 'string' ? c : c.text)).join('\n'),
          })),
          ...thinkingFields,
        };

        const startTime = Date.now();
        let response: Response;
        let rawBody = '';
        try {
          response = await bounded(fetcher(baseUrl, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          }));

          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || !contentType.includes('text/event-stream')) {
            rawBody = await bounded(response.text()).catch((e: unknown) => {
              if (response.ok) throw e;
              return 'Could not read error body';
            });
          }
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const status = response.status;
          const errorText = rawBody;

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

        let text = '';
        let stopReason: string | undefined;
        let inputTokens = 0;
        let outputTokens = 0;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let streamBuf = '';

          while (true) {
            const { done, value } = await bounded(reader.read());
            if (done) break;
            streamBuf += decoder.decode(value, { stream: true });
            const events = streamBuf.split('\n\n');
            streamBuf = events.pop() || '';

            for (const rawEvent of events) {
              const lines = rawEvent.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                  const dataStr = trimmed.slice(5).trim();
                  if (!dataStr || dataStr === '[DONE]') continue;
                  try {
                    const evt = JSON.parse(dataStr);
                    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                      text += evt.delta.text || '';
                    } else if (evt.type === 'message_start' && evt.message?.usage) {
                      inputTokens = evt.message.usage.input_tokens || 0;
                    } else if (evt.type === 'message_delta') {
                      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                      if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
                    }
                  } catch {
                    // Ignore chunk parse error
                  }
                }
              }
            }
          }
        } else {
          const data = JSON.parse(rawBody) as {
            content?: Array<{ type: string; text?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number };
            stop_reason?: string | null;
          };
          text = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') || '';
          inputTokens = data.usage?.input_tokens ?? 0;
          outputTokens = data.usage?.output_tokens ?? 0;
          stopReason = data.stop_reason ?? undefined;
        }

        return {
          text,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          model: wireModel,
          durationMs: Date.now() - startTime,
          stopReason,
        };
      } catch (err: any) {
        lastError = err;
        if (err instanceof AnalyzerError && !err.retryable) {
          throw err;
        }

        // Historical protection from commit b3b08e5c: suppress retries if an attempt already took a lengthy timeout (>=30s)
        const isTimeout =
          err?.name === 'TimeoutError' ||
          err?.name === 'AbortError' ||
          String(err?.message || '').toLowerCase().includes('timed out') ||
          String(err?.message || '').toLowerCase().includes('deadline') ||
          String(err?.message || '').toLowerCase().includes('timeout');
        const wasLongTimeout = isTimeout && (Date.now() - attemptStart >= 30_000);
        if (wasLongTimeout) {
          logAnalyzerDiagnostic(`suppressing retry after lengthy provider timeout (${Date.now() - attemptStart} ms)`, err);
          break;
        }

        if (attempt <= maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 3000);
          const remainingAfter = overallBudget - (Date.now() - overallStart);
          if (remainingAfter <= backoffMs) {
            break;
          }
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
      }
    }

    if (lastError instanceof AnalyzerError) {
      throw lastError;
    }
    logAnalyzerDiagnostic(`provider transport after ${attempt} attempt(s)`, lastError ?? new Error('unknown'));
    throw new AnalyzerError(
      'AI_PROVIDER_TEMPORARILY_UNAVAILABLE',
      503,
      'The AI analysis engine did not respond in time. Please try again shortly. Nothing was charged.',
      true
    );
  };
}
