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
    // Thinking cannot be disabled on this model and its tokens count toward max_tokens, so the
    // requested visible-output limit gets fixed thinking headroom (production guidance-section regression).
    expect(capturedBody.max_tokens).toBe(4096 + 8000);
    expect(capturedBody.thinking).toBeUndefined();
    expect(capturedBody.output_config).toEqual({ effort: 'low' });
  });

  it('handles Anthropic CRLF event separators split between network chunks', async () => {
    const payload = [
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"verified"}}\r\n\r\n',
      'event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\r\n\r\n',
      'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
    ].join('');
    const bytes = new TextEncoder().encode(payload);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // One byte per chunk forces \r and \n to be delivered separately.
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    const result = await generate({
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_tokens: 100,
      timeoutMs: 5000,
      retries: 0,
      requestId: 'req_crlf_sse',
      stage: 'direct_analysis',
      mode: 'fast',
    }, 'claude-sonnet-5');
    expect(result.text).toBe('verified');
    expect(result.stopReason).toBe('end_turn');
  });

  it('rejects streamed results without Anthropic message_stop', async () => {
    const body = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    ].join('');
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    await expect(generate({
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_tokens: 100,
      timeoutMs: 5000,
      retries: 0,
      requestId: 'req_partial_sse',
      stage: 'direct_analysis',
      mode: 'fast',
    }, 'claude-sonnet-5')).rejects.toThrow(/stream ended before the analysis completed/);
  });

  it('rejects oversized unterminated SSE events before buffering indefinitely', async () => {
    const oversized = 'event: content_block_delta\ndata: ' + 'x'.repeat(1_048_577);
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(oversized, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    await expect(generate({
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_tokens: 100,
      timeoutMs: 5000,
      retries: 0,
      requestId: 'req_oversized_event',
      stage: 'direct_analysis',
      mode: 'fast',
    }, 'claude-sonnet-5')).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
    expect(mockFetcher).toHaveBeenCalledOnce();
  });

  it('returns a completed Anthropic report even if stream cancellation never settles', async () => {
    const payload = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"complete"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(payload)); },
      cancel() { return new Promise<void>(() => {}); },
    });
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        generate({
          system: 'sys',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 100, timeoutMs: 5000, retries: 0,
          requestId: 'req_cancel_stall', stage: 'direct_analysis', mode: 'fast',
        }, 'claude-sonnet-5'),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Completed SSE stalled in cancel()')), 750);
        }),
      ]);
      expect(result.text).toBe('complete');
      expect(result.stopReason).toBe('end_turn');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });

  it('sends stream: true in Anthropic request body', async () => {
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
        requestId: 'req_stream_flag_test',
        stage: 'direct_full_analysis',
        mode: 'fast',
      },
      'claude-sonnet-5'
    );

    expect(capturedBody.stream).toBe(true);
  });

  it('skips thinking_delta, signature_delta, and ping SSE events while preserving text, usage, and error handling', async () => {
    const payload = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1234}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"internal reasoning"}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_abc123"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{\\"note\\":\\"thinking_delta literal\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":456}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    const result = await generate({
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_tokens: 100,
      timeoutMs: 5000,
      retries: 0,
      requestId: 'req_thinking_fastpath',
      stage: 'redFlags',
      mode: 'full',
    }, 'claude-opus-5');
    expect(result.text).toBe('{"note":"thinking_delta literal"}');
    expect(result.usage).toEqual({ input_tokens: 1234, output_tokens: 456 });
    expect(result.stopReason).toBe('end_turn');
  });

  it('still rejects malformed non-JSON SSE data payloads with AI_RESPONSE_INVALID', async () => {
    const payload = 'event: content_block_delta\ndata: not-json\n\n';
    const mockFetcher = vi.fn().mockResolvedValue(
      new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: 'test-key' }, mockFetcher as any);
    await expect(generate({
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      max_tokens: 100,
      timeoutMs: 5000,
      retries: 0,
      requestId: 'req_invalid_json_sse',
      stage: 'redFlags',
      mode: 'full',
    }, 'claude-opus-5')).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
  });
});
