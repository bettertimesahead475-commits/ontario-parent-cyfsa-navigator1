import { describe, expect, it } from "vitest";
import type { GenerateFn } from "../analyzerSections";
import type { CaseDocument } from "./caseModel";
import { CheckpointStore, InMemoryObjectStore, type EngineJobMeta } from "./checkpointStore";
import { createEngineState, runForensicInvestigation } from "./pipeline";
import { advanceEngine } from "./resumableRunner";

const DOCS: CaseDocument[] = [
  {
    id: "aff",
    title: "Affidavit",
    kind: "AFFIDAVIT",
    extractionMethod: "TEXT_LAYER",
    text: "[Page 1]\nI, Jane Worker, am a child protection worker.\nI was told by a neighbour that the child was left alone.\n[Page 2]\nI did not attend the home.",
    sourceFile: { mediaType: "application/pdf", data: "JVBERi0=" },
  },
];
const MODELS = { extractor: "claude-sonnet-5", investigator: "claude-opus-5", reviewer: "claude-opus-5" };
const META: EngineJobMeta = { jobId: "job1", uid: "u", billing: "paid", sessionId: "s", tier: "Pro", reservationId: "r", billingCycle: null, userEmail: null, documentName: null, mode: "full", createdAt: 0 };

const RESPONSES: Record<string, string> = {
  forensic_extraction: JSON.stringify({ people: [{ name: "Jane Worker", roles: ["worker"], quote: "I, Jane Worker" }] }),
  forensic_investigation: JSON.stringify({
    hypotheses: [{ id: "H1", question: "Firsthand?", outcome: "UNDERMINED" }],
    findings: [{ id: "F1", hypothesisId: "H1", title: "Hearsay", statement: "Allegation is hearsay.", evidenceClass: "A", supporting: [{ documentId: "aff", quote: "I was told by a neighbour that the child was left alone." }, { documentId: "aff", quote: "I did not attend the home." }] }],
  }),
  forensic_adversarial_review: JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }] }),
};

function provider(opts: { failures?: Record<string, number>; delayMs?: number } = {}) {
  const calls: string[] = [];
  const failures = { ...opts.failures };
  const generate: GenerateFn = async (params, model) => {
    const stage = String(params.stage);
    calls.push(stage);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if ((failures[stage] ?? 0) > 0) {
      failures[stage]--;
      throw Object.assign(new Error("overloaded"), { status: 529 });
    }
    return { text: RESPONSES[stage] ?? "{}", model, durationMs: 1, usage: { input_tokens: 10, output_tokens: 5 } };
  };
  return { generate, calls };
}

async function startJob(objects = new InMemoryObjectStore()) {
  const store = new CheckpointStore(objects);
  const { state, media } = createEngineState({ documents: DOCS, models: MODELS, requestId: "job1", now: 0 });
  expect(await store.start("job1", META, state, media)).toBe(true);
  return { store, objects };
}

const far = () => Date.now() + 600_000;
const advance = (store: CheckpointStore, generate: GenerateFn, extra: Partial<Parameters<typeof advanceEngine>[0]> = {}) =>
  advanceEngine({ store, jobId: "job1", owner: `w-${Math.random()}`, deps: { generate, deadlineAt: far() }, minModelStepMs: 1_000, leaseTtlMs: 60_000, ...extra });

