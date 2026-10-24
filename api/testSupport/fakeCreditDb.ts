// In-memory stand-in for the Supabase tables that credit accounting reads and writes. Shared by tests only.

export interface FakeSessionRow {
  id: string;
  tier: string;
  credits_granted: number;
  credits_consumed: number;
  is_suspended: boolean;
  suspended_reason?: string | null;
  revoked_at?: string | null;
}

interface FakeReservationRow {
  id: string;
  session_id: string;
  firebase_uid: string;
  slot_index: number;
  request_id: string;
  analysis_type: string;
  status: "reserved" | "finalized" | "released";
  document_name?: string | null;
}

export function createFakeDb(initialSessions: FakeSessionRow[] = []) {
  const sessions: Map<string, FakeSessionRow> = new Map(
    initialSessions.map((s) => [s.id, { ...s }])
  );
  const reservations: FakeReservationRow[] = [];
  const freeUsage: Map<string, any> = new Map();
  const auditLedger: any[] = [];

  const networkDelay = () => new Promise((resolve) => setTimeout(resolve, 1));

  return {
    _sessions: sessions,
    _reservations: reservations,
    _auditLedger: auditLedger,
    from(table: string) {
      if (table === "navigator_paid_sessions") {
        return {
          select: (_cols?: string) => ({
            eq: (_field: string, id: string) => ({
              maybeSingle: async () => {
                await networkDelay();
                const session = sessions.get(id);
                return { data: session ? { ...session } : null, error: null };
              },
            }),
          }),
          update: (patch: Partial<FakeSessionRow>) => ({
            eq: (_field: string, id: string) => {
              const session = sessions.get(id);
              if (session) {
                Object.assign(session, patch);
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "analysis_credit_reservations") {
        return {
          insert: async (row: any) => {
            await networkDelay();
            // Check unique constraint on (session_id, slot_index) and request_id
            const duplicateSlot = reservations.find(
              (r) => r.session_id === row.session_id && r.slot_index === row.slot_index && r.status !== "released"
            );
            const duplicateReq = reservations.find((r) => r.request_id === row.request_id);

            if (duplicateSlot || duplicateReq) {
              const err: any = new Error("Unique constraint violation");
              err.code = "23505";
              return { data: null, error: err };
            }

            const newRow: FakeReservationRow = {
              id: row.id || `res_${Date.now()}_${Math.random()}`,
              session_id: row.session_id,
              firebase_uid: row.firebase_uid,
              slot_index: row.slot_index,
              request_id: row.request_id,
              analysis_type: row.analysis_type,
              status: row.status || "reserved",
              document_name: row.document_name,
            };
            reservations.push(newRow);
            return { data: [newRow], error: null };
          },
          select: (_cols?: string) => ({
            eq: (field: string, val: any) => {
              const getFiltered = () => reservations.filter((r) => (r as any)[field] === val);
              return {
                then: (onfulfilled: any, onrejected: any) => {
                  return networkDelay()
                    .then(() => ({ data: getFiltered().map((r) => ({ ...r })), error: null }))
                    .then(onfulfilled, onrejected);
                },
                maybeSingle: async () => {
                  await networkDelay();
                  const found = reservations.find((r) => (r as any)[field] === val);
                  return { data: found ? { ...found } : null, error: null };
                },
              };
            },
          }),
          update: (patch: Partial<FakeReservationRow>) => ({
            eq: (fieldA: string, valA: any) => {
              const applyPatch = (fieldB?: string, valB?: any) => {
                for (const res of reservations) {
                  if ((res as any)[fieldA] === valA && (!fieldB || (res as any)[fieldB] === valB)) {
                    Object.assign(res, patch);
                  }
                }
                return { error: null };
              };
              return {
                then: (onfulfilled: any, onrejected: any) => {
                  return networkDelay()
                    .then(() => applyPatch())
                    .then(onfulfilled, onrejected);
                },
                eq: (fieldB: string, valB: any) => {
                  return networkDelay().then(() => applyPatch(fieldB, valB));
                },
              };
            },
          }),
        };
      }

      if (table === "free_usage") {
        return {
          select: () => ({
            eq: (_field: string, uid: string) => ({
              maybeSingle: async () => {
                await networkDelay();
                const row = freeUsage.get(uid);
                return { data: row ? { ...row } : null, error: null };
              },
            }),
          }),
          upsert: async (row: any) => {
            await networkDelay();
            freeUsage.set(row.uid, { ...row });
            return { error: null };
          },
          delete: () => ({
            eq: (_field: string, uid: string) => {
              freeUsage.delete(uid);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "credit_audit_ledger") {
        return {
          insert: async (entry: any) => {
            auditLedger.push(entry);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}
