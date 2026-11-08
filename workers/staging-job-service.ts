import { parseAnalyzerQueueMessage } from '../functions/api/_analyzer-queue-contract';
import { processJob, processDeadLetter, type ConsumerEnv } from './analyzer-queue-consumer';
export type JobDisposition = { action: 'ack' } | { action: 'retry'; delaySeconds: number };
export const STAGING_DATABASE_ORIGIN = 'https://nxfhvebzzobegubefcda.supabase.co';
export async function executeStagingJob(env: ConsumerEnv, body: unknown, attempts: number, channel: 'primary' | 'dead-letter'): Promise<JobDisposition> {
  if (new URL(env.STAGING_SUPABASE_URL || 'https://unconfigured.invalid').origin !== STAGING_DATABASE_ORIGIN) throw new Error('Staging database isolation check failed');
  if (!env.ANTHROPIC_API_KEY || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Staging execution credentials missing');
  if (env.ANALYZER_JOBS_QUEUE_NAME !== 'cyfsa-staging-analyzer-jobs' || env.ANALYZER_JOBS_DLQ_NAME !== 'cyfsa-staging-analyzer-dead-letter') throw new Error('Staging queue isolation check failed');
  const parsed = parseAnalyzerQueueMessage(body);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 1000) throw new Error('Invalid delivery attempt');
  if (channel !== 'primary' && channel !== 'dead-letter') throw new Error('Invalid queue channel');
  let result: JobDisposition = { action: 'retry', delaySeconds: 30 };
  const message = { body: parsed, attempts,
    ack() { result = { action: 'ack' }; },
    retry(options?: { delaySeconds?: number }) { result = { action: 'retry', delaySeconds: options?.delaySeconds ?? 30 }; },
  };
  if (channel === 'primary') await processJob(message, env);
  else await processDeadLetter(message, env);
  return result;
}
