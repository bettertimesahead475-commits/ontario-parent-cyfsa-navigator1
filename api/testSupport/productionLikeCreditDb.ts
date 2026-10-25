import { createHash } from "node:crypto";

// In-memory stand-in for the Supabase project as it is in production today, used by credit tests only.
//
// Production differences this models (verified read-only against the live schema):
// - analysis_credit_reservations and credit_audit_ledger do NOT exist. PostgREST returns an error
//   object (it does not throw), so every call on those tables fails with PGRST205.
// - navigator_paid_sessions has no credits_granted / credits_consumed / is_suspended columns.
//   Selecting them fails with 42703.
// - free_usage has PRIMARY KEY (uid). Inserting an existing uid fails with 23505.
//
// Each resolved query applies its filters and writes in one synchronous step, so concurrent
// callers interleave between queries but never inside one, like row-level writes in Postgres.

type Row = Record<string, any>;
// ---- Emulation of the atomic reservation functions (supabase/migrations_pending_approval/paid_credit_reservation_functions.sql).
// The SQL itself is verified against real PostgreSQL in api/services/paidCreditFunctions.pg.test.ts. This emulation
// mirrors it so the application logic can be tested without a database. Keep the two in step.
function interval(text: string): number {
  const [n, unit] = text.trim().split(/\s+/);
  const mult: Record<string, number> = { second: 1000, seconds: 1000, minute: 60000, minutes: 60000, day: 86400000, days: 86400000 };
  return Number(n) * (mult[unit] ?? 1000);
}

const markerUid = (session: string, request: string) =>
  `paid_res_${session}_${createHash("sha256").update(request).digest("hex").slice(0, 32)}`;

function stateForScope(scope: string): string {
  if (scope === "total") return "reservation:reserved";
  if (scope === "none") return "reservation:reserved:none";
  return `reservation:reserved:period:${scope.slice("period:".length)}`;
}

function counterFor(session: string, state: string): string | null {
  if (state === "reservation:reserved") return `paid_session_${session}_total`;
  if (state === "reservation:reserved:none") return null;
  const prefix = "reservation:reserved:period:";
  return state.startsWith(prefix) ? `paid_session_${session}_period_${state.slice(prefix.length)}` : null;
}

type Store = Map<string, Row>;

function emulateReserve(store: Store, a: Row) {
  const uid = markerUid(a.p_session, a.p_request);
  const state = stateForScope(a.p_scope);
  const counter = counterFor(a.p_session, state);
  const now = Date.parse(a.p_now);
  const ttl = interval(a.p_ttl);
  const claim = interval(a.p_claim_window);
  const prefix = `paid_res_${a.p_session}_`;

  // Reconcile stale reservations of this session (not the caller's own).
  for (const [key, row] of [...store.entries()]) {
    if (!key.startsWith(prefix) || key === uid) continue;
    if (!String(row.email ?? "").startsWith("reservation:reserved")) continue;
    const touched = Date.parse(row.last_analysis_at ?? row.first_analysis_at);
    if (touched > now - ttl) continue;
    const before = String(row.email);
    row.email = "reservation:released";
    row.last_analysis_at = new Date(now).toISOString();
    const c = counterFor(a.p_session, before);
    if (c && row.analyses_used > 0) {
      const cr = store.get(c);
      if (cr) cr.analyses_used = Math.max(0, cr.analyses_used - 1);
    }
  }

  const marker = store.get(uid);
  if (marker) {
    const touched = Date.parse(marker.last_analysis_at ?? marker.first_analysis_at);
    if (marker.email === "reservation:consumed") {
      return { status: "consumed", reservation_id: null, slot: marker.analyses_used };
    }
    if (String(marker.email ?? "").startsWith("reservation:reserved")) {
      if (marker.analyses_used > 0) return { status: "joined", reservation_id: null, slot: marker.analyses_used };
      if (now - touched <= claim) return { status: "in_progress", reservation_id: null };
    }
  }

  let slot = 0;
  if (counter) {
    const cr = store.get(counter);
    const used = cr?.analyses_used ?? 0;
    if (used >= a.p_granted) return { status: "limit", reservation_id: null };
    slot = used + 1;
    if (cr) {
      cr.analyses_used = slot;
      cr.last_analysis_at = a.p_now;
    } else {
      store.set(counter, { uid: counter, email: null, analyses_used: slot, first_analysis_at: a.p_now, last_analysis_at: a.p_now });
    }
  }
  if (marker) {
    Object.assign(marker, { email: state, analyses_used: slot, last_analysis_at: a.p_now });
  } else {
    store.set(uid, { uid, email: state, analyses_used: slot, first_analysis_at: a.p_now, last_analysis_at: a.p_now });
  }
  return { status: "reserved", reservation_id: uid, slot, counter_used: counter ? slot : null };
}

