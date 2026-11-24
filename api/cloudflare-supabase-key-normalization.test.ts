import { describe, expect, it, vi } from 'vitest';
import { normalizeSupabaseKey, supabaseKeyHygiene } from '../functions/api/_supabase-key';
import { claimDurableJob, saveDurableInput } from '../functions/api/_durable-analysis-jobs';
import { saveJobState } from '../functions/api/_analysis-jobs';
import { createStagingCreditRpc } from '../functions/api/_staging-credit-rpc';
import { readVerifiedPaidSession } from '../functions/api/_supabase-paid-session';

// Synthetic key material only. The padding mimics a pasted Cloudflare secret.
const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl';
// Invisible characters are built with fromCharCode so the source file itself stays plain ASCII.
const ch = (code: number) => String.fromCharCode(code);
const BOM = ch(0xfeff), NBSP = ch(0xa0), ZWSP = ch(0x200b), LF = ch(10), CR = ch(13);
const PADDED = [BOM + KEY, KEY + NBSP, KEY + CR + LF, '  ' + KEY + LF];
// Observed on the staging executor: damage inside the key (trimChanges false, invalidHeaderChars true).
const INTERNAL = [KEY.slice(0, 40) + LF + KEY.slice(40), KEY.replace('.', '.' + ZWSP), KEY.slice(0, 20) + ' ' + KEY.slice(20)];
const DAMAGED = [...PADDED, ...INTERNAL];
const URL_BASE = 'https://synthetic.supabase.co/';

function headersOf(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.map(([, init]) => init.headers as Record<string, string>);
}

describe('Supabase service key normalization (staging executor HTTP 400 regression)', () => {
  it('trims invisible padding and reports only boolean hygiene facts', () => {
    for (const raw of DAMAGED) {
      expect(normalizeSupabaseKey(raw)).toBe(KEY);
      expect(supabaseKeyHygiene(raw).removedWhitespaceOnly).toBe(true);
      expect(supabaseKeyHygiene(raw).removedCount).toBeGreaterThan(0);
    }
    for (const raw of PADDED) expect(supabaseKeyHygiene(raw)).toMatchObject({ trimChanges: true, invalidHeaderChars: false });
    for (const raw of INTERNAL) expect(supabaseKeyHygiene(raw)).toMatchObject({ trimChanges: false, invalidHeaderChars: true });
    expect(supabaseKeyHygiene(KEY)).toEqual({ trimChanges: false, invalidHeaderChars: false, removedCount: 0, removedWhitespaceOnly: true });
    // A non-whitespace foreign character is reported as not paste damage.
    expect(supabaseKeyHygiene(KEY + ch(0xe9))).toMatchObject({ removedCount: 1, removedWhitespaceOnly: false });
    expect(normalizeSupabaseKey('   ')).toBeUndefined();
    expect(JSON.stringify(supabaseKeyHygiene(KEY))).not.toContain(KEY);
  });

  it('sends the trimmed key from the job ledger, Storage, job state and credit RPC transports', async () => {
    for (const raw of DAMAGED) {
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

  it('sends the cleaned key from the paid-session lookup', async () => {
    for (const raw of DAMAGED) {
      const fetcher = vi.fn(async () => Response.json([]));
      await readVerifiedPaidSession({ STAGING_SUPABASE_URL: URL_BASE, STAGING_SUPABASE_SERVICE_ROLE_KEY: raw }, 'u1', '11111111-1111-4111-8111-111111111111', fetcher as unknown as typeof fetch);
      const h = headersOf(fetcher)[0];
      expect(h.apikey).toBe(KEY);
      expect(h.Authorization).toBe('Bearer ' + KEY);
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

describe('Anthropic key normalization', () => {
  it('sends a cleaned x-api-key when the secret carries invisible characters', async () => {
    const { createCloudflareGenerateFn } = await import('../functions/api/_analyzer-model-adapter');
    const key = 'sk-ant-api03-' + 'a'.repeat(80);
    const lf = String.fromCharCode(10), zwsp = String.fromCharCode(0x200b);
    const fetcher = vi.fn(async () => Response.json({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }));
    const generate = createCloudflareGenerateFn({ ANTHROPIC_API_KEY: zwsp + key.slice(0, 30) + lf + key.slice(30) + lf }, fetcher as unknown as typeof fetch);
    await generate({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }], max_tokens: 10, timeoutMs: 5000 } as any, 'claude-sonnet-5');
    expect((fetcher.mock.calls[0] as any)[1].headers['x-api-key']).toBe(key);
  });
});
