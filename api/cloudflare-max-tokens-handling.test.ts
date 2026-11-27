import { describe, expect, it, vi } from 'vitest';
import { createCloudflareGenerateFn, effectiveMaxTokens, ALWAYS_ON_THINKING_HEADROOM_TOKENS } from '../functions/api/_analyzer-model-adapter';
import { runOneSection } from './services/analyzerSections';

const KEY = 'sk-ant-api03-' + 'a'.repeat(80);

// A complete Anthropic SSE message that ends with the given stop reason.
function sse(text: string, stopReason: string) {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 4000 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
const params = (extra: Record<string, unknown> = {}) => ({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }], max_tokens: 4000, timeoutMs: 5000, ...extra });

describe('max_tokens handling on always-on-thinking models (production guidance-section regression)', () => {
  it('adds thinking headroom only for models whose thinking cannot be disabled', () => {
    expect(effectiveMaxTokens('claude-opus-5-5', 4000)).toBe(4000 + ALWAYS_ON_THINKING_HEADROOM_TOKENS);
    expect(effectiveMaxTokens('claude-sonnet-5-5', 3500)).toBe(3500 + ALWAYS_ON_THINKING_HEADROOM_TOKENS);
    expect(effectiveMaxTokens('claude-sonnet-5', 3500)).toBe(3500);
    expect(effectiveMaxTokens('claude-opus-5-5', 60_000)).toBe(64_000);
  });

  it('sends the enlarged max_tokens to the provider', async () => {
    const fetcher = vi.fn(async () => sse('{"ok":true}', 'end_turn'));
    await createCloudflareGenerateFn({ ANTHROPIC_API_KEY: KEY }, fetcher as unknown as typeof fetch)(params() as any, 'claude-opus-5-5');
    expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body).max_tokens).toBe(12_000);
  });

  it('returns a complete max_tokens stop to opted-in callers and still rejects it for everyone else', async () => {
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: KEY }, vi.fn(async () => sse('{"partial":', 'max_tokens')) as unknown as typeof fetch);
    const result = await generate(params({ allowTruncated: true }) as any, 'claude-opus-5-5');
    expect(result.stopReason).toBe('max_tokens');
    await expect(generate(params() as any, 'claude-opus-5-5')).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
  });

  it('still rejects a stream that was genuinely interrupted, even when opted in', async () => {
    const cut = new Response(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1 } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: KEY }, vi.fn(async () => cut) as unknown as typeof fetch);
    await expect(generate(params({ allowTruncated: true }) as any, 'claude-opus-5-5')).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
  });

  it('a section that hits max_tokens is retried with a shorter-answer instruction and then succeeds', async () => {
    const guidance = { whatToVerify: ['Verify intake records.'], whatToAskALawyer: ['Question: Can kinship be raised?'], whatIsMissing: ['Supervision logs.'], lawyerCaseBrief: ['ISSUE: Kinship alternatives.'] };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse('{"whatToVerify": ["cut off', 'max_tokens'))
      .mockResolvedValueOnce(sse(JSON.stringify(guidance), 'end_turn'));
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: KEY }, fetcher as unknown as typeof fetch);
    const out = await runOneSection('guidance', { mode: 'full', documentText: 'Synthetic affidavit text.', primaryModel: 'claude-opus-5-5', generate, deadlineAt: Date.now() + 120_000, requestId: 'req_1700000000000_synthmax' }, {});
    expect(out.attempts).toBe(2);
    expect(out.value.whatToVerify).toEqual(['Verify intake records.']);
    const secondPrompt = JSON.parse((fetcher.mock.calls[1] as any)[1].body).messages[0].content as string;
    expect(secondPrompt).toMatch(/cut off because it was too long/i);
  });
});
