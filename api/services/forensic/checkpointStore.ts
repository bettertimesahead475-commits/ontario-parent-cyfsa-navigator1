/**
 * Durable checkpoints and step leases for resumable Forensic Engine runs.
 *
 * Built on one primitive: create-if-absent ("putIfAbsent"). Supabase Storage provides it atomically (an upload with
 * upsert: false fails with 409 when the object exists, enforced by a unique key in its database), and the in-memory
 * store used by tests implements the same contract. Nothing here overwrites an object.
 *
 * - State is versioned: <jobId>/state/<seq>.json. A worker that finished step N writes seq N+1 only if no one else
 *   has; a slow worker whose lease expired can therefore never overwrite newer state.
 * - Leases are attempt-numbered: <jobId>/lease/<step>/<attempt>.json. Taking over an expired lease means creating
 *   attempt+1, which only one worker can do, so two workers never run the same step at the same time. A release is a
 *   marker object next to the attempt.
 * - Unlike the existing job store, failures here throw. A run that cannot be checkpointed must not pretend it was.
 */

import type { EngineMedia, EngineState } from "./pipeline.js";

export interface ObjectStore {
  get(key: string): Promise<string | null>;
  /** Creates the object. Returns false, without changing anything, if it already exists. */
  putIfAbsent(key: string, body: string): Promise<boolean>;
  /** Object names directly under a prefix ending in "/" (names only, not full keys). "" lists the top level. */
  list(prefix: string): Promise<string[]>;
  /** Deletes objects. Deleting a missing object is not an error. */
  remove(keys: string[]): Promise<void>;
}

export class InMemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, string>();
  /** Test hook: fail the next N writes, as a storage outage would. */
  failWrites = 0;
  /** Test hook: fail the next write whose key matches, then clear. */
  failNextWriteMatching: RegExp | null = null;
  /** Test hook: fail the next N reads, as a storage outage would. */
  failReads = 0;
  /** Test hook: fail the next read whose key matches, then clear. */
  failNextReadMatching: RegExp | null = null;
  async get(key: string) {
    if (this.failReads > 0) {
      this.failReads--;
      throw new Error("simulated storage read outage");
    }
    if (this.failNextReadMatching?.test(key)) {
      this.failNextReadMatching = null;
      throw new Error("simulated storage read outage");
    }
    return this.objects.get(key) ?? null;
  }
  async putIfAbsent(key: string, body: string) {
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("simulated storage outage");
    }
    if (this.failNextWriteMatching?.test(key)) {
      this.failNextWriteMatching = null;
      throw new Error("simulated storage outage");
    }
    if (this.objects.has(key)) return false;
    this.objects.set(key, body);
    return true;
  }
  async remove(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }
  async list(prefix: string) {
    const out = new Set<string>();
    for (const k of this.objects.keys()) {
      if (!k.startsWith(prefix)) continue;
      out.add(k.slice(prefix.length).split("/")[0]);
    }
    return [...out];
  }
}

export interface StorageOpCounts {
  reads: number;
  writes: number;
  lists: number;
  removes: number;
}

/** Counts storage operations, for the per-invocation log line. Behaviour is the inner store's. */
export class CountingObjectStore implements ObjectStore {
  readonly counts: StorageOpCounts = { reads: 0, writes: 0, lists: 0, removes: 0 };
  constructor(private readonly inner: ObjectStore) {}
  get(key: string) {
    this.counts.reads++;
    return this.inner.get(key);
  }
  putIfAbsent(key: string, body: string) {
    this.counts.writes++;
    return this.inner.putIfAbsent(key, body);
  }
  list(prefix: string) {
    this.counts.lists++;
    return this.inner.list(prefix);
  }
  remove(keys: string[]) {
    this.counts.removes++;
    return this.inner.remove(keys);
  }
}

export const ENGINE_BUCKET = "forensic_engine_jobs";

/** Supabase Storage implementation. The bucket is private; objects are deleted by retention policy, not here. */
export class SupabaseObjectStore implements ObjectStore {
  private bucketReady = false;
  constructor(private readonly db: any, private readonly bucket = ENGINE_BUCKET) {}

