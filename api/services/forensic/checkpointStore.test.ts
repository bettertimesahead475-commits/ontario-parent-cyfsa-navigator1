import { describe, expect, it } from "vitest";
import { SupabaseObjectStore } from "./checkpointStore";

function fakeDb(opts: { publicBucket?: boolean; buckets?: string[] } = {}) {
  const objects = new Map<string, string>();
  const created: string[] = [];
  const db = {
    storage: {
      listBuckets: async () => ({ data: (opts.buckets ?? ["forensic_engine_jobs"]).map((name) => ({ name, public: opts.publicBucket ?? false })), error: null }),
      createBucket: async (name: string, o: any) => {
        created.push(`${name}:${o.public}`);
        return { error: null };
      },
      from: () => ({
        upload: async (key: string, body: string, o: any) => {
          if (o.upsert !== false) throw new Error("must not upsert");
          if (objects.has(key)) return { error: { statusCode: "409", message: "The resource already exists" } };
          objects.set(key, body);
          return { error: null };
        },
        download: async (key: string) =>
          objects.has(key) ? { data: { text: async () => objects.get(key)! }, error: null } : { data: null, error: { statusCode: "404", message: "Object not found" } },
        list: async (folder: string) => ({
          data: [...new Set([...objects.keys()].filter((k) => k.startsWith(folder + "/")).map((k) => k.slice(folder.length + 1).split("/")[0]))].map((name) => ({ name })),
          error: null,
        }),
      }),
    },
  };
  return { db, objects, created };
}

describe("SupabaseObjectStore", () => {
  it("creates without overwriting, reports an existing object as false, and a missing one as null", async () => {
    const { db } = fakeDb();
    const s = new SupabaseObjectStore(db);
    expect(await s.putIfAbsent("j/state/000000.json", "a")).toBe(true);
    expect(await s.putIfAbsent("j/state/000000.json", "b")).toBe(false);
    expect(await s.get("j/state/000000.json")).toBe("a");
    expect(await s.get("j/none.json")).toBeNull();
    expect(await s.list("j/state/")).toEqual(["000000.json"]);
  });

  it("creates a private bucket when none exists", async () => {
    const { db, created } = fakeDb({ buckets: [] });
    await new SupabaseObjectStore(db).putIfAbsent("k", "v");
    expect(created).toEqual(["forensic_engine_jobs:false"]);
  });

  it("refuses to write case documents to a public bucket", async () => {
    const { db } = fakeDb({ publicBucket: true });
    await expect(new SupabaseObjectStore(db).putIfAbsent("k", "v")).rejects.toThrow(/public/);
  });

  it("throws on a storage error instead of pretending the write happened", async () => {
    const { db } = fakeDb();
    (db.storage as any).from = () => ({ upload: async () => ({ error: { statusCode: "500", message: "boom" } }) });
    await expect(new SupabaseObjectStore(db).putIfAbsent("k", "v")).rejects.toThrow(/write failed/);
  });
});
