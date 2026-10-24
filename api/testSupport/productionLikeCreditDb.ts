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

  return {
    _freeUsage: freeUsage,
    _sessions: sessions,
    _queryLog: queryLog,
    from(table: string) {
      if (table === "free_usage") return freeUsageTable();
      if (table === "navigator_paid_sessions") return sessionsTable();
      return missingTable(table);
    },
  };
}
