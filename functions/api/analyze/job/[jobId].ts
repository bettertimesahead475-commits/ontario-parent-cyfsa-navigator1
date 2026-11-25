/**
 * Cloudflare Pages Functions - Analysis Job Recovery & Status Poll API.
 *
 * GET /api/analyze/job/:jobId
 * Allows client recovery and reconnection to in-flight or completed jobs.
 */
import { verifyFirebaseRequest } from '../../_auth-check';
import { effectiveJob, jobObjectUrl, secretEquals } from '../../_analysis-jobs';
import { DurableJobStorageError, latestOwnAttempt, loadPersistedReport, readDurableJob } from '../../_durable-analysis-jobs';
import { apiKeyHygiene, normalizeApiKey } from '../../_supabase-key';

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

interface Env {
  FIREBASE_PROJECT_ID?: string;
  ADMIN_SECRET?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
  STAGING_SUPABASE_READ_KEY?: string;
}

export function jobFailureHttpStatus(code: string | null | undefined, retryable: boolean): number {
  if (retryable) return 503;
  if (code === 'UPGRADE_REQUIRED' || code === 'SESSION_INVALID') return 403;
  if (code === 'FREE_LIMIT_REACHED' || code === 'CREDIT_LIMIT_REACHED') return 402;
  if (code === 'ANALYSIS_TIMED_OUT') return 408;
  if (code === 'INVALID_REQUEST' || code === 'DOCUMENT_UNEXTRACTED') return 400;
  return 422;
}

