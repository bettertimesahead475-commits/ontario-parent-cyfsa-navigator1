/**
 * Durable analyzer queue message contract.
 * Queue payloads contain only an opaque job identifier; document text,
 * Firebase credentials, user identifiers and paid-session data stay in private storage.
 *
 * This module is deliberately transport-independent. Binding a Pages producer and
 * a separate consumer requires a verified persistence/credit lifecycle first.
 */
export interface AnalyzerQueueMessage {
  version: 1;
  jobId: string;
}

const JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function createAnalyzerQueueMessage(jobId: string): AnalyzerQueueMessage {
  if (!JOB_ID.test(jobId)) {
    throw new Error('Invalid analyzer job identifier');
  }
  return { version: 1, jobId };
}

export function parseAnalyzerQueueMessage(value: unknown): AnalyzerQueueMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid analyzer queue payload');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.version !== 1 || typeof record.jobId !== 'string') {
    throw new Error('Invalid analyzer queue payload');
  }
  return createAnalyzerQueueMessage(record.jobId);
}

export type DurableJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export function canTransitionJobStatus(from: DurableJobStatus, to: DurableJobStatus): boolean {
  if (from === to) return true;
  if (from === 'queued') return to === 'running' || to === 'failed';
  if (from === 'running') return to === 'completed' || to === 'failed' || to === 'queued';
  return false;
}
