import { parseAnalyzerQueueMessage } from '../functions/api/_analyzer-queue-contract';
import type { JobDisposition } from './staging-job-service';
export interface RelayEnv {
  ANALYZER_EXECUTOR?: { processJob(body: unknown, attempts: number, channel: 'primary' | 'dead-letter'): Promise<JobDisposition> };
}
interface Delivery { body: unknown; attempts: number; ack(): void; retry(options?: { delaySeconds?: number }): void; }
export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async queue(batch: { queue: string; messages: Delivery[] }, env: RelayEnv) {
    if (!['cyfsa-staging-analyzer-jobs', 'cyfsa-staging-analyzer-dead-letter'].includes(batch.queue)) throw new Error('Unexpected staging queue');
    if (!env.ANALYZER_EXECUTOR) throw new Error('Private analyzer service binding missing');
    for (const message of batch.messages) {
      let body;
      try { body = parseAnalyzerQueueMessage(message.body); } catch { message.ack(); continue; }
      try {
        const result = await env.ANALYZER_EXECUTOR.processJob(body, message.attempts, batch.queue === 'cyfsa-staging-analyzer-jobs' ? 'primary' : 'dead-letter');
        if (result.action === 'ack') message.ack();
        else if (result.action === 'retry' && Number.isFinite(result.delaySeconds) && result.delaySeconds >= 0 && result.delaySeconds <= 900) message.retry({ delaySeconds: result.delaySeconds });
        else throw new Error('Invalid private analyzer disposition');
      } catch {
        // Retry the SAME job. The ledger lease and idempotent finalizer reconcile lost RPC replies.
        console.error('[STAGING_ANALYZER_RPC_RETRY]');
        message.retry({ delaySeconds: 30 });
      }
    }
  },
};
