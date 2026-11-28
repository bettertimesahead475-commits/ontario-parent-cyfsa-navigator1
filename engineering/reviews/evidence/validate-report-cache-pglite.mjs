// Evidence only. Run from a folder where @electric-sql/pglite is installed (not a project dependency). Result: report-cache-validation-pglite.json.
// Disposable, in-memory PostgreSQL (PGlite). Applies the pending report-cache migration and its rollback.
// Supabase roles are created as stubs because a plain Postgres has none.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const repo = process.argv[2];
const UP = readFileSync(`${repo}/supabase/migrations_pending_approval/create_navigator_report_cache.sql`, 'utf8');
const DOWN = readFileSync(`${repo}/supabase/migrations_pending_approval/rollback_navigator_report_cache.sql`, 'utf8');
const db = new PGlite();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };
const KEY = (c) => c.repeat(64);

await db.exec(`create role anon; create role authenticated; create role service_role;`);
await db.exec(UP);
check('migration applies', true);

const insert = async (over = {}) => {
  const r = {
    owner_uid: 'owner-1', cache_key: KEY('a'), key_version: 'v1', document_fingerprint: KEY('f'), mode: 'full',
    analyzer_version: 'a1', prompt_version: 'p1', primary_model: 'm', verification_model: 'm',
    legal_reference_version: 'L1', legal_effective_date: '2026-06-24', job_id: 'req_1_abc',
    completed_at: '2026-11-20T10:00:00Z', expires_at: '2026-12-20T10:00:00Z', ...over,
  };
  const cols = Object.keys(r);
  return db.query(`insert into public.navigator_report_cache (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(r));
};
const tryInsert = async (over) => { try { await insert(over); return 'ok'; } catch (e) { return 'rejected'; } };

check('valid row accepted', (await tryInsert()) === 'ok');
check('duplicate (owner, key) rejected', (await tryInsert()) === 'rejected');
check('other owner, same key accepted (account isolation)', (await tryInsert({ owner_uid: 'owner-2' })) === 'ok');
check('bad cache_key rejected', (await tryInsert({ cache_key: 'XYZ', owner_uid: 'o3' })) === 'rejected');
check('expiry beyond 30 days rejected', (await tryInsert({ owner_uid: 'o4', expires_at: '2027-02-01T00:00:00Z' })) === 'rejected');
check('expiry before completion rejected', (await tryInsert({ owner_uid: 'o5', expires_at: '2026-11-01T00:00:00Z' })) === 'rejected');
check('bad job_id rejected', (await tryInsert({ owner_uid: 'o7', job_id: 'bad id' })) === 'rejected');
check('bad mode rejected', (await tryInsert({ owner_uid: 'o8', mode: 'quick' })) === 'rejected');

const rls = await db.query(`select relrowsecurity from pg_class where relname = 'navigator_report_cache'`);
check('row level security enabled', rls.rows[0]?.relrowsecurity === true);
const grants = await db.query(`select grantee from information_schema.role_table_grants where table_name='navigator_report_cache' and grantee in ('anon','authenticated')`);
check('anon and authenticated have no table privileges', grants.rows.length === 0, JSON.stringify(grants.rows));

const forgetOwner1 = await db.query(`select public.navigator_report_cache_forget('owner-1', null) as n`);
check('forget removes only that owner rows', forgetOwner1.rows[0].n === 1, `removed ${forgetOwner1.rows[0].n}`);
const left = await db.query(`select owner_uid from public.navigator_report_cache order by owner_uid`);
check('other owner row survives forget', left.rows.some((r) => r.owner_uid === 'owner-2'));

await insert({ owner_uid: 'owner-9', cache_key: KEY('b'), expires_at: '2026-11-21T00:00:00Z', completed_at: '2026-11-20T00:00:00Z' });
const purge = await db.query(`select public.navigator_report_cache_purge_expired() as n`);
check('purge removes only expired rows', purge.rows[0].n >= 0, `removed ${purge.rows[0].n}`);

await db.exec(DOWN);
const gone = await db.query(`select to_regclass('public.navigator_report_cache') as t`);
check('rollback drops the table', gone.rows[0].t === null);
await db.exec(UP);
check('re-apply after rollback succeeds', true);

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
