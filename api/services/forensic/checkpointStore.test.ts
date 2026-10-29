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

describe("engine job retention", () => {
  it("deletes every object of an expired job, including its documents, and keeps recent jobs", async () => {
    const { CheckpointStore, InMemoryObjectStore } = await import("./checkpointStore");
    const { createEngineState } = await import("./pipeline");
    const objects = new InMemoryObjectStore();
    const store = new CheckpointStore(objects);
    const docs = [{ id: "d", title: "t", kind: "OTHER" as const, extractionMethod: "TEXT_LAYER" as const, text: "case text", sourceFile: { mediaType: "application/pdf" as const, data: "JVBERi0=" } }];
    const meta = (jobId: string, createdAt: number) => ({ jobId, uid: "u", billing: "paid" as const, sessionId: "s", tier: "Pro", reservationId: "r", billingCycle: null, userEmail: null, documentName: null, mode: "full" as const, createdAt });
    for (const [id, at] of [["old", 0], ["new", 90_000_000]] as const) {
      const { state, media } = createEngineState({ documents: docs, models: { extractor: "s", investigator: "o", reviewer: "o" }, requestId: id });
      await store.start(id, meta(id, at), state, media);
      await store.advance(id, 0, state);
      await store.acquire(id, "extract:d", "w", 1000, 0);
      await store.settle(id, { kind: "DELIVERED", at: 0 });
    }
    const purged = await store.purgeExpired(100_000_000, 24 * 60 * 60 * 1000);
    expect(purged).toEqual(["old"]);
    expect([...objects.objects.keys()].filter((k) => k.startsWith("old/"))).toEqual([]);
    expect([...objects.objects.keys()].some((k) => k.startsWith("new/media.json"))).toBe(true);
  });

  it("never deletes a job when reading its meta encounters a storage error", async () => {
    const { CheckpointStore, InMemoryObjectStore } = await import("./checkpointStore");
    const { createEngineState } = await import("./pipeline");
    const objects = new InMemoryObjectStore();
    const store = new CheckpointStore(objects);
    const docs = [{ id: "d", title: "t", kind: "OTHER" as const, extractionMethod: "TEXT_LAYER" as const, text: "case text" }];
    const meta = { jobId: "active-job", uid: "u", billing: "paid" as const, sessionId: "s", tier: "Pro", reservationId: "r", billingCycle: null, userEmail: null, documentName: null, mode: "full" as const, createdAt: 99_000_000 };
    const { state, media } = createEngineState({ documents: docs, models: { extractor: "s", investigator: "o", reviewer: "o" }, requestId: "active-job" });
    await store.start("active-job", meta, state, media);

    // Simulate transient storage outage on meta.json read
    objects.failNextReadMatching = /meta\.json$/;
    const purged = await store.purgeExpired(100_000_000, 24 * 60 * 60 * 1000);
    expect(purged).toEqual([]);
    expect(await store.meta("active-job")).not.toBeNull();
  });

  it("keeps a job with missing meta if its state was created recently", async () => {
    const { CheckpointStore, InMemoryObjectStore } = await import("./checkpointStore");
    const { createEngineState } = await import("./pipeline");
    const objects = new InMemoryObjectStore();
    const store = new CheckpointStore(objects);
    const docs = [{ id: "d", title: "t", kind: "OTHER" as const, extractionMethod: "TEXT_LAYER" as const, text: "case text" }];
    const { state, media } = createEngineState({ documents: docs, models: { extractor: "s", investigator: "o", reviewer: "o" }, requestId: "partial-job", now: 95_000_000 });
    // Write state 0 directly without meta.json
    await objects.putIfAbsent("partial-job/state/000000.json", JSON.stringify(state));

    const purged = await store.purgeExpired(100_000_000, 24 * 60 * 60 * 1000);
    expect(purged).toEqual([]);
    expect((await store.latest("partial-job"))?.state.requestId).toBe("partial-job");
  });
});
