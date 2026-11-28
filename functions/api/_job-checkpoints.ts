/**
 * Stage checkpoints for a queued analysis. Each completed section is saved once, when it completes. A later delivery of
 * the same job reuses a saved section instead of producing it again, so a failure in a later stage does not restart
 * completed stages. A checkpoint is reused only when it was written under the same analyzer and prompt version
 * (the `version` field), so a deploy between deliveries cannot mix two versions of the same section.
 *
 * Storage: one object per job and stage in the private analysis bucket, written with x-upsert=false. The first value
 * saved for a stage is kept; a second delivery that produces the same stage cannot overwrite it.
 */
import { getDurableObject, putDurableObjectOnce, type DurableJobEnv } from './_durable-analysis-jobs';

export interface CheckpointRecord {
  version: string;
  value: Record<string, unknown>;
}

export interface CheckpointStore {
  save(jobId: string, stage: string, record: CheckpointRecord): Promise<'created' | 'exists'>;
  load(jobId: string, stage: string): Promise<CheckpointRecord | null>;
}

const JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;
const STAGE = /^[a-z][A-Za-z0-9]{0,40}$/;

function keyFor(jobId: string, stage: string): string {
  if (!JOB_ID.test(jobId) || !STAGE.test(stage)) throw new Error('Invalid checkpoint key.');
  return `checkpoints/${jobId}/${stage}.json`;
}

function isRecord(value: unknown): value is CheckpointRecord {
  return Boolean(value) && typeof value === 'object' && typeof (value as CheckpointRecord).version === 'string' &&
    Boolean((value as CheckpointRecord).value) && typeof (value as CheckpointRecord).value === 'object';
}

export function createDurableCheckpointStore(env: DurableJobEnv, fetcher: typeof fetch = fetch): CheckpointStore {
  return {
    async save(jobId, stage, record) {
      return await putDurableObjectOnce(env, keyFor(jobId, stage), record, fetcher);
    },
    async load(jobId, stage) {
      const stored = await getDurableObject(env, keyFor(jobId, stage), fetcher);
      return isRecord(stored) ? stored : null;
    },
  };
}

/** In-memory store with the same first-write-wins rule. For tests. */
export function createMemoryCheckpointStore(): CheckpointStore {
  const rows = new Map<string, CheckpointRecord>();
  return {
    async save(jobId, stage, record) {
      const key = keyFor(jobId, stage);
      if (rows.has(key)) return 'exists';
      rows.set(key, structuredClone(record));
      return 'created';
    },
    async load(jobId, stage) {
      const row = rows.get(keyFor(jobId, stage));
      return row ? structuredClone(row) : null;
    },
  };
}

/** Loads the checkpoints of the given stages that were written under `version`. Other versions are ignored. */
export async function loadCheckpoints(
  store: CheckpointStore,
  jobId: string,
  stages: readonly string[],
  version: string
): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const stage of stages) {
    const record = await store.load(jobId, stage);
    if (record && record.version === version) out[stage] = record.value;
  }
  return out;
}

/** Short, non-cryptographic label of a checkpoint value, recorded in the usage ledger. Not a security control. */
export function checkpointDigest(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ c, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
