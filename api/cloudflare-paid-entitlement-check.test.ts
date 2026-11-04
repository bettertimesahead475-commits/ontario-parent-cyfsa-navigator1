import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/_paid-entitlement-check';

describe('Cloudflare paid entitlement endpoint', () => {
  it('requires a verified Firebase token before reading a paid session', async () => {
    const request = new Request('https://staging.example/api/_paid-entitlement-check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111', uid: 'forged', tier: 'Pro' }),
    });
    const response = await onRequestPost({ request, env: { FIREBASE_PROJECT_ID: 'test-project' } });
    expect(response.status).toBe(401);
    expect((await response.json()).authorized).toBe(false);
  });
});
