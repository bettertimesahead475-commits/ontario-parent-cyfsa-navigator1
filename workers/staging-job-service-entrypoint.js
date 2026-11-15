import { WorkerEntrypoint } from 'cloudflare:workers';
import { executeStagingJob } from './staging-job-service';
import { checkStagingProvider } from './staging-provider-service';
// Only an explicitly bound Worker can call this named RPC entrypoint. HTTP cannot.
export class StagingAnalyzerJobs extends WorkerEntrypoint {
  async checkProvider(token, mode) { return checkStagingProvider(this.env, token, mode); }
  // Private service-binding diagnostic, not exposed over HTTP. Checks only
  // a non-existent synthetic job ID, never customer records or stored content.
  // Returns status/headers only; no keys, response bodies, URLs or JWTs.
  async checkDatabaseConnection() {
    const env = this.env;
    const base = 'https://nxfhvebzzobegubefcda.supabase.co';
    if (![base, base + '/'].includes(env.STAGING_SUPABASE_URL || '') || env.ANALYZER_ENABLED !== 'true') {
      throw new Error('Unexpected staging database diagnostic target');
    }
    const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('Staging secret binding missing');
    const probe = async (path, withAuth, method = 'GET', body) => {
      try {
        const headers = { Accept: 'application/json' };
        if (withAuth) {
          headers.apikey = key;
          headers.Authorization = 'Bearer ' + key;
        }
        if (method === 'POST') headers['Content-Type'] = 'application/json';
        const response = await fetch(base + path, {
          method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: 'manual', signal: AbortSignal.timeout(7000),
        });
        return {
          status: response.status,
          contentType: (response.headers.get('content-type') || '').split(';')[0],
          gatewayHeader: response.headers.has('sb-gateway-version'),
          contentLength: Number(response.headers.get('content-length')) || 0,
        };
      } catch (error) {
        return { transportError: error instanceof Error ? error.name : 'unknown' };
      }
    };
    const [unauthenticated, authenticated, rpc] = await Promise.all([
      probe('/rest/v1/', false),
      probe('/rest/v1/', true),
      probe('/rest/v1/rpc/analyzer_get_job', true, 'POST', { p_job_id: 'probe_nonexistent_staging_job_20261115' }),
    ]);
    return { unauthenticated, authenticated, rpc };
  }

  async processJob(body, attempts, channel) { return executeStagingJob(this.env, body, attempts, channel); }
}
// No public inference endpoint, job creation endpoint, credential reader, or queue handler.
export default { fetch() { return new Response('Not found', { status: 404 }); } };
