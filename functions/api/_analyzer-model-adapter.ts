import { providerDiagnostic } from '../../shared/providerDiagnostics';
import { apiKeyHygiene, normalizeApiKey } from './_supabase-key';
/**
 * Cloudflare Worker / Pages Functions Anthropic AI Model Execution Adapter.
 *
 * Calls Claude Messages API using web standard fetch, supporting approved model routing,
 * timeout controls via AbortSignal, transient error retries, and token usage accounting.
 */

import { AnalyzerError, logAnalyzerDiagnostic } from '../../api/services/analyzerErrors';
import { requireApprovedModel, resolveAnthropicWireModel, buildThinkingRequestFields, MODELS_REJECTING_DISABLED_THINKING } from '../../api/services/analyzerModels';

/**
 * On models whose thinking cannot be disabled, thinking tokens count toward max_tokens. Requested
 * limits were sized for visible JSON only, so thinking could exhaust them (production: the Forensic
 * guidance section hit its 4,000-token limit on both attempts). max_tokens is a ceiling, not a
 * charge: only generated tokens are billed.
 */
export const ALWAYS_ON_THINKING_HEADROOM_TOKENS = 8_000;
export function effectiveMaxTokens(model: string, requested: number | undefined): number {
  const base = requested || 8192;
  return MODELS_REJECTING_DISABLED_THINKING.has(model) ? Math.min(64_000, base + ALWAYS_ON_THINKING_HEADROOM_TOKENS) : base;
}
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
    // Remove paste damage (line breaks, NBSP, BOM, zero-width characters) that Cloudflare's edge
    // rejects with an empty HTTP 400 before the request reaches Anthropic.
    const apiKey = normalizeApiKey(env.ANTHROPIC_API_KEY) ?? '';
    if (!apiKey) {
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

      let activeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        activeTimer = setTimeout(() => controller.abort(), timeoutMs);
        const deadline = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error(`provider deadline of ${timeoutMs} ms exceeded`)),
            { once: true }
          );
        });
        deadline.catch(() => undefined);
        const bounded = <T>(p: Promise<T>): Promise<T> => Promise.race([p, deadline]);

        const thinkingFields = buildThinkingRequestFields(wireModel, Boolean((options as any).enableThinking), (options as any).thinkingBudget);
        const requestBody: Record<string, unknown> = {
          model: wireModel,
          max_tokens: effectiveMaxTokens(wireModel, options.max_tokens),
          stream: true,
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
        {
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
        }

        if (!response.ok) {
          const status = response.status;
          const errorText = rawBody;

          const diagnostic = providerDiagnostic(status, errorText);
          // Non-secret key facts only: usable length, expected sk-ant- prefix, and removed-character counts.
          console.warn(JSON.stringify({ tag: '[ANTHROPIC_REJECTED]', model: wireModel, ...diagnostic,
            configuredKey: { ...apiKeyHygiene(env.ANTHROPIC_API_KEY), usableLength: apiKey.length, expectedPrefix: apiKey.startsWith('sk-ant-') } }));
          const rejected = (error: AnalyzerError): never => { error.providerDiagnostic = diagnostic; throw error; };
          if (diagnostic.category === 'INSUFFICIENT_PROVIDER_CREDIT' || diagnostic.category === 'BILLING_REQUIRED') {
            rejected(new AnalyzerError('AI_PROVIDER_CONFIGURATION_ERROR', 503, 'The analysis service is temporarily unavailable due to provider billing. Nothing was charged. Please contact support.', false));
          }
          if (status === 429) {
            rejected(new AnalyzerError('AI_RATE_LIMITED', 429, 'The AI service is busy right now. Please wait a moment and try again. Nothing was charged.', true));
          }
          if (status >= 500 && status < 600) {
            rejected(new AnalyzerError('AI_PROVIDER_TEMPORARILY_UNAVAILABLE', 503, 'The AI analysis engine is temporarily unavailable. Please try again shortly. Nothing was charged.', true));
          }
          if (status === 400 && !errorText.trim() && apiKey.length < 24) {
            rejected(new AnalyzerError('AI_PROVIDER_CONFIGURATION_ERROR', 503, 'The analysis provider credentials are not configured correctly. Nothing was charged.', false));
          }
          if (status === 400) {
            rejected(new AnalyzerError('AI_REQUEST_REJECTED', 400, 'The AI service could not process this request. Nothing was charged. Please try again or contact support.', false));
          }
          rejected(new AnalyzerError('AI_PROVIDER_CONFIGURATION_ERROR', 503, 'The analysis service is not available right now because of a configuration problem on our side. Nothing was charged.', false));
        }

        let text = '';
        let stopReason: string | undefined;
        let inputTokens = 0;
        let outputTokens = 0;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const MAX_SSE_EVENT_CHARS = 1_048_576;
          const textParts: string[] = [];
          let streamBuf = '';
          let currentEventType = '';
          let currentEventChars = 0;
          let pendingMessageStop = false;
          let receivedMessageStop = false;

          try {
          while (!receivedMessageStop) {
            const { done, value } = await bounded(reader.read());
            if (done) break;
            streamBuf += decoder.decode(value, { stream: true });

            let lineStart = 0;
            let nlIdx = streamBuf.indexOf('\n', lineStart);
            while (nlIdx !== -1) {
              const rawLen = nlIdx - lineStart + 1;
              let lineEnd = nlIdx;
              if (lineEnd > lineStart && streamBuf.charCodeAt(lineEnd - 1) === 13) {
                lineEnd--;
              }
              if (lineEnd === lineStart) {
                currentEventType = '';
                currentEventChars = 0;
                if (pendingMessageStop) {
                  receivedMessageStop = true;
                  break;
                }
              } else {
                currentEventChars += rawLen;
                if (currentEventChars > MAX_SSE_EVENT_CHARS) {
                  throw new AnalyzerError('AI_RESPONSE_INVALID', 422, 'The AI provider sent an oversized streaming event. Nothing was charged.', true);
                }
                // Skip leading ASCII whitespace without slicing the full line.
                let s = lineStart;
                while (s < lineEnd && streamBuf.charCodeAt(s) <= 32) s++;
                while (lineEnd > s && streamBuf.charCodeAt(lineEnd - 1) <= 32) lineEnd--;

                if (streamBuf.startsWith('event:', s)) {
                  let es = s + 6;
                  while (es < lineEnd && streamBuf.charCodeAt(es) <= 32) es++;
                  if (streamBuf.startsWith('content_block_delta', es)) {
                    currentEventType = 'content_block_delta';
                  } else if (streamBuf.startsWith('ping', es)) {
                    currentEventType = 'ping';
                  } else if (streamBuf.startsWith('content_block_start', es)) {
                    currentEventType = 'content_block_start';
                  } else if (streamBuf.startsWith('content_block_stop', es)) {
                    currentEventType = 'content_block_stop';
                  } else {
                    currentEventType = streamBuf.slice(es, lineEnd);
                  }
                } else if (streamBuf.startsWith('data:', s)) {
                  let ds = s + 5;
                  while (ds < lineEnd && streamBuf.charCodeAt(ds) <= 32) ds++;
                  if (ds < lineEnd) {
                    const firstChar = streamBuf.charCodeAt(ds);
                    const lastChar = streamBuf.charCodeAt(lineEnd - 1);
                    const isJsonObject = firstChar === 123 && lastChar === 125;
                    // Skip JSON.parse for high-volume non-text SSE events (pings, block boundaries)
                    // without even slicing the data payload.
                    if (
                      isJsonObject &&
                      (currentEventType === 'ping' ||
                        currentEventType === 'content_block_start' ||
                        currentEventType === 'content_block_stop')
                    ) {
                      // Benign structural/keepalive event; no text, usage, or error payload.
                    } else {
                      const dataStr = streamBuf.slice(ds, lineEnd);
                      if (dataStr !== '[DONE]') {
                        if (dataStr === '{"type":"message_stop"}') {
                          pendingMessageStop = true;
                        } else {
                        // Skip JSON.parse for high-volume thinking/signature deltas on Opus/Sonnet.
                        const skippableDelta =
                          isJsonObject &&
                          !dataStr.includes('"text_delta"') &&
                          (dataStr.includes('"thinking_delta"') || dataStr.includes('"signature_delta"'));
                        if (!skippableDelta) {
                          try {
                            const evt = JSON.parse(dataStr);
                            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                              if (evt.delta.text) textParts.push(evt.delta.text);
                            } else if (evt.type === 'message_start' && evt.message?.usage) {
                              inputTokens = evt.message.usage.input_tokens || 0;
                            } else if (evt.type === 'error') {
                              throw new AnalyzerError('AI_PROVIDER_TEMPORARILY_UNAVAILABLE', 503, 'The AI provider interrupted the analysis. Nothing was charged.', true);
                            } else if (evt.type === 'message_stop') {
                              pendingMessageStop = true;
                            } else if (evt.type === 'message_delta') {
                              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                              if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
                            }
                          } catch (parseError) {
                            if (parseError instanceof AnalyzerError) throw parseError;
                            throw new AnalyzerError('AI_RESPONSE_INVALID', 422, 'The AI provider returned an invalid streaming event. Nothing was charged.', true);
                          }
                        }
                        }
                      }
                    }
                  }
                }
              }
              lineStart = nlIdx + 1;
              nlIdx = streamBuf.indexOf('\n', lineStart);
            }

            if (lineStart >= streamBuf.length) {
              streamBuf = '';
            } else if (lineStart > 0) {
              streamBuf = streamBuf.slice(lineStart);
            }
            // A malformed SSE stream without newlines must not grow a Worker buffer indefinitely.
            if (currentEventChars + streamBuf.length > MAX_SSE_EVENT_CHARS) {
              throw new AnalyzerError('AI_RESPONSE_INVALID', 422, 'The AI provider sent an oversized streaming event. Nothing was charged.', true);
            }
          }
          text = textParts.join('');
          // A stop reason alone does not prove that the streamed response finished.
          // Never persist or charge for an interrupted or token-truncated report.
          // A complete message that stopped at max_tokens is returned to callers that handle it (they
          // retry with a shorter-answer instruction); everyone else still gets an error.
          const truncatedButComplete = receivedMessageStop && stopReason === 'max_tokens' && Boolean(options.allowTruncated);
          if (!truncatedButComplete && (!receivedMessageStop || !text.trim() || (stopReason !== 'end_turn' && stopReason !== 'stop_sequence'))) {
            if (receivedMessageStop && stopReason === 'max_tokens') console.warn(JSON.stringify({ tag: '[ANTHROPIC_MAX_TOKENS]', model: wireModel, outputTokens }));
            throw new AnalyzerError('AI_RESPONSE_INVALID', 422, 'The AI provider stream ended before the analysis completed. Nothing was charged.', true);
          }
          } finally {
            // Anthropic message_stop is the protocol terminator; do not wait for the
            // HTTP connection to close after a complete message.
            // The provider has already sent message_stop. Some stream
            // implementations delay cancellation indefinitely; never hold up
            // report persistence/credit finalization waiting for cancel().
            void reader.cancel().catch(() => undefined);
            reader.releaseLock();
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

        if (!(stopReason === 'max_tokens' && options.allowTruncated) && (!text.trim() || (stopReason !== 'end_turn' && stopReason !== 'stop_sequence'))) {
          throw new AnalyzerError('AI_RESPONSE_INVALID', 422, 'The AI provider returned an incomplete analysis. Nothing was charged.', true);
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
      } finally {
        if (activeTimer !== undefined) clearTimeout(activeTimer);
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
