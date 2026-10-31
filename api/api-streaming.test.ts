import { describe, expect, it, vi } from 'vitest';
import { readAnalysisEventStream } from '../src/utils/api';

describe('readAnalysisEventStream', () => {
  function createSseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  it('handles heartbeats, stage progress, sections, and complete event', async () => {
    const onStage = vi.fn();
    const onSection = vi.fn();
    const onHeartbeat = vi.fn();
    const onComplete = vi.fn();

    const ssePayload = [
      'event: heartbeat\ndata: {"requestId":"req_test","elapsedMs":15000}\n\n',
      'event: stage\ndata: {"stage":"reviewing_evidence","percent":40,"message":"Reviewing..."}\n\n',
      'event: heartbeat\ndata: {"requestId":"req_test","elapsedMs":30000}\n\n',
      'event: section\ndata: {"section":"overview","data":{"documentTitle":"Test Affidavit"}}\n\n',
      'event: complete\ndata: {"report":{"documentTitle":"Test Affidavit","score":85},"credits":{"balance":2}}\n\n',
    ];

    const response = createSseResponse(ssePayload);
    const result = await readAnalysisEventStream(response, {
      onStage,
      onSection,
      onHeartbeat,
      onComplete,
    });

    expect(onHeartbeat).toHaveBeenCalledTimes(2);
    expect(onHeartbeat).toHaveBeenNthCalledWith(1, { requestId: 'req_test', elapsedMs: 15000 });
    expect(onHeartbeat).toHaveBeenNthCalledWith(2, { requestId: 'req_test', elapsedMs: 30000 });
    expect(onStage).toHaveBeenCalledWith('reviewing_evidence', 40, 'Reviewing...');
    expect(onSection).toHaveBeenCalledWith('overview', { documentTitle: 'Test Affidavit' });
    expect(onComplete).toHaveBeenCalled();
    expect(result.documentTitle).toBe('Test Affidavit');
  });

  it('dispatches onError and throws ApiResponseError on error event', async () => {
    const onError = vi.fn();

    const ssePayload = [
      'event: error\ndata: {"code":"AI_RESPONSE_INVALID","error":"The AI model output was truncated.","statusCode":422,"retryable":true}\n\n',
    ];

    const response = createSseResponse(ssePayload);
    await expect(
      readAnalysisEventStream(response, { onError })
    ).rejects.toThrow('The AI model output was truncated.');

    expect(onError).toHaveBeenCalledWith({
      code: 'AI_RESPONSE_INVALID',
      message: 'The AI model output was truncated.',
      statusCode: 422,
      retryable: true,
    });
  });
});
