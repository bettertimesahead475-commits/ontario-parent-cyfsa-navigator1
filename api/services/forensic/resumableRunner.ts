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
 */

import { nextStep, runEngineStep, type EngineState, type StepDeps } from "./pipeline.js";
import type { CheckpointStore } from "./checkpointStore.js";

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
  let steps = 0;
  let knownLatest: { seq: number; state: EngineState } | null = null;
  for (;;) {
    const latest = knownLatest ?? (await opts.store.latest(opts.jobId));
    if (!latest) return { status: "MISSING" };
    const step = nextStep(latest.state);
    if (!step) return { status: "COMPLETE", state: latest.state };
    const timeLeft = opts.deps.deadlineAt - now();
    const needsModel = !DETERMINISTIC_STEPS.has(step);
    if ((opts.maxSteps !== undefined && steps >= opts.maxSteps) || (needsModel && timeLeft < opts.minModelStepMs)) {
      return { status: "PENDING", state: latest.state, nextStep: step };
    }

    const lease = await opts.store.acquire(opts.jobId, step, opts.owner, opts.leaseTtlMs, now());
    if (!lease) return { status: "BUSY", nextStep: step };
    try {
      // Another worker may have finished this step between our read and the lease.
      const current = knownLatest ?? (await opts.store.latest(opts.jobId));
      if (!current || current.seq !== latest.seq) {
        knownLatest = null;
        continue;
      }
      const before = current.state.attempts[step] ?? 0;
      const { state, outcome } = await runEngineStep(current.state, step, { ...opts.deps, media, resumable: true });
      steps++;
      const saved = await opts.store.advance(opts.jobId, current.seq, state);
      if (!saved) {
        knownLatest = null;
        continue; // a newer state exists; ours is discarded
      }
      knownLatest = { seq: current.seq + 1, state };
      if (outcome === "RETRY_LATER" && (state.attempts[step] ?? 0) === before) {
        // Interrupted by the deadline, not failed: hand over to the next invocation.
        return { status: "PENDING", state, nextStep: step };
      }
    } finally {
      await opts.store.release(opts.jobId, lease).catch(() => {});
    }
  }
}
