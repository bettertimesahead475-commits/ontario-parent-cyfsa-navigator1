import { ANALYSIS_JOBS_BUCKET } from './_analysis-jobs';
import type { AnalyzerQueueMessage } from './_analyzer-queue-contract';

export interface DurableJobEnv {
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface AnalyzerQueueBinding {
  send(message: AnalyzerQueueMessage): Promise<unknown>;
}

export interface DurableJobRecord {
  job_id: string;
  owner_uid: string;
  mode: 'fast' | 'full';
  status: 'queued' | 'running' | 'completed' | 'failed';
  input_key: string;
  session_id: string | null;
  reservation_id: string | null;
  owner_bypass: boolean;
  worker_token?: string;
  attempt_count?: number;
  lease_expires_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  retryable?: boolean;
  progress?: number;
  stage?: string | null;
}

export class DurableJobStorageError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = 'DurableJobStorageError';
  }
}

function serviceConfig(env: DurableJobEnv): { base: string; key: string } {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    throw new DurableJobStorageError('Durable job database is not configured.', false);
  }
  const base = env.STAGING_SUPABASE_URL.replace(/\/$/, '');
  const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  return { base, key };
}

async function rpc<T>(env: DurableJobEnv, name: string, args: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  const { base, key } = serviceConfig(env);
  let response: Response;
  try {
    response = await fetcher(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new DurableJobStorageError('Durable job database request failed.', true);
  }
  if (!response.ok) throw new DurableJobStorageError('Durable job database rejected the request.', response.status >= 500 || response.status === 429, response.status);
  return await response.json() as T;
}

function storageUrl(env: DurableJobEnv, key: string, read = false): string {
  const { base } = serviceConfig(env);
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/${read ? 'authenticated/' : ''}${ANALYSIS_JOBS_BUCKET}/${encodedKey}`;
}

function storageHeaders(env: DurableJobEnv, contentType = 'application/json'): HeadersInit {
  const { key } = serviceConfig(env);
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType };
}

export async function createDurableJob(env: DurableJobEnv, job: Omit<DurableJobRecord, 'status'>, fetcher: typeof fetch = fetch): Promise<DurableJobRecord> {
  return rpc<DurableJobRecord>(env, 'analyzer_create_job', {
    p_job_id: job.job_id,
    p_owner_uid: job.owner_uid,
    p_mode: job.mode,
    p_input_key: job.input_key,
    p_session_id: job.session_id,
    p_reservation_id: job.reservation_id,
    p_owner_bypass: job.owner_bypass,
  }, fetcher);
}

export async function saveDurableInput(env: DurableJobEnv, key: string, input: unknown, fetcher: typeof fetch = fetch): Promise<void> {
  serviceConfig(env);
  let response: Response;
  try {
    response = await fetcher(storageUrl(env, key), {
      method: 'POST',
      headers: { ...storageHeaders(env), 'x-upsert': 'false' },
      body: JSON.stringify(input),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new DurableJobStorageError('Document input could not be saved securely.', true);
  }
  if (!response.ok) throw new DurableJobStorageError('Document input could not be saved securely.', response.status >= 500 || response.status === 429, response.status);
}

export async function loadDurableInput(env: DurableJobEnv, key: string, fetcher: typeof fetch = fetch): Promise<{ documentText: string; fileName?: string }> {
  let response: Response;
  try {
    response = await fetcher(storageUrl(env, key, true), {
      headers: storageHeaders(env), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new DurableJobStorageError('Stored document input could not be loaded.', true);
  }
  if (!response.ok) throw new DurableJobStorageError('Stored document input could not be loaded.', response.status >= 500 || response.status === 429, response.status);
  const value = await response.json() as { documentText?: unknown; fileName?: unknown };
  if (typeof value.documentText !== 'string' || !value.documentText.trim()) throw new DurableJobStorageError('Stored document input is invalid.', false, 422);
  return { documentText: value.documentText, ...(typeof value.fileName === 'string' ? { fileName: value.fileName } : {}) };
}

export async function readDurableJob(env: DurableJobEnv, jobId: string, fetcher: typeof fetch = fetch): Promise<DurableJobRecord | null> {
  return await rpc<DurableJobRecord | null>(env, 'analyzer_get_job', { p_job_id: jobId }, fetcher);
}

export async function claimDurableJob(env: DurableJobEnv, jobId: string, workerToken: string, leaseSeconds = 240, fetcher: typeof fetch = fetch): Promise<DurableJobRecord | null> {
  return await rpc<DurableJobRecord | null>(env, 'analyzer_claim_job', {
    p_job_id: jobId, p_worker_token: workerToken, p_lease_seconds: leaseSeconds,
  }, fetcher);
}

export async function updateDurableJob(
  env: DurableJobEnv,
  input: { jobId: string; workerToken?: string | null; status: 'queued' | 'running' | 'completed' | 'failed'; errorCode?: string | null; errorMessage?: string | null; retryable?: boolean; progress?: number; stage?: string },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  return rpc<boolean>(env, 'analyzer_update_job', {
    p_job_id: input.jobId,
    p_worker_token: input.workerToken ?? null,
    p_status: input.status,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_retryable: input.retryable ?? null,
    p_progress: input.progress ?? null,
    p_stage: input.stage ?? null,
  }, fetcher);
}

export async function failDeadLetterJob(env: DurableJobEnv, jobId: string, fetcher: typeof fetch = fetch): Promise<DurableJobRecord | null> {
  return await rpc<DurableJobRecord | null>(env, 'analyzer_fail_dead_letter', {
    p_job_id: jobId,
    p_error_code: 'ANALYZER_RETRIES_EXHAUSTED',
    p_error_message: 'The analysis could not be completed after multiple attempts. Your document remains available; you can retry it.',
  }, fetcher);
}

export async function completeRecoveredJob(env: DurableJobEnv, jobId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  return await rpc<boolean>(env, 'analyzer_complete_recovered_job', { p_job_id: jobId }, fetcher);
}

export async function requeueFromDeadLetter(env: DurableJobEnv, jobId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  return await rpc<boolean>(env, 'analyzer_requeue_from_dlq', { p_job_id: jobId }, fetcher);
}

export async function loadPersistedReport(env: DurableJobEnv, jobId: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetcher(storageUrl(env, `${jobId}.json`, true), { headers: storageHeaders(env), redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch { throw new DurableJobStorageError('Saved analysis report could not be loaded.', true); }
  if (response.status === 404) return null;
  if (!response.ok) throw new DurableJobStorageError('Saved analysis report could not be loaded.', response.status >= 500 || response.status === 429, response.status);
  const stored = await response.json() as { status?: string; report?: unknown };
  return stored.status === 'completed' && stored.report && typeof stored.report === 'object'
    ? stored.report as Record<string, unknown>
    : null;
}