  private async ensureBucket() {
    if (this.bucketReady) return;
    const { data: buckets, error } = await this.db.storage.listBuckets();
    if (error) throw new Error(`Engine storage unavailable: ${error.message}`);
    const existing = (buckets ?? []).find((b: any) => b.name === this.bucket);
    if (existing?.public) throw new Error("Engine storage bucket is public; refusing to write case documents to it.");
    if (!existing) {
      const { error: createErr } = await this.db.storage.createBucket(this.bucket, { public: false });
      if (createErr && !String(createErr.message).includes("already exists")) throw new Error(`Engine storage unavailable: ${createErr.message}`);
    }
    this.bucketReady = true;
  }

  async get(key: string) {
    await this.ensureBucket();
    const { data, error } = await this.db.storage.from(this.bucket).download(key);
    if (error) {
      const status = Number(error.statusCode ?? error.status);
      if (status === 404 || /not found/i.test(String(error.message))) return null;
      throw new Error(`Engine storage read failed: ${error.message}`);
    }
    return data ? await data.text() : null;
  }

  async putIfAbsent(key: string, body: string) {
    await this.ensureBucket();
    const { error } = await this.db.storage.from(this.bucket).upload(key, body, { upsert: false, contentType: "application/json" });
    if (!error) return true;
    const status = Number(error.statusCode ?? error.status);
    if (status === 409 || /already exists|duplicate/i.test(String(error.message))) return false;
    throw new Error(`Engine storage write failed: ${error.message}`);
  }

  async remove(keys: string[]) {
    if (keys.length === 0) return;
    await this.ensureBucket();
    const { error } = await this.db.storage.from(this.bucket).remove(keys);
    if (error) throw new Error(`Engine storage delete failed: ${error.message}`);
  }

  async list(prefix: string) {
    await this.ensureBucket();
    const folder = prefix.replace(/\/$/, "");
    const { data, error } = await this.db.storage.from(this.bucket).list(folder, { limit: 1000 });
    if (error) throw new Error(`Engine storage list failed: ${error.message}`);
    return (data ?? []).map((o: any) => String(o.name));
  }
}

/** What the route needs to finish or release the analysis later. Stored once, when the job starts. */
export interface EngineJobMeta {
  jobId: string;
  uid: string | null;
  billing: "paid" | "admin";
  sessionId: string | null;
  tier: string | null;
  /** The starting request's reservation id: only it may release the credit. */
  reservationId: string | null;
  /** Billing cycle of the reservation, for the per-type usage counter. */
  billingCycle: string | null;
  userEmail: string | null;
  documentName: string | null;
  mode: "full";
  createdAt: number;
}

export interface Lease {
  step: string;
  attempt: number;
  owner: string;
  expiresAt: number;
}

const pad = (n: number) => String(n).padStart(6, "0");
// Step ids contain ":" (extract:<docId>); keep object names to a conservative character set.
const stepKey = (step: string) => step.replace(/[^A-Za-z0-9_-]/g, "~");

export class CheckpointStore {
  constructor(private readonly objects: ObjectStore) {}

  /** The same store, with its storage operations counted. */
  counted(): { store: CheckpointStore; counts: StorageOpCounts } {
    const counting = new CountingObjectStore(this.objects);
    return { store: new CheckpointStore(counting), counts: counting.counts };
  }

  private key(jobId: string, ...parts: string[]) {
    return [jobId, ...parts].join("/");
  }

  /** Writes meta, media and state 0. Returns false if this job was already started (nothing is overwritten). */
  async start(jobId: string, meta: EngineJobMeta, state: EngineState, media: EngineMedia): Promise<boolean> {
    if (!(await this.objects.putIfAbsent(this.key(jobId, "meta.json"), JSON.stringify(meta)))) return false;
    await this.objects.putIfAbsent(this.key(jobId, "media.json"), JSON.stringify(media));
    await this.objects.putIfAbsent(this.key(jobId, "state", `${pad(0)}.json`), JSON.stringify(state));
    return true;
  }

  async meta(jobId: string): Promise<EngineJobMeta | null> {
    const raw = await this.objects.get(this.key(jobId, "meta.json"));
    return raw ? (JSON.parse(raw) as EngineJobMeta) : null;
  }

  async media(jobId: string): Promise<EngineMedia> {
    const raw = await this.objects.get(this.key(jobId, "media.json"));
    return raw ? (JSON.parse(raw) as EngineMedia) : {};
  }

