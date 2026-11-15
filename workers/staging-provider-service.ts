import type { ConsumerEnv } from './analyzer-queue-consumer';
import { handleProviderCheck } from '../functions/api/admin/analyzer-provider-check';

/** Reuses the existing private credential holder. No ledger, report or queue operation. */
export async function checkStagingProvider(env: ConsumerEnv, token: string, mode: string) {
  if (env.ANALYZER_JOBS_QUEUE_NAME !== 'cyfsa-staging-analyzer-jobs' || env.ANALYZER_JOBS_DLQ_NAME !== 'cyfsa-staging-analyzer-dead-letter') throw new Error('Unexpected staging credential service');
  if (!['models','fast','full'].includes(mode) || typeof token !== 'string' || token.length > 20000) throw new Error('Invalid fixed provider check');
  const response = await handleProviderCheck(new Request('https://cyfsa-navigator-staging.pages.dev/api/admin/analyzer-provider-check', {
    method: mode === 'models' ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(mode === 'models' ? {} : { body: JSON.stringify({ mode }) }),
  }), { ...env, ANALYZER_ENABLED: 'false', FIREBASE_PROJECT_ID: 'cyfsa-navigator-e2e-20261108', STAGING_PROVIDER_CHECKS_ENABLED: 'true', STAGING_PROVIDER_CHECK_UIDS: 'cyfsa_e2e_a_0c17a294d05842208391fe56a90ca64f,cyfsa_e2e_b_c751bef315e74b23b1cd968c53797b12' });
  return { status: response.status, body: await response.json() };
}
