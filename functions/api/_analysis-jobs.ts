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

/** Saves a completed job. Returns whether storage accepted it. */
export async function saveCompletedJob(
  env: JobStoreEnv,
  job: { jobId: string; uid: string; report: unknown },
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) return false;
  const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetcher(jobObjectUrl(env.STAGING_SUPABASE_URL, job.jobId, 'write'), {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify({ jobId: job.jobId, status: 'completed', uid: job.uid, currentStage: 'complete', percent: 100, report: job.report, updatedAt: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(JSON.stringify({ tag: '[ANALYSIS_JOB_SAVE_FAILED]', jobId: job.jobId, status: res.status }));
    return res.ok;
  } catch (err: any) {
    console.error(JSON.stringify({ tag: '[ANALYSIS_JOB_SAVE_FAILED]', jobId: job.jobId, status: err?.name ?? 'error' }));
    return false;
  }
}

/** Constant-time string comparison for secrets. */
export function secretEquals(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
