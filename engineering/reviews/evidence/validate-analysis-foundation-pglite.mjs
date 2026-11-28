// Evidence only. Run from a folder where @electric-sql/pglite is installed (not a project dependency).
// Disposable, in-memory PostgreSQL (PGlite). Applies the pending analysis-foundation migration and its rollback.
// Usage: node validate-analysis-foundation-pglite.mjs <repo-root>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const repo = process.argv[2];
const UP = readFileSync(`${repo}/supabase/migrations_pending_approval/create_navigator_analysis_foundation.sql`, 'utf8');
const DOWN = readFileSync(`${repo}/supabase/migrations_pending_approval/rollback_navigator_analysis_foundation.sql`, 'utf8');
const db = new PGlite();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };
const FP = (c) => c.repeat(64);

await db.exec(`create role anon; create role authenticated; create role service_role;`);
await db.exec(UP);
check('migration applies', true);

const insert = async (over = {}) => {
  const r = {
    owner_uid: 'owner-1', document_fingerprint: FP('a'), schema_version: 1, source_mode: 'fast',
    source_job_id: 'req_1_abc', foundation: JSON.stringify({ schemaVersion: 1, quotes: [], dates: [], parties: [] }),
    completed_at: '2026-11-20T10:00:00Z', expires_at: '2026-12-20T10:00:00Z', ...over,
  };
  const cols = Object.keys(r);
  return db.query(
    `insert into public.navigator_analysis_foundation (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
    Object.values(r)
  );
};
const tryInsert = async (over) => { try { await insert(over); return 'ok'; } catch { return 'rejected'; } };

check('valid row accepted', (await tryInsert()) === 'ok');
check('duplicate (owner, fingerprint, schema) rejected', (await tryInsert()) === 'rejected');
check('same document, next schema version accepted', (await tryInsert({ schema_version: 2 })) === 'ok');
check('other owner, same fingerprint accepted (account isolation)', (await tryInsert({ owner_uid: 'owner-2' })) === 'ok');
check('bad fingerprint rejected', (await tryInsert({ owner_uid: 'o3', document_fingerprint: 'XYZ' })) === 'rejected');
check('expiry beyond 30 days rejected', (await tryInsert({ owner_uid: 'o4', expires_at: '2027-02-01T00:00:00Z' })) === 'rejected');
check('expiry before completion rejected', (await tryInsert({ owner_uid: 'o5', expires_at: '2026-11-01T00:00:00Z' })) === 'rejected');
check('non-object foundation rejected', (await tryInsert({ owner_uid: 'o6', foundation: '[1,2]' })) === 'rejected');
check('oversized foundation rejected', (await tryInsert({ owner_uid: 'o7', foundation: JSON.stringify({ x: 'a'.repeat(270000) }) })) === 'rejected');
check('bad source_mode rejected', (await tryInsert({ owner_uid: 'o8', source_mode: 'quick' })) === 'rejected');
check('bad job id rejected', (await tryInsert({ owner_uid: 'o9', source_job_id: 'bad id' })) === 'rejected');

const rls = await db.query(`select relrowsecurity from pg_class where relname = 'navigator_analysis_foundation'`);
check('row level security enabled', rls.rows[0]?.relrowsecurity === true);
const grants = await db.query(`select grantee from information_schema.role_table_grants where table_name='navigator_analysis_foundation' and grantee in ('anon','authenticated')`);
check('anon and authenticated have no table privileges', grants.rows.length === 0, JSON.stringify(grants.rows));

const forgetDoc = await db.query(`select public.navigator_analysis_foundation_forget('owner-1', $1) as n`, [FP('a')]);
check('forget by fingerprint removes only that document for that owner', forgetDoc.rows[0].n === 2, `removed ${forgetDoc.rows[0].n}`);
const survivor = await db.query(`select owner_uid from public.navigator_analysis_foundation where owner_uid = 'owner-2'`);
check('other owner row survives forget', survivor.rows.length === 1);

await insert({ owner_uid: 'owner-9', document_fingerprint: FP('b'), completed_at: '2026-11-01T00:00:00Z', expires_at: '2026-11-20T00:00:00Z' });
const purge = await db.query(`select public.navigator_analysis_foundation_purge_expired() as n`);
check('purge removes expired rows', purge.rows[0].n === 1, `removed ${purge.rows[0].n}`);

await db.exec(DOWN);
const gone = await db.query(`select to_regclass('public.navigator_analysis_foundation') as t`);
check('rollback drops the table', gone.rows[0].t === null);
await db.exec(UP);
check('re-apply after rollback succeeds', true);

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
