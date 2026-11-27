// A minimal in-memory PostgREST/Storage double: GET filters rows by `col=eq.value`, RPCs and object writes are logged.
// It is deliberately literal so a missing ownership filter in the code under test returns another user's rows.
export interface FakeSupabase {
  tables: Record<string, Array<Record<string, unknown>>>;
  objects: Record<string, unknown>;
  jobs: Record<string, Record<string, unknown>>;
  reads: string[];
  writes: Array<{ method: string; url: string; body?: string }>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  handle: (url: string, init: RequestInit) => Response;
}

export function fakeSupabase(): FakeSupabase {
  const db: FakeSupabase = {
    tables: {}, objects: {}, jobs: {}, reads: [], writes: [], rpcs: [],
    handle(raw, init) {
      const url = new URL(raw);
      const method = (init.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : undefined;
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpc) {
        const args = body ? JSON.parse(body) : {};
        db.rpcs.push({ name: rpc[1], args });
        if (rpc[1] === 'analyzer_get_job') return Response.json(db.jobs[String(args.p_job_id)] ?? null);
        db.writes.push({ method, url: raw, body });
        return Response.json(null);
      }
      const obj = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
      if (obj) {
        const key = decodeURIComponent(obj[2]).replace(/\.json$/, '');
        if (method === 'GET') {
          db.reads.push('object:' + key);
          return key in db.objects ? Response.json(db.objects[key]) : Response.json({ statusCode: '404', error: 'not_found' }, { status: 400 });
        }
        db.writes.push({ method, url: raw, body });
        return Response.json({ Key: key });
      }
      const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
      if (table && method === 'GET') {
        db.reads.push(table);
        const filters = [...url.searchParams].filter(([, v]) => v.startsWith('eq.'));
        const rows = (db.tables[table] ?? []).filter((r) => filters.every(([k, v]) => String(r[k]) === v.slice(3)));
        return Response.json(rows);
      }
      if (method !== 'GET') { db.writes.push({ method, url: raw, body }); return Response.json([], { status: 201 }); }
      return Response.json({ error: 'unhandled' }, { status: 500 });
    },
  };
  return db;
}
