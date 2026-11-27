import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Pages forensic recovery queue configuration', () => {
  it('routes recovery Pages to staging, not the unattended production queue', () => {
    const config = JSON.parse(readFileSync(new URL('../wrangler.pages.jsonc', import.meta.url), 'utf8'));
    expect(config.queues?.producers).toContainEqual({ binding: 'ANALYZER_JOBS_QUEUE', queue: 'cyfsa-staging-analyzer-jobs' });
    expect(config.queues.producers).not.toContainEqual(expect.objectContaining({ queue: 'cyfsa-analyzer-jobs' }));
  });
  it('keeps Quick Review in direct mode by default', () => {
    const config = JSON.parse(readFileSync(new URL('../wrangler.pages.jsonc', import.meta.url), 'utf8'));
    expect(config.vars?.QUEUE_QUICK_ANALYSIS).not.toBe('true');
  });
});
