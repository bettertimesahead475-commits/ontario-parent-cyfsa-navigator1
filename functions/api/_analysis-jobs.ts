/**
 * Durable analysis job records in Supabase Storage, shared by POST /api/analyze (write) and
 * GET /api/analyze/job/:jobId (read).
 *
 * The bucket is `analysis_jobs` (private), as created on staging and production. The routes used `analysis-jobs`,
 * which does not exist, so every save failed and was ignored (fetch does not throw on 404), and no report could be
 * recovered after a refresh. A failed save is now logged (job id and status only, never report content).
 */
export const ANALYSIS_JOBS_BUCKET = 'analysis_jobs';

export interface JobStoreEnv {
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function jobObjectUrl(supabaseUrl: string, jobId: string, mode: 'write' | 'read'): string {
  const path = mode === 'read' ? `/storage/v1/object/authenticated/${ANALYSIS_JOBS_BUCKET}/${jobId}.json` : `/storage/v1/object/${ANALYSIS_JOBS_BUCKET}/${jobId}.json`;
  return new URL(path, supabaseUrl).toString();
}

export type JobState =
  | { status: 'running'; percent: number; message: string }
  | { status: 'completed'; report: unknown }
  | { status: 'failed'; error: { code: string; message: string; retryable: boolean } };

/**
 * Writes the job record for one state. The record is the only thing a refreshed or reconnected browser can read, so
 * every outcome is written: running when the analysis starts, then completed or failed. Returns whether storage
 * accepted the write. A failed write never changes the analysis result; it is logged without content.
 */
export async function saveJobState(
  env: JobStoreEnv,
  job: { jobId: string; uid: string } & JobState,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) return false;
  const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const body: Record<string, unknown> = { jobId: job.jobId, uid: job.uid, status: job.status, updatedAt: Date.now() };
  if (job.status === 'running') Object.assign(body, { currentStage: 'running', percent: job.percent, message: job.message });
  if (job.status === 'completed') Object.assign(body, { currentStage: 'complete', percent: 100, report: job.report });
  if (job.status === 'failed') Object.assign(body, { currentStage: 'failed', percent: 100, error: job.error });
  try {
    const res = await fetcher(jobObjectUrl(env.STAGING_SUPABASE_URL, job.jobId, 'write'), {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(JSON.stringify({ tag: '[ANALYSIS_JOB_SAVE_FAILED]', jobId: job.jobId, state: job.status, status: res.status }));
    return res.ok;
  } catch (err: any) {
    console.error(JSON.stringify({ tag: '[ANALYSIS_JOB_SAVE_FAILED]', jobId: job.jobId, state: job.status, status: err?.name ?? 'error' }));
    return false;
  }
}

/** Saves a completed job. Kept for existing callers. */
export async function saveCompletedJob(
  env: JobStoreEnv,
  job: { jobId: string; uid: string; report: unknown },
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  return saveJobState(env, { ...job, status: 'completed', report: job.report }, fetcher);
}

/** Constant-time string comparison for secrets. */
export function secretEquals(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A running record older than this is treated as stopped: no budget is longer than it, so the worker is gone. */
export const RUNNING_JOB_STALE_MS = 5 * 60_000;

/**
 * What a reader is told about a stored job. A "running" record that has not been updated for longer than any analysis
 * budget belongs to a worker that stopped (the platform ended it, or the runtime was recycled), so it is reported as
 * timed out, not as in progress forever. The stored record itself is not changed here.
 */
export function effectiveJob<T extends { status?: string; updatedAt?: number }>(job: T, now: number): T | Record<string, unknown> {
  if (job.status === 'running' && typeof job.updatedAt === 'number' && now - job.updatedAt > RUNNING_JOB_STALE_MS) {
    return {
      ...job,
      status: 'timed_out',
      error: {
        code: 'ANALYSIS_TIMED_OUT',
        message: 'The analysis did not finish. Your document is safe. Please start the analysis again.',
        retryable: true,
      },
    };
  }
  return job;
}
