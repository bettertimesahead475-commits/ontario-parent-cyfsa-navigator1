import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function loadConfig(filename: string): any {
  const raw = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

describe('Cloudflare analyzer worker release isolation', () => {
  const production = loadConfig('wrangler.production-analyzer-queue-consumer.jsonc');
  const preflight = loadConfig('wrangler.production-analyzer-queue-preflight.jsonc');
  const stagingRelay = loadConfig('wrangler.analyzer-queue-staging.jsonc');
  const stagingExecutor = loadConfig('wrangler.staging-job-service.jsonc');
  const stagingPages = loadConfig('wrangler.pages-queue-staging.jsonc');
  const retired = loadConfig('wrangler.analyzer-queue-consumer.jsonc');

  it('keeps production fail-closed in both normal and preflight configs', () => {
    expect(production.name).toBe(preflight.name);
    expect(production.vars.ANALYZER_ENABLED).toBe('false');
    expect(preflight.vars.ANALYZER_ENABLED).toBe('false');
    expect(preflight.queues.consumers ?? []).toHaveLength(0);
    expect(production.queues.consumers.map((x: any) => x.queue).sort()).toEqual([
      'cyfsa-analyzer-dead-letter', 'cyfsa-analyzer-jobs',
    ]);
  });

  it('isolates staging Queues and service bindings from production', () => {
    expect(stagingRelay.queues.consumers.map((x: any) => x.queue).sort()).toEqual([
      'cyfsa-staging-analyzer-dead-letter', 'cyfsa-staging-analyzer-jobs',
    ]);
    expect(stagingPages.queues.producers[0].queue).toBe('cyfsa-staging-analyzer-jobs');
    expect(stagingRelay.services[0].service).toBe(stagingExecutor.name);
    expect(stagingExecutor.queues.producers[0].queue).toBe('cyfsa-staging-analyzer-jobs');
  });

  it('prevents the retired config from colliding with a deployed Worker or attaching Queues', () => {
    const activeWorkerNames = [
      production.name, stagingRelay.name, stagingExecutor.name,
    ];
    expect(new Set([...activeWorkerNames, retired.name]).size).toBe(4);
    expect(retired.queues).toBeUndefined();
    expect(retired.vars.ANALYZER_ENABLED).toBe('false');
  });
});
