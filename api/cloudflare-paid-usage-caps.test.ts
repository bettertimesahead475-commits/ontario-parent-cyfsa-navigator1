import { describe, expect, it, vi } from 'vitest';
import { platformDailyKey, takePaidUsageUnit } from '../functions/api/_free-trial';
import { classifyFailure } from '../shared/analyzerRetryPolicy';

const now = new Date('2026-11-27T12:00:00Z');
const counters = (full: string[]) => vi.fn(async (name: string, args: Record<string, unknown>) =>
  name === 'free_reserve_scan'
    ? full.some((prefix) => String(args.p_uid).startsWith(prefix)) ? { status: 'limit', reservation_id: null } : { status: 'reserved', reservation_id: 'free_res_x' }
    : { status: 'consumed' });

describe('paid transcription and OCR daily caps', () => {
  it('takes one account unit then one platform unit', async () => {
    const rpc = counters([]);
    expect(await takePaidUsageUnit({}, 'tr', 'uid_paid_1', rpc, now)).toBe('ok');
    const keys = rpc.mock.calls.filter(([n]) => n === 'free_reserve_scan').map(([, a]) => a.p_uid);
    expect(keys).toEqual(['acct:tr:uid_paid_1:20261127', platformDailyKey('tr', now)]);
    expect(rpc.mock.calls.some(([n]) => String(n).startsWith('paid_'))).toBe(false);
  });
  it('refuses at the account cap before touching the platform cap', async () => {
    const rpc = counters(['acct:pocr:']);
    expect(await takePaidUsageUnit({}, 'pocr', 'uid_paid_1', rpc, now)).toBe('account_limit');
    expect(rpc.mock.calls.every(([, a]) => !String(a.p_uid).startsWith('plat:'))).toBe(true);
  });
  it('refuses at the platform cap', async () => {
    expect(await takePaidUsageUnit({}, 'tr', 'uid_paid_1', counters(['plat:tr:']), now)).toBe('platform_limit');
  });
  it('0 blocks, off disables, and an unreadable counter does not block a paying customer', async () => {
    expect(await takePaidUsageUnit({ PAID_TRANSCRIBE_ACCOUNT_DAILY_LIMIT: '0' }, 'tr', 'u1', counters([]), now)).toBe('account_limit');
    const off = counters([]);
    expect(await takePaidUsageUnit({ PAID_OCR_ACCOUNT_DAILY_LIMIT: 'off', PAID_OCR_PLATFORM_DAILY_LIMIT: 'off' }, 'pocr', 'u1', off, now)).toBe('ok');
    expect(off).not.toHaveBeenCalled();
    expect(await takePaidUsageUnit({}, 'tr', 'u1', vi.fn(async () => { throw new Error('down'); }), now)).toBe('ok');
  });
  it('a daily-cap refusal is permanent for the client retry policy, so a bulk scan does not keep retrying it', () => {
    for (const code of ['ACCOUNT_DAILY_LIMIT', 'PLATFORM_DAILY_LIMIT', 'FREE_TRIAL_PAUSED']) {
      expect(classifyFailure({ status: 503, code, retryable: false }).action).toBe('STOP');
    }
  });
});
