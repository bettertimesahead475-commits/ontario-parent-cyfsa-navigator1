/**
 * Cloudflare Pages Functions - Analysis Job Recovery & Status Poll API.
 *
 * GET /api/analyze/job/:jobId
 * Allows client recovery and reconnection to in-flight or completed jobs.
 */

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const onRequestGet = async ({
  params,
}: {
  params: { jobId?: string };
}): Promise<Response> => {
  const jobId = params?.jobId;
  if (!jobId || !/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) {
    return Response.json(
      { error: 'Invalid or missing jobId parameter.', code: 'INVALID_JOB_ID' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  // On serverless edge without Redis/durable storage binding, jobs complete within single request lifetime.
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
