import { describe, expect, it, vi } from 'vitest';
import { LIMITS, reserveVerifiedPaidCredit, type CreditRpc } from '../../functions/api/_paid-credit-reservation';
import { FREE_SCAN_LIMIT, reserveFreeScan } from '../../functions/api/_free-credit-reservation';
import type { VerifiedSession } from '../../functions/api/_paid-session-validation';

// These tests pin the CURRENT entitlement rules. They do not change any price, limit or allowance.
const SESSION_ID = '3f2a1c9e-7b4d-4e8a-9c1f-2d5e6a7b8c9d';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const ISSUED = '2026-11-01T00:00:00.000Z';
const REQUEST = 'req_entitlement_01';

function session(tier: string): VerifiedSession {
  return { sessionId: SESSION_ID, ownerUid: 'owner-1', tier, issuedAt: ISSUED, expiresAt: null } as unknown as VerifiedSession;
}

function recordingRpc(status = 'reserved') {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { status, reservation_id: 'res_1' };
  }) as unknown as CreditRpc & ReturnType<typeof vi.fn>;
  return { rpc, calls };
}

describe('paid entitlements are enforced independently for quick and forensic', () => {
  it('Basic: a quick review reserves against a 3-analysis total pool', async () => {
    const { rpc, calls } = recordingRpc();
    const r = await reserveVerifiedPaidCredit(session('Basic'), 'quick', REQUEST, rpc, NOW);
    expect(r.status).toBe('reserved');
    expect(calls[0].name).toBe('paid_reserve_credit');
    expect(calls[0].args.p_scope).toBe('total');
    expect(calls[0].args.p_granted).toBe(3);
  });

  it('Basic: a forensic request is refused locally and the RPC is never called', async () => {
    const { rpc } = recordingRpc();
    const r = await reserveVerifiedPaidCredit(session('Basic'), 'forensic', REQUEST, rpc, NOW);
    expect(r).toEqual({ status: 'denied' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('Premium: quick and forensic both draw on the same 5-analysis total pool', async () => {
    const quick = recordingRpc();
    const forensic = recordingRpc();
    await reserveVerifiedPaidCredit(session('Premium'), 'quick', REQUEST, quick.rpc, NOW);
    await reserveVerifiedPaidCredit(session('Premium'), 'forensic', REQUEST, forensic.rpc, NOW);
    expect(quick.calls[0].args.p_scope).toBe('total');
    expect(forensic.calls[0].args.p_scope).toBe('total');
    expect(quick.calls[0].args.p_granted).toBe(5);
    expect(forensic.calls[0].args.p_granted).toBe(5);
  });

  it('the RPC arguments carry no analysis type: quick and forensic produce identical argument shapes', async () => {
    const quick = recordingRpc();
    const forensic = recordingRpc();
    await reserveVerifiedPaidCredit(session('Premium'), 'quick', REQUEST, quick.rpc, NOW);
    await reserveVerifiedPaidCredit(session('Premium'), 'forensic', REQUEST, forensic.rpc, NOW);
    const keys = (c: typeof quick) => Object.keys(c.calls[0].args).sort();
    expect(keys(quick)).toEqual(keys(forensic));
    expect(keys(quick)).not.toContain('p_analysis_type');
    expect(keys(quick)).not.toContain('p_type');
  });

  it('Pro: quick reviews are unlimited (scope none), forensic is scoped to the billing period', async () => {
    const quick = recordingRpc();
    const forensic = recordingRpc();
    await reserveVerifiedPaidCredit(session('Pro'), 'quick', REQUEST, quick.rpc, NOW);
    await reserveVerifiedPaidCredit(session('Pro'), 'forensic', REQUEST, forensic.rpc, NOW);
    expect(quick.calls[0].args.p_scope).toBe('none');
    expect(String(forensic.calls[0].args.p_scope)).not.toBe('none');
    expect(String(forensic.calls[0].args.p_scope)).not.toBe('total');
    expect(forensic.calls[0].args.p_granted).toBe(5);
  });

  it('an unknown tier is denied without calling the RPC', async () => {
    const { rpc } = recordingRpc();
    expect(await reserveVerifiedPaidCredit(session('Gold'), 'quick', REQUEST, rpc, NOW)).toEqual({ status: 'denied' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a malformed analysis type is denied without calling the RPC', async () => {
    const { rpc } = recordingRpc();
    expect(await reserveVerifiedPaidCredit(session('Premium'), 'deep' as any, REQUEST, rpc, NOW)).toEqual({ status: 'denied' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a limit answer from the RPC is passed through unchanged', async () => {
    const { rpc } = recordingRpc('limit');
    expect((await reserveVerifiedPaidCredit(session('Basic'), 'quick', REQUEST, rpc, NOW)).status).toBe('limit');
  });

  it('an RPC error is reported as unavailable, not as a reservation', async () => {
    const rpc = vi.fn(async () => { throw new Error('db down'); }) as unknown as CreditRpc;
    expect((await reserveVerifiedPaidCredit(session('Basic'), 'quick', REQUEST, rpc, NOW)).status).toBe('unavailable');
  });

  it('the tier table matches the documented allowances', () => {
    expect(LIMITS.Basic).toEqual({ limit: 3, monthly: false, forensic: false });
    expect(LIMITS.Premium).toEqual({ limit: 5, monthly: false, forensic: true });
    expect(LIMITS.Pro.monthly).toBe(true);
  });
});

describe('free scans are a separate entitlement from paid', () => {
  it('a free scan reserves against FREE_SCAN_LIMIT through free_reserve_scan, never the paid RPC', async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ status: 'reserved', reservation_id: 'free_1' }));
    const r = await reserveFreeScan('owner-1', REQUEST, rpc as unknown as CreditRpc);
    expect(r.status).toBe('reserved');
    expect(rpc).toHaveBeenCalledWith('free_reserve_scan', expect.objectContaining({ p_limit: FREE_SCAN_LIMIT }));
    const names = rpc.mock.calls.map((c) => c[0] as string);
    expect(names).not.toContain('paid_reserve_credit');
  });

  it('the free limit is the same constant the usage display reads', () => {
    expect(FREE_SCAN_LIMIT).toBe(3);
  });
});