  async latest(jobId: string): Promise<{ seq: number; state: EngineState } | null> {
    const names = await this.objects.list(this.key(jobId, "state") + "/");
    const seqs = names.map((n) => Number(n.replace(/\.json$/, ""))).filter((n) => Number.isInteger(n) && n >= 0);
    if (seqs.length === 0) return null;
    const seq = Math.max(...seqs);
    const raw = await this.objects.get(this.key(jobId, "state", `${pad(seq)}.json`));
    if (!raw) return null;
    return { seq, state: JSON.parse(raw) as EngineState };
  }

  /** Saves the state that follows seq. Returns false if another worker already saved it. */
  async advance(jobId: string, seq: number, state: EngineState): Promise<boolean> {
    return this.objects.putIfAbsent(this.key(jobId, "state", `${pad(seq + 1)}.json`), JSON.stringify(state));
  }

  /** Takes the lease on a step. Returns null if another worker holds a live lease. */
  async acquire(jobId: string, step: string, owner: string, ttlMs: number, now: number): Promise<Lease | null> {
    const dir = this.key(jobId, "lease", stepKey(step)) + "/";
    const names = await this.objects.list(dir);
    const attempts = names.filter((n) => /^\d+\.json$/.test(n)).map((n) => Number(n.slice(0, -5)));
    const latest = attempts.length ? Math.max(...attempts) : 0;
    if (latest > 0) {
      const current = JSON.parse((await this.objects.get(`${dir}${pad(latest)}.json`)) ?? "null") as Lease | null;
      const released = names.includes(`${pad(latest)}.released`);
      if (current && !released && current.expiresAt > now) return current.owner === owner ? current : null;
    }
    const lease: Lease = { step, attempt: latest + 1, owner, expiresAt: now + ttlMs };
    return (await this.objects.putIfAbsent(`${dir}${pad(lease.attempt)}.json`, JSON.stringify(lease))) ? lease : null;
  }

  async release(jobId: string, lease: Lease): Promise<void> {
    await this.objects.putIfAbsent(this.key(jobId, "lease", stepKey(lease.step), `${pad(lease.attempt)}.released`), "{}");
  }

  /** Marks a job settled (delivered and charged, or failed and released). Returns false if it already was. */
  async settle(jobId: string, outcome: { kind: "DELIVERED" | "RELEASED"; at: number }): Promise<boolean> {
    return this.objects.putIfAbsent(this.key(jobId, "settled.json"), JSON.stringify(outcome));
  }

  /** Every object key of a job (meta, media, settlement, states, leases). */
  async keys(jobId: string): Promise<string[]> {
    const out: string[] = [];
    for (const name of await this.objects.list(`${jobId}/`)) {
      if (name === "state" || name === "lease") continue;
      out.push(`${jobId}/${name}`);
    }
    for (const name of await this.objects.list(`${jobId}/state/`)) out.push(`${jobId}/state/${name}`);
    for (const step of await this.objects.list(`${jobId}/lease/`)) {
      for (const name of await this.objects.list(`${jobId}/lease/${step}/`)) out.push(`${jobId}/lease/${step}/${name}`);
    }
    return out;
  }

  /**
   * Deletes jobs created more than retentionMs ago, including their documents and original files. A job whose meta
   * and state are confirmed absent or expired is deleted. A job whose records cannot be read due to a storage error
   * is never purged. At most `limit` jobs per call.
   */
  async purgeExpired(now: number, retentionMs: number, limit = 50): Promise<string[]> {
    const purged: string[] = [];
    for (const jobId of await this.objects.list("")) {
      if (purged.length >= limit) break;
      let meta: EngineJobMeta | null = null;
      try {
        meta = await this.meta(jobId);
      } catch {
        // Storage read error: do NOT delete an unconfirmed job during an outage.
        continue;
      }
      if (meta) {
        if (now - meta.createdAt < retentionMs) continue;
      } else {
        // If meta.json was not found (null), check latest state for recent activity before purging
        try {
          const latest = await this.latest(jobId);
          if (latest && now - latest.state.startedAt < retentionMs) continue;
        } catch {
          // If reading state also failed with an error, do NOT delete during storage error
          continue;
        }
      }
      await this.objects.remove(await this.keys(jobId));
      purged.push(jobId);
    }
    return purged;
  }

  async settled(jobId: string): Promise<{ kind: "DELIVERED" | "RELEASED"; at: number } | null> {
    const raw = await this.objects.get(this.key(jobId, "settled.json"));
    return raw ? JSON.parse(raw) : null;
  }
}
