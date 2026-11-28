import { describe, expect, it, vi } from 'vitest';
import { authorizeFreeOcr, freeTrialKey, ocrRequestIdFor, FREE_OCR_LIFETIME_LIMIT } from '../functions/api/_free-trial';

// OCR for a free account must be (a) tied to one document, so retries of that document are free, (b) bounded by the
// number of distinct documents the account's free analyses allow, and (c) unavailable once both free analyses are used.
// The RPC fake below reproduces free_reserve_scan's behaviour: one marker per (key, request), idempotent on repeat.

type Markers = Map<string, Set<string>>;
function reserveFake() {
  const markers: Markers = new Map();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'free_reserve_scan') return { status: 'consumed' };
    const key = String(args.p_uid);
    const request = String(args.p_request);
    const limit = Number(args.p_limit);
    const seen = markers.get(key) ?? new Set<string>();
    markers.set(key, seen);
    if (seen.has(request)) return { status: 'joined', reservation_id: null };
    if (seen.size >= limit) return { status: 'limit', reservation_id: null };
    seen.add(request);
    return { status: 'reserved', reservation_id: `free_res_${request}` };
  });
  return { rpc, markers };
}

/** free_usage counters keyed by uid (legacy) and by email hash (quick/forensic). Unknown keys read as 0. */
function usageFetch(counts: Record<string, number>) {
  return vi.fn(async (input: any) => {
    const uid = new URL(String(input)).searchParams.get('uid') ?? '';
    const value = counts[uid.replace(/^eq\./, '')] ?? 0;
    return Response.json([{ analyses_used: value }]);
  });
}

const env = { STAGING_SUPABASE_URL: 'https://staging.example.test', STAGING_SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'a'.repeat(24)}` };
const uid = 'uid_family_1';
const email = 'family@example.com';
const now = new Date('2026-11-27T12:00:00Z');

describe('OCR is tied to a specific document, not to each call', () => {
  it('derives a stable id per account and document, different for another document or account', async () => {
    const a = await ocrRequestIdFor(uid, 'AAAA');
    expect(await ocrRequestIdFor(uid, 'AAAA')).toBe(a);
    expect(await ocrRequestIdFor(uid, 'AAAB')).not.toBe(a);
    expect(await ocrRequestIdFor('uid_other', 'AAAA')).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('retries of one document are not counted again, even after the budget is spent on other documents', async () => {
    const { rpc } = reserveFake();
    const fetcher = usageFetch({});
    const docs = ['DOC-ONE', 'DOC-TWO'];
    for (const doc of docs) expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, doc), fetcher as any, now)).toBe('ok');
    // The budget (two documents) is now spent. A timeout-retry of the first document must still succeed.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, docs[0]), fetcher as any, now)).toBe('ok');
    }
    // A third, new document is refused.
    expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, 'DOC-THREE'), fetcher as any, now)).toBe('ocr_limit');
  });

  it('a modified copy of a document takes a new unit, so it cannot be used to read unlimited pages', async () => {
    const { rpc } = reserveFake();
    const fetcher = usageFetch({});
    expect(FREE_OCR_LIFETIME_LIMIT).toBe(2);
    expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, 'DOC-ONE'), fetcher as any, now)).toBe('ok');
    expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, 'DOC-ONE-EDITED'), fetcher as any, now)).toBe('ok');
    expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, 'DOC-ONE-EDITED-AGAIN'), fetcher as any, now)).toBe('ocr_limit');
  });
});

describe('OCR without an unused free analysis, and malformed input', () => {
  it('refuses OCR once both free analyses are used, and spends no OCR unit', async () => {
    const { rpc, markers } = reserveFake();
    // Both lifetime counters are spent (keyed by the email hash). The legacy uid counter is 0, so no grandfathering.
    const usedQuick = await freeTrialKey('quick', email);
    const usedForensic = await freeTrialKey('forensic', email);
    const fetcher = usageFetch({ [usedQuick]: 1, [usedForensic]: 1 });
    expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, await ocrRequestIdFor(uid, 'DOC-ONE'), fetcher as any, now)).toBe('no_entitlement');
    expect(markers.size).toBe(0);
  });

  it('refuses unverified email before any read or unit', async () => {
    const { rpc } = reserveFake();
    expect(await authorizeFreeOcr(env as any, uid, email, false, rpc as any, await ocrRequestIdFor(uid, 'DOC-ONE'), usageFetch({}) as any, now)).toBe('email_unverified');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a request id outside the accepted format rather than guessing a key', async () => {
    const { rpc } = reserveFake();
    expect(await authorizeFreeOcr(env as any, uid, email, true, rpc as any, 'bad id!', usageFetch({}) as any, now)).toBe('unavailable');
    expect(rpc).not.toHaveBeenCalled();
  });
});
