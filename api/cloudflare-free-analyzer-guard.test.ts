import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/analyze';

describe('staging free user analyzer guard', () => {
  it('does not grant free scans through the public analyzer', async () => {
    const response = await onRequestPost();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('STAGING_ANALYZER_NOT_READY');
  });
});
