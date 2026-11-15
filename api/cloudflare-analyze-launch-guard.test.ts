import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/analyze';

describe('staging analyzer launch guard', () => {
  it('cannot execute without model adapter and full entitlement accounting', async () => {
    const response = await onRequestPost();
    expect(response.status).toBe(503);
    expect((await response.json()).analyzerReady).toBe(false);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
