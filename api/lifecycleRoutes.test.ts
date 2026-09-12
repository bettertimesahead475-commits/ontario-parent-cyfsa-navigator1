import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const current = vi.hoisted(() => ({ db: null as any }));
vi.mock("./services/access.js", () => ({ getSupabase: () => current.db }));
vi.mock("./services/firebaseAdmin.js", () => ({
  verifyFirebaseToken: vi.fn(async (header: string) => {
    if (header === "Bearer throws") throw new Error("credential secret");
    return ["Bearer A", "Bearer B"].includes(header)
      ? { uid: header.slice(7), email: `${header.slice(7)}@example.test` } : null;
  }),
}));
import { registerLifecycleRoutes } from "./lifecycleRoutes.js";

// Only the database transport and Firebase verifier are doubled. Routes and all
// account/client/matter services are real. RPC rollback below models the reviewed
// contract; it is NOT a claim that PostgreSQL or live RLS has been integration-tested.
function fakeDatabase() {
  const tables: Record<string, any[]> = {
    accounts: [], clients: [], navigator_matters: [], navigator_matter_members: [],
  };
  let sequence = 0;
  const row = (values: any) => ({ id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z", ...values });
  const db = {
    tables, failure: "", failMembership: false, clientLostAtRpc: false,
    beforeAuthorization: null as null | (() => void),
    calls: [] as any[],
    from(table: string) {
      let operation = "select";
      let values: any;
      let options: any;
      let single = false;
      const filters: [string, any][] = [];
      const query = {
        select(_columns: string) { return query; },
        eq(key: string, value: any) { filters.push([key, value]); return query; },
        insert(value: any) { operation = "insert"; values = value; return query; },
        upsert(value: any, opts: any) { operation = "upsert"; values = value; options = opts; return query; },
        single() { single = true; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve: (value: any) => any, reject?: (reason: any) => any) {
          return Promise.resolve().then(() => {
            db.calls.push({ table, operation, values, options, filters });
            if (db.failure === `${table}:${operation}`) {
              return { data: null, error: { message: "raw SQL secret internal_table", statusCode: 418 } };
            }
            let result: any[];
            if (operation === "upsert") {
              if (options?.onConflict !== "firebase_uid" || options?.ignoreDuplicates !== true) {
                throw new Error("Unsafe upsert contract");
              }
              if (!tables[table].some(x => x.firebase_uid === values.firebase_uid)) {
                tables[table].push(row({ status: "active", ...values }));
              }
              result = [];
            } else if (operation === "insert") {
              result = [row(values)]; tables[table].push(...result);
            } else {
              result = tables[table].filter(x => filters.every(([key, value]) => x[key] === value));
            }
            return { data: single ? result[0] ?? null : result, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name: string, args: any) {
      db.calls.push({ rpc: name, args });
      if (name === "read_navigator_owned_matter") {
        // Contract double only: does not prove PostgreSQL locking/concurrency.
        db.beforeAuthorization?.();
        if (db.failure === "authorization") return { data: null, error: { message: "SQL secret read_navigator_owned_matter" } };
        const a = tables.accounts.find(x => x.firebase_uid === args.p_firebase_uid && x.status === "active");
        const m = tables.navigator_matters.find(x => x.id === args.p_matter_id && x.account_id === a?.id);
        const c = tables.clients.find(x => x.id === m?.client_id && x.account_id === a?.id);
        const member = tables.navigator_matter_members.find(x => x.matter_id === m?.id && x.account_id === a?.id && x.role === "OWNER");
        return { data: a && m && c && member ? [m] : [], error: null };
      }
      if (name !== "create_navigator_matter_with_owner") throw new Error("Unexpected RPC");
      if (db.failure === "rpc") return { data: null, error: { message: "raw SQL secret internal_table" } };
      const account = tables.accounts.find(x => x.firebase_uid === args.p_firebase_uid);
      if (db.clientLostAtRpc || !tables.clients.some(x => x.id === args.p_client_id && x.account_id === account?.id)) {
        return { data: null, error: { message: "The supplied client does not belong to the resolved account." } };
      }
      // Stage the new matter before simulating the membership insert. Neither
      // staged row commits if membership fails, matching the single SQL RPC.
      const matter = row({ account_id: account.id, client_id: args.p_client_id,
        title: args.p_title, description: args.p_description });
      if (db.failMembership) return { data: null, error: { message: "membership constraint failed" } };
      const member = row({ matter_id: matter.id, account_id: account.id, role: "OWNER" });
      tables.navigator_matters.push(matter); tables.navigator_matter_members.push(member);
      return { data: matter, error: null };
    },
  };
  return db;
}

const app = express();
app.use(express.json());
registerLifecycleRoutes(app);
let db: ReturnType<typeof fakeDatabase>;
const unknownId = "00000000-0000-4000-8000-999999999999";
const spoof = { accountId: "B", account_id: "B", ownerUid: "B", firebase_uid: "B",
  role: "admin", primaryRole: "admin", primary_role: "admin", membershipRole: "ADMIN", created_by: "B" };
const post = (url: string, body: any = {}, uid = "A") => request(app).post(url).set("Authorization", `Bearer ${uid}`).send(body);
async function ownedClient(uid = "A") {
  const response = await post("/api/clients", { name: " Parent " }, uid);
  expect(response.status).toBe(201);
  return response.body.client.id as string;
}
async function ownedMatter() {
  const clientId = await ownedClient();
  const response = await post("/api/matters", { clientId, title: "Matter" });
  expect(response.status).toBe(201);
  return response.body.matter.id as string;
}
beforeEach(() => { db = fakeDatabase(); current.db = db; });

describe("account → client → matter lifecycle", () => {
  it.each(["inactive", "membership", "role", "account", "client", "missing"])("fails closed when final authorization denies %s after prechecks", async reason => {
    const id = await ownedMatter();
    db.beforeAuthorization = () => {
      if (reason === "inactive") db.tables.accounts[0].status = "suspended";
      if (reason === "membership") db.tables.navigator_matter_members.length = 0;
      if (reason === "role") db.tables.navigator_matter_members[0].role = "VIEWER";
      if (reason === "account") db.tables.navigator_matters[0].account_id = "other";
      if (reason === "client") db.tables.clients[0].account_id = "other";
      if (reason === "missing") db.tables.navigator_matters.length = 0;
    };
    const response = await request(app).get(`/api/matters/${id}`).set("Authorization", "Bearer A");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: "MATTER_NOT_FOUND", error: "Matter not found." });
    expect(db.calls.at(-1)).toEqual({ rpc: "read_navigator_owned_matter", args: { p_firebase_uid: "A", p_matter_id: id } });
  });
  it("returns the authoritative RPC row and sends only verified identity despite query spoofing", async () => {
    const id = await ownedMatter();
    db.beforeAuthorization = () => { db.tables.navigator_matters[0] = { ...db.tables.navigator_matters[0], title: "Authoritative" }; };
    const response = await request(app).get(`/api/matters/${id}?uid=B&account_id=B&role=OWNER`).set("Authorization", "Bearer A");
    expect(response.status).toBe(200); expect(response.body.matter.title).toBe("Authoritative");
    expect(db.calls.at(-1)).toEqual({ rpc: "read_navigator_owned_matter", args: { p_firebase_uid: "A", p_matter_id: id } });
  });
  it("does not fall back to prechecked data if the authorization RPC fails or is unavailable", async () => {
    const id = await ownedMatter(); db.failure = "authorization";
    const response = await request(app).get(`/api/matters/${id}`).set("Authorization", "Bearer A");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: "MATTER_LOOKUP_FAILED", error: "Matter lookup failed." });
  });
  it.each(["/api/account", "/api/clients", "/api/matters"])("rejects anonymous POST %s without touching the DB", async url => {
    expect((await request(app).post(url).send({})).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
  it("rejects anonymous matter reads", async () => {
    expect((await request(app).get(`/api/matters/${unknownId}`)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
  it("provisions idempotently using verified UID/email and ignores spoofed roles and ownership", async () => {
    const first = await post("/api/account", spoof);
    const second = await post("/api/account", { ...spoof, email: "attacker@example.test" });
    expect(first.status).toBe(200); expect(second.body).toEqual(first.body);
    expect(db.tables.accounts).toHaveLength(1);
    expect(db.tables.accounts[0]).toMatchObject({ firebase_uid: "A", primary_role: "parent", email: "A@example.test" });
  });
  it("handles competing first requests without duplicate accounts", async () => {
    const [a, b] = await Promise.all([post("/api/account"), post("/api/account")]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.account.id).toBe(b.body.account.id);
    expect(db.tables.accounts).toHaveLength(1);
  });
  it("preserves the server-stored role and profile on repeated resolution", async () => {
    await post("/api/account");
    Object.assign(db.tables.accounts[0], { primary_role: "lawyer", email: "stored@example.test" });
    const response = await post("/api/account", spoof);
    expect(response.body.account.primaryRole).toBe("lawyer");
    expect(db.tables.accounts[0].email).toBe("stored@example.test");
  });
  it.each(["suspended", "deleted"])("does not reactivate %s accounts", async status => {
    await post("/api/account"); db.tables.accounts[0].status = status;
    expect((await post("/api/account")).status).toBe(403);
    expect((await post("/api/clients", { name: "Client" })).status).toBe(403);
    expect((await post("/api/matters", { clientId: unknownId, title: "Matter" })).status).toBe(403);
    expect((await request(app).get(`/api/matters/${unknownId}`).set("Authorization", "Bearer A")).status).toBe(403);
    expect(db.tables.accounts[0].status).toBe(status);
  });
  it("creates an owned client without accepting identity or role input", async () => {
    await ownedClient("B");
    const response = await post("/api/clients", { ...spoof, name: " Alice " });
    expect(response.status).toBe(201); expect(response.body.client.name).toBe("Alice");
    const account = db.tables.accounts.find(x => x.firebase_uid === "A");
    expect(db.tables.clients.find(x => x.id === response.body.client.id).account_id).toBe(account.id);
    expect(account.primary_role).toBe("parent");
  });
  it.each([{}, { name: " " }, { name: 42 }, { name: "x".repeat(201) }, []])("rejects invalid client input %j before DB access", async body => {
    expect((await post("/api/clients", body)).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
  it("creates and retrieves an owned matter, ignoring spoofed identity and membership roles", async () => {
    const clientId = await ownedClient();
    const response = await post("/api/matters", { ...spoof, clientId, title: " My matter ", description: "Details" });
    expect(response.status).toBe(201);
    expect(response.body.matter).toMatchObject({ title: "My matter", clientId, accountId: db.tables.accounts[0].id });
    expect(db.tables.navigator_matter_members).toHaveLength(1);
    expect(db.tables.navigator_matter_members[0]).toMatchObject({ account_id: db.tables.accounts[0].id, role: "OWNER" });
    const read = await request(app).get(`/api/matters/${response.body.matter.id}`).set("Authorization", "Bearer A");
    expect(read.status).toBe(200); expect(read.body).toEqual(response.body);
    expect(db.calls.find(x => x.rpc)?.args.p_primary_role).toBe("parent");
  });
  it("returns the same safe 404 for absent and another account's client", async () => {
    const foreign = await ownedClient("B");
    const absent = await post("/api/matters", { clientId: unknownId, title: "Matter" });
    const denied = await post("/api/matters", { ...spoof, clientId: foreign, title: "Matter" });
    expect(absent.status).toBe(404); expect(denied.status).toBe(404); expect(denied.body).toEqual(absent.body);
    expect(db.calls.filter(x => x.rpc)).toHaveLength(0);
    expect(db.tables.navigator_matters).toHaveLength(0);
  });
  it.each([{}, { clientId: "invalid", title: "Matter" }, { clientId: unknownId, title: " " },
    { clientId: unknownId, title: "x".repeat(201) }, { clientId: unknownId, title: 12 },
    { clientId: unknownId, title: "M", description: {} },
    { clientId: unknownId, title: "M", description: "x".repeat(10001) }, []])("rejects invalid matter input %j", async body => {
    expect((await post("/api/matters", body)).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
  it("retains atomic RPC failure behavior without falling back to separate inserts", async () => {
    const clientId = await ownedClient(); db.failMembership = true;
    const response = await post("/api/matters", { clientId, title: "Matter" });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: "MATTER_CREATION_FAILED", error: "Matter creation failed." });
    expect(db.tables.navigator_matters).toHaveLength(0); expect(db.tables.navigator_matter_members).toHaveLength(0);
    expect(db.calls.filter(x => x.rpc)).toHaveLength(1);
    expect(db.calls.filter(x => x.operation === "insert" && x.table.startsWith("navigator_"))).toHaveLength(0);
  });
  it("fails safely if ownership disappears between the precheck and RPC", async () => {
    const clientId = await ownedClient(); db.clientLostAtRpc = true;
    const response = await post("/api/matters", { clientId, title: "Matter" });
    expect(response.status).toBe(404); expect(response.body.code).toBe("CLIENT_NOT_FOUND");
    expect(db.tables.navigator_matters).toHaveLength(0);
  });
  it("isolates matter reads even when the caller claims the owner's account", async () => {
    const matterId = await ownedMatter(); await post("/api/account", {}, "B");
    const response = await request(app).get(`/api/matters/${matterId}?accountId=${db.tables.accounts[0].id}&role=OWNER`)
      .set("Authorization", "Bearer B");
    expect(response.status).toBe(404); expect(response.body.code).toBe("MATTER_NOT_FOUND");
  });
  it("requires an OWNER membership even for an account-owned matter", async () => {
    const matterId = await ownedMatter(); db.tables.navigator_matter_members.length = 0;
    expect((await request(app).get(`/api/matters/${matterId}`).set("Authorization", "Bearer A")).status).toBe(404);
  });
  it("requires the matter's client to remain owned at retrieval", async () => {
    const matterId = await ownedMatter(); db.tables.clients[0].account_id = "other";
    expect((await request(app).get(`/api/matters/${matterId}`).set("Authorization", "Bearer A")).status).toBe(404);
  });
  it("does not provision accounts as a side effect of matter retrieval", async () => {
    expect((await request(app).get(`/api/matters/${unknownId}`).set("Authorization", "Bearer A")).status).toBe(404);
    expect(db.tables.accounts).toHaveLength(0);
  });
  it("rejects malformed matter IDs before database access", async () => {
    expect((await request(app).get('/api/matters/not-a-uuid').set("Authorization", "Bearer A")).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
  it.each(["accounts:select", "accounts:upsert"])("hides account database failures: %s", async failure => {
    db.failure = failure;
    const response = await post("/api/account");
    expect(response.status).toBe(500); expect(response.body).toEqual({ code: "ACCOUNT_PROVISIONING_FAILED", error: "Account provisioning failed." });
  });
  it("hides client insert failures", async () => {
    db.failure = "clients:insert";
    const response = await post("/api/clients", { name: "Client" });
    expect(response.status).toBe(500); expect(response.body.code).toBe("CLIENT_CREATION_FAILED");
    expect(JSON.stringify(response.body)).not.toMatch(/SQL|secret|internal_table/);
  });
  it.each(["clients:select", "rpc"])("hides matter creation database failures: %s", async failure => {
    const clientId = await ownedClient(); db.failure = failure;
    const response = await post("/api/matters", { clientId, title: "Matter" });
    expect(response.status).toBe(500); expect(response.body.code).toBe("MATTER_CREATION_FAILED");
    expect(JSON.stringify(response.body)).not.toMatch(/SQL|secret|internal_table/);
  });
  it.each(["navigator_matters:select", "navigator_matter_members:select"])("hides matter retrieval failures: %s", async failure => {
    const id = await ownedMatter(); db.failure = failure;
    const response = await request(app).get(`/api/matters/${id}`).set("Authorization", "Bearer A");
    expect(response.status).toBe(500); expect(response.body.code).toBe("MATTER_LOOKUP_FAILED");
  });
  it("handles verifier rejection without an Express async exception or leaked detail", async () => {
    const response = await post("/api/account", {}, "throws");
    expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(db.calls).toHaveLength(0);
  });
});
