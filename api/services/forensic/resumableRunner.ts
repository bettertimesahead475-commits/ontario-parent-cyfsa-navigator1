/**
 * Runs a Forensic Engine job step by step across invocations, using CheckpointStore for state and leases.
 *
 * Guarantees (each tested in resumableRunner.test.ts):
 * - A completed step is never executed again: the runner always starts from the latest saved state, and a step is
 *   only saved once (state sequence numbers are create-if-absent).
 * - Two workers never run the same step at the same time: a step runs only under its lease. A worker that loses the
 *   lease race returns BUSY without calling a model.
 * - A worker whose lease expired mid-step cannot overwrite newer state: its save fails and its result is discarded.
 * - A model step is started only when this invocation has enough time left for it; otherwise the runner returns
 *   PENDING and the next invocation runs it. An interrupted step is not a failed attempt.
 * - A transient failure is saved as an attempt and retried (MAX_STEP_ATTEMPTS); then it is recorded as a failure,
 *   exactly as a single-invocation run records it.
 * - Independent per-document steps (extraction, and investigation in multi-pass runs) run as one batch with their
 *   model calls in parallel, each under its own lease, and are saved as one checkpoint. The saved state is the one
 *   running them one at a time would produce (pipeline.parallel.test.ts). A crash before that checkpoint repeats the
 *   whole batch, as it would repeat a single step.
 */

import { nextStep, parallelSteps, runEngineSteps, type EngineState, type StepDeps } from "./pipeline.js";
import type { CheckpointStore, Lease } from "./checkpointStore.js";

export type AdvanceResult =
  | { status: "COMPLETE"; state: EngineState }
  | { status: "PENDING"; state: EngineState; nextStep: string }
  | { status: "BUSY"; nextStep: string }
  | { status: "MISSING" };

/** Steps that make no model call and finish in milliseconds. */
const DETERMINISTIC_STEPS = new Set(["build", "ground"]);

export interface AdvanceOptions {
  store: CheckpointStore;
  jobId: string;
  /** Unique per invocation. */
  owner: string;
  deps: Omit<StepDeps, "media" | "resumable">;
  /** A model step is started only if at least this much time is left before deps.deadlineAt. */
  minModelStepMs: number;
  /** Lease length; must exceed the longest step (stage timeout plus a margin). */
  leaseTtlMs: number;
  /** Stops after this many steps (tests, and an upper bound per invocation). */
  maxSteps?: number;
}

export async function advanceEngine(opts: AdvanceOptions): Promise<AdvanceResult> {
  const now = opts.deps.now ?? Date.now;
  const media = await opts.store.media(opts.jobId);
  let batches = 0;
  let knownLatest: { seq: number; state: EngineState } | null = null;
  for (;;) {
    const latest = knownLatest ?? (await opts.store.latest(opts.jobId));
    if (!latest) return { status: "MISSING" };
    const step = nextStep(latest.state);
    if (!step) return { status: "COMPLETE", state: latest.state };
    const timeLeft = opts.deps.deadlineAt - now();
    const needsModel = !DETERMINISTIC_STEPS.has(step);
    if ((opts.maxSteps !== undefined && batches >= opts.maxSteps) || (needsModel && timeLeft < opts.minModelStepMs)) {
      return { status: "PENDING", state: latest.state, nextStep: step };
    }

    // Independent per-document steps run together, each under its own lease, and are saved as one checkpoint.
    const batch = parallelSteps(latest.state);
    const leases: Lease[] = [];
    for (const s of batch) {
      const lease = await opts.store.acquire(opts.jobId, s, opts.owner, opts.leaseTtlMs, now());
      if (!lease) break;
      leases.push(lease);
    }
    if (leases.length === 0) return { status: "BUSY", nextStep: step };
    const steps = batch.slice(0, leases.length);
    try {
      // Another worker may have finished this step between our read and the lease. Always re-read here, even when the
      // state we just saved is cached: a concurrent continue can save the next step before we take its lease.
      const current = await opts.store.latest(opts.jobId);
      if (!current || current.seq !== latest.seq) {
        knownLatest = null;
        continue;
      }
      const before = Object.fromEntries(steps.map((s) => [s, current.state.attempts[s] ?? 0]));
      const { state, outcomes } = await runEngineSteps(current.state, steps, { ...opts.deps, media, resumable: true });
      batches++;
      const saved = await opts.store.advance(opts.jobId, current.seq, state);
      if (!saved) {
        knownLatest = null;
        continue; // a newer state exists; ours is discarded
      }
      knownLatest = { seq: current.seq + 1, state };
      const interrupted = steps.find((s) => outcomes[s] === "RETRY_LATER" && (state.attempts[s] ?? 0) === before[s]);
      if (interrupted) {
        // Interrupted by the deadline, not failed: hand over to the next invocation.
        return { status: "PENDING", state, nextStep: interrupted };
      }
    } finally {
      for (const lease of leases) await opts.store.release(opts.jobId, lease).catch(() => {});
    }
  }
}