export const onRequestGet = async ({
  request,
  env = {},
  params,
}: {
  request?: Request;
  env?: Env;
  params: { jobId?: string };
}): Promise<Response> => {
  const jobId = params?.jobId;
  if (!jobId || !/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) {
    return Response.json(
      { error: 'Invalid or missing jobId parameter.', code: 'INVALID_JOB_ID' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  // Status reads always require a verified Firebase identity, except the existing explicit
  // owner/admin testing bypass. A missing Firebase configuration is not anonymous access.
  let callerUid: string | null = null;
  let isAdmin = false;
  const adminSecretHeader = request?.headers.get('x-admin-secret');
  if (adminSecretHeader && env?.ADMIN_SECRET && secretEquals(adminSecretHeader, env.ADMIN_SECRET)) {
    isAdmin = true;
  } else if (request && env?.FIREBASE_PROJECT_ID) {
    const authResult = await verifyFirebaseRequest(request, env);
    if (authResult.status === 'verified') {
      callerUid = authResult.uid;
    }
  }
  if (!isAdmin && !callerUid) {
    return Response.json({ error: 'Please sign in again to see this analysis.', code: 'SIGN_IN_REQUIRED' }, { status: 401, headers: DEFAULT_HEADERS });
  }

  // New queue jobs use the transactional Postgres ledger for status and ownership. The report
  // remains in the private Storage bucket and is fetched only after checking the owner's UID.
  if (env?.STAGING_SUPABASE_URL && env?.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    try {
      let job = await readDurableJob(env, jobId);
      if (job) {
        if (!isAdmin && job.owner_uid !== callerUid) {
          return Response.json({ error: "Access denied. You cannot access another user's analysis job.", code: 'FORBIDDEN' }, { status: 403, headers: DEFAULT_HEADERS });
        }
        // A failed job may have been retried under <id>-rN (the browser keeps polling the original id after a lost
        // reply or a reload): report the owner's newest attempt instead, so a paid retry's result is shown.
        if (job.status === 'failed') {
          const attempt = await latestOwnAttempt(env, jobId, job.owner_uid).catch(() => null);
          if (attempt) job = attempt;
        }
        if (job.status === 'completed') {
          const report = await loadPersistedReport(env, job.job_id, fetch, job.owner_uid);
          if (!report) return Response.json({ error: 'The saved report is temporarily unavailable.', code: 'ANALYSIS_PERSISTENCE_FAILED', retryable: true }, { status: 503, headers: DEFAULT_HEADERS });
          return Response.json({ jobId, status: 'completed', percent: 100, currentStage: 'complete', report }, { status: 200, headers: DEFAULT_HEADERS });
        }
        if (job.status === 'failed') {
          return Response.json({ jobId, status: 'failed', percent: 100, currentStage: 'failed', error: {
            code: job.error_code || 'ANALYSIS_FAILED',
            message: job.error_message || 'The analysis could not be completed.',
            retryable: job.retryable ?? false,
            statusCode: jobFailureHttpStatus(job.error_code, job.retryable ?? false),
          } }, { status: 200, headers: DEFAULT_HEADERS });
        }
        return Response.json({ jobId, status: job.status, currentStage: job.stage || job.status, percent: Math.min(99, Math.max(0, job.progress ?? (job.status === 'queued' ? 10 : 35))), message: job.status === 'queued' ? 'Waiting for an analyzer worker.' : 'Analysis is running.' }, { status: 200, headers: DEFAULT_HEADERS });
      }
    } catch (error) {
      // Previously silent. Log the failure class and non-secret facts about the configured key only:
      // never the job id, user id, key material, URL or upstream text.
      const storage = error instanceof DurableJobStorageError ? error : null;
      const notConfigured = Boolean(storage && /not configured/i.test(storage.message));
      const hygiene = apiKeyHygiene(env?.STAGING_SUPABASE_SERVICE_ROLE_KEY);
      console.error('[JOB_STATUS_UNAVAILABLE]', JSON.stringify({
        errorClass: error instanceof Error ? error.name : 'unknown',
        storageStatus: storage?.status ?? null,
        storageRetryable: storage?.retryable ?? null,
        notConfigured,
        configuredKey: { present: Boolean(env?.STAGING_SUPABASE_SERVICE_ROLE_KEY), usableLength: normalizeApiKey(env?.STAGING_SUPABASE_SERVICE_ROLE_KEY)?.length ?? 0, ...hygiene },
      }));
      // A missing or unusable credential will not fix itself by polling; tell the client to stop.
      const retryable = !notConfigured && (storage?.retryable ?? true);
      return Response.json(
        { error: 'Analysis status is temporarily unavailable.', code: notConfigured ? 'JOB_STATUS_NOT_CONFIGURED' : 'JOB_STATUS_UNAVAILABLE', retryable },
        { status: 503, headers: DEFAULT_HEADERS },
      );
    }
  }

  // 2. Fetch durable job from Supabase Storage if configured
  const supabaseUrl = env?.STAGING_SUPABASE_URL;
  const supabaseKey = normalizeApiKey(env?.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? normalizeApiKey(env?.STAGING_SUPABASE_READ_KEY);
  if (supabaseUrl && supabaseKey) {
    try {
      const res = await fetch(jobObjectUrl(supabaseUrl, jobId, 'read'), {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const job = (await res.json()) as any;
        if (job && typeof job === 'object') {
          // Access control: if job has an owner, require matching UID or admin
          if (!isAdmin && (!callerUid || typeof job.uid !== 'string' || job.uid !== callerUid)) {
            return Response.json(
              { error: "Access denied. You cannot access another user's analysis job.", code: 'FORBIDDEN' },
              { status: 403, headers: DEFAULT_HEADERS }
            );
          }
          return Response.json(effectiveJob(job, Date.now()), { status: 200, headers: DEFAULT_HEADERS });
        }
      }
    } catch {
      // Non-blocking: continue to grace or not_found response
    }
  }

  // 3. Grace response for recently initiated jobs (req_<timestamp>_...)
  const match = jobId.match(/^req_(\d+)_/);
  if (match) {
    const reqTs = parseInt(match[1], 10);
    const now = Date.now();
    if (!isNaN(reqTs) && now - reqTs < 90000 && now - reqTs >= 0) {
      return Response.json(
        {
          jobId,
          status: 'pending',
          message: 'Waiting for the analysis request to start on the server.',
          createdAt: reqTs,
          updatedAt: now,
        },
        { status: 200, headers: DEFAULT_HEADERS }
      );
    }
  }

  return Response.json(
    {
      jobId,
      status: 'not_found',
      message: 'Job is not running or has already completed.',
      code: 'JOB_NOT_FOUND',
    },
    { status: 404, headers: DEFAULT_HEADERS }
  );
};
