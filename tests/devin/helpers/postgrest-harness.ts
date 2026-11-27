// Disposable PostgreSQL + the real PostgREST binary, for payment-schema qualification tests.
// The handlers' fetch is routed: /rest/v1/* to PostgREST (real SQL, grants, RLS, schema cache, error codes);
// /storage/v1/* (audit trail and create-once locks) to an in-memory double with Storage's semantics.
// Never points at a hosted project: the database is created and dropped here, the service key is a local JWT.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const JWT_SECRET = 'disposable-postgrest-harness-secret-0123456789';

export function findPostgrest(): string | null {
  const candidates = [process.env.POSTGREST_BIN, path.join(os.homedir(), 'tools/postgrest'), '/usr/local/bin/postgrest', '/usr/bin/postgrest'];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');
/** HS256 JWT for the local PostgREST only (role claim selects the database role, as on Supabase). */
export function localJwt(role: string): string {
  const head = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ role, iat: 1 }))}`;
  return `${head}.${b64(createHmac('sha256', JWT_SECRET).update(head).digest())}`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer(); s.unref(); s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
  });
}

/** A request the router is about to forward (or has forwarded). Hooks may delay or throw to inject faults. */
export type Hop = { method: string; target: string; path: string; search: URLSearchParams; body: unknown };
export type Hook = (hop: Hop, phase: 'before' | 'after') => Promise<void> | void;

export class Harness {
  pool!: pg.Pool;
  private admin!: pg.Client;
  private proc: ChildProcess | null = null;
  private port = 0;
  readonly audit = new Map<string, unknown>();
  readonly locks = new Set<string>();
  hooks: Hook[] = [];
  storageDown = 0;
  log: string[] = [];
  /** The fetch in place before a test stubs the global one with `this.fetch`. */
  private realFetch: typeof fetch = globalThis.fetch;

  constructor(readonly adminUrl: string, readonly dbName: string, readonly bin: string) {}

  get dbUrl(): string { const u = new URL(this.adminUrl); u.pathname = `/${this.dbName}`; return u.toString(); }

  async start(sql: string[]): Promise<void> {
    this.realFetch = globalThis.fetch;
    this.admin = new pg.Client({ connectionString: this.adminUrl }); await this.admin.connect();
    await this.admin.query(`create database ${this.dbName}`);
    this.pool = new pg.Pool({ connectionString: this.dbUrl, max: 6 });
    this.pool.on('error', () => undefined);
    for (const s of sql) await this.pool.query(s);
    this.port = await freePort();
    this.proc = spawn(this.bin, [], {
      env: {
        PATH: process.env.PATH ?? '', PGRST_DB_URI: this.dbUrl, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
        PGRST_JWT_SECRET: JWT_SECRET, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(this.port),
        PGRST_DB_POOL: '10', PGRST_DB_CHANNEL_ENABLED: 'true', PGRST_LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc.stdout?.on('data', (d) => this.log.push(String(d)));
    this.proc.stderr?.on('data', (d) => this.log.push(String(d)));
    for (let i = 0; i < 100; i++) {
      const ok = await this.realFetch(`http://127.0.0.1:${this.port}/`).then((r) => r.ok).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`PostgREST did not start: ${this.log.join('')}`);
  }

  /** Runs migration SQL and waits until PostgREST's schema cache has reloaded (probe: a query that must succeed). */
  async migrate(sql: string, probe: string): Promise<void> {
    await this.pool.query(sql);
    await this.pool.query(`notify pgrst, 'reload schema'`);
    for (let i = 0; i < 100; i++) {
      const r = await this.realFetch(`http://127.0.0.1:${this.port}/${probe}`, { headers: { Authorization: `Bearer ${localJwt('service_role')}` } });
      if (r.ok) return;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error(`PostgREST schema cache did not reload for ${probe}`);
  }

  async stop(): Promise<void> {
    this.proc?.kill('SIGTERM');
    await this.pool?.end().catch(() => undefined);
    if (this.admin) {
      await this.admin.query(`drop database if exists ${this.dbName} with (force)`).catch(() => undefined);
      await this.admin.end();
    }
  }

  async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query(sql, params)).rows as T[];
  }

  /** Simulates the minute changing: per-minute reissue/claim locks expire, create-once locks stay. */
  nextMinute(): void { for (const l of [...this.locks]) if (l.startsWith('reissue-')) this.locks.delete(l); }

  private async run(hop: Hop, phase: 'before' | 'after') { for (const h of this.hooks) await h(hop, phase); }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' && init.body ? (() => { try { return JSON.parse(init.body as string); } catch { return init.body; } })() : undefined;
    if (u.pathname.startsWith('/rest/v1/')) {
      const target = u.pathname.slice('/rest/v1/'.length);
      const hop: Hop = { method, target, path: `${target}${u.search}`, search: u.searchParams, body };
      await this.run(hop, 'before');
      const headers = new Headers(init?.headers);
      headers.delete('apikey');
      const res = await this.realFetch(`http://127.0.0.1:${this.port}/${target}${u.search}`, { method, headers, body: init?.body as BodyInit | undefined });
      const text = await res.text();
      await this.run(hop, 'after');
      return new Response(res.status === 204 ? null : text, { status: res.status, headers: res.headers });
    }
    if (u.pathname.startsWith('/storage/v1/')) return this.storage(u, method, body);
    throw new TypeError(`harness: unexpected outbound request to ${u.origin}`);
  };

  private storage(u: URL, method: string, body: unknown): Response {
    if (this.storageDown > 0) { this.storageDown--; return Response.json({ message: 'storage unavailable' }, { status: 503 }); }
    const p = decodeURIComponent(u.pathname);
    if (method === 'POST' && p === '/storage/v1/object/list/analysis_jobs') {
      const b = body as { prefix?: string; limit?: number; offset?: number };
      const names = [...this.audit.keys()].sort().reverse();
      return Response.json(names.slice(b.offset ?? 0, (b.offset ?? 0) + (b.limit ?? 100)).map((name) => ({ name })));
    }
    const lock = /^\/storage\/v1\/object\/analysis_jobs\/admin-locks\/(.+)$/.exec(p);
    if (lock && method === 'POST') {
      if (this.locks.has(lock[1])) return Response.json({ statusCode: '409', error: 'Duplicate' }, { status: 400 });
      this.locks.add(lock[1]); return Response.json({ Key: lock[1] });
    }
    const rec = /^\/storage\/v1\/object\/(?:authenticated\/)?analysis_jobs\/[^/]+\/(.+)$/.exec(p);
    if (rec && method === 'POST') {
      if (this.audit.has(rec[1])) return Response.json({ statusCode: '409' }, { status: 400 });
      this.audit.set(rec[1], body); return Response.json({ Key: rec[1] });
    }
    if (rec && method === 'GET') return this.audit.has(rec[1]) ? Response.json(this.audit.get(rec[1])) : Response.json({}, { status: 404 });
    return Response.json({ message: `harness: unsupported storage call ${method} ${p}` }, { status: 400 });
  }
}
