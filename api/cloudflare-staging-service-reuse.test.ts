import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ job: vi.fn(), dlq: vi.fn() }));
vi.mock('../workers/analyzer-queue-consumer', () => ({ processJob: calls.job, processDeadLetter: calls.dlq }));
import relay from '../workers/staging-queue-relay';
import { executeStagingJob } from '../workers/staging-job-service';
const body = { version: 1 as const, jobId: 'job_staging_test_123' };
const env = {
  STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co/', ANTHROPIC_API_KEY: 'fake', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'fake',
  ANALYZER_JOBS_QUEUE_NAME: 'cyfsa-staging-analyzer-jobs', ANALYZER_JOBS_DLQ_NAME: 'cyfsa-staging-analyzer-dead-letter',
};
const delivery = () => ({ body, attempts: 1, ack: vi.fn(), retry: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); calls.job.mockImplementation(async m => m.ack()); calls.dlq.mockImplementation(async m => m.retry({ delaySeconds: 45 })); });
describe('private staging job service', () => {
  it('delegates only an opaque job id and preserves ack/retry dispositions', async () => {
    await expect(executeStagingJob(env, body, 1, 'primary')).resolves.toEqual({ action: 'ack' });
    await expect(executeStagingJob(env, body, 2, 'dead-letter')).resolves.toEqual({ action: 'retry', delaySeconds: 45 });
    expect(calls.job.mock.calls[0][0].body).toEqual(body);
  });
  it('refuses another database before any job operation', async () => {
    await expect(executeStagingJob({ ...env, STAGING_SUPABASE_URL: 'https://production.example' }, body, 1, 'primary')).rejects.toThrow('isolation');
    expect(calls.job).not.toHaveBeenCalled();
  });
  it('refuses shared queue configuration and missing credentials', async () => {
    await expect(executeStagingJob({ ...env, ANALYZER_JOBS_QUEUE_NAME: 'cyfsa-analyzer-jobs' }, body, 1, 'primary')).rejects.toThrow('isolation');
    await expect(executeStagingJob({ ...env, ANTHROPIC_API_KEY: '' }, body, 1, 'primary')).rejects.toThrow('credentials');
  });
  it('rejects document-bearing payloads, invalid channels and attempts', async () => {
    await expect(executeStagingJob(env, { ...body, documentText: 'private' }, 1, 'primary')).rejects.toThrow();
    await expect(executeStagingJob(env, body, 0, 'primary')).rejects.toThrow();
    await expect(executeStagingJob(env, body, 1, 'unknown' as any)).rejects.toThrow();
    expect(calls.job).not.toHaveBeenCalled();
  });
});
describe('staging queue relay', () => {
  it('has no public HTTP job or inference endpoint', async () => { expect(relay.fetch().status).toBe(404); });
  it('acknowledges only a confirmed private service ack', async () => {
    const message = delivery(); const processJob = vi.fn().mockResolvedValue({ action: 'ack' });
    await relay.queue({ queue: 'cyfsa-staging-analyzer-jobs', messages: [message] }, { ANALYZER_EXECUTOR: { processJob } });
    expect(processJob).toHaveBeenCalledWith(body, 1, 'primary');
    expect(message.ack).toHaveBeenCalledOnce();
  });
  it('retries the same job when RPC fails instead of acknowledging or recreating it', async () => {
    const message = delivery();
    await relay.queue({ queue: 'cyfsa-staging-analyzer-jobs', messages: [message] }, { ANALYZER_EXECUTOR: { processJob: vi.fn().mockRejectedValue(new Error('disconnect')) } });
    expect(message.ack).not.toHaveBeenCalled(); expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 }); expect(message.body).toEqual(body);
  });
  it('routes the isolated DLQ and refuses shared traffic', async () => {
    const message = delivery(); const processJob = vi.fn().mockResolvedValue({ action: 'retry', delaySeconds: 60 });
    await relay.queue({ queue: 'cyfsa-staging-analyzer-dead-letter', messages: [message] }, { ANALYZER_EXECUTOR: { processJob } });
    expect(processJob).toHaveBeenCalledWith(body, 1, 'dead-letter'); expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    await expect(relay.queue({ queue: 'cyfsa-analyzer-jobs', messages: [message] }, {})).rejects.toThrow();
  });
  it('fails closed without a service binding', async () => { await expect(relay.queue({ queue: 'cyfsa-staging-analyzer-jobs', messages: [delivery()] }, {})).rejects.toThrow('binding'); });
});