function emulateRelease(store: Store, a: Row) {
  const uid = markerUid(a.p_session, a.p_request);
  if (!a.p_reservation_id || a.p_reservation_id !== uid) return { status: "noop" };
  const r = store.get(uid);
  if (!r || !String(r.email ?? "").startsWith("reservation:reserved")) return { status: "noop" };
  const state = String(r.email);
  r.email = "reservation:released";
  r.last_analysis_at = a.p_now;
  const c = counterFor(a.p_session, state);
  if (c && r.analyses_used > 0) {
    const cr = store.get(c);
    if (cr) cr.analyses_used = Math.max(0, cr.analyses_used - 1);
  }
  return { status: "released" };
}

function emulateFinalize(store: Store, a: Row) {
  const uid = markerUid(a.p_session, a.p_request);
  const r = store.get(uid);
  if (!r) return { status: "missing" };
  if (r.email === "reservation:consumed") return { status: "consumed" };
  if (String(r.email ?? "").startsWith("reservation:reserved")) {
    r.email = "reservation:consumed";
    r.last_analysis_at = a.p_now;
    return { status: "consumed" };
  }
  return { status: "released" };
}

type Result = { data: any; error: any };

interface Filter {
  kind: "eq" | "in" | "like";
  field: string;
  value: any;
}

// PostgREST LIKE: * (or %) matches any run, _ matches one character, and a backslash escapes the next character.
function likeToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%" || c === "*") {
      source += ".*";
    } else if (c === "_") {
      source += ".";
    } else {
      source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "s");
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.field];
    if (f.kind === "eq") return v === f.value;
    if (f.kind === "in") return (f.value as any[]).includes(v);
    return typeof v === "string" && likeToRegExp(f.value).test(v);
  });
}

// Deterministic interleaving: each query yields for a fixed, cycling number of timer ticks, so concurrent
// callers always interleave the same way from run to run.
let pauseCount = 0;
function pause(): Promise<void> {
  pauseCount++;
  return new Promise((resolve) => setTimeout(resolve, pauseCount % 3));
}

