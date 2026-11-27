// Old application on the new schema: the handlers of the production deployment (commit 82dfe65, deployment 0cc59589)
// run unmodified against a disposable PostgreSQL + real PostgREST built to the live nxfh payment schema, before and after
// migrations G, P and D. (The new application on the pre-P schema is covered by payment-schema-qualification.pg.test.ts.)
// The production sources are extracted with `git archive` into a git-ignored directory; skipped where that commit or
// CREDIT_PG_URL / PostgREST is unavailable. Synthetic records only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness, findPostgrest, localJwt } from './helpers/postgrest-harness';

const PROD = '82dfe65';
const url = process.env.CREDIT_PG_URL;
const bin = findPostgrest();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (p: string) => readFileSync(path.resolve(here, p), 'utf8');
const LIVE = read('fixtures/live-nxfh-payment-schema.sql');
const G = read('../../supabase/migrations_pending_approval/payments_service_role_review_update.sql');
const P = read('../../supabase/migrations/20261110004740_preserve_monthly_renewal.sql');
const D = read('../../supabase/migrations_pending_approval/access_codes_one_redemption_per_reference.sql');
const hasProd = (() => { try { execFileSync('git', ['cat-file', '-e', `${PROD}^{commit}`], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } })();
const dir = path.join(here, `.compat-${PROD}`);
const env = { FIREBASE_PROJECT_ID: 'p', SESSION_SECRET: 'compat-secret', STAGING_SUPABASE_URL: 'https://db.test',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt('service_role'), PAYMENT_EMAIL: 'pay@example.test' };
type Json = Record<string, any>;
type Mods = { auth: any; activate: any; admin: any };

async function loadProd(): Promise<Mods> {
  if (!existsSync(path.join(dir, 'functions'))) {
    mkdirSync(dir, { recursive: true });
    const tar = execFileSync('git', ['archive', '--format=tar', PROD, 'functions', 'shared'], { cwd: root, maxBuffer: 1 << 28 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
  }
  return {
    auth: await import(/* @vite-ignore */ path.join(dir, 'functions/api/_auth-check.ts')),
    activate: await import(/* @vite-ignore */ path.join(dir, 'functions/api/activate-code.ts')),
    admin: await import(/* @vite-ignore */ path.join(dir, 'functions/api/admin/[[path]].ts')),
  };
}

const enabled = !!url && !!bin && hasProd;
const tag = `${process.pid}_${Date.now()}`;

for (const stage of ['live (no G)', 'G', 'G + P', 'G + P + D'] as const) {
  describe.skipIf(!enabled)(`production ${PROD} handlers on the ${stage} schema`, () => {
    const h = new Harness(url!, `paycompat_${stage.replace(/\W+/g, '').toLowerCase()}_${tag}`, bin!);
    let m: Mods; let n = 0; let uid = ''; let email = '';
    beforeAll(async () => {
      m = await loadProd();
      await h.start(stage === 'live (no G)' ? [LIVE] : [LIVE, G]);
      if (stage.includes('P')) await h.migrate(P, 'access_codes?select=redeemed_session_id&limit=1');
      if (stage.includes('D')) await h.migrate(D, 'access_codes?select=id&limit=1');
    });
    afterAll(async () => { await h.stop(); });
    beforeEach(() => {
      n++; uid = `uid-c-${n}-${Date.now().toString(36)}`; email = `c${n}.${Date.now().toString(36)}@example.test`;
      vi.stubGlobal('fetch', h.fetch);
      vi.spyOn(m.auth, 'verifyFirebaseRequest').mockImplementation(async () => ({ status: 'verified', uid, email, emailVerified: true }) as never);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => { h.hooks = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
    const out = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as Json });
    const order = async () => {
      const ref = `PS-C${(Date.now().toString(36) + (++n).toString(36)).toUpperCase().slice(-8)}`;
      await h.q(`insert into public.payments (plan, amount, reference_number, status, notes, firebase_uid, user_role) values ('Premium', 49.99, $1, 'pending', $2, $3, 'parent')`,
        [ref, `email:${email};uid:${uid}`, uid]);
      return ref;
    };
    const admin = async (route: string, body: Json) => out(await m.admin.handleAdminRequest(
      new Request(`https://cyfsanavigator.com/api/admin/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      env, { requireAdmin: async () => ({ admin: { email: 'ops@example.test', uid: `admin-${n}` } }), fetcher: h.fetch }));
    const activate = async (code: string) => out(await m.activate.onRequestPost({ request: new Request('https://x/api/activate-code', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.8.${n % 250}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ code, email }) }), env }));
    const live = async () => (await h.q<{ revoked_at: Date | null; expires_at: Date }>('select revoked_at, expires_at from public.navigator_paid_sessions where firebase_uid = $1', [uid]))
      .filter((s) => !s.revoked_at && s.expires_at.getTime() > Date.now());

    if (stage === 'live (no G)') {
      it('production approval is refused by the database (missing UPDATE grant: why G is needed), and nothing is issued', async () => {
        const ref = await order();
        expect((await admin('payments/approve', { referenceNumber: ref, amountReceived: 49.99 })).status).toBeGreaterThanOrEqual(500);
        expect((await h.q('select status from public.payments where reference_number = $1', [ref]))[0].status).toBe('pending');
        expect(await h.q('select 1 from public.access_codes where reference_number = $1 and used_at is null and (expires_at is null or expires_at > now())', [ref])).toHaveLength(0);
      });
      return;
    }

    it('approve, activate, re-activate and refund work as before; one entitlement, revoked by the refund', async () => {
      const ref = await order();
      const a = await admin('payments/approve', { referenceNumber: ref, amountReceived: 49.99 });
      expect(a.status).toBe(200);
      expect((await activate(a.body.accessCode)).status).toBe(200);
      const again = await activate(a.body.accessCode);
      expect([again.status, again.body.reused]).toEqual([200, true]);
      expect(await live()).toHaveLength(1);
      const r = await admin('payments/refund', { referenceNumber: ref, reason: 'customer requested a refund' });
      if (!stage.includes('P')) {
        // Production defect on the pre-P schema (fixed on the release branch): the refund reads redeemed_session_id,
        // which only P adds, so refunding an activated order is recorded but fails (501) and the customer keeps access.
        expect([...h.audit.keys()].filter((k) => k.includes(`__refund__${ref}__`))).toHaveLength(1); // recorded, not applied
        expect([r.status, r.body.code]).toEqual([501, 'ADMIN_SCHEMA_UNAVAILABLE']);
        expect(await live()).toHaveLength(1);
        return;
      }
      expect(r.status).toBe(200);
      expect(await live()).toHaveLength(0);
      expect((await activate(a.body.accessCode)).status).not.toBe(200);
    });

    it('two activations of the same code at once: one entitlement', async () => {
      const ref = await order();
      const a = await admin('payments/approve', { referenceNumber: ref, amountReceived: 49.99 });
      const rs = await Promise.all([activate(a.body.accessCode), activate(a.body.accessCode), activate(a.body.accessCode)]);
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(await live()).toHaveLength(1);
    });

    it(stage.includes('D') ? 'a reissued code for an already activated order is refused (D), the entitlement stays single'
      : 'a reissued code for an already activated order (no D): records what production does today', async () => {
      const ref = await order();
      const a = await admin('payments/approve', { referenceNumber: ref, amountReceived: 49.99 });
      expect((await activate(a.body.accessCode)).status).toBe(200);
      const re = await admin('payments/reissue-code', { referenceNumber: ref, reason: 'customer lost the code' });
      if (re.status !== 200) return; // production refuses to reissue for an activated order: nothing more to check
      const second = await activate(re.body.accessCode);
      if (stage.includes('D')) { expect(second.status).toBe(409); expect(await live()).toHaveLength(1); }
      expect((await h.q('select count(*)::int as n from public.access_codes where reference_number = $1 and used_at is not null', [ref]))[0].n)
        .toBe(stage.includes('D') ? 1 : second.status === 200 ? 2 : 1);
    });
  });
}
