import { describe, expect, it } from 'vitest';
import { errorResponse } from '../workers/analyzer-queue-consumer';

describe('forensic queue response retry classification', () => {
  it('retries a bodyless 422 response', async () => {
    expect((await errorResponse(new Response(null, { status: 422 }))).retryable).toBe(true);
  });
  it('honors an explicit non-retryable 422 response', async () => {
    expect((await errorResponse(new Response(JSON.stringify({ code: 'INVALID_REQUEST', retryable: false }), { status: 422 }))).retryable).toBe(false);
  });
  it('does not retry a bodyless 400 response', async () => {
    expect((await errorResponse(new Response(null, { status: 400 }))).retryable).toBe(false);
  });
  it('retries a bodyless 503 response', async () => {
    expect((await errorResponse(new Response(null, { status: 503 }))).retryable).toBe(true);
  });
});
