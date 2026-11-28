/**
 * Verifies the experimental reasoning switch at the provider boundary: what the adapter actually puts in the
 * Messages API request body. A flag that never reaches the body is not evidence of reasoning.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCloudflareGenerateFn, effectiveMaxTokens, ALWAYS_ON_THINKING_HEADROOM_TOKENS } from '../functions/api/_analyzer-model-adapter';

function capture() {
  const bodies: any[] = [];
  const fetcher = vi.fn(async (_url: unknown, init: any) => {
    bodies.push(JSON.parse(init.body));
    // Stop after capturing the request. The adapter's own error path is not under test here.
    throw new Error('captured');
  });
  return { bodies, fetcher: fetcher as unknown as typeof fetch };
}

const options = (extra: Record<string, unknown> = {}) => ({
  system: 'sys',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
  max_tokens: 6000,
  timeoutMs: 5000,
  requestId: 'req_reasoning_wire',
  stage: 'section',
  mode: 'full',
  ...extra,
});

async function sendAndCapture(model: string, extra: Record<string, unknown>) {
  const { bodies, fetcher } = capture();
  const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, fetcher);
  await generate(options(extra) as any, model).catch(() => undefined);
  expect(bodies.length).toBeGreaterThan(0);
  return bodies[0];
}

describe('reasoning switch at the provider request', () => {
  it('default request on Opus 5 disables thinking and keeps the requested max_tokens', async () => {
    const body = await sendAndCapture('claude-opus-5', {});
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBe(6000);
  });

  it('enableThinking on Opus 5 sends adaptive thinking, never budget_tokens', async () => {
    const body = await sendAndCapture('claude-opus-5', { enableThinking: true });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(JSON.stringify(body)).not.toContain('budget_tokens');
  });

  it('enableThinking adds headroom to max_tokens so thinking cannot consume the visible JSON budget', async () => {
    const body = await sendAndCapture('claude-opus-5', { enableThinking: true });
    expect(body.max_tokens).toBe(6000 + ALWAYS_ON_THINKING_HEADROOM_TOKENS);
  });

  it('enableThinking on a model that rejects disabled thinking omits the thinking field', async () => {
    const body = await sendAndCapture('claude-opus-5-5', { enableThinking: true });
    expect(body).not.toHaveProperty('thinking');
    expect(body.max_tokens).toBe(6000 + ALWAYS_ON_THINKING_HEADROOM_TOKENS);
  });

  it('Basic model (Sonnet 5) default request carries no thinking change', async () => {
    const body = await sendAndCapture('claude-sonnet-5', {});
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBe(6000);
  });

  it('the sectioned Forensic path reaches the provider request with adaptive thinking', async () => {
    const { runSectionedAnalysis } = await import('../api/services/analyzerSections');
    const { bodies, fetcher } = capture();
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, fetcher);
    await runSectionedAnalysis({
      mode: 'full', documentText: 'Worker note dated March 3, 2026.', primaryModel: 'claude-opus-5',
      verificationModel: 'claude-opus-5', generate, deadlineAt: Date.now() + 200_000,
      requestId: 'req_reasoning_path', reasoning: 'adaptive',
    } as any).catch(() => undefined);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.thinking).toEqual({ type: 'adaptive' });
  });

  it('the sectioned path without reasoning sends thinking disabled', async () => {
    const { runSectionedAnalysis } = await import('../api/services/analyzerSections');
    const { bodies, fetcher } = capture();
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, fetcher);
    await runSectionedAnalysis({
      mode: 'full', documentText: 'Worker note dated March 3, 2026.', primaryModel: 'claude-opus-5',
      verificationModel: 'claude-opus-5', generate, deadlineAt: Date.now() + 200_000,
      requestId: 'req_reasoning_path_off',
    } as any).catch(() => undefined);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('effectiveMaxTokens leaves the default unchanged and caps at 64,000', () => {
    expect(effectiveMaxTokens('claude-opus-5', 6000)).toBe(6000);
    expect(effectiveMaxTokens('claude-opus-5', 6000, true)).toBe(6000 + ALWAYS_ON_THINKING_HEADROOM_TOKENS);
    expect(effectiveMaxTokens('claude-opus-5', 60_000, true)).toBe(64_000);
  });
});