describe("resumable Forensic Engine runs", () => {
  it("can be interrupted after every step and resumed to the same result, running each model step once", async () => {
    const { store } = await startJob();
    const { generate, calls } = provider();
    let invocations = 0;
    let result;
    do {
      result = await advance(store, generate, { maxSteps: 1 });
      invocations++;
    } while (result.status === "PENDING" && invocations < 20);
    expect(result.status).toBe("COMPLETE");
    expect(invocations).toBe(6); // extract, build, investigate, review, visual (nothing to check), ground
    expect(calls).toEqual(["forensic_extraction", "forensic_investigation", "forensic_adversarial_review"]);

    const single = await runForensicInvestigation({ documents: DOCS, generate: provider().generate, models: MODELS, deadlineAt: far(), requestId: "job1" });
    const resumed = (result as any).state.report;
    expect(resumed.findings.map((f: any) => f.id)).toEqual(single.findings.map((f) => f.id));
    expect(resumed.status).toBe(single.status);
  });

  it("keeps the original file out of the saved state and gives it back to the visual stage", async () => {
    const { store, objects } = await startJob();
    const stateKeys = [...objects.objects.keys()].filter((k) => k.includes("/state/"));
    for (const k of stateKeys) expect(objects.objects.get(k)).not.toContain("JVBERi0=");
    expect(await store.media("job1")).toEqual({ aff: { sourceFile: { mediaType: "application/pdf", data: "JVBERi0=" } } });
  });

  it("never runs a step a second time once it is saved, even when a later invocation is asked again", async () => {
    const { store } = await startJob();
    const { generate, calls } = provider();
    expect((await advance(store, generate)).status).toBe("COMPLETE");
    expect((await advance(store, generate)).status).toBe("COMPLETE");
    expect(calls.filter((c) => c === "forensic_investigation")).toHaveLength(1);
  });

  it("lets only one of two concurrent workers run a step; the other makes no model call", async () => {
    const { store } = await startJob();
    const a = provider({ delayMs: 30 });
    const b = provider({ delayMs: 30 });
    const [ra, rb] = await Promise.all([
      advance(store, a.generate, { owner: "A", maxSteps: 1 }),
      advance(store, b.generate, { owner: "B", maxSteps: 1 }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual(["BUSY", "PENDING"]);
    expect(a.calls.length + b.calls.length).toBe(1);
  });

  it("does not repeat a model step that another worker finished while this worker was between steps", async () => {
    const { store } = await startJob();
    const { generate, calls } = provider();
    const acquire = store.acquire.bind(store);
    let raced = false;
    store.acquire = async (jobId, step, owner, ttlMs, now) => {
      if (step === "investigate" && owner === "worker-a" && !raced) {
        raced = true;
        // Worker B picks up the saved state and finishes the investigation before worker A takes its lease.
        expect((await advance(store, generate, { owner: "worker-b", maxSteps: 1 })).status).toBe("PENDING");
      }
      return acquire(jobId, step, owner, ttlMs, now);
    };
    const result = await advance(store, generate, { owner: "worker-a" });
    expect(raced).toBe(true);
    expect(result.status).toBe("COMPLETE");
    expect(calls.filter((c) => c === "forensic_investigation")).toHaveLength(1);
  });

  it("takes over a step whose worker died, once the lease has expired", async () => {
    const { store } = await startJob();
    const t0 = 1_000_000;
    expect(await store.acquire("job1", "extract:aff", "dead-worker", 60_000, t0)).not.toBeNull();
    const { generate, calls } = provider();
    const blocked = await advance(store, generate, { owner: "B", deps: { generate, deadlineAt: t0 + 600_000, now: () => t0 + 1_000 } });
    expect(blocked.status).toBe("BUSY");
    expect(calls).toHaveLength(0);
    const later = await advance(store, generate, { owner: "B", deps: { generate, deadlineAt: t0 + 700_000, now: () => t0 + 61_000 } });
    expect(later.status).toBe("COMPLETE");
  });

  it("discards the result of a stale worker instead of overwriting newer state", async () => {
    const { store } = await startJob();
    const latest = (await store.latest("job1"))!;
    expect(await store.advance("job1", latest.seq, latest.state)).toBe(true);
    expect(await store.advance("job1", latest.seq, { ...latest.state, calls: 999 })).toBe(false);
    expect((await store.latest("job1"))!.state.calls).toBe(0);
  });

  it("retries a transient model failure on the same job and completes", async () => {
    const { store } = await startJob();
    const { generate, calls } = provider({ failures: { forensic_investigation: 2 } });
    const r = await advance(store, generate);
    expect(r.status).toBe("COMPLETE");
    expect(calls.filter((c) => c === "forensic_investigation")).toHaveLength(3);
    expect((r as any).state.report.findings).toHaveLength(1);
    expect((r as any).state.attempts.investigate).toBe(2);
  });

  it("records the failure after the last attempt, exactly as a single run would", async () => {
    const { store } = await startJob();
    const { generate } = provider({ failures: { forensic_investigation: 5 } });
    const r = await advance(store, generate);
    expect(r.status).toBe("COMPLETE");
    const report = (r as any).state.report;
    expect(report.status).toBe("PARTIAL");
    expect(report.findings).toEqual([]);
    expect(report.stages.find((s: any) => s.stage === "INVESTIGATION").status).toBe("FAILED");
  });

  it("does not start a model step without enough time left, and is not charged an attempt for it", async () => {
    const { store } = await startJob();
    const { generate, calls } = provider();
    const r = await advance(store, generate, { deps: { generate, deadlineAt: Date.now() + 5_000 }, minModelStepMs: 30_000 });
    expect(r).toMatchObject({ status: "PENDING", nextStep: "extract:aff" });
    expect(calls).toHaveLength(0);
    expect((await store.latest("job1"))!.state.attempts).toEqual({});
  });

  it("survives a storage outage: the step is not saved, and the next invocation repeats it from the last checkpoint", async () => {
    const objects = new InMemoryObjectStore();
    const { store } = await startJob(objects);
    const { generate } = provider();
    objects.failWrites = 1; // the next write (the step lease) fails, as in a storage outage
    await expect(advance(store, generate)).rejects.toThrow(/outage/);
    const r = await advance(store, generate);
    expect(r.status).toBe("COMPLETE");
    expect((r as any).state.report.findings).toHaveLength(1);
  });

  it("repeats a step whose result could not be saved after the model call, and still completes once", async () => {
    const objects = new InMemoryObjectStore();
    const { store } = await startJob(objects);
    const { generate, calls } = provider();
    await advance(store, generate, { maxSteps: 2 }); // extract + build saved
    objects.failNextWriteMatching = /\/state\//; // the investigation result is lost after the model answered
    await expect(advance(store, generate)).rejects.toThrow(/outage/);
    const r = await advance(store, generate);
    expect(r.status).toBe("COMPLETE");
    // The lost step ran again (provider cost twice); the case result is the same and the job finishes once.
    expect(calls.filter((c) => c === "forensic_investigation")).toHaveLength(2);
    expect((r as any).state.report.findings.map((f: any) => f.id)).toEqual(["F1"]);
  });

  it("refuses to start the same job twice", async () => {
    const { store } = await startJob();
    const { state, media } = createEngineState({ documents: DOCS, models: MODELS, requestId: "job1" });
    expect(await store.start("job1", META, state, media)).toBe(false);
  });

  it("reports a job it has no state for as missing", async () => {
    const store = new CheckpointStore(new InMemoryObjectStore());
    expect((await advanceEngine({ store, jobId: "nope", owner: "x", deps: { generate: provider().generate, deadlineAt: far() }, minModelStepMs: 1, leaseTtlMs: 1 })).status).toBe("MISSING");
  });
});

describe("invocations a customer waits through (simulated clock)", () => {
  // Assumed provider latency, seconds: Sonnet extraction 30, Opus investigation 150, Opus review 120.
  const LATENCY: Record<string, number> = { forensic_extraction: 30_000, forensic_investigation: 150_000, forensic_adversarial_review: 120_000 };
  async function run(dependsOnVisual: boolean) {
    const objects = new InMemoryObjectStore();
    let mediaReads = 0;
    const get = objects.get.bind(objects);
    objects.get = async (k: string) => {
      if (k.endsWith("/media.json")) mediaReads++;
      return get(k);
    };
    const store = new CheckpointStore(objects);
    const { state, media } = createEngineState({ documents: DOCS, models: MODELS, requestId: "job1", now: 0 });
    await store.start("job1", META, state, media);
    let clock = 0;
    const generate: GenerateFn = async (params, model) => {
      const stage = String(params.stage);
      clock += LATENCY[stage] ?? 10_000;
      const text =
        stage === "forensic_investigation"
          ? JSON.stringify({ findings: [{ id: "F1", title: "Hearsay", statement: "Allegation is hearsay.", evidenceClass: "A", dependsOnVisual, supporting: [{ documentId: "aff", quote: "I did not attend the home." }] }] })
          : stage === "forensic_adversarial_review"
            ? JSON.stringify({ reviews: [{ findingId: "F1", verdict: "UPHELD" }] })
            : stage === "forensic_visual_verification"
              ? JSON.stringify({ results: [{ findingId: "F1", verdict: "CONFIRMED", observation: "x" }] })
              : "{}";
      return { text, model, durationMs: 1, usage: { input_tokens: 1, output_tokens: 1 } };
    };
    let invocations = 0;
    let result;
    do {
      invocations++;
      const start = clock;
      result = await advanceEngine({ store, jobId: "job1", owner: `w${invocations}`, deps: { generate, deadlineAt: start + 265_000, now: () => clock }, minModelStepMs: 200_000, leaseTtlMs: 260_000 });
      clock += 1_000; // the client's pause before it continues
    } while (result.status === "PENDING" && invocations < 10);
    return { status: result.status, invocations, mediaReads };
  }

  it("finishes a one-document case in two invocations and never downloads the original file when no page check is needed", async () => {
    // Before: three invocations, because the visual step (no model call here) waited for a fresh 200 s window,
    // and every invocation downloaded media.json.
    expect(await run(false)).toEqual({ status: "COMPLETE", invocations: 2, mediaReads: 0 });
  });

  it("still gives the visual stage the original file when a finding depends on the page", async () => {
    const r = await run(true);
    expect(r.status).toBe("COMPLETE");
    expect(r.mediaReads).toBe(1);
  });
});
