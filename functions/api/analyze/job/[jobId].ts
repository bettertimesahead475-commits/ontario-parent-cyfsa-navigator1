/**
 * Cloudflare Pages Functions - Analysis Job Recovery & Status Poll API.
 *
 * GET /api/analyze/job/:jobId
 * Allows client recovery and reconnection to in-flight or completed jobs.
 */
import { verifyFirebaseRequest } from '../../_auth-check';
import { jobObjectUrl, secretEquals } from '../../_analysis-jobs';

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

  // 1. Authenticate caller if credentials are provided
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

  // 2. Fetch durable job from Supabase Storage if configured
  const supabaseUrl = env?.STAGING_SUPABASE_URL;
  const supabaseKey = env?.STAGING_SUPABASE_SERVICE_ROLE_KEY || env?.STAGING_SUPABASE_READ_KEY;
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
          if (!isAdmin && job.uid) {
            if (!callerUid) {
              return Response.json(
                { error: 'Please sign in again to see this analysis.', code: 'SIGN_IN_REQUIRED' },
                { status: 401, headers: DEFAULT_HEADERS }
              );
            }
            if (job.uid !== callerUid) {
              return Response.json(
                { error: "Access denied. You cannot access another user's analysis job.", code: 'FORBIDDEN' },
                { status: 403, headers: DEFAULT_HEADERS }
              );
            }
          }
          return Response.json(job, { status: 200, headers: DEFAULT_HEADERS });
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
