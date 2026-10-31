import { describe, expect, it, vi } from 'vitest';
import { createCloudflareGenerateFn } from '../functions/api/_analyzer-model-adapter';
import { AnalyzerError } from './services/analyzerErrors';

describe('Cloudflare Anthropic Model Adapter', () => {
  it('throws configuration error if ANTHROPIC_API_KEY is missing', async () => {
    const generate = createCloudflareGenerateFn({});
    await expect(
      generate(
        {
          system: 'sys',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 100,
          timeoutMs: 1000,
          requestId: 'req_12345678',
          stage: 'test',
          mode: 'fast',
        },
        'claude-sonnet-5'
      )
    ).rejects.toThrow('ANTHROPIC_API_KEY is not configured');
  });

  it('rejects unapproved model identifiers', async () => {
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' });
    await expect(
      generate(
        {
          system: 'sys',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 100,
          timeoutMs: 1000,
          requestId: 'req_12345678',
          stage: 'test',
          mode: 'fast',
        },
        'unapproved-fake-model'
      )
    ).rejects.toThrow(/not on the approved list/);
  });

  it('successfully calls Anthropic API and formats GenerateResult', async () => {
    const mockFetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe('claude-sonnet-5');
      expect(body.system).toBe('test system prompt');
      expect(init?.headers).toMatchObject({
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      });
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"status":"ok"}' }],
          usage: { input_tokens: 120, output_tokens: 45 },
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    const result = await generate(
      {
        system: 'test system prompt',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'analyze this document' }] }],
        max_tokens: 2000,
        timeoutMs: 5000,
        requestId: 'req_12345678',
        stage: 'overview',
        mode: 'fast',
      },
      'claude-sonnet-5'
    );

    expect(result.text).toBe('{"status":"ok"}');
    expect(result.usage).toEqual({ input_tokens: 120, output_tokens: 45 });
    expect(result.stopReason).toBe('end_turn');
    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });

  it('retries on transient 503 and succeeds on next attempt', async () => {
    let calls = 0;
    const mockFetcher = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response('Overloaded', { status: 503 });
      }
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'recovered' }],
          usage: { input_tokens: 50, output_tokens: 20 },
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    const result = await generate(
      {
        system: 'sys',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 100,
        timeoutMs: 5000,
        retries: 1,
        requestId: 'req_12345678',
        stage: 'test',
        mode: 'fast',
      },
      'claude-sonnet-5'
    );

    expect(result.text).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('fails immediately without retry on non-retryable 400 error', async () => {
    const mockFetcher = vi.fn(async () => {
      return new Response('Bad request parameter', { status: 400 });
    });

    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    await expect(
      generate(
        {
          system: 'sys',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 100,
          timeoutMs: 5000,
          retries: 2,
          requestId: 'req_12345678',
          stage: 'test',
          mode: 'fast',
        },
        'claude-sonnet-5'
      )
    ).rejects.toThrow(AnalyzerError);

    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });
  it('injects thinking: disabled and defaults max_tokens to 8192 for fast structured analysis', async () => {
    let capturedBody: any = null;
    const mockFetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"status":"ok"}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    await generate(
      {
        system: 'sys prompt',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'evidence test' }] }],
        max_tokens: 0,
        timeoutMs: 5000,
        requestId: 'req_model_config_test',
        stage: 'direct_full_analysis',
        mode: 'fast',
      },
      'claude-sonnet-5'
    );

    expect(capturedBody.model).toBe('claude-sonnet-5');
    expect(capturedBody.max_tokens).toBe(8192);
    expect(capturedBody.thinking).toEqual({ type: 'disabled' });
  });

  it('configures low effort on models rejecting disabled thinking', async () => {
    let capturedBody: any = null;
    const mockFetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"status":"ok"}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    await generate(
      {
        system: 'sys prompt',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'evidence test' }] }],
        max_tokens: 4096,
        timeoutMs: 5000,
        requestId: 'req_model_rejecting_test',
        stage: 'direct_full_analysis',
        mode: 'fast',
      },
      'claude-sonnet-5-5'
    );

    expect(capturedBody.model).toBe('claude-sonnet-5-5');
    expect(capturedBody.max_tokens).toBe(4096);
    expect(capturedBody.thinking).toBeUndefined();
    expect(capturedBody.output_config).toEqual({ effort: 'low' });
  });
});
