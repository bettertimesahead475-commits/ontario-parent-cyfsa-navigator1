import { WorkerEntrypoint } from 'cloudflare:workers';
import { executeStagingJob } from './staging-job-service';
import { checkStagingProvider } from './staging-provider-service';
// Only an explicitly bound Worker can call this named RPC entrypoint. HTTP cannot.
export class StagingAnalyzerJobs extends WorkerEntrypoint {
  async checkProvider(token, mode) { return checkStagingProvider(this.env, token, mode); }
  async processJob(body, attempts, channel) { return executeStagingJob(this.env, body, attempts, channel); }
}
// No public inference endpoint, job creation endpoint, credential reader, or queue handler.
export default { fetch() { return new Response('Not found', { status: 404 }); } };
