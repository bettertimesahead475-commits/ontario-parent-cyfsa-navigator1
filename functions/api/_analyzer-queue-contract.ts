/**
 * Durable analyzer queue message contract.
 * Queue payloads contain only an opaque job identifier; document text,
 * Firebase credentials, user identifiers and paid-session data stay in private storage.
 *
 * The Pages producer and the separate Worker consumer share this strict contract.
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

/**
 * Lease a worker holds on a claimed job. It must outlast the longest permitted analysis, because the
 * consumer does not renew it: a shorter lease lets a second worker reclaim a job that is still running,
 * which would run and charge the analysis twice. The database caps leases at 600 s.
 */
export const CLAIM_LEASE_SECONDS = 600;
/** Largest Forensic analysis budget the analyzer accepts (see clampBudget in functions/api/analyze.ts). */
export const MAX_ANALYSIS_BUDGET_SECONDS = 300;

