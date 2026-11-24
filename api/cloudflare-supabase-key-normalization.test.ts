import { describe, expect, it, vi } from 'vitest';
import { normalizeSupabaseKey, supabaseKeyHygiene } from '../functions/api/_supabase-key';
import { claimDurableJob, saveDurableInput } from '../functions/api/_durable-analysis-jobs';
import { saveJobState } from '../functions/api/_analysis-jobs';
import { createStagingCreditRpc } from '../functions/api/_staging-credit-rpc';

// Synthetic key material only. The padding mimics a pasted Cloudflare secret.
const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl';
const PADDED = ['﻿' + KEY, KEY + ' ', KEY + '\r\n', '  ' + KEY + '\n'];
const URL_BASE = 'https://synthetic.supabase.co/';

function headersOf(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.map(([, init]) => init.headers as Record<string, string>);
}

describe('Supabase service key normalization (staging executor HTTP 400 regression)', () => {
  it('trims invisible padding and reports only boolean hygiene facts', () => {
    for (const raw of PADDED) {
      expect(normalizeSupabaseKey(raw)).toBe(KEY);
      expect(supabaseKeyHygiene(raw)).toEqual({ trimChanges: true, invalidHeaderChars: false });
    }
    expect(supabaseKeyHygiene(KEY)).toEqual({ trimChanges: false, invalidHeaderChars: false });
    expect(supabaseKeyHygiene('abc def')).toEqual({ trimChanges: false, invalidHeaderChars: true });
    expect(normalizeSupabaseKey('   ')).toBeUndefined();
    expect(JSON.stringify(supabaseKeyHygiene(KEY))).not.toContain(KEY);
  });

  it('sends the trimmed key from the job ledger, Storage, job state and credit RPC transports', async () => {
    for (const raw of PADDED) {
      const env = { STAGING_SUPABASE_URL: URL_BASE, STAGING_SUPABASE_SERVICE_ROLE_KEY: raw };
      const fetcher = vi.fn(async (url: string) => (String(url).includes('/rpc/') ? Response.json(String(url).includes('credit') || String(url).includes('scan') ? { status: 'reserved', reservation_id: 'r1' } : null) : new Response('{}', { status: 200 })));
      await claimDurableJob(env, 'req_1700000000000_synthkey', '00000000-0000-4000-8000-000000000000', 240, fetcher as unknown as typeof fetch);
      await saveDurableInput(env, 'inputs/req_1700000000000_synthkey.json', { documentText: 'synthetic' }, fetcher as unknown as typeof fetch);
      await saveJobState(env, { jobId: 'req_1700000000000_synthkey', uid: 'u', status: 'running', percent: 35, message: 'm' }, fetcher as unknown as typeof fetch);
      await createStagingCreditRpc(env, fetcher as unknown as typeof fetch)('free_reserve_scan', { p_uid: 'u' });
      const all = headersOf(fetcher);
      expect(all).toHaveLength(4);
      for (const h of all) {
        expect(h.apikey).toBe(KEY);
        expect(h.Authorization).toBe('Bearer ' + KEY);
      }
    }
  });

  it('treats a whitespace-only secret as unconfigured instead of sending an empty key', async () => {
    const env = { STAGING_SUPABASE_URL: URL_BASE, STAGING_SUPABASE_SERVICE_ROLE_KEY: ' \n ' };
    const fetcher = vi.fn();
    await expect(claimDurableJob(env, 'req_1700000000000_synthkey', '00000000-0000-4000-8000-000000000000', 240, fetcher as unknown as typeof fetch)).rejects.toThrow(/not configured/);
    expect(await saveJobState(env, { jobId: 'req_1700000000000_synthkey', uid: 'u', status: 'running', percent: 1, message: 'm' }, fetcher as unknown as typeof fetch)).toBe(false);
    await expect(createStagingCreditRpc(env, fetcher as unknown as typeof fetch)('free_reserve_scan', {})).rejects.toThrow(/not configured/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
