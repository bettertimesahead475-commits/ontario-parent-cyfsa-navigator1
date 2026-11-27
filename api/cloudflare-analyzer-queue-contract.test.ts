import { describe, expect, it } from 'vitest';
import {
  createAnalyzerQueueMessage,
  parseAnalyzerQueueMessage,
  canTransitionJobStatus,
} from '../functions/api/_analyzer-queue-contract';

describe('durable analyzer queue contract', () => {
  it('encodes only an opaque job ID', () => {
    expect(createAnalyzerQueueMessage('job_12345678')).toEqual({ version: 1, jobId: 'job_12345678' });
  });

  it('rejects payloads containing document text, credentials or other extra properties', () => {
    expect(() => parseAnalyzerQueueMessage({ version: 1, jobId: 'job_12345678', documentText: 'private' })).toThrow();
    expect(() => parseAnalyzerQueueMessage({ version: 1, jobId: 'job_12345678', uid: 'someone' })).toThrow();
    expect(() => parseAnalyzerQueueMessage({ version: 1, jobId: 'job_12345678', token: 'secret' })).toThrow();
  });

  it('rejects malformed and unsupported messages', () => {
    for (const value of [null, [], {}, { version: 2, jobId: 'job_12345678' }, { version: 1, jobId: '../private' }, { version: 1, jobId: '' }]) {
      expect(() => parseAnalyzerQueueMessage(value)).toThrow();
    }
  });

  it('permits retry from running to queued, but never restarts a terminal job', () => {
    expect(canTransitionJobStatus('queued', 'running')).toBe(true);
    expect(canTransitionJobStatus('running', 'queued')).toBe(true);
    expect(canTransitionJobStatus('running', 'completed')).toBe(true);
    expect(canTransitionJobStatus('completed', 'running')).toBe(false);
    expect(canTransitionJobStatus('failed', 'running')).toBe(false);
  });
});
