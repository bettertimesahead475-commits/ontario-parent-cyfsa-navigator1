// Evidence only. Run from a folder where @electric-sql/pglite is installed (not a project dependency).
// Disposable, in-memory PostgreSQL (PGlite). Applies the durable job table migration, then the pending usage-ledger
// migration and its rollback. Usage: node validate-analysis-ledger-pglite.mjs <repo-root>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const repo = process.argv[2];
const JOBS = readFileSync(`${repo}/supabase/migrations/20261104230000_durable_analyzer_queue.sql`, 'utf8');
const UP = readFileSync(`${repo}/supabase/migrations_pending_approval/create_navigator_analysis_ledger.sql`, 'utf8');
const DOWN = readFileSync(`${repo}/supabase/migrations_pending_approval/rollback_navigator_analysis_ledger.sql`, 'utf8');
const db = new PGlite();
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const STATE = (over = {}) => JSON.stringify({ jobId: 'job_ledger_01', deliveries: 1, reservations: {}, checkpoints: {}, ...over });

await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(JOBS);
await db.exec(UP);
check('ledger migration applies on top of the job table', true);

await db.query(
  `insert into public.analyzer_jobs (job_id, owner_uid, mode, input_key, status, worker_token, lease_expires_at)
   values ('job_ledger_01', 'owner-1', 'full', 'inputs/x.json', 'running', $1, now() + interval '4 minutes'),
          ('job_queued_02', 'owner-1', 'full', 'inputs/y.json', 'queued', null, null)`,
  [T1]
);

const write = async (jobId, expected, token, state) => {
  const r = await db.query('select public.analyzer_job_ledger_write($1, $2, $3, $4::jsonb) as r', [jobId, expected, token, state]);
  return r.rows[0].r;
};

check('first write from the lease holder is accepted', (await write('job_ledger_01', 0, T1, STATE())) === 'written');
const afterFirst = await db.query("select version from public.analyzer_job_ledger where job_id='job_ledger_01'");
check('version advances to 1', afterFirst.rows[0].version === 1);

check('stale expected version is a conflict, not a lost update', (await write('job_ledger_01', 0, T1, STATE({ deliveries: 9 }))) === 'conflict');
check('a conflict leaves the stored state untouched', (await db.query("select state->>'deliveries' as d from public.analyzer_job_ledger where job_id='job_ledger_01'")).rows[0].d === '1');

check('current expected version is accepted', (await write('job_ledger_01', 1, T1, STATE({ deliveries: 2 }))) === 'written');

check('two racing writers at the same version: exactly one wins', (
  await Promise.all([write('job_ledger_01', 2, T1, STATE({ deliveries: 3 })), write('job_ledger_01', 2, T1, STATE({ deliveries: 4 }))])
).sort().join(',') === 'conflict,written');

check('a worker with another token (lease lost) is refused', (await write('job_ledger_01', 3, T2, STATE())) === 'not_owner');
check('a missing token is refused', (await write('job_ledger_01', 3, null, STATE())) === 'not_owner');

await db.query("update public.analyzer_jobs set lease_expires_at = now() - interval '1 second' where job_id='job_ledger_01'");
check('an expired lease is refused even with the right token', (await write('job_ledger_01', 3, T1, STATE())) === 'not_owner');
await db.query("update public.analyzer_jobs set lease_expires_at = now() + interval '4 minutes' where job_id='job_ledger_01'");

check('a queued job (no lease) is refused', (await write('job_queued_02', 0, T1, STATE({ jobId: 'job_queued_02' }))) === 'not_owner');

const read = await db.query("select public.analyzer_job_ledger_read('job_ledger_01') as s");
const state = read.rows[0].s;
check('read returns the state with its version', state && state.version === 3 && (state.deliveries === 3 || state.deliveries === 4), JSON.stringify(state));
check('stored state does not carry the version twice', (await db.query("select state ? 'version' as has from public.analyzer_job_ledger where job_id='job_ledger_01'")).rows[0].has === false);

check('reading a missing ledger returns null', (await db.query("select public.analyzer_job_ledger_read('job_missing_99') as s")).rows[0].s === null);

await db.query("delete from public.analyzer_jobs where job_id='job_ledger_01'");
const afterDelete = await db.query("select count(*)::int as n from public.analyzer_job_ledger where job_id='job_ledger_01'");
check('deleting the job removes its ledger row', afterDelete.rows[0].n === 0);

const rls = await db.query("select relrowsecurity from pg_class where relname='analyzer_job_ledger'");
check('row level security enabled on the ledger', rls.rows[0]?.relrowsecurity === true);
const grants = await db.query("select grantee from information_schema.role_table_grants where table_name='analyzer_job_ledger' and grantee in ('anon','authenticated')");
check('anon and authenticated have no table privileges', grants.rows.length === 0);

await db.exec(DOWN);
check('rollback removes the table', (await db.query("select to_regclass('public.analyzer_job_ledger') as t")).rows[0].t === null);
await db.exec(UP);
check('re-apply after rollback succeeds', true);

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