// A query builder: filters accumulate; awaiting it runs the operation once.
function chain(run: (filters: Filter[]) => Promise<Result> | Result, single = false) {
  const filters: Filter[] = [];
  const builder: any = {
    eq(field: string, value: any) {
      filters.push({ kind: "eq", field, value });
      return builder;
    },
    in(field: string, value: any[]) {
      filters.push({ kind: "in", field, value });
      return builder;
    },
    like(field: string, value: string) {
      filters.push({ kind: "like", field, value });
      return builder;
    },
    select() {
      return builder;
    },
    retry() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(run(filters)).then((r) => ({
        data: Array.isArray(r.data) ? r.data[0] ?? null : r.data,
        error: r.error,
      }));
    },
    then(onFulfilled: any, onRejected: any) {
      return Promise.resolve(run(filters))
        .then((r) => (single ? { data: r.data?.[0] ?? null, error: r.error } : r))
        .then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const PGRST205 = (table: string) => ({
  code: "PGRST205",
  message: `Could not find the table 'public.${table}' in the schema cache`,
});

export function createProductionLikeDb(seed: {
  usage?: Record<string, number>;
  sessions?: Row[];
  // Simulates a write outage on free_usage. Reads still work.
  failWrites?: boolean;
} = {}) {
  // Lost-response fault: the next N free_usage updates are applied, then reported as failed (as if the response was lost).
  // failNextRpc: the named function is refused before it runs (nothing is applied), for the next N calls to that name.
  const faults = { commitThenFailUpdates: 0, commitThenFailRpc: 0, failNextRpc: {} as Record<string, number> };
  // Supabase Storage (the durable analysis job store), in memory. failUploadMatching refuses an upload whose body matches.
  const storageObjects = new Map<string, string>();
  const storageFaults: { failUploads: number; failUploadMatching: ((body: string) => boolean) | null } = {
    failUploads: 0,
    failUploadMatching: null,
  };
  const buckets = new Set<string>();
  const outage = () => ({ code: "PGRST000", message: "simulated database write outage" });
  const freeUsage = new Map<string, Row>();
  for (const [uid, analyses_used] of Object.entries(seed.usage ?? {})) {
    freeUsage.set(uid, { uid, email: null, analyses_used, first_analysis_at: null, last_analysis_at: null });
  }
  const sessions = new Map<string, Row>((seed.sessions ?? []).map((s) => [s.id, { ...s }]));
  const queryLog: string[] = [];

  function freeUsageTable() {
    return {
      select(cols = "*") {
        return chain(async (filters) => {
          await pause();
          queryLog.push(`select free_usage ${cols}`);
          const rows = [...freeUsage.values()].filter((r) => matches(r, filters)).map((r) => ({ ...r }));
          return { data: rows, error: null };
        });
      },
      insert(row: Row) {
        return chain(async () => {
          await pause();
          if (seed.failWrites) return { data: null, error: outage() };
          if (freeUsage.has(row.uid)) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"free_usage_pkey\"" } };
          }
          freeUsage.set(row.uid, { ...row });
          return { data: [{ ...row }], error: null };
        });
      },
      upsert(row: Row) {
        return chain(async () => {
          await pause();
          if (seed.failWrites) return { data: null, error: outage() };
          freeUsage.set(row.uid, { ...freeUsage.get(row.uid), ...row });
          return { data: [{ ...row }], error: null };
        });
      },
      update(patch: Row) {
        return chain(async (filters) => {
          await pause();
          if (seed.failWrites) return { data: null, error: outage() };
          const updated: Row[] = [];
          for (const row of freeUsage.values()) {
            if (matches(row, filters)) {
              Object.assign(row, patch);
              updated.push({ ...row });
            }
          }
          if (faults.commitThenFailUpdates > 0) {
            faults.commitThenFailUpdates--;
            return { data: null, error: outage() };
          }
          return { data: updated, error: null };
        });
      },
      delete() {
        return chain(async (filters) => {
          await pause();
          if (seed.failWrites) return { data: null, error: outage() };
          const deleted: Row[] = [];
          for (const [uid, row] of freeUsage) {
            if (matches(row, filters)) {
              freeUsage.delete(uid);
              deleted.push({ ...row });
            }
          }
          return { data: deleted, error: null };
        });
      },
    };
  }

  function sessionsTable() {
    return {
      // The administrative suspension columns do not exist in production yet.
      update() {
        return chain(() => ({ data: null, error: { code: "42703", message: "column navigator_paid_sessions.is_suspended does not exist" } }));
      },
      select(cols = "*") {
        return chain(async (filters) => {
          await pause();
          if (cols.includes("credits_")) {
            return { data: null, error: { code: "42703", message: "column navigator_paid_sessions.credits_granted does not exist" } };
          }
          const rows = [...sessions.values()].filter((r) => matches(r, filters)).map((r) => ({ ...r }));
          return { data: rows, error: null };
        });
      },
    };
  }

  function missingTable(table: string) {
    const failed = () => chain(() => ({ data: null, error: PGRST205(table) }));
    return { select: failed, insert: failed, update: failed, upsert: failed, delete: failed };
  }

  // The subset of the Supabase Storage client that the durable job store uses. Errors are returned, not thrown,
  // as Supabase does, so a caller that ignores `error` would wrongly believe the write succeeded.
  const storage = {
    _objects: storageObjects,
    _faults: storageFaults,
    async listBuckets() {
      return { data: [...buckets].map((name) => ({ name, public: false })), error: null };
    },
    async createBucket(name: string) {
      if (buckets.has(name)) return { data: null, error: { message: "Bucket already exists" } };
      buckets.add(name);
      return { data: { name }, error: null };
    },
    async updateBucket() {
      return { data: null, error: null };
    },
    from(bucket: string) {
      return {
        async upload(path: string, body: string) {
          const text = String(body);
          const refused =
            storageFaults.failUploads > 0 || (storageFaults.failUploadMatching?.(text) ?? false);
          if (storageFaults.failUploads > 0) storageFaults.failUploads--;
          if (refused) return { data: null, error: { message: "simulated storage upload failure" } };
          storageObjects.set(`${bucket}/${path}`, text);
          return { data: { path }, error: null };
        },
        async download(path: string) {
          const text = storageObjects.get(`${bucket}/${path}`);
          if (text === undefined) return { data: null, error: { message: "Object not found" } };
          return { data: new Blob([text]), error: null };
        },
      };
    },
  };

  return {
    _freeUsage: freeUsage,
    _faults: faults,
    storage,
    // Calls one of the atomic functions. Applied in one step; a configured fault applies it and then reports a lost response.
    rpc(name: string, args: Row) {
      return (async () => {
        await pause();
        if (seed.failWrites) return { data: null, error: outage() };
        if ((faults.failNextRpc[name] ?? 0) > 0) {
          faults.failNextRpc[name]--;
          return { data: null, error: outage() };
        }
        const store = freeUsage as Store;
        let data: any;
        if (name === "paid_reserve_credit") data = emulateReserve(store, args);
        else if (name === "paid_release_credit") data = emulateRelease(store, args);
        else if (name === "paid_finalize_credit") data = emulateFinalize(store, args);
        else return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
        if (faults.commitThenFailRpc > 0) {
          faults.commitThenFailRpc--;
          return { data: null, error: outage() };
        }
        return { data, error: null };
      })();
    },
    _sessions: sessions,
    _queryLog: queryLog,
    from(table: string) {
      if (table === "free_usage") return freeUsageTable();
      if (table === "navigator_paid_sessions") return sessionsTable();
      return missingTable(table);
    },
  };
}
