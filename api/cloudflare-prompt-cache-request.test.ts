/**
 * Prompt caching at the provider boundary (experimental, ANALYZER_PROMPT_CACHE=on). Checks the Messages API request body
 * the adapter sends. Default (flag unset) bodies must be byte-identical to the uncached form.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCloudflareGenerateFn, buildRequestMessages } from '../functions/api/_analyzer-model-adapter';
import { cacheablePrefixOf, buildConsolidatedPrompt, runConsolidatedForensic } from './services/consolidatedForensic';
import { COMPLETE_ANALYSIS, completeVerification, isVerificationRequest, VERIFICATION_RESULT } from './analyzerTestFixtures';

const DOC = 'Synthetic page one. The worker wrote a note on March 3, 2026.\nSynthetic page two. No further facts.';
const PREFIX = 'INSTRUCTIONS AND DOCUMENT\n';
const TAIL = '\nTASK: produce the sections.';

function capture() {
  const bodies: any[] = [];
  const fetcher = vi.fn(async (_url: unknown, init: any) => {
    bodies.push(JSON.parse(init.body));
    throw new Error('captured');
  });
  return { bodies, fetcher: fetcher as unknown as typeof fetch };
}

async function bodyFor(env: Record<string, string>, extra: Record<string, unknown>) {
  const { bodies, fetcher } = capture();
  const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key', ...env }, fetcher);
  await generate(
    {
      system: 'sys',
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: PREFIX + 'body' + TAIL }] }],
      max_tokens: 6000,
      timeoutMs: 5000,
      requestId: 'req_cache_wire',
      stage: 'consolidated_forensic',
      mode: 'full',
      ...extra,
    } as any,
    'claude-opus-5'
  ).catch(() => undefined);
  expect(bodies.length).toBeGreaterThan(0);
  return bodies[0];
}

describe('buildRequestMessages', () => {
  it('flattens to plain strings when no prefix is given (default body unchanged)', () => {
    const out = buildRequestMessages([{ role: 'user', content: [{ text: 'a' }, 'b'] }]);
    expect(out).toEqual([{ role: 'user', content: 'a\nb' }]);
  });

  it('marks the prefix as an ephemeral cache breakpoint and keeps the remaining text unmarked', () => {
    const out = buildRequestMessages([{ role: 'user', content: [{ text: PREFIX + 'rest' }] }], PREFIX);
    expect(out).toEqual([
      { role: 'user', content: [
        { type: 'text', text: PREFIX, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'rest' },
      ] },
    ]);
  });

  it('falls back to plain text when the prefix is not at the start, or nothing follows it', () => {
    expect(buildRequestMessages([{ role: 'user', content: [{ text: 'xx' + PREFIX + 'rest' }] }], PREFIX)[0].content).toBe('xx' + PREFIX + 'rest');
    expect(buildRequestMessages([{ role: 'user', content: [{ text: PREFIX }] }], PREFIX)[0].content).toBe(PREFIX);
  });
});

describe('prompt cache flag at the provider request', () => {
  it('default: flag unset leaves the request message as one plain string even when a prefix is sent', async () => {
    const body = await bodyFor({}, { cachedPrefix: PREFIX });
    expect(body.messages).toEqual([{ role: 'user', content: PREFIX + 'body' + TAIL }]);
  });

  it('flag on: the document prefix carries the cache breakpoint', async () => {
    const body = await bodyFor({ ANALYZER_PROMPT_CACHE: 'on' }, { cachedPrefix: PREFIX });
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: PREFIX, cache_control: { type: 'ephemeral' } });
    expect(body.messages[0].content[1].text).toBe('body' + TAIL);
  });

  it('flag on without a prefix: no breakpoint is added', async () => {
    const body = await bodyFor({ ANALYZER_PROMPT_CACHE: 'on' }, {});
    expect(body.messages).toEqual([{ role: 'user', content: PREFIX + 'body' + TAIL }]);
  });

  it('flag value other than on is ignored', async () => {
    const body = await bodyFor({ ANALYZER_PROMPT_CACHE: 'yes' }, { cachedPrefix: PREFIX });
    expect(body.messages[0].content).toBe(PREFIX + 'body' + TAIL);
  });
});

describe('consolidated prompt prefix', () => {
  it('is the same for the comprehensive call and the repair call of one run', () => {
    const full = buildConsolidatedPrompt(['overview', 'redFlags'] as any, DOC, undefined, undefined);
    const repair = buildConsolidatedPrompt(['thresholds'] as any, DOC, 'CORRECTION REQUIRED: test', undefined);
    expect(cacheablePrefixOf(full)).toBe(cacheablePrefixOf(repair));
    expect(cacheablePrefixOf(full)).toContain(DOC);
  });

  it('is empty when the task marker is missing, so nothing is cached', () => {
    expect(cacheablePrefixOf('no marker here')).toBe('');
  });

  it('the cacheable prefix never contains the task list', () => {
    const prompt = buildConsolidatedPrompt(['overview'] as any, DOC);
    expect(cacheablePrefixOf(prompt)).not.toContain('TASK:');
  });
});

describe('consolidated run sends the cache prefix with its requests', () => {
  it('each request carries the same cachedPrefix', async () => {
    const seen: string[] = [];
    const generate = vi.fn(async (params: any) => {
      seen.push(params.cachedPrefix);
      if (isVerificationRequest(params)) {
        return { text: JSON.stringify(completeVerification(VERIFICATION_RESULT as any, params)), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', durationMs: 1, stopReason: 'end_turn' };
      }
      return { text: JSON.stringify(COMPLETE_ANALYSIS), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', durationMs: 1, stopReason: 'end_turn' };
    }) as any;
    await runConsolidatedForensic({
      mode: 'full', documentText: DOC, primaryModel: 'claude-opus-5', verificationModel: 'claude-opus-5',
      generate, deadlineAt: Date.now() + 600_000, requestId: 'req_cache_run',
    } as any);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.filter((p) => p !== undefined)).size).toBe(1);
    expect(seen[0]).toContain(DOC);
  });
});
